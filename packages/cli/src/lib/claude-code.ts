import { existsSync } from "node:fs";
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
  forEachJsonLine,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
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

async function getClaudeFiles() {
  const projectDirs = getClaudeProjectDirs();
  const files = (
    await Promise.all(
      projectDirs.map((projectDir) => listFilesRecursive(projectDir, ".jsonl")),
    )
  ).flat();

  return files;
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
  const recentStart = getRecentWindowStart(endDate, 30);
  const processedHashes = new Set<string>();

  for (const file of files) {
    await forEachJsonLine<ClaudeRawLogEntry>(file, async (line) => {
      const entry = parseClaudeLogEntry(line);

      if (!entry) {
        return;
      }

      const uniqueHash = createUniqueHash(entry.messageId, entry.requestId);

      if (uniqueHash && processedHashes.has(uniqueHash)) {
        return;
      }

      if (uniqueHash) {
        processedHashes.add(uniqueHash);
      }

      const timestamp = new Date(entry.timestamp);

      if (timestamp < startDate || timestamp > endDate) {
        return;
      }

      const tokenTotals = createClaudeTokenTotals(entry.usage);

      if (tokenTotals.total <= 0) {
        return;
      }

      const modelName =
        entry.model && entry.model !== "<synthetic>"
          ? normalizeModelName(entry.model)
          : undefined;

      addDailyTokenTotals(totals, timestamp, tokenTotals, modelName);

      if (!modelName) {
        return;
      }

      addModelTokenTotals(modelTotals, modelName, tokenTotals);

      if (timestamp >= recentStart) {
        addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
      }
    });
  }

  return createUsageSummary(
    "claude",
    totals,
    modelTotals,
    recentModelTotals,
    endDate,
  );
}
