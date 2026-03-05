import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  type DailyTokenTotals,
  type ModelTokenTotals,
  addDailyTokenTotals,
  getProviderInsights,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
  totalsToRows,
} from "./utils";

const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";
const CLAUDE_PROJECTS_DIR_NAME = "projects";

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

function getClaudeConfigPaths() {
  const envPaths = (process.env[CLAUDE_CONFIG_DIR_ENV] ?? "").trim();

  if (envPaths !== "") {
    return envPaths
      .split(",")
      .map((path) => path.trim())
      .filter((path) => path !== "")
      .map((path) => resolve(path));
  }

  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return [join(xdgConfigHome, "claude"), join(homedir(), ".claude")];
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
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheInput = usage.cache_read_input_tokens ?? 0;
  const cacheOutput = usage.cache_creation_input_tokens ?? 0;

  return {
    input,
    output,
    cache: { input: cacheInput, output: cacheOutput },
    total: input + output + cacheInput + cacheOutput,
  };
}

async function parseClaudeFile(filePath: string) {
  const content = await readFile(filePath, "utf8");

  const entries: ClaudeLogEntry[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  for (const line of lines) {
    const parsed = parseClaudeLogEntry(JSON.parse(line) as ClaudeRawLogEntry);

    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}

async function parseClaudeFiles() {
  const projectDirs = getClaudeProjectDirs();
  const files = (
    await Promise.all(
      projectDirs.map((projectDir) => listFilesRecursive(projectDir, ".jsonl")),
    )
  ).flat();

  return Promise.all(files.map((file) => parseClaudeFile(file)));
}

function createUniqueHash(messageId?: string, requestId?: string) {
  if (!messageId || !requestId) {
    return null;
  }

  return `${messageId}:${requestId}`;
}

function addModelTotals(
  modelTotals: Map<string, ModelTokenTotals>,
  modelName: string,
  tokens: DailyTokenTotals,
) {
  const existing = modelTotals.get(modelName);
  if (existing) {
    existing.input += tokens.input;
    existing.output += tokens.output;
    existing.cache.input += tokens.cache.input;
    existing.cache.output += tokens.cache.output;
    existing.total += tokens.total;
  } else {
    modelTotals.set(modelName, { ...tokens });
  }
}

export async function loadClaudeRows(
  startDate: Date,
  endDate: Date,
): Promise<UsageSummary> {
  const sessions = await parseClaudeFiles();

  const totals = new Map<
    string,
    { tokens: DailyTokenTotals; models: Map<string, ModelTokenTotals> }
  >();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const recentStart = getRecentWindowStart(endDate, 30);
  const processedHashes = new Set<string>();

  for (const session of sessions) {
    for (const entry of session) {
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

      const normalizedModelName = entry.model
        ? normalizeModelName(entry.model)
        : undefined;
      const modelName =
        normalizedModelName && normalizedModelName !== "<synthetic>"
          ? normalizedModelName
          : undefined;

      addDailyTokenTotals(totals, timestamp, tokenTotals, modelName);

      if (!modelName) {
        continue;
      }

      addModelTotals(modelTotals, modelName, tokenTotals);

      if (timestamp >= recentStart) {
        addModelTotals(recentModelTotals, modelName, tokenTotals);
      }
    }
  }

  return {
    provider: "claude",
    daily: totalsToRows(totals),
    insights: getProviderInsights(modelTotals, recentModelTotals),
  };
}
