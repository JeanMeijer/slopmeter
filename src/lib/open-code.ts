import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { CliDailyRow } from "./interfaces";
import { addDailyTotal, formatLocalDate, listFilesRecursive, totalsToRows } from "./utils";

interface OpenCodeTokenCache {
  read?: number;
  write?: number;
}

interface OpenCodeTokens {
  input?: number;
  output?: number;
  cache?: OpenCodeTokenCache;
}

interface OpenCodeMessage {
  id: string;
  providerID?: string;
  modelID?: string;
  time: { created?: number };
  tokens?: OpenCodeTokens;
}

export async function loadOpenCodeRows(startDate: string, endDate: string) {
  const openCodeBaseDir = process.env.OPENCODE_DATA_DIR?.trim()
    ? resolve(process.env.OPENCODE_DATA_DIR)
    : join(homedir(), ".local", "share", "opencode");
  const messagesDir = join(openCodeBaseDir, "storage", "message");
  const files = await listFilesRecursive(messagesDir, ".json");
  const totals = new Map<string, number>();
  const dedupe = new Set<string>();

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    const message = JSON.parse(content) as OpenCodeMessage;

    if (!message.providerID || !message.modelID) {
      continue;
    }

    if (dedupe.has(message.id)) {
      continue;
    }

    dedupe.add(message.id);

    const totalTokens =
      (message.tokens?.input ?? 0) +
      (message.tokens?.output ?? 0) +
      (message.tokens?.cache?.read ?? 0) +
      (message.tokens?.cache?.write ?? 0);

    if (totalTokens <= 0) {
      continue;
    }

    const createdAt = message.time.created ?? Date.now();
    const date = formatLocalDate(new Date(createdAt));
    if (date < startDate || date > endDate) {
      continue;
    }

    addDailyTotal(totals, date, totalTokens);
  }

  return totalsToRows(totals);
}
