import type { DailyUsage as CcusageDailyUsage } from "ccusage/data-loader";
import type { UsageSummary } from "../interfaces";
import {
  type DailyTokenTotals,
  type ModelTokenTotals,
  getProviderInsights,
  getRecentWindowStart,
  normalizeModelName,
} from "./utils";

interface ClaudeTokenEntry {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

function toCompactDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}${m}${d}`;
}

function getClaudeTokenTotals({
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
}: ClaudeTokenEntry): DailyTokenTotals {
  return {
    input: inputTokens + cacheReadTokens,
    output: outputTokens + cacheCreationTokens,
    cache: { input: cacheReadTokens, output: cacheCreationTokens },
    total: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
  };
}

function toDailyRows(daily: CcusageDailyUsage[], startDate: Date, endDate: Date) {
  const recentStart = getRecentWindowStart(endDate, 30);
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  const rows = daily
    .filter((entry) => {
      const rowDate = new Date(entry.date);
      return rowDate >= startDate && rowDate <= endDate;
    })
    .map((entry) => {
      const dayTotals = getClaudeTokenTotals(entry);
      const rowDate = new Date(entry.date);
      const isRecent = rowDate >= recentStart;

      const breakdown = entry.modelBreakdowns
        .map((model) => {
          const tokens = getClaudeTokenTotals(model);
          if (tokens.total <= 0) return null;

          const name = normalizeModelName(model.modelName);

          const existing = modelTotals.get(name);
          if (existing) {
            existing.input += tokens.input;
            existing.output += tokens.output;
            existing.cache.input += tokens.cache.input;
            existing.cache.output += tokens.cache.output;
            existing.total += tokens.total;
          } else {
            modelTotals.set(name, { ...tokens });
          }

          if (isRecent) {
            const recentExisting = recentModelTotals.get(name);
            if (recentExisting) {
              recentExisting.input += tokens.input;
              recentExisting.output += tokens.output;
              recentExisting.cache.input += tokens.cache.input;
              recentExisting.cache.output += tokens.cache.output;
              recentExisting.total += tokens.total;
            } else {
              recentModelTotals.set(name, { ...tokens });
            }
          }

          return {
            name,
            tokens: {
              input: tokens.input,
              output: tokens.output,
              cache: { input: tokens.cache.input, output: tokens.cache.output },
              total: tokens.total,
            },
          };
        })
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => b.tokens.total - a.tokens.total);

      return {
        input: dayTotals.input,
        output: dayTotals.output,
        cache: { input: dayTotals.cache.input, output: dayTotals.cache.output },
        total: dayTotals.total,
        breakdown,
      };
    })
    .filter((row) => row.total > 0);

  return { rows, modelTotals, recentModelTotals };
}

export async function loadClaudeRows(
  startDate: Date,
  endDate: Date,
  timezone: string,
): Promise<UsageSummary> {
  process.env.LOG_LEVEL ??= "0";
  const { loadDailyUsageData } = await import("ccusage/data-loader");

  const usage = await loadDailyUsageData({
    since: toCompactDate(startDate),
    until: toCompactDate(endDate),
    timezone,
    mode: "display",
    offline: true,
  });

  const { rows, modelTotals, recentModelTotals } = toDailyRows(usage, startDate, endDate);

  return {
    provider: "claude",
    daily: rows,
    insights: getProviderInsights(modelTotals, recentModelTotals),
  };
}
