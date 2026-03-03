import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CliDailyRow } from "./interfaces";
import { addDailyTotal, formatLocalDate, listFilesRecursive, totalsToRows } from "./utils";

interface CodexRawUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

interface CodexEventPayload {
  type?: string;
  info?: Record<string, unknown>;
}

interface CodexEventEntry {
  type?: string;
  timestamp?: string;
  payload?: CodexEventPayload;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeCodexUsage(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const input = numberOrZero(record.input_tokens);
  const cached = numberOrZero(record.cached_input_tokens ?? record.cache_read_input_tokens);
  const output = numberOrZero(record.output_tokens);
  const reasoning = numberOrZero(record.reasoning_output_tokens);
  const total = numberOrZero(record.total_tokens);

  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total > 0 ? total : input + output,
  };
}

function subtractCodexUsage(current: CodexRawUsage, previous: CodexRawUsage | null) {
  return {
    input_tokens: Math.max(current.input_tokens - (previous?.input_tokens ?? 0), 0),
    cached_input_tokens: Math.max(current.cached_input_tokens - (previous?.cached_input_tokens ?? 0), 0),
    output_tokens: Math.max(current.output_tokens - (previous?.output_tokens ?? 0), 0),
    reasoning_output_tokens: Math.max(
      current.reasoning_output_tokens - (previous?.reasoning_output_tokens ?? 0),
      0,
    ),
    total_tokens: Math.max(current.total_tokens - (previous?.total_tokens ?? 0), 0),
  };
}

export async function loadCodexRows(startDate: string, endDate: string) {
  const codexHome = process.env.CODEX_HOME?.trim()
    ? resolve(process.env.CODEX_HOME)
    : join(homedir(), ".codex");
  const sessionsDir = join(codexHome, "sessions");
  const files = await listFilesRecursive(sessionsDir, ".jsonl");
  const totals = new Map<string, number>();

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    let previousTotals: CodexRawUsage | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const entry = JSON.parse(trimmed) as CodexEventEntry;

      if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
        continue;
      }

      if (!entry.timestamp) {
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

      const totalTokens =
        rawUsage.total_tokens > 0 ? rawUsage.total_tokens : rawUsage.input_tokens + rawUsage.output_tokens;

      if (totalTokens <= 0) {
        continue;
      }

      const date = formatLocalDate(new Date(entry.timestamp));
      if (date < startDate || date > endDate) {
        continue;
      }

      addDailyTotal(totals, date, totalTokens);
    }
  }

  return totalsToRows(totals);
}
