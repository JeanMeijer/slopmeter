import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  DEFAULT_MAX_JSONL_RECORD_BYTES,
  MAX_JSONL_RECORD_BYTES_ENV,
  type JsonlRecordDecision,
  type DailyTotalsByDate,
  type DailyTokenTotals,
  type ModelTokenTotals,
  addDailyTokenTotals,
  addModelTokenTotals,
  createUsageSummary,
  getPositiveIntegerEnv,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
  readJsonlRecords,
} from "./utils";

const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const CLASSIFICATION_PREFIX_BYTES = 16 * 1024;

interface PiUsagePayload {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

interface PiMessagePayload {
  role?: string;
  model?: string;
  usage?: PiUsagePayload;
  timestamp?: number | string;
}

interface PiSessionEntry {
  type?: string;
  timestamp?: string;
  message?: PiMessagePayload;
}

function getPiAgentDir() {
  const configuredAgentDir = process.env[PI_AGENT_DIR_ENV]?.trim();

  return configuredAgentDir
    ? resolve(configuredAgentDir)
    : join(homedir(), ".pi", "agent");
}

async function getPiSessionFiles() {
  return listFilesRecursive(join(getPiAgentDir(), "sessions"), ".jsonl");
}

export function isPiAvailable() {
  return existsSync(join(getPiAgentDir(), "sessions"));
}

function classifyPiRecord(prefix: string): JsonlRecordDecision<void> {
  if (
    prefix.includes('"type":"message"') &&
    prefix.includes('"role":"assistant"')
  ) {
    return { kind: "keep", classification: undefined };
  }

  return { kind: "skip" };
}

function asNonEmptyString(value?: string) {
  const trimmed = value?.trim();

  return trimmed === "" ? undefined : trimmed;
}

function createPiTokenTotals(usage: PiUsagePayload): DailyTokenTotals {
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const input = (usage.input ?? 0) + cacheRead;
  const output = (usage.output ?? 0) + cacheWrite;
  const total = usage.totalTokens ?? input + output;

  return {
    input,
    output,
    cache: { input: cacheRead, output: cacheWrite },
    total,
  };
}

function getPiTimestamp(entry: PiSessionEntry) {
  const rawTimestamp = entry.timestamp ?? entry.message?.timestamp;

  if (typeof rawTimestamp === "string" || typeof rawTimestamp === "number") {
    return new Date(rawTimestamp);
  }

  return null;
}

export async function loadPiRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const files = await getPiSessionFiles();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const recentStart = getRecentWindowStart(end, 30);
  const maxRecordBytes = getPositiveIntegerEnv(
    MAX_JSONL_RECORD_BYTES_ENV,
    DEFAULT_MAX_JSONL_RECORD_BYTES,
  );

  for (const file of files) {
    for await (const record of readJsonlRecords(file, {
      classificationPrefixBytes: CLASSIFICATION_PREFIX_BYTES,
      classify: classifyPiRecord,
      maxRecordBytes,
      oversizedErrorMessage: ({
        filePath,
        lineNumber,
        maxRecordBytes,
        envVarName,
      }) =>
        `Relevant Pi Coding Agent record exceeds ${maxRecordBytes} bytes in ${filePath}:${lineNumber}. Increase ${envVarName} to process this file.`,
    })) {
      let entry: PiSessionEntry;

      try {
        entry = JSON.parse(record.rawLine) as PiSessionEntry;
      } catch {
        continue;
      }

      if (entry.type !== "message" || entry.message?.role !== "assistant") {
        continue;
      }

      const usage = entry.message.usage;

      if (!usage) {
        continue;
      }

      const timestamp = getPiTimestamp(entry);

      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        continue;
      }

      if (timestamp < start || timestamp > end) {
        continue;
      }

      const tokenTotals = createPiTokenTotals(usage);

      if (tokenTotals.total <= 0) {
        continue;
      }

      const modelName = asNonEmptyString(entry.message.model);
      const normalizedModelName = modelName
        ? normalizeModelName(modelName)
        : undefined;

      addDailyTokenTotals(totals, timestamp, tokenTotals, normalizedModelName);

      if (!normalizedModelName) {
        continue;
      }

      addModelTokenTotals(modelTotals, normalizedModelName, tokenTotals);

      if (timestamp >= recentStart) {
        addModelTokenTotals(
          recentModelTotals,
          normalizedModelName,
          tokenTotals,
        );
      }
    }
  }

  return createUsageSummary("pi", totals, modelTotals, recentModelTotals, end);
}
