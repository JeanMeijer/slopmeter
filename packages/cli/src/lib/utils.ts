import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DailyUsage, Insights, ModelUsage } from "../interfaces";

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

type TokenTotals = {
  tokens: DailyTokenTotals;
  models: Map<string, ModelTokenTotals>;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function addDailyTokenTotals(
  totals: Map<string, TokenTotals>,
  date: Date,
  tokenTotals: DailyTokenTotals,
  modelName?: string,
) {
  const key = formatLocalDate(date);
  const existing = totals.get(key);

  if (!existing) {
    const models = new Map<string, ModelTokenTotals>();
    if (modelName) {
      models.set(modelName, { ...tokenTotals });
    }
    totals.set(key, { tokens: { ...tokenTotals }, models });
    return;
  }

  existing.tokens.input += tokenTotals.input;
  existing.tokens.output += tokenTotals.output;
  existing.tokens.cache.input += tokenTotals.cache.input;
  existing.tokens.cache.output += tokenTotals.cache.output;
  existing.tokens.total += tokenTotals.total;

  if (modelName) {
    const existingModel = existing.models.get(modelName);
    if (existingModel) {
      existingModel.input += tokenTotals.input;
      existingModel.output += tokenTotals.output;
      existingModel.cache.input += tokenTotals.cache.input;
      existingModel.cache.output += tokenTotals.cache.output;
      existingModel.total += tokenTotals.total;
    } else {
      existing.models.set(modelName, { ...tokenTotals });
    }
  }
}

export function totalsToRows(totals: Map<string, TokenTotals>): DailyUsage[] {
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { tokens, models }]) => ({
      date: new Date(`${date}T00:00:00`),
      input: tokens.input,
      output: tokens.output,
      cache: { input: tokens.cache.input, output: tokens.cache.output },
      total: tokens.total,
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
    }));
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

  return files;
}

export function getRecentWindowStart(endDate: Date, days = 30) {
  const start = new Date(endDate);

  start.setDate(start.getDate() - (days - 1));

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

  return {
    mostUsedModel,
    recentMostUsedModel,
    streaks: {
      longest: computeLongestStreak(daily),
      current: computeCurrentStreak(daily, end),
    },
  };
}
