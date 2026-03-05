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

interface CodexRawUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexEventInfo {
  model?: string;
  model_name?: string;
  metadata?: { model?: string };
  last_token_usage?: CodexRawUsage;
  total_token_usage?: CodexRawUsage;
}

interface CodexEventPayload {
  type?: string;
  info?: CodexEventInfo;
  model?: string;
  model_name?: string;
  metadata?: { model?: string };
}

interface CodexEventEntry {
  type?: string;
  timestamp: string;
  payload?: CodexEventPayload;
}

interface CodexNormalizedUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

function normalizeCodexUsage(value?: CodexRawUsage) {
  if (!value) {
    return null;
  }

  const input = value.input_tokens ?? 0;
  const cached =
    value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0;
  const output = value.output_tokens ?? 0;
  const reasoning = value.reasoning_output_tokens ?? 0;
  const total = value.total_tokens ?? 0;

  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output,
  };
}

function subtractCodexUsage(
  current: CodexNormalizedUsage,
  previous: CodexNormalizedUsage | null,
) {
  return {
    input_tokens: Math.max(
      current.input_tokens - (previous?.input_tokens ?? 0),
      0,
    ),
    cached_input_tokens: Math.max(
      current.cached_input_tokens - (previous?.cached_input_tokens ?? 0),
      0,
    ),
    output_tokens: Math.max(
      current.output_tokens - (previous?.output_tokens ?? 0),
      0,
    ),
    reasoning_output_tokens: Math.max(
      current.reasoning_output_tokens -
        (previous?.reasoning_output_tokens ?? 0),
      0,
    ),
    total_tokens: Math.max(
      current.total_tokens - (previous?.total_tokens ?? 0),
      0,
    ),
  };
}

function asNonEmptyString(value?: string) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function extractCodexModel(payload?: CodexEventPayload) {
  const directModel =
    asNonEmptyString(payload?.model) ?? asNonEmptyString(payload?.model_name);

  if (directModel) {
    return directModel;
  }

  if (payload?.info) {
    const infoModel =
      asNonEmptyString(payload.info.model) ??
      asNonEmptyString(payload.info.model_name);

    if (infoModel) {
      return infoModel;
    }

    if (payload.info.metadata) {
      const model = asNonEmptyString(payload.info.metadata.model);

      if (model) {
        return model;
      }
    }
  }

  if (payload?.metadata) {
    return asNonEmptyString(payload.metadata.model);
  }

  return undefined;
}

async function parseCodexFile(filePath: string) {
  const content = await readFile(filePath, "utf8");

  const lines = content.split(/\r?\n/);

  return lines
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line.trim()) as CodexEventEntry);
}

async function parseCodexFiles() {
  const codexHome = process.env.CODEX_HOME?.trim()
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");

  const sessionsDir = join(codexHome, "sessions");

  const files = await listFilesRecursive(sessionsDir, ".jsonl");

  return Promise.all(files.map((file) => parseCodexFile(file)));
}

export async function loadCodexRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const sessions = await parseCodexFiles();

  const totals = new Map<
    string,
    { tokens: DailyTokenTotals; models: Map<string, ModelTokenTotals> }
  >();
  const recentStart = getRecentWindowStart(end, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  for (const session of sessions) {
    let previousTotals: CodexNormalizedUsage | null = null;
    let currentModel: string | undefined;

    for (const entry of session) {
      const extractedModel = extractCodexModel(entry.payload);

      if (entry.type === "turn_context") {
        if (extractedModel) {
          currentModel = extractedModel;
        }
        continue;
      }

      if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
        continue;
      }

      const info = entry.payload.info;
      const lastUsage = normalizeCodexUsage(info?.last_token_usage);
      const totalUsage = normalizeCodexUsage(info?.total_token_usage);
      let rawUsage = lastUsage;

      if (!rawUsage && totalUsage) {
        rawUsage = subtractCodexUsage(totalUsage, previousTotals);
      }

      if (totalUsage) {
        previousTotals = totalUsage;
      }

      if (!rawUsage) {
        continue;
      }

      const usage: DailyTokenTotals = {
        input: rawUsage.input_tokens,
        output: rawUsage.output_tokens,
        cache: { input: rawUsage.cached_input_tokens, output: 0 },
        total: rawUsage.total_tokens,
      };

      if (usage.total <= 0) {
        continue;
      }

      const date = new Date(entry.timestamp);

      if (date < start || date > end) {
        continue;
      }

      const modelName = extractedModel ?? currentModel;
      const normalizedModelName = modelName
        ? normalizeModelName(modelName)
        : undefined;

      addDailyTokenTotals(totals, date, usage, normalizedModelName);

      if (normalizedModelName) {
        const existing = modelTotals.get(normalizedModelName);
        if (existing) {
          existing.input += usage.input;
          existing.output += usage.output;
          existing.cache.input += usage.cache.input;
          existing.cache.output += usage.cache.output;
          existing.total += usage.total;
        } else {
          modelTotals.set(normalizedModelName, { ...usage });
        }

        if (date >= recentStart) {
          const recentExisting = recentModelTotals.get(normalizedModelName);
          if (recentExisting) {
            recentExisting.input += usage.input;
            recentExisting.output += usage.output;
            recentExisting.cache.input += usage.cache.input;
            recentExisting.cache.output += usage.cache.output;
            recentExisting.total += usage.total;
          } else {
            recentModelTotals.set(normalizedModelName, { ...usage });
          }
        }
      }
    }
  }

  return {
    provider: "codex",
    daily: totalsToRows(totals),
    insights: getProviderInsights(modelTotals, recentModelTotals),
  };
}
