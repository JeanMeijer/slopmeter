import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { summarizeCursorUsageCsv } from "../src/lib/cursor";

const cliPath = resolve(import.meta.dirname, "../dist/cli.js");
const cliRuntime = process.release.name === "node" ? process.execPath : "node";
const npmRuntime = process.platform === "win32" ? "npm.cmd" : "npm";
const tarRuntime =
  process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";

function createTempWorkspace(label: string) {
  return mkdtempSync(join(tmpdir(), `slopmeter-${label}-`));
}

function recentIso(daysAgo = 0) {
  const date = new Date();

  date.setUTCDate(date.getUTCDate() - daysAgo);

  return date.toISOString();
}

function recentDate(daysAgo = 0) {
  const date = new Date();

  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);

  return date.toISOString().slice(0, 10);
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function ensureParent(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJsonlFile(path: string, records: string[]) {
  ensureParent(path);
  writeFileSync(path, `${records.join("\n")}\n`, "utf8");
}

function writeJsonFile(path: string, value: string) {
  ensureParent(path);
  writeFileSync(path, value, "utf8");
}

function createHomeEnv(homeDir: string): NodeJS.ProcessEnv {
  if (process.platform === "win32") {
    return {
      HOME: undefined,
      HOMEDRIVE: undefined,
      HOMEPATH: undefined,
      PI_CODING_AGENT_DIR: undefined,
      USERPROFILE: homeDir,
    };
  }

  return {
    HOME: homeDir,
    PI_CODING_AGENT_DIR: undefined,
    USERPROFILE: undefined,
  };
}

function createChildEnv(extraEnv: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    FORCE_COLOR: "0",
    NODE_NO_WARNINGS: "1",
    NO_COLOR: "1",
    TERM: "dumb",
  };
  const unsetKeys = Object.entries(extraEnv)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);

  if (process.platform === "win32") {
    const unsetKeyNames = new Set(unsetKeys.map((key) => key.toUpperCase()));

    for (const key of Object.keys(env)) {
      if (unsetKeyNames.has(key.toUpperCase())) {
        delete env[key];
      }
    }
  } else {
    for (const key of unsetKeys) {
      delete env[key];
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }

  return env;
}

function packCliPackage(packDir: string) {
  const result = spawnSync(
    `${npmRuntime} pack --json --pack-destination "${packDir}"`,
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      shell: true,
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const output = JSON.parse(result.stdout) as Array<{ filename: string }>;

  return join(packDir, output[0]!.filename);
}

function extractTarball(tarballPath: string, extractDir: string) {
  const result = spawnSync(tarRuntime, ["-xzf", tarballPath, "-C", extractDir], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function codexTurnContext(model = "gpt-5") {
  return JSON.stringify({
    type: "turn_context",
    timestamp: recentIso(),
    payload: { model },
  });
}

interface CodexUsageFixture {
  input?: number;
  cachedInput?: number;
  output?: number;
  reasoningOutput?: number;
  total?: number;
}

function codexUsage(options: CodexUsageFixture = {}) {
  const {
    input = 10,
    cachedInput = 0,
    output = 5,
    reasoningOutput = 0,
    total = input + output,
  } = options;

  return {
    input_tokens: input,
    cached_input_tokens: cachedInput,
    output_tokens: output,
    reasoning_output_tokens: reasoningOutput,
    total_tokens: total,
  };
}

function codexTokenCount(options: {
  model?: string;
  timestamp?: string;
  input?: number;
  cachedInput?: number;
  output?: number;
  reasoningOutput?: number;
  total?: number;
  lastUsage?: CodexUsageFixture | null;
  totalUsage?: CodexUsageFixture;
  padding?: string;
}) {
  const {
    model,
    timestamp = recentIso(),
    input = 10,
    cachedInput = 0,
    output = 5,
    reasoningOutput = 0,
    total = input + output,
    lastUsage,
    totalUsage,
    padding,
  } = options;
  const resolvedLastUsage =
    lastUsage === null
      ? undefined
      : codexUsage({
          input,
          cachedInput,
          output,
          reasoningOutput,
          total,
          ...lastUsage,
        });
  const resolvedTotalUsage = totalUsage ? codexUsage(totalUsage) : undefined;

  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      ...(model ? { model } : {}),
      padding,
      info: {
        ...(resolvedLastUsage ? { last_token_usage: resolvedLastUsage } : {}),
        ...(resolvedTotalUsage
          ? { total_token_usage: resolvedTotalUsage }
          : {}),
      },
    },
  });
}

function codexOversizedIrrelevantRecord(size: number) {
  return JSON.stringify({
    type: "response_item",
    timestamp: recentIso(),
    payload: {
      type: "function_call_output",
      output: "x".repeat(size),
    },
  });
}

function claudeEntry(options: {
  timestamp?: string;
  messageId: string;
  requestId: string;
  model?: string;
  input?: number;
  output?: number;
}) {
  const {
    timestamp = recentIso(),
    messageId,
    requestId,
    model = "claude-3-5-sonnet-20241022",
    input = 6,
    output = 4,
  } = options;

  return JSON.stringify({
    timestamp,
    requestId,
    message: {
      id: messageId,
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
      },
    },
  });
}

function openCodeMessage(options: {
  id?: string;
  role?: string;
  modelID?: string;
  created?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}) {
  const {
    id = "msg-1",
    role = "assistant",
    modelID = "gpt-5.4",
    created = Date.now(),
    input = 6,
    output = 4,
    cacheRead = 0,
    cacheWrite = 0,
  } = options;

  return JSON.stringify({
    id,
    role,
    modelID,
    providerID: "openai",
    time: { created, completed: created + 1_000 },
    tokens: {
      total: input + output + cacheRead + cacheWrite,
      input,
      output,
      reasoning: 0,
      cache: {
        read: cacheRead,
        write: cacheWrite,
      },
    },
  });
}

function piSessionHeader(cwd = "/tmp") {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: "pi-session-1",
    timestamp: recentIso(),
    cwd,
  });
}

function piAssistantMessage(options: {
  timestamp?: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}) {
  const {
    timestamp = recentIso(),
    model = "gpt-5.4",
    input = 10,
    output = 6,
    cacheRead = 0,
    cacheWrite = 0,
    totalTokens = input + output + cacheRead + cacheWrite,
  } = options;

  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model,
      usage: {
        input,
        output,
        cacheRead,
        cacheWrite,
        totalTokens,
      },
      stopReason: "endTurn",
      timestamp: Date.now(),
    },
  });
}

function piToolResultMessage(size: number) {
  return JSON.stringify({
    type: "message",
    timestamp: recentIso(),
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "x".repeat(size) }],
      timestamp: Date.now(),
    },
  });
}

async function createOpenCodeDb(
  rootDir: string,
  rows: Array<{ id: string; created?: number; data: string }>,
) {
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = join(rootDir, "opencode.db");

  ensureParent(databasePath);

  const database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    const insert = database.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const created = row.created ?? Date.now();

      insert.run(row.id, "ses-1", created, created, row.data);
    }
  } finally {
    database.close();
  }
}

async function runCli(args: string[], extraEnv: NodeJS.ProcessEnv) {
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolveRun, reject) => {
    const child = spawn(cliRuntime, [cliPath, ...args], {
      env: createChildEnv(extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

test("--codex only loads Codex and only reports Codex availability", async (t) => {
  const workspace = createTempWorkspace("codex-only");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const claudeConfig = join(workspace, "claude");
  const openCodeDir = join(workspace, "opencode");
  const outputPath = join(workspace, "out.json");
  const unreadableClaudeFile = join(claudeConfig, "projects", "bad.jsonl");

  writeJsonlFile(join(codexHome, "sessions", "session.jsonl"), [
    codexTurnContext(),
    codexTokenCount({ input: 12, output: 8, total: 20 }),
  ]);
  writeJsonlFile(unreadableClaudeFile, ['{"broken":true}']);
  chmodSync(unreadableClaudeFile, 0o000);
  writeJsonFile(
    join(openCodeDir, "storage", "message", "bad.json"),
    "{ this is not valid json",
  );

  const result = await runCli(
    ["--codex", "--format", "json", "--output", outputPath],
    {
      CODEX_HOME: codexHome,
      CLAUDE_CONFIG_DIR: claudeConfig,
      OPENCODE_DATA_DIR: openCodeDir,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex found/);
  assert.doesNotMatch(result.stdout, /Claude code/);
  assert.doesNotMatch(result.stdout, /Open Code/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["codex"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 20);
});

test("Codex derives token usage from cumulative totals and ignores duplicate snapshots", async (t) => {
  const workspace = createTempWorkspace("codex-cumulative-totals");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const outputPath = join(workspace, "out.json");
  const baseTimestamp = new Date();

  baseTimestamp.setUTCHours(0, 0, 0, 0);

  writeJsonlFile(join(codexHome, "sessions", "session.jsonl"), [
    JSON.stringify({
      type: "turn_context",
      timestamp: new Date(baseTimestamp.getTime()).toISOString(),
      payload: { model: "gpt-5.2" },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 1_000).toISOString(),
      input: 100,
      cachedInput: 20,
      output: 30,
      reasoningOutput: 5,
      total: 130,
      totalUsage: {
        input: 100,
        cachedInput: 20,
        output: 30,
        reasoningOutput: 5,
        total: 130,
      },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 2_000).toISOString(),
      input: 100,
      cachedInput: 20,
      output: 30,
      reasoningOutput: 5,
      total: 130,
      totalUsage: {
        input: 100,
        cachedInput: 20,
        output: 30,
        reasoningOutput: 5,
        total: 130,
      },
    }),
  ]);

  const result = await runCli(
    ["--codex", "--format", "json", "--output", outputPath],
    {
      CODEX_HOME: codexHome,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{
      provider: string;
      daily: Array<{
        date: string;
        input: number;
        output: number;
        cache: { input: number; output: number };
        total: number;
        breakdown: Array<{ name: string; tokens: { total: number } }>;
      }>;
    }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["codex"],
  );
  assert.deepEqual(
    payload.providers[0]?.daily.map((day) => ({
      date: day.date,
      input: day.input,
      output: day.output,
      cache: day.cache,
      total: day.total,
      model: day.breakdown[0]?.name,
      modelTotal: day.breakdown[0]?.tokens.total,
    })),
    [
      {
        date: formatLocalDate(baseTimestamp),
        input: 100,
        output: 30,
        cache: { input: 20, output: 0 },
        total: 130,
        model: "gpt-5.2",
        modelTotal: 130,
      },
    ],
  );
});

test("Codex falls back to last usage when cumulative totals roll back", async (t) => {
  const workspace = createTempWorkspace("codex-total-rollback");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const outputPath = join(workspace, "out.json");
  const baseTimestamp = new Date();

  baseTimestamp.setUTCHours(0, 0, 0, 0);

  writeJsonlFile(join(codexHome, "sessions", "session.jsonl"), [
    JSON.stringify({
      type: "turn_context",
      timestamp: new Date(baseTimestamp.getTime()).toISOString(),
      payload: { model: "gpt-5.2" },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 1_000).toISOString(),
      input: 100,
      output: 30,
      total: 130,
      totalUsage: { input: 100, output: 30, total: 130 },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 2_000).toISOString(),
      input: 7,
      output: 5,
      total: 12,
      totalUsage: { input: 7, output: 5, total: 12 },
    }),
  ]);

  const result = await runCli(
    ["--codex", "--format", "json", "--output", outputPath],
    {
      CODEX_HOME: codexHome,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["codex"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 142);
});

test("Codex advances the cumulative baseline across last-usage-only records", async (t) => {
  const workspace = createTempWorkspace("codex-last-usage-baseline");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const outputPath = join(workspace, "out.json");
  const baseTimestamp = new Date();

  baseTimestamp.setUTCHours(0, 0, 0, 0);

  writeJsonlFile(join(codexHome, "sessions", "session.jsonl"), [
    JSON.stringify({
      type: "turn_context",
      timestamp: new Date(baseTimestamp.getTime()).toISOString(),
      payload: { model: "gpt-5.2" },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 1_000).toISOString(),
      input: 100,
      output: 30,
      total: 130,
      totalUsage: { input: 100, output: 30, total: 130 },
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 2_000).toISOString(),
      input: 7,
      output: 5,
      total: 12,
      totalUsage: undefined,
    }),
    codexTokenCount({
      timestamp: new Date(baseTimestamp.getTime() + 3_000).toISOString(),
      input: 1,
      output: 2,
      total: 3,
      lastUsage: { input: 1, output: 2, total: 3 },
      totalUsage: { input: 108, output: 37, total: 145 },
    }),
  ]);

  const result = await runCli(
    ["--codex", "--format", "json", "--output", outputPath],
    {
      CODEX_HOME: codexHome,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["codex"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 145);
});

test("--pi only loads Pi Coding Agent and ignores oversized irrelevant session records", async (t) => {
  const workspace = createTempWorkspace("pi-only");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const piAgentDir = join(workspace, "pi-agent");
  const codexHome = join(workspace, "codex");
  const claudeConfig = join(workspace, "claude");
  const openCodeDir = join(workspace, "opencode");
  const outputPath = join(workspace, "out.json");

  writeJsonlFile(join(piAgentDir, "sessions", "session.jsonl"), [
    piSessionHeader(workspace),
    piToolResultMessage(4_096),
    piAssistantMessage({
      input: 12,
      output: 7,
      cacheRead: 2,
      totalTokens: 21,
    }),
  ]);
  writeJsonlFile(join(codexHome, "sessions", "bad.jsonl"), ['{"broken":true}']);
  writeJsonFile(join(openCodeDir, "storage", "message", "bad.json"), "{");

  const result = await runCli(
    ["--pi", "--format", "json", "--output", outputPath],
    {
      PI_CODING_AGENT_DIR: piAgentDir,
      CODEX_HOME: codexHome,
      CLAUDE_CONFIG_DIR: claudeConfig,
      OPENCODE_DATA_DIR: openCodeDir,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "1024",
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Pi Coding Agent found/);
  assert.doesNotMatch(result.stdout, /Claude code/);
  assert.doesNotMatch(result.stdout, /Codex/);
  assert.doesNotMatch(result.stdout, /Open Code/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{
      provider: string;
      daily: Array<{
        input: number;
        output: number;
        total: number;
        breakdown: Array<{ name: string }>;
      }>;
    }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["pi"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.input, 14);
  assert.equal(payload.providers[0]?.daily[0]?.output, 7);
  assert.equal(payload.providers[0]?.daily[0]?.total, 21);
  assert.equal(payload.providers[0]?.daily[0]?.breakdown[0]?.name, "gpt-5.4");
});

test("Pi discovers ~/.pi/agent/sessions from the default home directory layout", async (t) => {
  const workspace = createTempWorkspace("pi-home-discovery");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const outputPath = join(workspace, "out.json");

  writeJsonlFile(join(workspace, ".pi", "agent", "sessions", "session.jsonl"), [
    piSessionHeader(workspace),
    piAssistantMessage({
      input: 7,
      output: 5,
      cacheRead: 3,
      totalTokens: 15,
    }),
  ]);

  const result = await runCli(
    ["--pi", "--format", "json", "--output", outputPath],
    createHomeEnv(workspace),
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Pi Coding Agent found/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["pi"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 15);
});

test("Pi default-home discovery ignores mixed-case PI_CODING_AGENT_DIR variants", async (t) => {
  const workspace = createTempWorkspace("pi-home-mixed-case-env");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const outputPath = join(workspace, "out.json");
  const leakedPiAgentDir = join(workspace, "leaked-pi-agent-dir");

  writeJsonlFile(join(workspace, ".pi", "agent", "sessions", "session.jsonl"), [
    piSessionHeader(workspace),
    piAssistantMessage({
      input: 9,
      output: 4,
      cacheRead: 2,
      totalTokens: 15,
    }),
  ]);
  mkdirSync(leakedPiAgentDir, { recursive: true });

  const result = await runCli(
    ["--pi", "--format", "json", "--output", outputPath],
    {
      ...createHomeEnv(workspace),
      Pi_Coding_Agent_Dir: leakedPiAgentDir,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Pi Coding Agent found/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["pi"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 15);
});

test("Codex skips oversized irrelevant records and still counts token usage", async (t) => {
  const workspace = createTempWorkspace("codex-oversized-irrelevant");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const outputPath = join(workspace, "out.json");

  writeJsonlFile(join(codexHome, "sessions", "session.jsonl"), [
    codexTurnContext(),
    codexOversizedIrrelevantRecord(1024),
    codexTokenCount({ input: 9, output: 6, total: 15 }),
  ]);

  const result = await runCli(
    ["--codex", "--format", "json", "--output", outputPath],
    {
      CODEX_HOME: codexHome,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "256",
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /Skipped 1 oversized irrelevant Codex record\(s\)/,
  );

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.equal(payload.providers[0]?.daily[0]?.total, 15);
});

test("Codex fails clearly on oversized relevant records", async (t) => {
  const workspace = createTempWorkspace("codex-oversized-relevant");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const codexHome = join(workspace, "codex");
  const oversizedFile = join(codexHome, "sessions", "session.jsonl");

  writeJsonlFile(oversizedFile, [
    codexTurnContext(),
    codexTokenCount({
      input: 11,
      output: 7,
      total: 18,
      padding: "x".repeat(1024),
    }),
  ]);

  const result = await runCli(
    ["--codex", "--format", "json", "--output", join(workspace, "out.json")],
    {
      CODEX_HOME: codexHome,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "256",
    },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Relevant Codex record exceeds 256 bytes/);
  assert.match(
    result.stderr,
    new RegExp(oversizedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(result.stderr, /SLOPMETER_MAX_JSONL_RECORD_BYTES/);
});

test("Claude JSONL streaming preserves usage results across multiple files", async (t) => {
  const workspace = createTempWorkspace("claude-streaming");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const claudeConfig = join(workspace, "claude");
  const outputPath = join(workspace, "out.json");

  writeJsonlFile(join(claudeConfig, "projects", "one.jsonl"), [
    claudeEntry({ messageId: "m-1", requestId: "r-1", input: 4, output: 6 }),
    "{ malformed json",
    claudeEntry({ messageId: "m-2", requestId: "r-2", input: 3, output: 2 }),
  ]);
  writeJsonlFile(join(claudeConfig, "projects", "two.jsonl"), [
    claudeEntry({ messageId: "m-1", requestId: "r-1", input: 4, output: 6 }),
    claudeEntry({ messageId: "m-3", requestId: "r-3", input: 5, output: 5 }),
  ]);

  const result = await runCli(
    ["--claude", "--format", "json", "--output", outputPath],
    {
      CLAUDE_CONFIG_DIR: claudeConfig,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["claude"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 25);
});

test("Cursor streams CSV rows without buffering the full export", async () => {
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens\r\n",
          ),
        );
        controller.enqueue(encoder.encode(`${recentDate(1)},"gpt`));
        controller.enqueue(encoder.encode(`-5",2,3,4,5,14\r\n`));
        controller.enqueue(
          encoder.encode(`${recentDate(0)},gpt-5,1,1,0,2,4\r\n`),
        );
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
      },
    },
  );

  const summary = await summarizeCursorUsageCsv(
    response,
    new Date(`${recentDate(30)}T00:00:00`),
    new Date(`${recentDate(0)}T23:59:59.999`),
  );

  assert.deepEqual(
    summary.daily.map((day) => ({
      date: formatLocalDate(day.date),
      total: day.total,
      model: day.breakdown[0]?.name,
      modelTotal: day.breakdown[0]?.tokens.total,
    })),
    [
      {
        date: recentDate(1),
        total: 14,
        model: "gpt-5",
        modelTotal: 14,
      },
      {
        date: recentDate(0),
        total: 4,
        model: "gpt-5",
        modelTotal: 4,
      },
    ],
  );
});

test("Claude falls back to stats-cache.json for older layouts without double counting project logs", async (t) => {
  const workspace = createTempWorkspace("claude-stats-cache");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const claudeConfig = join(workspace, "claude");
  const outputPath = join(workspace, "out.json");

  writeJsonlFile(join(claudeConfig, "projects", "current.jsonl"), [
    claudeEntry({
      timestamp: `${recentDate(2)}T10:00:00.000Z`,
      messageId: "m-1",
      requestId: "r-1",
      model: "claude-opus-4-5-20251101",
      input: 6,
      output: 4,
    }),
  ]);
  writeJsonFile(
    join(claudeConfig, "stats-cache.json"),
    JSON.stringify({
      version: 2,
      lastComputedDate: recentDate(1),
      firstSessionDate: `${recentDate(4)}T08:00:00.000Z`,
      dailyActivity: [],
      dailyModelTokens: [
        {
          date: recentDate(4),
          tokensByModel: {
            "claude-opus-4-5-20251101": 100,
          },
        },
        {
          date: recentDate(2),
          tokensByModel: {
            "claude-opus-4-5-20251101": 999,
          },
        },
      ],
      modelUsage: {
        "claude-opus-4-5-20251101": {
          inputTokens: 30,
          outputTokens: 10,
          cacheReadInputTokens: 40,
          cacheCreationInputTokens: 20,
        },
      },
      totalSessions: 0,
      totalMessages: 0,
      hourCounts: {},
      totalSpeculationTimeSavedMs: 0,
    }),
  );

  const result = await runCli(
    ["--claude", "--format", "json", "--output", outputPath],
    {
      CLAUDE_CONFIG_DIR: claudeConfig,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{
      provider: string;
      daily: Array<{
        date: string;
        input: number;
        output: number;
        cache: { input: number; output: number };
        total: number;
        breakdown: Array<{
          name: string;
          tokens: {
            input: number;
            output: number;
            cache: { input: number; output: number };
            total: number;
          };
        }>;
      }>;
    }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["claude"],
  );
  assert.deepEqual(
    payload.providers[0]?.daily.map((day) => ({
      date: day.date,
      input: day.input,
      output: day.output,
      cache: day.cache,
      total: day.total,
      model: day.breakdown[0]?.name,
    })),
    [
      {
        date: recentDate(4),
        input: 70,
        output: 30,
        cache: { input: 40, output: 20 },
        total: 100,
        model: "claude-opus-4-5",
      },
      {
        date: recentDate(2),
        input: 6,
        output: 4,
        cache: { input: 0, output: 0 },
        total: 10,
        model: "claude-opus-4-5",
      },
    ],
  );
});

test("Claude falls back to history.jsonl for activity-only days before token logs exist", async (t) => {
  const workspace = createTempWorkspace("claude-history-fallback");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const claudeConfig = join(workspace, "claude");
  const outputPath = join(workspace, "out.json");

  writeJsonFile(
    join(claudeConfig, "history.jsonl"),
    [
      JSON.stringify({
        timestamp: `${recentDate(6)}T08:00:00.000Z`,
        sessionId: "s-1",
      }),
      JSON.stringify({
        timestamp: `${recentDate(6)}T08:30:00.000Z`,
        sessionId: "s-1",
      }),
      JSON.stringify({
        timestamp: `${recentDate(5)}T09:00:00.000Z`,
        sessionId: "s-2",
      }),
    ].join("\n"),
  );

  const result = await runCli(
    ["--claude", "--format", "json", "--output", outputPath],
    {
      CLAUDE_CONFIG_DIR: claudeConfig,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{
      provider: string;
      insights: {
        streaks: {
          longest: number;
          current: number;
        };
      };
      daily: Array<{
        date: string;
        total: number;
        displayValue?: number;
        breakdown: unknown[];
      }>;
    }>;
  };

  assert.deepEqual(
    payload.providers[0]?.daily.map((day) => ({
      date: day.date,
      total: day.total,
      displayValue: day.displayValue,
      breakdownLength: day.breakdown.length,
    })),
    [
      {
        date: recentDate(6),
        total: 0,
        displayValue: 2,
        breakdownLength: 0,
      },
      {
        date: recentDate(5),
        total: 0,
        displayValue: 1,
        breakdownLength: 0,
      },
    ],
  );
  assert.deepEqual(payload.providers[0]?.insights.streaks, {
    longest: 2,
    current: 0,
  });
});

test("Claude fails clearly on oversized JSONL records via the shared splitter", async (t) => {
  const workspace = createTempWorkspace("claude-oversized");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const claudeConfig = join(workspace, "claude");
  const oversizedFile = join(claudeConfig, "projects", "oversized.jsonl");

  writeJsonlFile(oversizedFile, [
    claudeEntry({
      messageId: "m-1",
      requestId: "r-1",
      input: 3,
      output: 2,
    }),
    JSON.stringify({
      timestamp: recentIso(),
      requestId: "r-2",
      message: {
        id: "m-2",
        model: "claude-3-5-sonnet-20241022",
        usage: {
          input_tokens: 4,
          output_tokens: 1,
        },
        padding: "x".repeat(1024),
      },
    }),
  ]);

  const result = await runCli(
    ["--claude", "--format", "json", "--output", join(workspace, "out.json")],
    {
      CLAUDE_CONFIG_DIR: claudeConfig,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "256",
    },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /JSONL record exceeds 256 bytes/);
  assert.match(
    result.stderr,
    new RegExp(oversizedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(result.stderr, /SLOPMETER_MAX_JSONL_RECORD_BYTES/);
});

test("OpenCode reads the legacy file-backed message layout", async (t) => {
  const workspace = createTempWorkspace("opencode-files");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const openCodeDir = join(workspace, "opencode");
  const outputPath = join(workspace, "out.json");

  writeJsonFile(
    join(openCodeDir, "storage", "message", "one.json"),
    openCodeMessage({
      id: "msg-1",
      input: 8,
      output: 5,
      cacheRead: 2,
    }),
  );

  const result = await runCli(
    ["--opencode", "--format", "json", "--output", outputPath],
    {
      OPENCODE_DATA_DIR: openCodeDir,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Open Code found/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["opencode"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 15);
});

test("OpenCode prefers the SQLite message store when opencode.db exists", async (t) => {
  const workspace = createTempWorkspace("opencode-db");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const openCodeDir = join(workspace, "opencode");
  const outputPath = join(workspace, "out.json");

  await createOpenCodeDb(openCodeDir, [
    {
      id: "msg-db-1",
      data: openCodeMessage({
        id: "msg-db-1",
        modelID: "gpt-5.4",
        input: 8,
        output: 5,
        cacheRead: 2,
      }),
    },
  ]);
  writeJsonFile(
    join(openCodeDir, "storage", "message", "bad.json"),
    "{ this is not valid json",
  );

  const result = await runCli(
    ["--opencode", "--format", "json", "--output", outputPath],
    {
      OPENCODE_DATA_DIR: openCodeDir,
    },
  );

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Open Code found/);

  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as {
    providers: Array<{ provider: string; daily: Array<{ total: number }> }>;
  };

  assert.deepEqual(
    payload.providers.map((provider) => provider.provider),
    ["opencode"],
  );
  assert.equal(payload.providers[0]?.daily[0]?.total, 15);
});

test("OpenCode fails clearly on oversized JSON documents", async (t) => {
  const workspace = createTempWorkspace("opencode-oversized");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const openCodeDir = join(workspace, "opencode");
  const oversizedFile = join(
    openCodeDir,
    "storage",
    "message",
    "oversized.json",
  );

  writeJsonFile(
    oversizedFile,
    `${openCodeMessage({
      input: 1,
      output: 1,
    }).slice(0, -1)},"padding":"${"x".repeat(1024)}"}`,
  );

  const result = await runCli(
    ["--opencode", "--format", "json", "--output", join(workspace, "out.json")],
    {
      OPENCODE_DATA_DIR: openCodeDir,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "256",
    },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /JSON document exceeds 256 bytes/);
  assert.match(
    result.stderr,
    new RegExp(oversizedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(result.stderr, /SLOPMETER_MAX_JSONL_RECORD_BYTES/);
});

test("OpenCode fails clearly on oversized SQLite message payloads", async (t) => {
  const workspace = createTempWorkspace("opencode-db-oversized");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const openCodeDir = join(workspace, "opencode");

  await createOpenCodeDb(openCodeDir, [
    {
      id: "msg-db-oversized",
      data: `${openCodeMessage({
        id: "msg-db-oversized",
        input: 1,
        output: 1,
      }).slice(0, -1)},"padding":"${"x".repeat(1024)}"}`,
    },
  ]);

  const result = await runCli(
    ["--opencode", "--format", "json", "--output", join(workspace, "out.json")],
    {
      OPENCODE_DATA_DIR: openCodeDir,
      SLOPMETER_MAX_JSONL_RECORD_BYTES: "256",
      NODE_NO_WARNINGS: "1",
    },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /JSON payload exceeds 256 bytes/);
  assert.match(result.stderr, /opencode\.db:message:msg-db-oversized/);
  assert.match(result.stderr, /SLOPMETER_MAX_JSONL_RECORD_BYTES/);
});

test("npm pack artifact includes Pi Coding Agent support", (t) => {
  const workspace = createTempWorkspace("pi-pack-artifact");

  t.after(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  const extractDir = join(workspace, "extract");

  mkdirSync(extractDir, { recursive: true });

  const tarballPath = packCliPackage(workspace);

  extractTarball(tarballPath, extractDir);

  const packedPackageJson = JSON.parse(
    readFileSync(join(extractDir, "package", "package.json"), "utf8"),
  ) as {
    description: string;
    keywords: string[];
  };
  const packedCli = readFileSync(
    join(extractDir, "package", "dist", "cli.js"),
    "utf8",
  );

  assert.match(packedPackageJson.description, /Pi Coding Agent/);
  assert.ok(packedPackageJson.keywords.includes("pi-coding-agent"));
  assert.match(packedCli, /--pi/);
  assert.match(packedCli, /Pi Coding Agent/);
});
