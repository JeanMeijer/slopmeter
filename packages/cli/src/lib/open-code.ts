import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
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
  providerID: string;
  modelID: string;
  time: { created: number };
  tokens?: OpenCodeTokens;
}

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
  const content = await readFile(filePath, "utf8");

  return JSON.parse(content) as OpenCodeMessage;
}

async function parseOpenCodeFiles() {
  const baseDir = process.env.OPENCODE_DATA_DIR?.trim()
    ? resolve(process.env.OPENCODE_DATA_DIR)
    : join(homedir(), ".local", "share", "opencode");

  const messagesDir = join(baseDir, "storage", "message");

  const files = await listFilesRecursive(messagesDir, ".json");

  return Promise.all(files.map((file) => parseOpenCodeFile(file)));
}

export async function loadOpenCodeRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const messages = await parseOpenCodeFiles();
  const totals: DailyTotalsByDate = new Map();
  const dedupe = new Set<string>();
  const recentStart = getRecentWindowStart(end, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  for (const message of messages) {
    if (dedupe.has(message.id)) {
      continue;
    }

    dedupe.add(message.id);

    const tokenTotals = sumOpenCodeTokens(message.tokens);

    if (tokenTotals.total <= 0) {
      continue;
    }

    const date = new Date(message.time.created);

    if (date < start || date > end) {
      continue;
    }

    const modelName = normalizeModelName(message.modelID);

    addDailyTokenTotals(totals, date, tokenTotals, modelName);
    addModelTokenTotals(modelTotals, modelName, tokenTotals);

    if (date >= recentStart) {
      addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
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
