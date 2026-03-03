import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import ora, { type Ora } from "ora";
import sharp from "sharp";
import { heatmapThemes, renderUsageHeatmapsSvg } from "./graph";
import { formatLocalDate } from "./lib/utils";
import {
  getRequestedProviders,
  hasData,
  loadProviderRows,
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./providers";

type OutputFormat = "png" | "svg";

const PNG_BASE_WIDTH = 1000;
const PNG_SCALE = 4;
const PNG_RENDER_WIDTH = PNG_BASE_WIDTH * PNG_SCALE;

function printHelp() {
  process.stdout.write("codegraph-usage\n\n");
  process.stdout.write(
    "Generate rolling 1-year usage heatmap image(s) (today is the latest day).\n\n",
  );
  process.stdout.write("Usage:\n");
  process.stdout.write(
    "  codegraph-usage [--claude] [--codex] [--opencode] [--format png|svg] [--output ./heatmap-last-year.png]\n\n",
  );
  process.stdout.write("Options:\n");
  process.stdout.write("  --claude, --Claude          Render Claude Code graph\n");
  process.stdout.write("  --codex, --Codex            Render Codex graph\n");
  process.stdout.write("  --opencode, --OpenCodex     Render Open Code graph\n");
  process.stdout.write("  -f, --format                Output format: png or svg (default: png)\n");
  process.stdout.write("  -o, --output                Output file path (default: ./heatmap-last-year.png)\n");
  process.stdout.write("  -h, --help                  Show this help\n");
}

function normalizeFormat(format: string) {
  const lower = format.toLowerCase();

  if (lower !== "png" && lower !== "svg") {
    throw new Error(`Invalid format "${format}". Expected "png" or "svg".`);
  }

  return lower;
}

function inferFormat(formatArg: string | undefined, outputArg: string | undefined) {
  if (formatArg) {
    return normalizeFormat(formatArg);
  }

  if (outputArg) {
    const ext = extname(outputArg).toLowerCase();
    if (ext === ".svg") {
      return "svg";
    }
    if (ext === ".png") {
      return "png";
    }
  }

  return "png";
}

async function writeOutputImage(outputPath: string, format: OutputFormat, svg: string) {
  if (format === "svg") {
    writeFileSync(outputPath, svg, "utf8");
    return;
  }

  const pngBuffer = await sharp(Buffer.from(svg), { density: 192 })
    .resize({ width: PNG_RENDER_WIDTH })
    .png()
    .toBuffer();

  writeFileSync(outputPath, pngBuffer);
}

async function main() {
  let spinner: Ora | undefined;

  const { values } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      help: { type: "boolean", short: "h", default: false },
      claude: { type: "boolean", default: false },
      Claude: { type: "boolean", default: false },
      cloudCode: { type: "boolean", default: false },
      CloudCode: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      Codex: { type: "boolean", default: false },
      opencode: { type: "boolean", default: false },
      OpenCode: { type: "boolean", default: false },
      OpenCodex: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  try {
    spinner = ora({
      text: "Analyzing usage data...",
      spinner: "dots",
    }).start();

    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 1);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    const start = formatLocalDate(startDate);
    const end = formatLocalDate(endDate);
    const format = inferFormat(values.format, values.output);

    const rowsByProvider = await loadProviderRows(start, end, timezone);
    spinner.stop();

    const foundByProvider: Record<ProviderId, boolean> = {
      claude: hasData(rowsByProvider.claude),
      codex: hasData(rowsByProvider.codex),
      opencode: hasData(rowsByProvider.opencode),
    };

    for (const provider of providerIds) {
      const found = foundByProvider[provider] ? "found" : "not found";
      process.stdout.write(`${providerStatusLabel[provider]} ${found}\n`);
    }

    const requestedProviders = getRequestedProviders(values);
    const hasExplicitProviderSelection = requestedProviders.length > 0;
    const targetProviders = hasExplicitProviderSelection ? requestedProviders : providerIds;
    const missingRequested = targetProviders.filter((provider) => !foundByProvider[provider]);

    if (hasExplicitProviderSelection && missingRequested.length > 0) {
      throw new Error(
        `Requested provider data not found: ${missingRequested
          .map((provider) => providerStatusLabel[provider])
          .join(", ")}`,
      );
    }

    const providersToRender = targetProviders.filter((provider) => foundByProvider[provider]);

    if (!hasExplicitProviderSelection && providersToRender.length === 0) {
      throw new Error("No usage data found for Claude code, Codex, or Open code.");
    }

    spinner.start("Rendering heatmaps...");

    const sections = providersToRender.map((provider) => ({
      daily: rowsByProvider[provider],
      title: heatmapThemes[provider].title,
      colors: heatmapThemes[provider].colors,
    }));

    const svg = renderUsageHeatmapsSvg({
      startDate: start,
      endDate: end,
      sections,
    });

    spinner.text = "Writing output file...";

    const outputPath = resolve(values.output ?? `./heatmap-last-year.${format}`);
    mkdirSync(dirname(outputPath), { recursive: true });
    await writeOutputImage(outputPath, format, svg);

    spinner.succeed("Analysis complete");

    process.stdout.write(
      `${JSON.stringify(
        {
          output: outputPath,
          format,
          startDate: start,
          endDate: end,
          rendered: providersToRender,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (spinner) {
      spinner.fail(`Failed: ${message}`);
    } else {
      process.stderr.write(`${message}\n`);
    }

    process.exitCode = 1;
  }
}

void main();
