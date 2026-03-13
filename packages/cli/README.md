# slopmeter

`slopmeter` is a Node.js CLI that scans local Claude Code, Codex, Cursor, Gemini CLI, Open Code, and Pi Coding Agent usage data and generates a contribution-style heatmap for the rolling past year.

## Requirements

- Node.js `>=22`

## Run with npm

Use it without installing:

```bash
npx slopmeter
```

Install it globally:

```bash
npm install -g slopmeter
slopmeter
```

## Usage

```bash
slopmeter [--all] [--claude] [--codex] [--cursor] [--gemini] [--opencode] [--pi] [--dark] [--format png|svg|json] [--output ./heatmap-last-year.png]
```

By default, the CLI:

- scans all supported providers
- writes `./heatmap-last-year.png`
- infers the date window as the rolling last year ending today

## Options

- `--claude`: include only Claude Code data
- `--codex`: include only Codex data
- `--cursor`: include only Cursor data
- `--gemini`: include only Gemini CLI data
- `--opencode`: include only Open Code data
- `--pi`: include only Pi Coding Agent data
- `--all`: merge all providers into one combined graph
- `--dark`: render the image with the dark theme
- `-f, --format <png|svg|json>`: choose the output format
- `-o, --output <path>`: write output to a custom path
- `-h, --help`: print the help text

## Examples

Generate the default PNG:

```bash
npx slopmeter
```

Write an SVG:

```bash
npx slopmeter --format svg --output ./out/heatmap.svg
```

Write JSON for custom rendering:

```bash
npx slopmeter --format json --output ./out/heatmap.json
```

Render only Codex usage:

```bash
npx slopmeter --codex
```

Render only Cursor usage:

```bash
npx slopmeter --cursor
```

Render only Gemini CLI usage:

```bash
npx slopmeter --gemini
```

Render only Pi Coding Agent usage:

```bash
npx slopmeter --pi
```

Render one merged graph across all providers:

```bash
npx slopmeter --all
```

When provider flags are present, `slopmeter` only loads those providers and only prints availability for those providers.

Render a dark-theme SVG:

```bash
npx slopmeter --dark --format svg --output ./out/heatmap-dark.svg
```

## Output behavior

- If `--format` is omitted, the format is inferred from the `--output` extension when possible.
- Supported extensions are `.png`, `.svg`, and `.json`.
- If neither `--format` nor a recognized output extension is provided, PNG is used.

## Data locations

- Claude Code: `$CLAUDE_CONFIG_DIR/*/projects` or `~/.config/claude/projects`, `~/.claude/projects`
- Older Claude Code layouts: falls back to `$CLAUDE_CONFIG_DIR/stats-cache.json`, `~/.config/claude/stats-cache.json`, or `~/.claude/stats-cache.json` for days not present in project logs
- Earliest Claude Code activity fallback: uses `$CLAUDE_CONFIG_DIR/history.jsonl`, `~/.config/claude/history.jsonl`, or `~/.claude/history.jsonl` to mark activity-only days when token totals are unavailable
- Codex: `$CODEX_HOME/sessions` or `~/.codex/sessions`
- Cursor: reads `cursorAuth/accessToken` and `cursorAuth/refreshToken` from `$CURSOR_STATE_DB_PATH`, `$CURSOR_CONFIG_DIR/User/globalStorage/state.vscdb`, `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (macOS), `%APPDATA%/Cursor/User/globalStorage/state.vscdb` (Windows), or `~/.config/Cursor/User/globalStorage/state.vscdb` (Linux), then loads usage from Cursor's CSV export endpoint
- Gemini CLI: `$GEMINI_CONFIG_DIR/tmp/**/chats/session-*.json` or `~/.gemini/tmp/**/chats/session-*.json`
- Open Code: prefers `$OPENCODE_DATA_DIR/opencode.db` or `~/.local/share/opencode/opencode.db`, and falls back to `$OPENCODE_DATA_DIR/storage/message` or `~/.local/share/opencode/storage/message`
- Pi Coding Agent: `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions`

When Claude Code falls back to `stats-cache.json`, the daily input/output/cache split is reconstructed from Claude's cached model totals because the older layout does not keep per-request usage logs.
When Claude Code falls back to `history.jsonl`, those days are rendered as activity-only cells and do not affect the token totals shown in the header.

## Exit behavior

- If no provider flags are passed, `slopmeter` renders every provider with available data.
- If `--all` is passed, `slopmeter` loads all providers and renders one combined graph with merged totals, streaks, and model rankings.
- Pi Coding Agent usage is derived from assistant messages in Pi session logs, grouped by the model that handled each turn.
- If provider flags are passed and a requested provider has no data, the command exits with an error.
- If no provider has data, the command exits with an error.

## Environment variables

- `SLOPMETER_FILE_PROCESS_CONCURRENCY`: positive integer file-processing limit for Claude Code and Codex JSONL files. Default: `16`.
- `SLOPMETER_MAX_JSONL_RECORD_BYTES`: byte cap for Claude Code and Codex JSONL records, OpenCode JSON documents, and OpenCode SQLite `message.data` payloads. Default: `67108864` (`64 MB`).

## JSONL record handling

- Claude Code and Codex JSONL files are streamed through the same bounded record splitter; `slopmeter` does not materialize whole files in memory.
- Oversized Claude Code JSONL records fail the file with a clear error that names the file, line number, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- OpenCode prefers the current SQLite store (`opencode.db`) and falls back to the legacy file-backed message layout.
- OpenCode legacy JSON message files are read through a bounded JSON document reader before `JSON.parse`.
- OpenCode SQLite `message.data` payloads use the same byte cap before `JSON.parse`.
- Oversized OpenCode JSON documents and SQLite message payloads fail clearly with the source path or row label, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- Only Codex `turn_context` and `event_msg` `token_count` records are parsed for usage aggregation.
- Oversized irrelevant Codex records are skipped and reported in a warning summary.
- Oversized relevant Codex records fail the file with a clear error that names the file, line number, byte cap, and `SLOPMETER_MAX_JSONL_RECORD_BYTES`.
- Pi Coding Agent session logs are streamed and only assistant messages are parsed for usage aggregation.

## License

MIT
