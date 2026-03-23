import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DailyUsage, Insights, ModelUsage, UsageSummary } from "../interfaces";

export function formatLocalDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

export interface DailyTokenTotals {
  input: number;
  output: number;
  cache: { input: number; output: number };
  total: number;
}

export interface ModelTokenTotals {
  input: number;
  output: number;
  cache: { input: number; output: number };
  total: number;
}

interface TokenTotals {
  tokens: DailyTokenTotals;
  models: Map<string, ModelTokenTotals>;
}

export type DailyTotalsByDate = Map<string, TokenTotals>;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FILE_PROCESS_CONCURRENCY = 16;
export const FILE_PROCESS_CONCURRENCY_ENV =
  "SLOPMETER_FILE_PROCESS_CONCURRENCY";
export const MAX_JSONL_RECORD_BYTES_ENV = "SLOPMETER_MAX_JSONL_RECORD_BYTES";
export const DEFAULT_MAX_JSONL_RECORD_BYTES = 64 * 1024 * 1024;

export interface JsonlRecord<TClassification = void> {
  lineNumber: number;
  rawLine: string;
  byteLength: number;
  classification: TClassification;
}

export type JsonlRecordDecision<TClassification> =
  | { kind: "keep"; classification: TClassification }
  | { kind: "skip" }
  | { kind: "unknown" };

interface ReadJsonlRecordsOptions<TClassification> {
  classificationPrefixBytes?: number;
  classify?: (prefix: string) => JsonlRecordDecision<TClassification>;
  maxRecordBytes?: number;
  onSkippedOversizedRecord?: (record: {
    lineNumber: number;
    byteLength: number;
  }) => void;
  oversizedErrorMessage?: (record: {
    filePath: string;
    lineNumber: number;
    maxRecordBytes: number;
    envVarName: string;
  }) => string;
}

interface ReadJsonDocumentOptions {
  maxBytes?: number;
  oversizedErrorMessage?: (record: {
    filePath: string;
    maxBytes: number;
    envVarName: string;
  }) => string;
}

interface ParseJsonTextOptions {
  maxBytes?: number;
  oversizedErrorMessage?: (record: {
    sourceLabel: string;
    maxBytes: number;
    envVarName: string;
  }) => string;
}

function cloneTokenTotals(
  totals: DailyTokenTotals | ModelTokenTotals,
): ModelTokenTotals {
  return {
    input: totals.input,
    output: totals.output,
    cache: { input: totals.cache.input, output: totals.cache.output },
    total: totals.total,
  };
}

function mergeTokenTotals(
  target: DailyTokenTotals | ModelTokenTotals,
  source: DailyTokenTotals | ModelTokenTotals,
) {
  target.input += source.input;
  target.output += source.output;
  target.cache.input += source.cache.input;
  target.cache.output += source.cache.output;
  target.total += source.total;
}

export function addModelTokenTotals(
  modelTotals: Map<string, ModelTokenTotals>,
  modelName: string,
  tokenTotals: DailyTokenTotals | ModelTokenTotals,
) {
  const existing = modelTotals.get(modelName);

  if (!existing) {
    modelTotals.set(modelName, cloneTokenTotals(tokenTotals));

    return;
  }

  mergeTokenTotals(existing, tokenTotals);
}

export function addDailyTokenTotals(
  totals: DailyTotalsByDate,
  date: Date,
  tokenTotals: DailyTokenTotals,
  modelName?: string,
) {
  const key = formatLocalDate(date);
  const existing = totals.get(key);

  if (!existing) {
    const models = new Map<string, ModelTokenTotals>();

    if (modelName) {
      models.set(modelName, cloneTokenTotals(tokenTotals));
    }
    totals.set(key, { tokens: cloneTokenTotals(tokenTotals), models });

    return;
  }

  mergeTokenTotals(existing.tokens, tokenTotals);

  if (modelName) {
    addModelTokenTotals(existing.models, modelName, tokenTotals);
  }
}

export function mergeDailyTotalsByDate(
  target: DailyTotalsByDate,
  source: DailyTotalsByDate,
) {
  for (const [dateKey, sourceTotals] of source.entries()) {
    const existing = target.get(dateKey);

    if (!existing) {
      const models = new Map<string, ModelTokenTotals>();

      for (const [modelName, totals] of sourceTotals.models.entries()) {
        models.set(modelName, cloneTokenTotals(totals));
      }

      target.set(dateKey, {
        tokens: cloneTokenTotals(sourceTotals.tokens),
        models,
      });
      continue;
    }

    mergeTokenTotals(existing.tokens, sourceTotals.tokens);

    for (const [modelName, totals] of sourceTotals.models.entries()) {
      addModelTokenTotals(existing.models, modelName, totals);
    }
  }
}

export function mergeModelTotals(
  target: Map<string, ModelTokenTotals>,
  source: Map<string, ModelTokenTotals>,
) {
  for (const [modelName, totals] of source.entries()) {
    addModelTokenTotals(target, modelName, totals);
  }
}

export function totalsToRows(
  totals: DailyTotalsByDate,
  displayValuesByDate = new Map<string, number>(),
): DailyUsage[] {
  const allDates = new Set<string>([
    ...totals.keys(),
    ...displayValuesByDate.keys(),
  ]);

  return [...allDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const entry = totals.get(date);
      const tokens = entry?.tokens ?? {
        input: 0,
        output: 0,
        cache: { input: 0, output: 0 },
        total: 0,
      };
      const models = entry?.models ?? new Map<string, ModelTokenTotals>();
      const displayValue =
        tokens.total > 0 ? tokens.total : (displayValuesByDate.get(date) ?? 0);

      return {
        date: new Date(`${date}T00:00:00`),
        input: tokens.input,
        output: tokens.output,
        cache: { input: tokens.cache.input, output: tokens.cache.output },
        total: tokens.total,
        displayValue: displayValue > 0 ? displayValue : undefined,
        breakdown: [...models.entries()]
          .sort(([, a], [, b]) => b.total - a.total)
          .map(([name, t]) => ({
            name,
            tokens: {
              input: t.input,
              output: t.output,
              cache: { input: t.cache.input, output: t.cache.output },
              total: t.total,
            },
          })),
      };
    });
}

export async function listFilesRecursive(rootDir: string, extension: string) {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;

    let entries;

    try {
      entries = await readdir(currentDir, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function defaultOversizedJsonlRecordMessage({
  filePath,
  lineNumber,
  maxRecordBytes,
  envVarName,
}: {
  filePath: string;
  lineNumber: number;
  maxRecordBytes: number;
  envVarName: string;
}) {
  return `JSONL record exceeds ${maxRecordBytes} bytes in ${filePath}:${lineNumber}. Increase ${envVarName} to process this file.`;
}

function defaultOversizedJsonDocumentMessage({
  filePath,
  maxBytes,
  envVarName,
}: {
  filePath: string;
  maxBytes: number;
  envVarName: string;
}) {
  return `JSON document exceeds ${maxBytes} bytes in ${filePath}. Increase ${envVarName} to process this file.`;
}

function defaultOversizedJsonTextMessage({
  sourceLabel,
  maxBytes,
  envVarName,
}: {
  sourceLabel: string;
  maxBytes: number;
  envVarName: string;
}) {
  return `JSON payload exceeds ${maxBytes} bytes in ${sourceLabel}. Increase ${envVarName} to process this payload.`;
}

function keepAllJsonlRecords<TClassification>(): JsonlRecordDecision<TClassification> {
  return { kind: "keep", classification: undefined as TClassification };
}

export async function* readJsonlRecords<TClassification = void>(
  filePath: string,
  options: ReadJsonlRecordsOptions<TClassification> = {},
): AsyncGenerator<JsonlRecord<TClassification>> {
  const maxRecordBytes =
    options.maxRecordBytes ??
    getPositiveIntegerEnv(
      MAX_JSONL_RECORD_BYTES_ENV,
      DEFAULT_MAX_JSONL_RECORD_BYTES,
    );
  const classificationPrefixBytes =
    options.classificationPrefixBytes ?? maxRecordBytes;
  const classify = options.classify ?? keepAllJsonlRecords<TClassification>;
  const oversizedErrorMessage =
    options.oversizedErrorMessage ?? defaultOversizedJsonlRecordMessage;
  const stream = createReadStream(filePath);
  let lineNumber = 0;
  let lineBytesSeen = 0;
  let retainedBytes = 0;
  let prefixBytes = 0;
  let exceededLimit = false;
  let decision: JsonlRecordDecision<TClassification> = { kind: "unknown" };
  let prefixChunks: Buffer[] = [];
  let retainedChunks: Buffer[] = [];

  const resetRecord = () => {
    lineBytesSeen = 0;
    retainedBytes = 0;
    prefixBytes = 0;
    exceededLimit = false;
    decision = { kind: "unknown" };
    prefixChunks = [];
    retainedChunks = [];
  };

  const maybeClassify = () => {
    if (decision.kind !== "unknown" || prefixBytes === 0) {
      return;
    }

    decision = classify(Buffer.concat(prefixChunks, prefixBytes).toString("utf8"));

    if (decision.kind === "skip") {
      retainedChunks = [];
      retainedBytes = 0;
    }
  };

  const appendSegment = (segment: Buffer) => {
    if (segment.length === 0) {
      return;
    }

    lineBytesSeen += segment.length;

    if (prefixBytes < classificationPrefixBytes) {
      const prefixSegment = segment.subarray(
        0,
        Math.min(segment.length, classificationPrefixBytes - prefixBytes),
      );

      prefixChunks.push(prefixSegment);
      prefixBytes += prefixSegment.length;
      maybeClassify();
    }

    if (decision.kind === "skip") {
      return;
    }

    const remainingBytes = maxRecordBytes - retainedBytes;

    if (remainingBytes > 0) {
      const retainedSegment = segment.subarray(
        0,
        Math.min(segment.length, remainingBytes),
      );

      if (retainedSegment.length > 0) {
        retainedChunks.push(retainedSegment);
        retainedBytes += retainedSegment.length;
      }
    }

    if (segment.length > remainingBytes) {
      exceededLimit = true;
    }
  };

  const resolveDecision = () => {
    if (decision.kind !== "unknown") {
      return decision;
    }

    const candidate =
      exceededLimit || retainedBytes === 0
        ? Buffer.concat(prefixChunks, prefixBytes).toString("utf8")
        : Buffer.concat(retainedChunks, retainedBytes).toString("utf8");

    return classify(candidate);
  };

  const finalizeRecord = () => {
    lineNumber += 1;

    if (lineBytesSeen === 0 && !exceededLimit) {
      resetRecord();

      return null;
    }

    const resolvedDecision = resolveDecision();

    if (resolvedDecision.kind === "skip") {
      if (lineBytesSeen > maxRecordBytes) {
        options.onSkippedOversizedRecord?.({
          lineNumber,
          byteLength: lineBytesSeen,
        });
      }

      resetRecord();

      return null;
    }

    if (resolvedDecision.kind === "unknown") {
      resetRecord();

      return null;
    }

    if (lineBytesSeen > maxRecordBytes || exceededLimit) {
      throw new Error(
        oversizedErrorMessage({
          filePath,
          lineNumber,
          maxRecordBytes,
          envVarName: MAX_JSONL_RECORD_BYTES_ENV,
        }),
      );
    }

    const rawLine = Buffer.concat(retainedChunks, retainedBytes)
      .toString("utf8")
      .trim();

    if (rawLine === "") {
      resetRecord();

      return null;
    }

    const record: JsonlRecord<TClassification> = {
      lineNumber,
      rawLine,
      byteLength: lineBytesSeen,
      classification: resolvedDecision.classification,
    };

    resetRecord();

    return record;
  };

  for await (const chunk of stream) {
    let start = 0;

    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) {
        continue;
      }

      appendSegment(chunk.subarray(start, index));
      const record = finalizeRecord();

      if (record) {
        yield record;
      }

      start = index + 1;
    }

    appendSegment(chunk.subarray(start));
  }

  if (lineBytesSeen > 0) {
    const record = finalizeRecord();

    if (record) {
      yield record;
    }
  }
}

export async function* readJsonLines<T>(filePath: string): AsyncGenerator<T> {
  for await (const record of readJsonlRecords(filePath)) {
    try {
      yield JSON.parse(record.rawLine) as T;
    } catch {
      // Preserve existing behavior for malformed JSONL records.
    }
  }
}

export async function readJsonDocument<T>(
  filePath: string,
  options: ReadJsonDocumentOptions = {},
) {
  const maxBytes =
    options.maxBytes ??
    getPositiveIntegerEnv(
      MAX_JSONL_RECORD_BYTES_ENV,
      DEFAULT_MAX_JSONL_RECORD_BYTES,
    );
  const oversizedErrorMessage =
    options.oversizedErrorMessage ?? defaultOversizedJsonDocumentMessage;
  const stream = createReadStream(filePath);
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    totalBytes += chunk.length;

    if (totalBytes > maxBytes) {
      stream.destroy();

      throw new Error(
        oversizedErrorMessage({
          filePath,
          maxBytes,
          envVarName: MAX_JSONL_RECORD_BYTES_ENV,
        }),
      );
    }

    chunks.push(chunk);
  }

  return parseJsonTextWithLimit<T>(
    Buffer.concat(chunks, totalBytes).toString("utf8"),
    filePath,
    {
      maxBytes,
      oversizedErrorMessage: ({ sourceLabel, maxBytes, envVarName }) =>
        oversizedErrorMessage({
          filePath: sourceLabel,
          maxBytes,
          envVarName,
        }),
    },
  );
}

export function parseJsonTextWithLimit<T>(
  content: string,
  sourceLabel: string,
  options: ParseJsonTextOptions = {},
) {
  const maxBytes =
    options.maxBytes ??
    getPositiveIntegerEnv(
      MAX_JSONL_RECORD_BYTES_ENV,
      DEFAULT_MAX_JSONL_RECORD_BYTES,
    );
  const oversizedErrorMessage =
    options.oversizedErrorMessage ?? defaultOversizedJsonTextMessage;

  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    throw new Error(
      oversizedErrorMessage({
        sourceLabel,
        maxBytes,
        envVarName: MAX_JSONL_RECORD_BYTES_ENV,
      }),
    );
  }

  return JSON.parse(content) as T;
}

export function getPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (items.length === 0) {
    return;
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const currentIndex = nextIndex;

        nextIndex += 1;

        if (currentIndex >= items.length) {
          return;
        }

        await worker(items[currentIndex], currentIndex);
      }
    }),
  );
}

export function getRecentWindowStart(endDate: Date, days = 30) {
  const start = new Date(endDate);

  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  return start;
}

export function normalizeModelName(modelName: string) {
  return modelName.replace(/-\d{8}$/, "");
}

export function getTopModel(
  modelTotals: Map<string, ModelTokenTotals>,
): ModelUsage | undefined {
  let bestModel: string | undefined;
  let bestTotals: ModelTokenTotals | undefined;

  for (const [modelName, totals] of modelTotals) {
    if (!bestTotals || totals.total > bestTotals.total) {
      bestModel = modelName;
      bestTotals = totals;
    }
  }

  if (!bestTotals || bestTotals.total <= 0) {
    return undefined;
  }

  return {
    name: bestModel!,
    tokens: {
      input: bestTotals.input,
      output: bestTotals.output,
      cache: { input: bestTotals.cache.input, output: bestTotals.cache.output },
      total: bestTotals.total,
    },
  };
}

function startOfDay(date: Date) {
  const day = new Date(date);

  day.setHours(0, 0, 0, 0);

  return day;
}

function isConsecutiveDay(prevDate: Date, currDate: Date): boolean {
  const prev = startOfDay(prevDate);
  const curr = startOfDay(currDate);
  const diff = curr.getTime() - prev.getTime();

  return diff === ONE_DAY_MS;
}

export function computeLongestStreak(daily: DailyUsage[]): number {
  if (daily.length === 0) {
    return 0;
  }

  let longest = 1;
  let running = 1;

  for (let i = 1; i < daily.length; i += 1) {
    if (isConsecutiveDay(daily[i - 1].date, daily[i].date)) {
      running += 1;
      if (running > longest) {
        longest = running;
      }
    } else {
      running = 1;
    }
  }

  return longest;
}

export function computeCurrentStreak(daily: DailyUsage[], end: Date): number {
  if (daily.length === 0) {
    return 0;
  }

  const endDay = startOfDay(end);
  const lastEntry = daily[daily.length - 1];
  const lastEntryDay = startOfDay(lastEntry.date);

  // If the last active day isn't the end date, check if it's consecutive
  if (
    lastEntryDay.getTime() !== endDay.getTime() &&
    !isConsecutiveDay(lastEntryDay, endDay)
  ) {
    return 0;
  }

  let current = 1;

  for (let i = daily.length - 2; i >= 0; i -= 1) {
    if (!isConsecutiveDay(daily[i].date, daily[i + 1].date)) {
      break;
    }
    current += 1;
  }

  return current;
}

export function getProviderInsights(
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
  daily: DailyUsage[],
  end: Date,
): Insights {
  const mostUsedModel = getTopModel(modelTotals);
  const recentMostUsedModel = getTopModel(recentModelTotals);
  const measuredDaily = daily.filter(
    (row) => (row.displayValue ?? row.total) > 0,
  );

  return {
    mostUsedModel,
    recentMostUsedModel,
    streaks: {
      longest: computeLongestStreak(measuredDaily),
      current: computeCurrentStreak(measuredDaily, end),
    },
  };
}

export function createUsageSummary(
  provider: UsageSummary["provider"],
  totals: DailyTotalsByDate,
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
  end: Date,
  displayValuesByDate?: Map<string, number>,
): UsageSummary {
  const daily = totalsToRows(totals, displayValuesByDate);

  return {
    provider,
    daily,
    insights: getProviderInsights(modelTotals, recentModelTotals, daily, end),
  };
}

export function hasUsage(summary: UsageSummary) {
  return summary.daily.some(
    (row) => row.total > 0 || (row.displayValue ?? 0) > 0,
  );
}

export function mergeUsageSummaries(
  provider: UsageSummary["provider"],
  summaries: UsageSummary[],
  end: Date,
): UsageSummary {
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const displayValuesByDate = new Map<string, number>();
  const recentStart = getRecentWindowStart(end, 30);

  for (const summary of summaries) {
    for (const row of summary.daily) {
      addDailyTokenTotals(totals, row.date, {
        input: row.input,
        output: row.output,
        cache: { input: row.cache.input, output: row.cache.output },
        total: row.total,
      });

      const dateKey = formatLocalDate(row.date);
      const displayValue = row.displayValue ?? row.total;

      if (displayValue > 0) {
        displayValuesByDate.set(
          dateKey,
          (displayValuesByDate.get(dateKey) ?? 0) + displayValue,
        );
      }

      const totalsForDate = totals.get(dateKey);

      if (totalsForDate) {
        for (const breakdown of row.breakdown) {
          addModelTokenTotals(
            totalsForDate.models,
            breakdown.name,
            breakdown.tokens,
          );
          addModelTokenTotals(modelTotals, breakdown.name, breakdown.tokens);

          if (row.date >= recentStart) {
            addModelTokenTotals(
              recentModelTotals,
              breakdown.name,
              breakdown.tokens,
            );
          }
        }
      }
    }
  }

  return createUsageSummary(
    provider,
    totals,
    modelTotals,
    recentModelTotals,
    end,
    displayValuesByDate,
  );
}
