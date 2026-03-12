# slopmeter

CLI tool that generates usage heatmaps for Claude Code, Codex, Cursor, Open Code, and Pi Coding Agent for the rolling past year (ending today).

## Monorepo layout

```text
packages/
  cli/
  registry/
tooling/
  typescript-config/
```

## Setup

```bash
bun install
bun run check
```

## Usage

```bash
# Build once
bun run build

# Run from built output
node packages/cli/dist/cli.js

# Run the CLI package directly in dev mode
bun run --cwd packages/cli dev

# Or if installed as a package binary
slopmeter
```

### Options

```bash
# Output file (default: ./heatmap-last-year.png)
slopmeter --output ./out/heatmap.svg
slopmeter -o ./out/heatmap.svg

# Output format
slopmeter --format png
slopmeter --format svg
slopmeter --format json
slopmeter -f svg

# Dark theme
slopmeter --dark
slopmeter --dark --format svg

# Merge all providers into one graph
slopmeter --all

# Provider filters (optional)
slopmeter --claude
slopmeter --codex
slopmeter --cursor
slopmeter --opencode
slopmeter --pi
```

## What the image shows

- Monday-first contribution-style heatmap for the last year.
- Top metrics per provider:
  - `LAST 30 DAYS`
  - `INPUT TOKENS`
  - `OUTPUT TOKENS`
  - `TOTAL TOKENS` (includes cache tokens)
- Bottom metrics per provider:
  - `MOST USED MODEL` (with total tokens)
  - `RECENT USE (LAST 30 DAYS)` (with total tokens)
  - `LONGEST STREAK`
  - `CURRENT STREAK`

Model names are normalized to remove a trailing date suffix like `-20251101`.

## Format behavior

- Default format is PNG.
- If `--format` is omitted, format is inferred from `--output` extension (`.png`, `.svg`, or `.json`).
- If neither provides a format, PNG is used.

## JSON export

- Use `--format json` (or an `.json` output filename) to export data for interactive rendering.
- Export includes fixed `version: "2026-03-03"`.
- Each provider includes:
  - `title` and `colors`
  - `daily` rows with `date`, `input`, `output`, `cache`, `total`
  - `daily[].breakdown` per-model usage for that day, sorted by `tokens.total` (includes `input` and `output`)
  - `insights` (`mostUsedModel`, `recentMostUsedModel`) when available

## Provider/data behavior

- If no provider flags are passed, the CLI renders all providers with available data.
- If `--all` is passed, the CLI renders one merged graph across all providers with consolidated totals, streaks, and model rankings.
- Pi Coding Agent usage is derived from assistant messages in Pi session logs, grouped by the model that handled each turn.
- If provider flags are passed, `slopmeter` only loads those providers and only prints availability for those providers.
- If no provider flags are passed, the CLI loads all providers and prints availability for all providers.
- If explicit provider flags are passed and any requested provider has no data, the command exits with an error.
- If no provider flags are passed and no provider has data, the command exits with an error.

## Environment knobs

- `SLOPMETER_FILE_PROCESS_CONCURRENCY`: positive integer file-processing limit for Claude Code and Codex JSONL files. Default: `16`.
- `SLOPMETER_MAX_JSONL_RECORD_BYTES`: byte cap for Claude Code and Codex JSONL records, OpenCode JSON documents, and OpenCode SQLite `message.data` payloads. Default: `67108864` (`64 MB`).

## JSONL oversized-record behavior

- Claude Code and Codex now share the same bounded JSONL record splitter and do not materialize whole files in memory.
- Oversized Claude Code JSONL records fail the affected file with a clear error that names the file, line number, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- OpenCode legacy JSON message files use a bounded JSON document reader before `JSON.parse`.
- OpenCode SQLite `message.data` payloads use the same byte cap before `JSON.parse`.
- Oversized OpenCode JSON documents and SQLite message payloads fail clearly with the source path or row label, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- Codex now streams JSONL records and only parses records that affect usage aggregation.
- Oversized irrelevant Codex records are skipped and summarized with a warning after processing.
- Oversized relevant Codex records fail the affected file with a clear error that names the file, line number, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- Pi Coding Agent session logs are streamed and only assistant messages are parsed for usage aggregation.

## Data locations

- Claude Code: `$CLAUDE_CONFIG_DIR/*/projects` (comma-separated dirs) or defaults `~/.config/claude/projects` and `~/.claude/projects`
- Codex: `$CODEX_HOME/sessions` or `~/.codex/sessions`
- Cursor: reads `cursorAuth/accessToken` and `cursorAuth/refreshToken` from `$CURSOR_STATE_DB_PATH`, `$CURSOR_CONFIG_DIR/User/globalStorage/state.vscdb`, `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (macOS), `%APPDATA%/Cursor/User/globalStorage/state.vscdb` (Windows), or `~/.config/Cursor/User/globalStorage/state.vscdb` (Linux), then loads usage from Cursor's CSV export endpoint
- Open Code: prefers `$OPENCODE_DATA_DIR/opencode.db` or `~/.local/share/opencode/opencode.db`, and falls back to `$OPENCODE_DATA_DIR/storage/message` or `~/.local/share/opencode/storage/message`
- Pi Coding Agent: `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions`
