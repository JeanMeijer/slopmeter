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
      date,
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

export function getProviderInsights(
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
): Insights | undefined {
  const mostUsedModel = getTopModel(modelTotals);
  const recentMostUsedModel = getTopModel(recentModelTotals);

  if (!mostUsedModel && !recentMostUsedModel) {
    return undefined;
  }

  return { mostUsedModel, recentMostUsedModel };
}
