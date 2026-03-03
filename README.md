# codegraph CLI

TypeScript CLI that generates usage heatmaps for Claude Code, Codex, and Open Code for the rolling past year (ending today).

Data is loaded directly in-process (no shelling out to provider CLIs).

## Runtime and tooling

- Package manager: Bun
- Runtime: Node.js 22+
- Module format: ESM
- Type checking: TypeScript (`tsc`)
- Build compiler: `tsup`
- SVG generation: `svg-builder`
- PNG rendering: `sharp`

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
node dist/cli.js

# Or if installed as a package binary
codegraph-usage
```

### Options

```bash
# Output file (default: ./heatmap-last-year.png)
codegraph-usage --output ./out/heatmap.svg
codegraph-usage -o ./out/heatmap.svg

# Output format
codegraph-usage --format png
codegraph-usage --format svg
codegraph-usage -f svg

# Provider filters (optional)
codegraph-usage --claude
codegraph-usage --codex
codegraph-usage --opencode
```

## What the image shows

- Monday-first contribution-style heatmap for the last year.
- Top metrics per provider:
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
- If `--format` is omitted, format is inferred from `--output` extension (`.png` or `.svg`).
- If neither provides a format, PNG is used.

## Provider/data behavior

- If no provider flags are passed, the CLI renders all providers with available data.
- The CLI always prints provider availability lines (`found`/`not found`).
- If explicit provider flags are passed and any requested provider has no data, the command exits with an error.
- If no provider flags are passed and no provider has data, the command exits with an error.

## Data locations

- Claude Code: `ccusage` data loader (timezone-aware display mode)
- Codex: `$CODEX_HOME/sessions` or `~/.codex/sessions`
- Open Code: `$OPENCODE_DATA_DIR/storage/message` or `~/.local/share/opencode/storage/message`
