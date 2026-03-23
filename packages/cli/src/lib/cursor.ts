import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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
  normalizeModelName,
} from "./utils";

const CURSOR_CONFIG_DIR_ENV = "CURSOR_CONFIG_DIR";
const CURSOR_STATE_DB_PATH_ENV = "CURSOR_STATE_DB_PATH";
const CURSOR_WEB_BASE_URL_ENV = "CURSOR_WEB_BASE_URL";
const CURSOR_STATE_DB_RELATIVE_PATH = join(
  "User",
  "globalStorage",
  "state.vscdb",
);
const CURSOR_SESSION_COOKIE_NAME = "WorkosCursorSessionToken";

interface CursorAuthState {
  accessToken?: string;
  refreshToken?: string;
}

interface CursorCsvRow {
  Date?: string;
  Model?: string;
  Tokens?: string;
  "Input (w/ Cache Write)"?: string;
  "Input (w/o Cache Write)"?: string;
  "Cache Read"?: string;
  "Output Tokens"?: string;
  "Total Tokens"?: string;
}

interface CursorFetchAttempt {
  label: string;
  headers: Record<string, string>;
}

interface CursorFetchFailure {
  label: string;
  status: number;
  statusText: string;
  body: string;
}

function getCursorDefaultStateDbPath() {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      CURSOR_STATE_DB_RELATIVE_PATH,
    );
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");

    return join(appData, "Cursor", CURSOR_STATE_DB_RELATIVE_PATH);
  }

  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return join(xdgConfigHome, "Cursor", CURSOR_STATE_DB_RELATIVE_PATH);
}

function getCursorStateDbCandidates() {
  const explicitDbPath = process.env[CURSOR_STATE_DB_PATH_ENV]?.trim();

  if (explicitDbPath) {
    return [resolve(explicitDbPath)];
  }

  const configuredDirs = process.env[CURSOR_CONFIG_DIR_ENV]?.trim();

  if (!configuredDirs) {
    return [getCursorDefaultStateDbPath()];
  }

  return configuredDirs
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map((value) => {
      const resolved = resolve(value);

      return resolved.endsWith(".vscdb")
        ? resolved
        : join(resolved, CURSOR_STATE_DB_RELATIVE_PATH);
    });
}

function getCursorStateDbPath() {
  const seen = new Set<string>();

  for (const candidate of getCursorStateDbCandidates()) {
    if (!seen.has(candidate) && existsSync(candidate)) {
      return candidate;
    }

    seen.add(candidate);
  }

  return null;
}

function normalizeCursorDbValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();

    return trimmed === "" ? undefined : trimmed;
  }

  if (Buffer.isBuffer(value)) {
    const trimmed = value.toString("utf8").trim();

    return trimmed === "" ? undefined : trimmed;
  }

  return undefined;
}

async function loadSqliteModule() {
  try {
    const moduleName = "node:sqlite";

    return await import(moduleName);
  } catch {
    throw new Error(
      "Cursor SQLite support requires a Node.js runtime that provides node:sqlite.",
    );
  }
}

async function withoutSqliteExperimentalWarning<T>(callback: () => Promise<T>) {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const warningText = typeof warning === "string" ? warning : warning.message;
    const warningType =
      warning instanceof Error ? warning.name : String(args[0] ?? "");

    if (warningType === "ExperimentalWarning" && /sqlite/i.test(warningText)) {
      return;
    }

    return Reflect.apply(originalEmitWarning, process, [
      warning,
      ...args,
    ] as Parameters<typeof process.emitWarning>);
  }) as typeof process.emitWarning;

  try {
    return await callback();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

async function readCursorAuthStateFromDatabase(databasePath: string) {
  return withoutSqliteExperimentalWarning(async () => {
    const { DatabaseSync } = await loadSqliteModule();
    const database = new DatabaseSync(databasePath, { readOnly: true });

    try {
      const query = database.prepare(
        "SELECT value FROM ItemTable WHERE key = ? LIMIT 1",
      );
      const accessRow = query.get("cursorAuth/accessToken") as
        | { value?: unknown }
        | undefined;
      const refreshRow = query.get("cursorAuth/refreshToken") as
        | { value?: unknown }
        | undefined;

      return {
        accessToken: normalizeCursorDbValue(accessRow?.value),
        refreshToken: normalizeCursorDbValue(refreshRow?.value),
      } satisfies CursorAuthState;
    } finally {
      database.close();
    }
  });
}

function isSqliteLockedError(error: unknown) {
  return error instanceof Error && /database is locked/i.test(error.message);
}

async function withCursorStateSnapshot<T>(
  databasePath: string,
  callback: (snapshotPath: string) => Promise<T>,
) {
  const snapshotDir = await mkdtemp(join(tmpdir(), "slopmeter-cursor-"));
  const snapshotPath = join(snapshotDir, "state.vscdb");

  await copyFile(databasePath, snapshotPath);

  for (const suffix of ["-shm", "-wal"]) {
    const companionPath = `${databasePath}${suffix}`;

    if (!existsSync(companionPath)) {
      continue;
    }

    await copyFile(companionPath, `${snapshotPath}${suffix}`);
  }

  try {
    return await callback(snapshotPath);
  } finally {
    await rm(snapshotDir, { recursive: true, force: true });
  }
}

async function readCursorAuthState(databasePath: string) {
  try {
    return await readCursorAuthStateFromDatabase(databasePath);
  } catch (error) {
    if (!isSqliteLockedError(error)) {
      throw error;
    }

    return withCursorStateSnapshot(databasePath, async (snapshotPath) =>
      readCursorAuthStateFromDatabase(snapshotPath),
    );
  }
}

export async function isCursorAvailable() {
  const databasePath = getCursorStateDbPath();

  if (!databasePath) {
    return false;
  }

  try {
    const authState = await readCursorAuthState(databasePath);

    return Boolean(authState.accessToken);
  } catch {
    return false;
  }
}

function decodeJwtPayload(token: string) {
  const encodedPayload = token.split(".")[1];

  if (!encodedPayload) {
    return null;
  }

  const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");

  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      sub?: string;
    };
  } catch {
    return null;
  }
}

function getCursorWebBaseUrl() {
  return (
    process.env[CURSOR_WEB_BASE_URL_ENV]?.trim() || "https://cursor.com"
  ).replace(/\/+$/, "");
}

function buildCookieHeaderValue(cookieValue: string) {
  return `${CURSOR_SESSION_COOKIE_NAME}=${cookieValue}`;
}

function getCursorFetchAttempts(accessToken: string) {
  const attempts: CursorFetchAttempt[] = [];
  const seen = new Set<string>();
  const subject = decodeJwtPayload(accessToken)?.sub?.trim();
  const cookieValues = [accessToken];

  if (subject) {
    cookieValues.push(`${subject}::${accessToken}`);
  }

  const pushAttempt = (label: string, headers: Record<string, string>) => {
    const signature = JSON.stringify({
      label,
      headers: Object.entries(headers).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    });

    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    attempts.push({ label, headers });
  };

  pushAttempt("bearer", {
    Authorization: `Bearer ${accessToken}`,
  });

  for (const cookieValue of cookieValues) {
    pushAttempt("cookie", {
      Cookie: buildCookieHeaderValue(cookieValue),
    });
    pushAttempt("cookie-encoded", {
      Cookie: buildCookieHeaderValue(encodeURIComponent(cookieValue)),
    });
    pushAttempt("bearer+cookie", {
      Authorization: `Bearer ${accessToken}`,
      Cookie: buildCookieHeaderValue(cookieValue),
    });
    pushAttempt("bearer+cookie-encoded", {
      Authorization: `Bearer ${accessToken}`,
      Cookie: buildCookieHeaderValue(encodeURIComponent(cookieValue)),
    });
  }

  return attempts;
}

async function fetchCursorUsageCsv(accessToken: string) {
  const url = new URL(
    "/api/dashboard/export-usage-events-csv?strategy=tokens",
    getCursorWebBaseUrl(),
  );
  const failures: CursorFetchFailure[] = [];

  for (const attempt of getCursorFetchAttempts(accessToken)) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
        ...attempt.headers,
      },
    });

    if (response.ok) {
      return response;
    }

    failures.push({
      label: attempt.label,
      status: response.status,
      statusText: response.statusText,
      body: (await response.text()).trim().slice(0, 200),
    });
  }

  const summary = failures
    .map((failure) => {
      const statusLine =
        `${failure.label}: ${failure.status} ${failure.statusText}`.trim();

      return failure.body ? `${statusLine} (${failure.body})` : statusLine;
    })
    .join("; ");

  throw new Error(
    `Failed to authenticate Cursor usage export with local auth state from ${url.origin}. ${summary}`,
  );
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);

  return values;
}

function createCursorCsvRow(headers: string[], values: string[]) {
  const row: CursorCsvRow = {};

  headers.forEach((header, index) => {
    row[header as keyof CursorCsvRow] = values[index];
  });

  return row;
}

function processCursorCsvLines(
  lines: Iterable<string>,
  onRow: (row: CursorCsvRow) => void,
) {
  let headers: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === "") {
      continue;
    }

    const values = parseCsvLine(line);

    if (!headers) {
      headers = values;
      continue;
    }

    onRow(createCursorCsvRow(headers, values));
  }
}

function processCursorUsageCsvText(
  content: string,
  onRow: (row: CursorCsvRow) => void,
) {
  processCursorCsvLines(content.split(/\r?\n/), onRow);
}

async function processCursorUsageCsvStream(
  response: Response,
  onRow: (row: CursorCsvRow) => void,
) {
  if (!response.body) {
    processCursorUsageCsvText(await response.text(), onRow);

    return;
  }

  let headers: string[] | null = null;
  const state = {
    currentField: "",
    currentRow: [] as string[],
    inQuotes: false,
    pendingQuote: false,
    sawCarriageReturn: false,
  };
  const decoder = new TextDecoder();

  const emitField = () => {
    state.currentRow.push(state.currentField);
    state.currentField = "";
  };

  const emitRow = () => {
    emitField();

    if (state.currentRow.every((value) => value.trim() === "")) {
      state.currentRow = [];

      return;
    }

    if (!headers) {
      headers = state.currentRow;
      state.currentRow = [];

      return;
    }

    onRow(createCursorCsvRow(headers, state.currentRow));
    state.currentRow = [];
  };

  const processChunk = (chunk: string) => {
    for (const char of chunk) {
      for (;;) {
        if (state.sawCarriageReturn) {
          state.sawCarriageReturn = false;

          if (char === "\n") {
            break;
          }
        }

        if (state.pendingQuote) {
          state.pendingQuote = false;

          if (char === '"') {
            state.currentField += '"';
            break;
          }

          state.inQuotes = false;
          continue;
        }

        if (state.inQuotes) {
          if (char === '"') {
            state.pendingQuote = true;
          } else {
            state.currentField += char;
          }

          break;
        }

        if (char === '"') {
          state.inQuotes = true;
          break;
        }

        if (char === ",") {
          emitField();
          break;
        }

        if (char === "\n") {
          emitRow();
          break;
        }

        if (char === "\r") {
          emitRow();
          state.sawCarriageReturn = true;
          break;
        }

        state.currentField += char;
        break;
      }
    }
  };

  const reader = response.body.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      processChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  processChunk(decoder.decode());

  if (state.pendingQuote) {
    state.inQuotes = false;
  }

  if (state.currentField !== "" || state.currentRow.length > 0) {
    emitRow();
  }
}

function addCursorUsageRow(
  row: CursorCsvRow,
  start: Date,
  end: Date,
  recentStart: Date,
  totals: DailyTotalsByDate,
  modelTotals: Map<string, ModelTokenTotals>,
  recentModelTotals: Map<string, ModelTokenTotals>,
) {
  const date = parseCursorDate(row.Date);
  const rawModel = row.Model?.trim();
  const tokenTotals = createCursorTokenTotals(row);

  if (!date || !rawModel || !tokenTotals) {
    return;
  }

  if (date < start || date > end) {
    return;
  }

  const modelName = normalizeModelName(rawModel);

  addDailyTokenTotals(totals, date, tokenTotals, modelName);
  addModelTokenTotals(modelTotals, modelName, tokenTotals);

  if (date >= recentStart) {
    addModelTokenTotals(recentModelTotals, modelName, tokenTotals);
  }
}

function parseCursorDate(value?: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00`);
  }

  const parsed = new Date(trimmed);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCursorNumber(value?: string) {
  const numeric = Number(value?.replaceAll(",", "").trim() ?? "");

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}

function createCursorTokenTotals(row: CursorCsvRow): DailyTokenTotals | null {
  const total =
    parseCursorNumber(row["Total Tokens"]) ?? parseCursorNumber(row.Tokens);

  if (!total) {
    return null;
  }

  const inputWithCacheWrite =
    parseCursorNumber(row["Input (w/ Cache Write)"]) ?? 0;
  const inputWithoutCacheWrite =
    parseCursorNumber(row["Input (w/o Cache Write)"]) ?? 0;
  const cacheInput = parseCursorNumber(row["Cache Read"]) ?? 0;
  const outputTokens = parseCursorNumber(row["Output Tokens"]) ?? 0;

  return {
    input: inputWithCacheWrite + inputWithoutCacheWrite + cacheInput,
    output: outputTokens,
    cache: { input: cacheInput, output: inputWithCacheWrite },
    total,
  };
}

export async function loadCursorRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const databasePath = getCursorStateDbPath();
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  if (!databasePath) {
    return createUsageSummary(
      "cursor",
      totals,
      modelTotals,
      recentModelTotals,
      end,
    );
  }

  const authState = await readCursorAuthState(databasePath);

  if (!authState.accessToken) {
    return createUsageSummary(
      "cursor",
      totals,
      modelTotals,
      recentModelTotals,
      end,
    );
  }

  const recentStart = getRecentWindowStart(end, 30);
  const response = await fetchCursorUsageCsv(authState.accessToken);

  return summarizeCursorUsageCsv(response, start, end, recentStart);
}

export async function summarizeCursorUsageCsv(
  response: Response,
  start: Date,
  end: Date,
  recentStart = getRecentWindowStart(end, 30),
): Promise<UsageSummary> {
  const totals: DailyTotalsByDate = new Map();
  const modelTotals = new Map<string, ModelTokenTotals>();
  const recentModelTotals = new Map<string, ModelTokenTotals>();

  await processCursorUsageCsvStream(response, (row) => {
    addCursorUsageRow(
      row,
      start,
      end,
      recentStart,
      totals,
      modelTotals,
      recentModelTotals,
    );
  });

  return createUsageSummary(
    "cursor",
    totals,
    modelTotals,
    recentModelTotals,
    end,
  );
}
