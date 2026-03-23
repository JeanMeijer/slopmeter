import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  type DailyTotalsByDate,
  type DailyTokenTotals,
  type ModelTokenTotals,
  addDailyTokenTotals,
  addModelTokenTotals,
  createUsageSummary,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
  parseJsonTextWithLimit,
  readJsonDocument,
} from "./utils";

interface OpenCodeTokenCache {
  read?: number;
  write?: number;
}

interface OpenCodeTokens {
  input?: number;
  output?: number;
  cache?: OpenCodeTokenCache;
}

interface OpenCodeMessage {
  id: string;
  role?: string;
  providerID: string;
  modelID: string;
  time: { created: number };
  tokens?: OpenCodeTokens;
}

interface OpenCodeMessageRow {
  id: string;
  data: string;
}

interface OpenCodeDatabaseSource {
  kind: "database";
  path: string;
}

interface OpenCodeLegacySource {
  kind: "legacy";
  files: string[];
}

type OpenCodeSource = OpenCodeDatabaseSource | OpenCodeLegacySource;

function sumOpenCodeTokens(tokens?: OpenCodeTokens): DailyTokenTotals {
  const cacheInput = tokens?.cache?.read ?? 0;
  const cacheOutput = tokens?.cache?.write ?? 0;
  const input = (tokens?.input ?? 0) + cacheInput;
  const output = (tokens?.output ?? 0) + cacheOutput;

  return {
    input,
    output,
    cache: { input: cacheInput, output: cacheOutput },
    total: input + output,
  };
}

async function parseOpenCodeFile(filePath: string) {
  return readJsonDocument<OpenCodeMessage>(filePath);
}

function getOpenCodeBaseDir() {
  const baseDir = process.env.OPENCODE_DATA_DIR?.trim()
    ? resolve(process.env.OPENCODE_DATA_DIR)
    : join(homedir(), ".local", "share", "opencode");

  return baseDir;
}

async function getOpenCodeSource(): Promise<OpenCodeSource> {
  const baseDir = getOpenCodeBaseDir();
  const databasePath = join(baseDir, "opencode.db");

  if (existsSync(databasePath)) {
    return { kind: "database", path: databasePath };
  }

  const messagesDir = join(baseDir, "storage", "message");

  return { kind: "legacy", files: await listFilesRecursive(messagesDir, ".json") };
}

export function isOpenCodeAvailable() {
  const baseDir = getOpenCodeBaseDir();

  return (
    existsSync(join(baseDir, "opencode.db")) ||
    existsSync(join(baseDir, "storage", "message"))
  );
}

async function loadSqliteModule() {
  try {
    const moduleName = "node:sqlite";

    return await import(moduleName);
  } catch {
    throw new Error(
      "OpenCode SQLite support requires a Node.js runtime that provides node:sqlite.",
    );
  }
}

async function withoutSqliteExperimentalWarning<T>(callback: () => Promise<T>) {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const warningText =
      typeof warning === "string" ? warning : warning.message;
    const warningType =
      warning instanceof Error ? warning.name : String(args[0] ?? "");

    if (
      warningType === "ExperimentalWarning" &&
      /sqlite/i.test(warningText)
    ) {
      return;
    }

    return Reflect.apply(originalEmitWarning, process, [
      warning,
      ...args,
    ] as Parameters<typeof process.emitWarning>);
  }) as typeof process.emitWarning;

  try {
    return await callback();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function parseOpenCodeMessageData(
  rowId: string,
  sourceLabel: string,
  content: string,
) {
  const message = parseJsonTextWithLimit<OpenCodeMessage>(content, sourceLabel);

  return {
    ...message,
    id: message.id || rowId,
  };
}

function isSqliteLockedError(error: unknown) {
  return error instanceof Error && /database is locked/i.test(error.message);
}

async function withDatabaseSnapshot<T>(
  databasePath: string,
  callback: (snapshotPath: string) => Promise<T>,
) {
  const snapshotDir = await mkdtemp(join(tmpdir(), "slopmeter-opencode-"));
  const snapshotPath = join(snapshotDir, "opencode.db");

  await copyFile(databasePath, snapshotPath);

  for (const suffix of ["-shm", "-wal"]) {
    const companionPath = `${databasePath}${suffix}`;

    if (!existsSync(companionPath)) {
      continue;
    }

    await copyFile(companionPath, `${snapshotPath}${suffix}`);
  }

  try {
    return await callback(snapshotPath);
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
}

async function iterateOpenCodeDatabaseMessages(
  databasePath: string,
  onMessage: (message: OpenCodeMessage) => void,
) {
  await withoutSqliteExperimentalWarning(async () => {
    const { DatabaseSync } = await loadSqliteModule();
    const database = new DatabaseSync(databasePath, { readOnly: true });

    try {
      const statement = database.prepare(
        "SELECT id, data FROM message ORDER BY time_created ASC",
      );

      for (const row of statement.iterate() as Iterable<OpenCodeMessageRow>) {
        onMessage(
          parseOpenCodeMessageData(
            row.id,
            `${databasePath}:message:${row.id}`,
            row.data,
          ),
        );
      }
    } finally {
      database.close();
    }
  });
}

async function loadOpenCodeDatabaseMessages(
  databasePath: string,
  onMessage: (message: OpenCodeMessage) => void,
) {
  try {
    await iterateOpenCodeDatabaseMessages(databasePath, onMessage);
  } catch (error) {
    if (!isSqliteLockedError(error)) {
      throw error;
    }

    await withDatabaseSnapshot(databasePath, async (snapshotPath) => {
      await iterateOpenCodeDatabaseMessages(snapshotPath, onMessage);
    });
  }
}

function addOpenCodeMessage(
  message: OpenCodeMessage,
  start: Date,
  end: Date,
  recentStart: Date,
  totals: DailyTotalsByDate,
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
  dedupe: Set<string>,
) {
  if (dedupe.has(message.id)) {
    return;
  }

  dedupe.add(message.id);

  const tokenTotals = sumOpenCodeTokens(message.tokens);

  if (tokenTotals.total <= 0) {
    return;
  }

  const date = new Date(message.time.created);

  if (date < start || date > end) {
    return;
  }

  const modelName = normalizeModelName(message.modelID);

  addDailyTokenTotals(totals, date, tokenTotals, modelName);
  addModelTokenTotals(modelTotals, modelName, tokenTotals);

  if (date >= recentStart) {
    addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
  }
}

export async function loadOpenCodeRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const source = await getOpenCodeSource();
  const totals: DailyTotalsByDate = new Map();
  const dedupe = new Set<string>();
  const recentStart = getRecentWindowStart(end, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  if (source.kind === "database") {
    await loadOpenCodeDatabaseMessages(source.path, (message) => {
      addOpenCodeMessage(
        message,
        start,
        end,
        recentStart,
        totals,
        modelTotals,
        recentModelTotals,
        dedupe,
      );
    });
  } else {
    for (const file of source.files) {
      const message = await parseOpenCodeFile(file);

      addOpenCodeMessage(
        message,
        start,
        end,
        recentStart,
        totals,
        modelTotals,
        recentModelTotals,
        dedupe,
      );
    }
  }

  return createUsageSummary(
    "opencode",
    totals,
    modelTotals,
    recentModelTotals,
    end,
  );
}
