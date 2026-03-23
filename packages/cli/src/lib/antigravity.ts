import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ModelUsage, UsageSummary } from "../interfaces";
import {
  createUsageSummary,
  formatLocalDate,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
} from "./utils";

const ANTIGRAVITY_LOGS_DIR_ENV = "ANTIGRAVITY_LOGS_DIR";
const ANTIGRAVITY_STATE_DB_ENV = "ANTIGRAVITY_STATE_DB";
const ANTIGRAVITY_DATA_DIR_ENV = "ANTIGRAVITY_DATA_DIR";
const ANTIGRAVITY_REQUEST_MARKER =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
const ANTIGRAVITY_MODEL_PATTERN = /\bgemini-[a-z0-9.-]+\b/gi;
const ANTIGRAVITY_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{3})?)/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_UNIX_SECONDS = 946684800;
const MAX_UNIX_SECONDS = 2208988800;
const MAX_PROTOBUF_RECURSION_DEPTH = 8;

interface AntigravityLogEvent {
  date: Date;
  model?: string;
}

interface AntigravityUsageAccumulator {
  displayValuesByDate: Map<string, number>;
  modelMessageCounts: Map<string, number>;
  recentModelMessageCounts: Map<string, number>;
  recentStart: Date;
}

interface ProtobufField {
  fieldNumber: number;
  wireType: number;
  value?: bigint;
  bytes?: Buffer;
}

interface ProtobufInsights {
  timestamps: Date[];
  modelCounts: Map<string, number>;
}

interface AntigravityBrowserRecordingMetadata {
  highlights?: Array<{
    start_time?: string;
    end_time?: string;
  }>;
}

interface AntigravityTrajectoryEntry {
  id: string;
  dates: Date[];
  dominantModel?: string;
}

function getDefaultAntigravityLogsDir() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Antigravity", "logs");
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");

    return join(appData, "Antigravity", "logs");
  }

  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return join(xdgConfigHome, "Antigravity", "logs");
}

function getDefaultAntigravityStateDbPath() {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Antigravity",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");

    return join(appData, "Antigravity", "User", "globalStorage", "state.vscdb");
  }

  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");

  return join(xdgConfigHome, "Antigravity", "User", "globalStorage", "state.vscdb");
}

function getDefaultAntigravityDataDir() {
  return join(homedir(), ".gemini", "antigravity");
}

function getAntigravityLogsDir() {
  const explicit = process.env[ANTIGRAVITY_LOGS_DIR_ENV]?.trim();

  return explicit ? resolve(explicit) : getDefaultAntigravityLogsDir();
}

function getAntigravityStateDbPath() {
  const explicit = process.env[ANTIGRAVITY_STATE_DB_ENV]?.trim();

  return explicit ? resolve(explicit) : getDefaultAntigravityStateDbPath();
}

function getAntigravityDataDir() {
  const explicit = process.env[ANTIGRAVITY_DATA_DIR_ENV]?.trim();

  return explicit ? resolve(explicit) : getDefaultAntigravityDataDir();
}

async function getAntigravityLogFiles() {
  return (await listFilesRecursive(getAntigravityLogsDir(), ".log")).filter((filePath) =>
    filePath.endsWith(join("google.antigravity", "Antigravity.log")),
  );
}

function parseAntigravityTimestamp(line: string) {
  const match = line.match(ANTIGRAVITY_TIMESTAMP_PATTERN);

  if (!match) {
    return null;
  }

  const [, datePart, timePart] = match;
  const timestamp = new Date(`${datePart}T${timePart}`);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function normalizeMatchedModel(modelName: string) {
  return normalizeModelName(modelName.toLowerCase());
}

function getDominantModel(modelCounts: Map<string, number>) {
  let bestModel: string | undefined;
  let bestCount = 0;

  for (const [model, count] of modelCounts) {
    if (count > bestCount) {
      bestModel = model;
      bestCount = count;
    }
  }

  return bestModel;
}

function addModelMatches(modelCounts: Map<string, number>, text: string) {
  for (const match of text.matchAll(ANTIGRAVITY_MODEL_PATTERN)) {
    const model = normalizeMatchedModel(match[0]);

    modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
  }
}

async function scanAntigravityLog(filePath: string): Promise<AntigravityLogEvent[]> {
  const content = await readFile(filePath, "utf8");
  const events: AntigravityLogEvent[] = [];
  let currentModel: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    for (const match of line.matchAll(ANTIGRAVITY_MODEL_PATTERN)) {
      currentModel = normalizeMatchedModel(match[0]);
    }

    if (!line.includes(ANTIGRAVITY_REQUEST_MARKER)) {
      continue;
    }

    const timestamp = parseAntigravityTimestamp(line);

    if (!timestamp) {
      continue;
    }

    events.push({ date: timestamp, model: currentModel });
  }

  return events;
}

function createMessageMetricModelUsage(
  modelName: string,
  messageCount: number,
): ModelUsage {
  return {
    name: modelName,
    tokens: {
      input: 0,
      output: 0,
      cache: { input: 0, output: 0 },
      total: 0,
    },
    metric: {
      unit: "messages",
      value: messageCount,
    },
  };
}

function getTopModelByMessages(
  counts: Map<string, number>,
): ModelUsage | undefined {
  let bestModel: string | undefined;
  let bestCount = 0;

  for (const [model, count] of counts) {
    if (count > bestCount) {
      bestModel = model;
      bestCount = count;
    }
  }

  if (!bestModel || bestCount <= 0) {
    return undefined;
  }

  return createMessageMetricModelUsage(bestModel, bestCount);
}

function addActivityEvent(
  accumulator: AntigravityUsageAccumulator,
  date: Date,
  model?: string,
  increment = 1,
) {
  const dateKey = formatLocalDate(date);

  accumulator.displayValuesByDate.set(
    dateKey,
    (accumulator.displayValuesByDate.get(dateKey) ?? 0) + increment,
  );

  if (!model) {
    return;
  }

  accumulator.modelMessageCounts.set(
    model,
    (accumulator.modelMessageCounts.get(model) ?? 0) + increment,
  );

  if (date >= accumulator.recentStart) {
    accumulator.recentModelMessageCounts.set(
      model,
      (accumulator.recentModelMessageCounts.get(model) ?? 0) + increment,
    );
  }
}

function addPerDayActivity(
  accumulator: AntigravityUsageAccumulator,
  uniqueActivityDays: Set<string>,
  sourceId: string,
  dates: Iterable<Date>,
  model?: string,
) {
  for (const date of dates) {
    const dateKey = formatLocalDate(date);
    const dedupeKey = `${sourceId}:${dateKey}`;

    if (uniqueActivityDays.has(dedupeKey)) {
      continue;
    }

    uniqueActivityDays.add(dedupeKey);
    addActivityEvent(accumulator, date, model);
  }
}

async function loadSqliteModule() {
  try {
    const moduleName = "node:sqlite";

    return await import(moduleName);
  } catch {
    throw new Error(
      "Google Antigravity SQLite support requires a Node.js runtime that provides node:sqlite.",
    );
  }
}

async function withoutSqliteExperimentalWarning<T>(callback: () => Promise<T>) {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const warningText =
      typeof warning === "string" ? warning : warning.message;
    const warningType =
      warning instanceof Error ? warning.name : String(args[0] ?? "");

    if (
      warningType === "ExperimentalWarning" &&
      /sqlite/i.test(warningText)
    ) {
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

function isSqliteLockedError(error: unknown) {
  return error instanceof Error && /database is locked/i.test(error.message);
}

async function withDatabaseSnapshot<T>(
  databasePath: string,
  callback: (snapshotPath: string) => Promise<T>,
) {
  const snapshotDir = await mkdtemp(join(tmpdir(), "slopmeter-antigravity-"));
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

async function readStateValues(
  databasePath: string,
  keys: string[],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();

  await withoutSqliteExperimentalWarning(async () => {
    const { DatabaseSync } = await loadSqliteModule();
    const database = new DatabaseSync(databasePath, { readOnly: true });

    try {
      const statement = database.prepare(
        `SELECT key, value FROM ItemTable WHERE key IN (${keys.map(() => "?").join(", ")})`,
      );

      for (const row of statement.iterate(...keys) as Iterable<{
        key: string;
        value: string | Uint8Array;
      }>) {
        const rawValue = row.value;

        values.set(
          row.key,
          typeof rawValue === "string"
            ? rawValue
            : Buffer.from(rawValue).toString("utf8"),
        );
      }
    } finally {
      database.close();
    }
  });

  return values;
}

async function loadStateValues(
  keys: string[],
): Promise<Map<string, string>> {
  const databasePath = getAntigravityStateDbPath();

  if (!existsSync(databasePath)) {
    return new Map();
  }

  try {
    return await readStateValues(databasePath, keys);
  } catch (error) {
    if (isSqliteLockedError(error)) {
      return withDatabaseSnapshot(databasePath, (snapshotPath) =>
        readStateValues(snapshotPath, keys),
      );
    }

    const message = error instanceof Error ? error.message : String(error);

    console.warn(`Warning: could not read Antigravity state DB ${databasePath}: ${message}`);

    return new Map();
  }
}

function readVarint(buffer: Buffer, offset: number) {
  let result = 0n;
  let shift = 0n;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = BigInt(buffer[cursor]);

    result |= (byte & 0x7fn) << shift;
    cursor += 1;

    if ((byte & 0x80n) === 0n) {
      return { value: result, nextOffset: cursor };
    }

    shift += 7n;

    if (shift > 63n) {
      return null;
    }
  }

  return null;
}

function parseProtobufFields(buffer: Buffer) {
  const fields: ProtobufField[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);

    if (!tag) {
      return null;
    }

    offset = tag.nextOffset;

    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (fieldNumber <= 0) {
      return null;
    }

    if (wireType === 0) {
      const value = readVarint(buffer, offset);

      if (!value) {
        return null;
      }

      fields.push({
        fieldNumber,
        wireType,
        value: value.value,
      });
      offset = value.nextOffset;
      continue;
    }

    if (wireType === 1) {
      if (offset + 8 > buffer.length) {
        return null;
      }

      fields.push({ fieldNumber, wireType, bytes: buffer.subarray(offset, offset + 8) });
      offset += 8;
      continue;
    }

    if (wireType === 2) {
      const length = readVarint(buffer, offset);

      if (!length) {
        return null;
      }

      offset = length.nextOffset;
      const byteLength = Number(length.value);

      if (!Number.isSafeInteger(byteLength) || offset + byteLength > buffer.length) {
        return null;
      }

      fields.push({
        fieldNumber,
        wireType,
        bytes: buffer.subarray(offset, offset + byteLength),
      });
      offset += byteLength;
      continue;
    }

    if (wireType === 5) {
      if (offset + 4 > buffer.length) {
        return null;
      }

      fields.push({ fieldNumber, wireType, bytes: buffer.subarray(offset, offset + 4) });
      offset += 4;
      continue;
    }

    return null;
  }

  return fields;
}

function decodeUtf8String(buffer: Buffer) {
  try {
    const value = buffer.toString("utf8");

    if (value.includes("\u0000")) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function decodeBase64Payload(value: string) {
  const compact = value.trim();

  if (
    compact.length < 24 ||
    compact.length % 4 !== 0 ||
    !BASE64_PATTERN.test(compact)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(compact, "base64");

    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function isLikelyTimestamp(seconds: number, nanos?: number) {
  if (seconds < MIN_UNIX_SECONDS || seconds > MAX_UNIX_SECONDS) {
    return false;
  }

  if (nanos !== undefined && (nanos < 0 || nanos >= 1_000_000_000)) {
    return false;
  }

  return true;
}

function addTimestamp(
  timestamps: Map<number, Date>,
  seconds: number,
  nanos = 0,
) {
  if (!isLikelyTimestamp(seconds, nanos)) {
    return;
  }

  const time = seconds * 1_000 + Math.trunc(nanos / 1_000_000);

  timestamps.set(time, new Date(time));
}

function collectProtobufInsights(
  buffer: Buffer,
  state: {
    timestamps: Map<number, Date>;
    modelCounts: Map<string, number>;
    visited: Set<string>;
  },
  depth = 0,
) {
  if (depth > MAX_PROTOBUF_RECURSION_DEPTH || buffer.length === 0) {
    return;
  }

  const visitKey = `${depth}:${buffer.length}:${buffer.subarray(0, 16).toString("hex")}`;

  if (state.visited.has(visitKey)) {
    return;
  }

  state.visited.add(visitKey);

  const fields = parseProtobufFields(buffer);

  if (!fields || fields.length === 0) {
    return;
  }

  const firstField = fields.find(
    (field) => field.fieldNumber === 1 && field.wireType === 0 && field.value !== undefined,
  );
  const secondField = fields.find(
    (field) => field.fieldNumber === 2 && field.wireType === 0 && field.value !== undefined,
  );

  if (firstField?.value !== undefined) {
    const seconds = Number(firstField.value);
    const nanos =
      secondField?.value !== undefined ? Number(secondField.value) : 0;

    addTimestamp(state.timestamps, seconds, nanos);
  }

  for (const field of fields) {
    if (field.wireType !== 2 || !field.bytes || field.bytes.length === 0) {
      continue;
    }

    const asText = decodeUtf8String(field.bytes);

    if (asText) {
      addModelMatches(state.modelCounts, asText);

      const nestedBase64 = decodeBase64Payload(asText);

      if (nestedBase64) {
        collectProtobufInsights(nestedBase64, state, depth + 1);
      }
    }

    collectProtobufInsights(field.bytes, state, depth + 1);
  }
}

function parseTrajectorySummaryEntry(entryBuffer: Buffer): AntigravityTrajectoryEntry | null {
  const fields = parseProtobufFields(entryBuffer);

  if (!fields) {
    return null;
  }

  const idField = fields.find(
    (field) => field.fieldNumber === 1 && field.wireType === 2 && field.bytes,
  );
  const trajectoryId = idField?.bytes ? decodeUtf8String(idField.bytes) : null;

  if (!trajectoryId) {
    return null;
  }

  const timestamps = new Map<number, Date>();
  const modelCounts = new Map<string, number>();
  const visited = new Set<string>();

  collectProtobufInsights(entryBuffer, { timestamps, modelCounts, visited });

  return {
    id: trajectoryId,
    dates: [...timestamps.values()],
    dominantModel: getDominantModel(modelCounts),
  };
}

function parseTrajectorySummaryBlob(serialized: string) {
  if (!serialized.trim()) {
    return [];
  }

  const decoded = Buffer.from(serialized, "base64");
  const topLevelFields = parseProtobufFields(decoded);

  if (!topLevelFields) {
    return [];
  }

  const entries: AntigravityTrajectoryEntry[] = [];

  for (const field of topLevelFields) {
    if (field.fieldNumber !== 1 || field.wireType !== 2 || !field.bytes) {
      continue;
    }

    const entry = parseTrajectorySummaryEntry(field.bytes);

    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

async function collectTrajectorySummaryActivity(
  accumulator: AntigravityUsageAccumulator,
  uniqueActivityDays: Set<string>,
  start: Date,
  end: Date,
) {
  const stateValues = await loadStateValues([
    "antigravityUnifiedStateSync.trajectorySummaries",
    "unifiedStateSync.trajectorySummaries",
  ]);

  for (const [key, value] of stateValues.entries()) {
    for (const entry of parseTrajectorySummaryBlob(value)) {
      const inRangeDates = entry.dates.filter(
        (date) => date >= start && date <= end,
      );

      addPerDayActivity(
        accumulator,
        uniqueActivityDays,
        `${key}:${entry.id}`,
        inRangeDates,
        entry.dominantModel,
      );
    }
  }
}

async function collectBrowserRecordingActivity(
  accumulator: AntigravityUsageAccumulator,
  uniqueActivityDays: Set<string>,
  start: Date,
  end: Date,
) {
  const browserRecordingsDir = join(getAntigravityDataDir(), "browser_recordings");
  const metadataFiles = await listFilesRecursive(browserRecordingsDir, ".json");

  for (const metadataFile of metadataFiles) {
    if (basename(metadataFile) !== "metadata.json") {
      continue;
    }

    const recordingId = basename(resolve(metadataFile, ".."));
    const dates: Date[] = [];

    try {
      const metadata = JSON.parse(
        await readFile(metadataFile, "utf8"),
      ) as AntigravityBrowserRecordingMetadata;

      for (const highlight of metadata.highlights ?? []) {
        const highlightDate = highlight.start_time
          ? parseDate(highlight.start_time)
          : highlight.end_time
            ? parseDate(highlight.end_time)
            : null;

        if (highlightDate) {
          dates.push(highlightDate);
        }
      }
    } catch {
      continue;
    }

    addPerDayActivity(
      accumulator,
      uniqueActivityDays,
      `browser-recording:${recordingId}`,
      dates.filter((date) => date >= start && date <= end),
    );
  }
}

async function collectFileTimestampActivity(
  accumulator: AntigravityUsageAccumulator,
  uniqueActivityDays: Set<string>,
  start: Date,
  end: Date,
  directory: string,
  extension: string,
  sourcePrefix: string,
) {
  const files = await listFilesRecursive(directory, extension);

  for (const filePath of files) {
    let stats;

    try {
      stats = await stat(filePath);
    } catch {
      continue;
    }

    const modifiedAt = stats.mtime;

    if (modifiedAt < start || modifiedAt > end) {
      continue;
    }

    addPerDayActivity(
      accumulator,
      uniqueActivityDays,
      `${sourcePrefix}:${basename(filePath)}`,
      [modifiedAt],
    );
  }
}

async function collectAnnotationActivity(
  accumulator: AntigravityUsageAccumulator,
  uniqueActivityDays: Set<string>,
  start: Date,
  end: Date,
) {
  const annotationsDir = join(getAntigravityDataDir(), "annotations");
  const annotationFiles = await listFilesRecursive(annotationsDir, ".pbtxt");

  for (const annotationFile of annotationFiles) {
    let content: string;

    try {
      content = await readFile(annotationFile, "utf8");
    } catch {
      continue;
    }

    const match = content.match(/seconds:(\d+)/);

    if (!match) {
      continue;
    }

    const seconds = Number.parseInt(match[1], 10);

    if (!Number.isFinite(seconds)) {
      continue;
    }

    const date = new Date(seconds * 1_000);

    if (date < start || date > end) {
      continue;
    }

    addPerDayActivity(
      accumulator,
      uniqueActivityDays,
      `annotation:${basename(annotationFile)}`,
      [date],
    );
  }
}

export function isAntigravityAvailable() {
  return (
    existsSync(getAntigravityLogsDir()) ||
    existsSync(getAntigravityStateDbPath()) ||
    existsSync(getAntigravityDataDir())
  );
}

export async function loadAntigravityRows(
  start: Date,
  end: Date,
): Promise<UsageSummary> {
  const accumulator: AntigravityUsageAccumulator = {
    displayValuesByDate: new Map(),
    modelMessageCounts: new Map(),
    recentModelMessageCounts: new Map(),
    recentStart: getRecentWindowStart(end, 30),
  };
  const uniqueActivityDays = new Set<string>();

  await collectTrajectorySummaryActivity(
    accumulator,
    uniqueActivityDays,
    start,
    end,
  );

  const dataDir = getAntigravityDataDir();

  await Promise.all([
    collectBrowserRecordingActivity(
      accumulator,
      uniqueActivityDays,
      start,
      end,
    ),
    collectAnnotationActivity(
      accumulator,
      uniqueActivityDays,
      start,
      end,
    ),
    collectFileTimestampActivity(
      accumulator,
      uniqueActivityDays,
      start,
      end,
      join(dataDir, "conversations"),
      ".pb",
      "conversation",
    ),
    collectFileTimestampActivity(
      accumulator,
      uniqueActivityDays,
      start,
      end,
      join(dataDir, "implicit"),
      ".pb",
      "implicit",
    ),
  ]);

  for (const logFile of await getAntigravityLogFiles()) {
    for (const event of await scanAntigravityLog(logFile)) {
      if (event.date < start || event.date > end) {
        continue;
      }

      addActivityEvent(accumulator, event.date, event.model);
    }
  }

  const summary = createUsageSummary(
    "antigravity",
    new Map(),
    new Map(),
    new Map(),
    end,
    accumulator.displayValuesByDate,
  );

  summary.insights = {
    streaks: summary.insights?.streaks ?? { longest: 0, current: 0 },
    mostUsedModel: getTopModelByMessages(accumulator.modelMessageCounts),
    recentMostUsedModel: getTopModelByMessages(
      accumulator.recentModelMessageCounts,
    ),
  };

  return summary;
}
