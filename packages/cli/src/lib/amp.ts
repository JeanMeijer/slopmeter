import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  DEFAULT_FILE_PROCESS_CONCURRENCY,
  FILE_PROCESS_CONCURRENCY_ENV,
  type DailyTotalsByDate,
  type DailyTokenTotals,
  type ModelTokenTotals,
  addDailyTokenTotals,
  addModelTokenTotals,
  createUsageSummary,
  getPositiveIntegerEnv,
  getRecentWindowStart,
  listFilesRecursive,
  mergeDailyTotalsByDate,
  mergeModelTotals,
  normalizeModelName,
  readJsonDocument,
  runWithConcurrency,
} from "./utils";

const AMP_HOME_ENV = "AMP_DATA_DIR";

interface AmpMessageUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalInputTokens?: number;
}

interface AmpMessage {
  role?: string;
  usage?: AmpMessageUsage;
  meta?: { sentAt?: number };
}

interface AmpThread {
  id?: string;
  created?: number;
  messages?: AmpMessage[];
}

function getAmpDataDir() {
  const envDir = process.env[AMP_HOME_ENV]?.trim();

  if (envDir) {
    return resolve(envDir);
  }

  const xdgDataHome =
    process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");

  return join(xdgDataHome, "amp");
}

async function getAmpFiles() {
  const dataDir = getAmpDataDir();

  return listFilesRecursive(join(dataDir, "threads"), ".json");
}

export function isAmpAvailable() {
  return existsSync(join(getAmpDataDir(), "threads"));
}

function createAmpTokenTotals(usage: AmpMessageUsage): DailyTokenTotals {
  const cacheReadInput = usage.cacheReadInputTokens ?? 0;
  const cacheCreationInput = usage.cacheCreationInputTokens ?? 0;
  const input = (usage.inputTokens ?? 0) + cacheReadInput;
  const output = (usage.outputTokens ?? 0) + cacheCreationInput;

  return {
    input,
    output,
    cache: { input: cacheReadInput, output: cacheCreationInput },
    total: input + output,
  };
}

async function processAmpFile(
  filePath: string,
  start: Date,
  end: Date,
): Promise<{
  totals: DailyTotalsByDate;
  modelTotals: Map<string, ModelTokenTotals>;
  recentModelTotals: Map<string, ModelTokenTotals>;
}> {
  const totals: DailyTotalsByDate = new Map();
  const recentStart = getRecentWindowStart(end, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  let thread: AmpThread;

  try {
    thread = await readJsonDocument<AmpThread>(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`Warning: skipping Amp thread ${filePath}: ${message}`);

    return { totals, modelTotals, recentModelTotals };
  }

  if (!thread.messages) {
    return { totals, modelTotals, recentModelTotals };
  }

  const threadDate = thread.created ? new Date(thread.created) : null;
  let lastUserTimestamp: Date | null = null;

  for (const message of thread.messages) {
    if (message.role === "user" && message.meta?.sentAt) {
      lastUserTimestamp = new Date(message.meta.sentAt);
      continue;
    }

    if (message.role !== "assistant" || !message.usage) {
      continue;
    }

    const date = lastUserTimestamp ?? threadDate;

    if (!date || date < start || date > end) {
      continue;
    }

    const tokenTotals = createAmpTokenTotals(message.usage);

    if (tokenTotals.total <= 0) {
      continue;
    }

    const modelName = message.usage.model
      ? normalizeModelName(message.usage.model)
      : undefined;

    addDailyTokenTotals(totals, date, tokenTotals, modelName);

    if (!modelName) {
      continue;
    }

    addModelTokenTotals(modelTotals, modelName, tokenTotals);

    if (date >= recentStart) {
      addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
    }
  }

  return { totals, modelTotals, recentModelTotals };
}

export async function loadAmpRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const files = await getAmpFiles();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const fileConcurrency = getPositiveIntegerEnv(
    FILE_PROCESS_CONCURRENCY_ENV,
    DEFAULT_FILE_PROCESS_CONCURRENCY,
  );

  const results = new Array<Awaited<ReturnType<typeof processAmpFile>>>(
    files.length,
  );

  await runWithConcurrency(files, fileConcurrency, async (file, index) => {
    results[index] = await processAmpFile(file, start, end);
  });

  for (const result of results) {
    mergeDailyTotalsByDate(totals, result.totals);
    mergeModelTotals(modelTotals, result.modelTotals);
    mergeModelTotals(recentModelTotals, result.recentModelTotals);
  }

  return createUsageSummary("amp", totals, modelTotals, recentModelTotals, end);
}
