import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultOutputPath,
  getDefaultOutputSuffix,
} from "../src/output-path.ts";

function createValues(overrides?: Partial<{
  all: boolean;
  amp: boolean;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  gemini: boolean;
  opencode: boolean;
  pi: boolean;
}>) {
  return {
    all: false,
    amp: false,
    claude: false,
    codex: false,
    cursor: false,
    gemini: false,
    opencode: false,
    pi: false,
    ...overrides,
  };
}

test("default output path stays unsuffixed when no provider flags are set", () => {
  assert.equal(
    getDefaultOutputPath(createValues(), "png"),
    "./heatmap-last-year.png",
  );
});

test("default output path adds _cursor for --cursor", () => {
  assert.equal(
    getDefaultOutputPath(createValues({ cursor: true }), "png"),
    "./heatmap-last-year_cursor.png",
  );
});

test("default output path adds _all for --all", () => {
  assert.equal(
    getDefaultOutputPath(createValues({ all: true, cursor: true }), "json"),
    "./heatmap-last-year_all.json",
  );
});

test("default output path reflects multiple explicit provider flags", () => {
  assert.equal(
    getDefaultOutputPath(
      createValues({ codex: true, cursor: true, pi: true }),
      "svg",
    ),
    "./heatmap-last-year_codex_cursor_pi.svg",
  );
});

test("default output suffix follows provider flag order", () => {
  assert.equal(
    getDefaultOutputSuffix(
      createValues({ pi: true, gemini: true, amp: true, opencode: true }),
    ),
    "_amp_gemini_opencode_pi",
  );
});
