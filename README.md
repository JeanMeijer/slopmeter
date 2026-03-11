# slopmeter

CLI tool that generates usage heatmaps for Claude Code, Codex, and Open Code for the rolling past year (ending today).

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

# Provider filters (optional)
slopmeter --claude
slopmeter --codex
slopmeter --opencode
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
- The CLI always prints provider availability lines (`found`/`not found`).
- If explicit provider flags are passed and any requested provider has no data, the command exits with an error.
- If no provider flags are passed and no provider has data, the command exits with an error.

## Data locations

- Claude Code: `$CLAUDE_CONFIG_DIR/*/projects` (comma-separated dirs) or defaults `~/.config/claude/projects` and `~/.claude/projects`
- Codex: `$CODEX_HOME/sessions` or `~/.codex/sessions`
- Open Code: `$OPENCODE_DATA_DIR/storage/message` or `~/.local/share/opencode/storage/message`
