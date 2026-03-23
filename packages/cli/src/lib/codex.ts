import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  DEFAULT_MAX_JSONL_RECORD_BYTES,
  DEFAULT_FILE_PROCESS_CONCURRENCY,
  FILE_PROCESS_CONCURRENCY_ENV,
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
  mergeDailyTotalsByDate,
  mergeModelTotals,
  normalizeModelName,
  readJsonlRecords,
  runWithConcurrency,
} from "./utils";
const CLASSIFICATION_PREFIX_BYTES = 32 * 1024;

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

interface CodexFileProcessingResult {
  totals: DailyTotalsByDate;
  modelTotals: Map<string, ModelTokenTotals>;
  recentModelTotals: Map<string, ModelTokenTotals>;
  skippedOversizedIrrelevantRecords: number;
}

type JsonContext =
  | {
      kind: "array";
      expecting: "valueOrEnd" | "commaOrEnd";
    }
  | {
      kind: "object";
      expecting: "keyOrEnd" | "colon" | "value" | "commaOrEnd";
      key?: string;
      isPayloadObject: boolean;
    };

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

function addCodexUsage(
  base: CodexNormalizedUsage | null,
  delta: CodexNormalizedUsage,
): CodexNormalizedUsage {
  return {
    input_tokens: (base?.input_tokens ?? 0) + delta.input_tokens,
    cached_input_tokens:
      (base?.cached_input_tokens ?? 0) + delta.cached_input_tokens,
    output_tokens: (base?.output_tokens ?? 0) + delta.output_tokens,
    reasoning_output_tokens:
      (base?.reasoning_output_tokens ?? 0) + delta.reasoning_output_tokens,
    total_tokens: (base?.total_tokens ?? 0) + delta.total_tokens,
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

function didCodexTotalsRollback(
  current: CodexNormalizedUsage,
  previous: CodexNormalizedUsage | null,
) {
  if (!previous) {
    return false;
  }

  return (
    current.input_tokens < previous.input_tokens ||
    current.cached_input_tokens < previous.cached_input_tokens ||
    current.output_tokens < previous.output_tokens ||
    current.reasoning_output_tokens < previous.reasoning_output_tokens ||
    current.total_tokens < previous.total_tokens
  );
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

function getCodexHome() {
  const trimmed = process.env.CODEX_HOME?.trim();

  return trimmed ? resolve(trimmed) : join(homedir(), ".codex");
}

async function getCodexFiles() {
  const codexHome = getCodexHome();

  return listFilesRecursive(join(codexHome, "sessions"), ".jsonl");
}

export function isCodexAvailable() {
  return existsSync(join(getCodexHome(), "sessions"));
}

function readJsonString(source: string, start: number) {
  if (source[start] !== '"') {
    return null;
  }

  let value = "";
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      return { value, nextIndex: index + 1 };
    }

    value += char;
  }

  return null;
}

function skipWhitespace(source: string, start: number) {
  let index = start;

  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }

  return index;
}

function skipPrimitive(source: string, start: number) {
  let index = start;

  while (index < source.length) {
    const char = source[index];

    if (char === "," || char === "}" || char === "]" || /\s/.test(char)) {
      return index;
    }

    index += 1;
  }

  return source.length;
}

function classifyCodexRecord(
  source: string,
): JsonlRecordDecision<"turn_context" | "token_count"> {
  const stack: JsonContext[] = [];
  let topLevelType: string | undefined;

  for (let index = 0; index < source.length; ) {
    index = skipWhitespace(source, index);

    if (index >= source.length) {
      break;
    }

    const char = source[index];

    if (stack.length === 0) {
      if (char !== "{") {
        return { kind: "unknown" };
      }

      stack.push({
        kind: "object",
        expecting: "keyOrEnd",
        isPayloadObject: false,
      });
      index += 1;
      continue;
    }

    const context = stack[stack.length - 1]!;

    if (context.kind === "object") {
      if (context.expecting === "keyOrEnd") {
        if (char === "}") {
          stack.pop();
          index += 1;
          continue;
        }

        const key = readJsonString(source, index);

        if (!key) {
          return { kind: "unknown" };
        }

        context.key = key.value;
        context.expecting = "colon";
        index = key.nextIndex;
        continue;
      }

      if (context.expecting === "colon") {
        if (char !== ":") {
          return { kind: "unknown" };
        }

        context.expecting = "value";
        index += 1;
        continue;
      }

      if (context.expecting === "value") {
        if (char === "{") {
          stack.push({
            kind: "object",
            expecting: "keyOrEnd",
            isPayloadObject: stack.length === 1 && context.key === "payload",
          });
          context.expecting = "commaOrEnd";
          context.key = undefined;
          index += 1;
          continue;
        }

        if (char === "[") {
          stack.push({ kind: "array", expecting: "valueOrEnd" });
          context.expecting = "commaOrEnd";
          context.key = undefined;
          index += 1;
          continue;
        }

        if (char === '"') {
          const value = readJsonString(source, index);

          if (!value) {
            return { kind: "unknown" };
          }

          if (stack.length === 1 && context.key === "type") {
            topLevelType = value.value;

            if (value.value === "turn_context") {
              return { kind: "keep", classification: "turn_context" };
            }

            if (value.value !== "event_msg") {
              return { kind: "skip" };
            }
          }

          if (context.isPayloadObject && context.key === "type") {
            if (value.value === "token_count") {
              return topLevelType === "event_msg"
                ? { kind: "keep", classification: "token_count" }
                : { kind: "unknown" };
            }

            return topLevelType === "event_msg"
              ? { kind: "skip" }
              : { kind: "unknown" };
          }

          context.expecting = "commaOrEnd";
          context.key = undefined;
          index = value.nextIndex;
          continue;
        }

        context.expecting = "commaOrEnd";
        context.key = undefined;
        index = skipPrimitive(source, index);
        continue;
      }

      {
        if (char === ",") {
          context.expecting = "keyOrEnd";
          index += 1;
          continue;
        }

        if (char === "}") {
          stack.pop();
          index += 1;
          continue;
        }

        return { kind: "unknown" };
      }

      continue;
    }

    if (context.expecting === "valueOrEnd") {
      if (char === "]") {
        stack.pop();
        index += 1;
        continue;
      }

      if (char === "{") {
        stack.push({
          kind: "object",
          expecting: "keyOrEnd",
          isPayloadObject: false,
        });
        context.expecting = "commaOrEnd";
        index += 1;
        continue;
      }

      if (char === "[") {
        stack.push({ kind: "array", expecting: "valueOrEnd" });
        context.expecting = "commaOrEnd";
        index += 1;
        continue;
      }

      if (char === '"') {
        const value = readJsonString(source, index);

        if (!value) {
          return { kind: "unknown" };
        }

        context.expecting = "commaOrEnd";
        index = value.nextIndex;
        continue;
      }

      context.expecting = "commaOrEnd";
      index = skipPrimitive(source, index);
      continue;
    }

    if (char === ",") {
      context.expecting = "valueOrEnd";
      index += 1;
      continue;
    }

    if (char === "]") {
      stack.pop();
      index += 1;
      continue;
    }

    return { kind: "unknown" };
  }

  if (topLevelType && topLevelType !== "event_msg") {
    return { kind: "skip" };
  }

  return { kind: "unknown" };
}

async function processCodexFile(
  filePath: string,
  start: Date,
  end: Date,
  maxRecordBytes: number,
): Promise<CodexFileProcessingResult> {
  const totals: DailyTotalsByDate = new Map();
  const recentStart = getRecentWindowStart(end, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  let previousTotals: CodexNormalizedUsage | null = null;
  let currentModel: string | undefined;

  let skippedOversizedIrrelevantRecords = 0;

  for await (const record of readJsonlRecords<"turn_context" | "token_count">(
    filePath,
    {
      classificationPrefixBytes: CLASSIFICATION_PREFIX_BYTES,
      classify: classifyCodexRecord,
      maxRecordBytes,
      onSkippedOversizedRecord: () => {
        skippedOversizedIrrelevantRecords += 1;
      },
      oversizedErrorMessage: ({ filePath, lineNumber, maxRecordBytes }) =>
        `Relevant Codex record exceeds ${maxRecordBytes} bytes in ${filePath}:${lineNumber}. Increase ${MAX_JSONL_RECORD_BYTES_ENV} to process this file.`,
    },
  )) {
    let entry: CodexEventEntry;

    try {
      entry = JSON.parse(record.rawLine) as CodexEventEntry;
    } catch {
      continue;
    }

    const extractedModel = extractCodexModel(entry.payload);

    if (record.classification === "turn_context") {
      currentModel = extractedModel ?? currentModel;
      continue;
    }

    const info = entry.payload?.info;
    const lastUsage = normalizeCodexUsage(info?.last_token_usage);
    const totalUsage = normalizeCodexUsage(info?.total_token_usage);
    let rawUsage: CodexNormalizedUsage | null = null;

    if (totalUsage) {
      rawUsage = didCodexTotalsRollback(totalUsage, previousTotals)
        ? (lastUsage ?? totalUsage)
        : subtractCodexUsage(totalUsage, previousTotals);
      previousTotals = totalUsage;
    } else {
      rawUsage = lastUsage;

      if (rawUsage) {
        previousTotals = addCodexUsage(previousTotals, rawUsage);
      }
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

    if (!normalizedModelName) {
      continue;
    }

    addModelTokenTotals(modelTotals, normalizedModelName, usage);

    if (date >= recentStart) {
      addModelTokenTotals(recentModelTotals, normalizedModelName, usage);
    }
  }

  return {
    totals,
    modelTotals,
    recentModelTotals,
    skippedOversizedIrrelevantRecords,
  };
}

export async function loadCodexRows(
  start: Date,
  end: Date,
  warnings: string[] = [],
): Promise<UsageSummary> {
  const files = await getCodexFiles();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const maxRecordBytes = getPositiveIntegerEnv(
    MAX_JSONL_RECORD_BYTES_ENV,
    DEFAULT_MAX_JSONL_RECORD_BYTES,
  );
  const fileConcurrency = getPositiveIntegerEnv(
    FILE_PROCESS_CONCURRENCY_ENV,
    DEFAULT_FILE_PROCESS_CONCURRENCY,
  );
  const results = new Array<CodexFileProcessingResult>(files.length);

  await runWithConcurrency(files, fileConcurrency, async (file, index) => {
    results[index] = await processCodexFile(file, start, end, maxRecordBytes);
  });

  let skippedOversizedIrrelevantRecords = 0;
  let skippedFiles = 0;

  for (const result of results) {
    mergeDailyTotalsByDate(totals, result.totals);
    mergeModelTotals(modelTotals, result.modelTotals);
    mergeModelTotals(recentModelTotals, result.recentModelTotals);

    if (result.skippedOversizedIrrelevantRecords > 0) {
      skippedOversizedIrrelevantRecords +=
        result.skippedOversizedIrrelevantRecords;
      skippedFiles += 1;
    }
  }

  if (skippedOversizedIrrelevantRecords > 0) {
    warnings.push(
      `Skipped ${skippedOversizedIrrelevantRecords} oversized irrelevant Codex record(s) across ${skippedFiles} file(s); usage totals exclude those records. Relevant oversized records fail the file. Override ${MAX_JSONL_RECORD_BYTES_ENV} to raise the cap.`,
    );
  }

  return createUsageSummary(
    "codex",
    totals,
    modelTotals,
    recentModelTotals,
    end,
  );
}
