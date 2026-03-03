import type { DailyUsage } from "ccusage/data-loader";
import type { CliDailyRow } from "./interfaces";

function isoDateToCompact(value: string) {
  return value.replaceAll("-", "");
}

function toDailyRows(daily: DailyUsage[]) {
  return daily
    .map((entry) => ({
      date: entry.date,
      totalTokens:
        entry.inputTokens + entry.outputTokens + entry.cacheCreationTokens + entry.cacheReadTokens,
    }))
    .filter((row) => row.totalTokens > 0);
}

export async function loadClaudeRows(
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<CliDailyRow[]> {
  process.env.LOG_LEVEL ??= "0";
  const { loadDailyUsageData } = await import("ccusage/data-loader");

  const usage = await loadDailyUsageData({
    since: isoDateToCompact(startDate),
    until: isoDateToCompact(endDate),
    timezone,
    mode: "display",
    offline: true,
  });

  return toDailyRows(usage).filter((row) => row.date >= startDate && row.date <= endDate);
}
