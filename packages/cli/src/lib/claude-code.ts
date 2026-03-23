import { existsSync, readdirSync } from "node:fs";
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
  formatLocalDate,
  getPositiveIntegerEnv,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
  readJsonDocument,
  readJsonLines,
  runWithConcurrency,
} from "./utils";

const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
const CLAUDE_PROJECTS_DIR_NAME = "projects";
const CLAUDE_STATS_CACHE_FILE_NAME = "stats-cache.json";

interface ClaudeUsagePayload {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ClaudeRawLogEntry {
  timestamp?: string;
  requestId?: string;
  message?: {
    usage?: ClaudeUsagePayload;
    model?: string;
    id?: string;
  };
}

interface ClaudeLogEntry {
  timestamp: string;
  usage: ClaudeUsagePayload;
  model?: string;
  messageId?: string;
  requestId?: string;
}

interface ClaudeStatsCacheModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface ClaudeStatsCacheEntry {
  date?: string;
  tokensByModel?: Record<string, number>;
}

interface ClaudeStatsCache {
  dailyModelTokens?: ClaudeStatsCacheEntry[];
  modelUsage?: Record<string, ClaudeStatsCacheModelUsage>;
}

interface ClaudeHistoryEntry {
  timestamp?: number | string;
}

function discoverClaudeWorkDirs() {
  const home = homedir();

  try {
    return readdirSync(home, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory() || !entry.name.startsWith(".claude-")) {
          return false;
        }

        const dir = join(home, entry.name);

        return (
          existsSync(join(dir, CLAUDE_PROJECTS_DIR_NAME)) ||
          existsSync(join(dir, CLAUDE_STATS_CACHE_FILE_NAME))
        );
      })
      .map((entry) => join(home, entry.name));
  } catch {
    return [];
  }
}

function getClaudeConfigPaths() {
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  const defaults = [join(xdgConfigHome, "claude"), join(homedir(), ".claude")];

  const envPaths = (process.env[CLAUDE_CONFIG_DIR_ENV] ?? "").trim();

  const envResolved =
    envPaths === ""
      ? []
      : envPaths
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path !== "")
          .map((path) => resolve(path));

  const seen = new Set(envResolved);
  const paths = [...envResolved];

  for (const path of [...defaults, ...discoverClaudeWorkDirs()]) {
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }

  return paths;
}

function getClaudeProjectDirs() {
  const unique = new Set<string>();
  const dirs: string[] = [];

  for (const basePath of getClaudeConfigPaths()) {
    const projectsDir = join(basePath, CLAUDE_PROJECTS_DIR_NAME);

    if (existsSync(projectsDir) && !unique.has(projectsDir)) {
      unique.add(projectsDir);
      dirs.push(projectsDir);
    }
  }

  return dirs;
}

function getClaudeStatsCacheFiles() {
  const unique = new Set<string>();
  const files: string[] = [];

  for (const basePath of getClaudeConfigPaths()) {
    const statsCacheFile = join(basePath, CLAUDE_STATS_CACHE_FILE_NAME);

    if (existsSync(statsCacheFile) && !unique.has(statsCacheFile)) {
      unique.add(statsCacheFile);
      files.push(statsCacheFile);
    }
  }

  return files;
}

function parseClaudeLogEntry(entry: ClaudeRawLogEntry): ClaudeLogEntry | null {
  if (!entry.timestamp || !entry.message?.usage) {
    return null;
  }

  return {
    timestamp: entry.timestamp,
    usage: entry.message.usage,
    model: entry.message.model,
    messageId: entry.message.id,
    requestId: entry.requestId,
  };
}

function createClaudeTokenTotals(usage: ClaudeUsagePayload): DailyTokenTotals {
  const cacheReadInput = usage.cache_read_input_tokens ?? 0;
  const cacheCreationInput = usage.cache_creation_input_tokens ?? 0;
  const input = (usage.input_tokens ?? 0) + cacheReadInput;
  const output = (usage.output_tokens ?? 0) + cacheCreationInput;

  return {
    input,
    output,
    cache: { input: cacheReadInput, output: cacheCreationInput },
    total: input + output,
  };
}

function distributeTokenComponents(total: number, weights: number[]) {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);

  if (total <= 0 || weightSum <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (weight / weightSum) * total);
  const allocated = exact.map((value) => Math.floor(value));
  let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({
      index,
      fraction: value - allocated[index],
      weight: weights[index],
    }))
    .sort((left, right) => {
      if (right.fraction !== left.fraction) {
        return right.fraction - left.fraction;
      }

      return right.weight - left.weight;
    });

  for (const { index } of order) {
    if (remainder <= 0) {
      break;
    }

    allocated[index] += 1;
    remainder -= 1;
  }

  return allocated;
}

function createStatsCacheTokenTotals(
  totalTokens: number,
  usage?: ClaudeStatsCacheModelUsage,
): DailyTokenTotals {
  if (totalTokens <= 0) {
    return {
      input: 0,
      output: 0,
      cache: { input: 0, output: 0 },
      total: 0,
    };
  }

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cacheReadInputTokens = usage?.cacheReadInputTokens ?? 0;
  const cacheCreationInputTokens = usage?.cacheCreationInputTokens ?? 0;
  const [scaledInput, scaledOutput, scaledCacheRead, scaledCacheCreation] =
    distributeTokenComponents(totalTokens, [
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    ]);

  // Older Claude installs only keep daily totals in stats-cache.json, so
  // reconstruct the input/output/cache split from the cached model totals.
  if (
    scaledInput === 0 &&
    scaledOutput === 0 &&
    scaledCacheRead === 0 &&
    scaledCacheCreation === 0
  ) {
    return {
      input: totalTokens,
      output: 0,
      cache: { input: 0, output: 0 },
      total: totalTokens,
    };
  }

  return {
    input: scaledInput + scaledCacheRead,
    output: scaledOutput + scaledCacheCreation,
    cache: { input: scaledCacheRead, output: scaledCacheCreation },
    total: totalTokens,
  };
}

async function getClaudeFiles() {
  const projectDirs = getClaudeProjectDirs();
  const files = (
    await Promise.all(
      projectDirs.map((projectDir) => listFilesRecursive(projectDir, ".jsonl")),
    )
  ).flat();

  return files;
}

function getClaudeHistoryFiles() {
  const unique = new Set<string>();
  const files: string[] = [];

  for (const basePath of getClaudeConfigPaths()) {
    const historyFile = join(basePath, "history.jsonl");

    if (existsSync(historyFile) && !unique.has(historyFile)) {
      unique.add(historyFile);
      files.push(historyFile);
    }
  }

  return files;
}

export function isClaudeAvailable() {
  return (
    getClaudeProjectDirs().length > 0 ||
    getClaudeStatsCacheFiles().length > 0 ||
    getClaudeHistoryFiles().length > 0
  );
}

async function loadClaudeStatsCacheRows(
  startDate: Date,
  endDate: Date,
  coveredDates: Set<string>,
  totals: DailyTotalsByDate,
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
  recentStart: Date,
) {
  const statsCacheFiles = getClaudeStatsCacheFiles();

  for (const file of statsCacheFiles) {
    let statsCache: ClaudeStatsCache;

    try {
      statsCache = await readJsonDocument<ClaudeStatsCache>(file);
    } catch {
      continue;
    }

    for (const row of statsCache.dailyModelTokens ?? []) {
      if (!row.date || coveredDates.has(row.date)) {
        continue;
      }

      const timestamp = new Date(`${row.date}T00:00:00`);

      if (
        Number.isNaN(timestamp.getTime()) ||
        timestamp < startDate ||
        timestamp > endDate
      ) {
        continue;
      }

      for (const [rawModelName, totalTokens] of Object.entries(
        row.tokensByModel ?? {},
      )) {
        if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
          continue;
        }

        const modelName = normalizeModelName(rawModelName);
        const tokenTotals = createStatsCacheTokenTotals(
          totalTokens,
          statsCache.modelUsage?.[rawModelName],
        );

        addDailyTokenTotals(totals, timestamp, tokenTotals, modelName);
        addModelTokenTotals(modelTotals, modelName, tokenTotals);

        if (timestamp >= recentStart) {
          addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
        }
      }
    }
  }
}

async function loadClaudeHistoryDisplayValues(
  startDate: Date,
  endDate: Date,
  coveredDates: Set<string>,
  displayValuesByDate: Map<string, number>,
) {
  const historyFiles = getClaudeHistoryFiles();

  for (const file of historyFiles) {
    for await (const line of readJsonLines<ClaudeHistoryEntry>(file)) {
      const rawTimestamp = line.timestamp;
      const timestamp =
        typeof rawTimestamp === "number"
          ? new Date(rawTimestamp)
          : typeof rawTimestamp === "string"
            ? new Date(rawTimestamp)
            : null;

      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        continue;
      }

      if (timestamp < startDate || timestamp > endDate) {
        continue;
      }

      const dateKey = formatLocalDate(timestamp);

      if (coveredDates.has(dateKey)) {
        continue;
      }

      displayValuesByDate.set(dateKey, (displayValuesByDate.get(dateKey) ?? 0) + 1);
    }
  }
}

function createUniqueHash(messageId?: string, requestId?: string) {
  if (!messageId || !requestId) {
    return null;
  }

  return `${messageId}:${requestId}`;
}

export async function loadClaudeRows(
  startDate: Date,
  endDate: Date,
): Promise<UsageSummary> {
  const files = await getClaudeFiles();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const displayValuesByDate = new Map<string, number>();
  const recentStart = getRecentWindowStart(endDate, 30);
  const processedHashes = new Set<string>();
  const fileConcurrency = getPositiveIntegerEnv(
    FILE_PROCESS_CONCURRENCY_ENV,
    DEFAULT_FILE_PROCESS_CONCURRENCY,
  );

  await runWithConcurrency(files, fileConcurrency, async (file) => {
    for await (const line of readJsonLines<ClaudeRawLogEntry>(file)) {
      const entry = parseClaudeLogEntry(line);

      if (!entry) {
        continue;
      }

      const uniqueHash = createUniqueHash(entry.messageId, entry.requestId);

      if (uniqueHash && processedHashes.has(uniqueHash)) {
        continue;
      }

      if (uniqueHash) {
        processedHashes.add(uniqueHash);
      }

      const timestamp = new Date(entry.timestamp);

      if (timestamp < startDate || timestamp > endDate) {
        continue;
      }

      const tokenTotals = createClaudeTokenTotals(entry.usage);

      if (tokenTotals.total <= 0) {
        continue;
      }

      const modelName =
        entry.model && entry.model !== "<synthetic>"
          ? normalizeModelName(entry.model)
          : undefined;

      addDailyTokenTotals(totals, timestamp, tokenTotals, modelName);

      if (!modelName) {
        continue;
      }

      addModelTokenTotals(modelTotals, modelName, tokenTotals);

      if (timestamp >= recentStart) {
        addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
      }
    }
  });

  await loadClaudeStatsCacheRows(
    startDate,
    endDate,
    new Set(totals.keys()),
    totals,
    modelTotals,
    recentModelTotals,
    recentStart,
  );

  await loadClaudeHistoryDisplayValues(
    startDate,
    endDate,
    new Set(totals.keys()),
    displayValuesByDate,
  );

  return createUsageSummary(
    "claude",
    totals,
    modelTotals,
    recentModelTotals,
    endDate,
    displayValuesByDate,
  );
}
