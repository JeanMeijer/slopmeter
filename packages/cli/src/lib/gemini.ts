import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { UsageSummary } from "../interfaces";
import {
  type DailyTotalsByDate,
  type DailyTokenTotals,
  type ModelTokenTotals,
  addDailyTokenTotals,
  addModelTokenTotals,
  createUsageSummary,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
  readJsonDocument,
} from "./utils";

const GEMINI_CONFIG_DIR_ENV = "GEMINI_CONFIG_DIR";
const GEMINI_SESSION_PATH_RE = /[\\/]chats[\\/]session-[^\\/]+\.json$/;

interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
}

interface GeminiMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  model?: string;
  tokens?: GeminiTokens;
}

interface GeminiSession {
  sessionId?: string;
  messages?: GeminiMessage[];
}

function getGeminiBaseDir() {
  const configuredDir = process.env[GEMINI_CONFIG_DIR_ENV]?.trim();

  return configuredDir ? resolve(configuredDir) : join(homedir(), ".gemini");
}

async function getGeminiSessionFiles() {
  const files = await listFilesRecursive(
    join(getGeminiBaseDir(), "tmp"),
    ".json",
  );

  return files.filter((file) => GEMINI_SESSION_PATH_RE.test(file));
}

export function isGeminiAvailable() {
  return existsSync(join(getGeminiBaseDir(), "tmp"));
}

function createGeminiTokenTotals(tokens: GeminiTokens): DailyTokenTotals {
  const cacheInput = tokens.cached ?? 0;
  const input = (tokens.input ?? 0) + cacheInput;
  const output =
    (tokens.output ?? 0) + (tokens.thoughts ?? 0) + (tokens.tool ?? 0);

  return {
    input,
    output,
    cache: { input: cacheInput, output: 0 },
    total: input + output,
  };
}

function getGeminiMessageKey(
  sessionId: string | undefined,
  message: GeminiMessage,
) {
  return JSON.stringify({
    sessionId,
    messageId: message.id,
    timestamp: message.timestamp,
    model: normalizeModelName(message.model ?? ""),
    tokens: message.tokens ? createGeminiTokenTotals(message.tokens) : null,
  });
}

async function parseGeminiSession(filePath: string) {
  return readJsonDocument<GeminiSession>(filePath, {
    oversizedErrorMessage: ({ filePath, maxBytes, envVarName }) =>
      `Gemini session JSON document exceeds ${maxBytes} bytes in ${filePath}. Increase ${envVarName} to process this file.`,
  });
}

export async function loadGeminiRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const files = await getGeminiSessionFiles();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();
  const recentStart = getRecentWindowStart(end, 30);
  const dedupe = new Set<string>();

  for (const file of files) {
    const session = await parseGeminiSession(file);

    for (const message of session.messages ?? []) {
      if (message.type !== "gemini" || !message.tokens) {
        continue;
      }

      const date = message.timestamp ? new Date(message.timestamp) : null;

      if (!date || Number.isNaN(date.getTime()) || date < start || date > end) {
        continue;
      }

      const tokenTotals = createGeminiTokenTotals(message.tokens);

      if (tokenTotals.total <= 0) {
        continue;
      }

      const messageKey = getGeminiMessageKey(session.sessionId, message);

      if (dedupe.has(messageKey)) {
        continue;
      }

      dedupe.add(messageKey);

      const modelName = message.model?.trim()
        ? normalizeModelName(message.model)
        : undefined;

      addDailyTokenTotals(totals, date, tokenTotals, modelName);

      if (!modelName) {
        continue;
      }

      addModelTokenTotals(modelTotals, modelName, tokenTotals);

      if (date >= recentStart) {
        addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
      }
    }
  }

  return createUsageSummary(
    "gemini",
    totals,
    modelTotals,
    recentModelTotals,
    end,
  );
}
