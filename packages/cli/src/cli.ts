import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import ora, { type Ora } from "ora";
import ow from "ow";
import sharp from "sharp";
import { heatmapThemes, renderUsageHeatmapsSvg } from "./graph";
import type {
  JsonExportPayload,
  JsonUsageSummary,
  UsageSummary,
} from "./interfaces";
import type { ProviderId } from "./providers";
import { formatLocalDate } from "./lib/utils";
import { aggregateUsage, providerIds, providerStatusLabel } from "./providers";

type OutputFormat = "png" | "svg" | "json";
interface CliArgValues {
  output?: string;
  format?: string;
  help: boolean;
  claude: boolean;
  codex: boolean;
  opencode: boolean;
}

const PNG_BASE_WIDTH = 1000;
const PNG_SCALE = 4;
const PNG_RENDER_WIDTH = PNG_BASE_WIDTH * PNG_SCALE;
const JSON_EXPORT_VERSION = "2026-03-03";

const HELP_TEXT = `codegraph-usage

Generate rolling 1-year usage heatmap image(s) (today is the latest day).

Usage:
  codegraph-usage [--claude] [--codex] [--opencode] [--format png|svg|json] [--output ./heatmap-last-year.png]

Options:
  --claude                    Render Claude Code graph
  --codex                     Render Codex graph
  --opencode                  Render Open Code graph
  -f, --format                Output format: png, svg, or json (default: png)
  -o, --output                Output file path (default: ./heatmap-last-year.png)
  -h, --help                  Show this help
`;

function printHelp() {
  process.stdout.write(HELP_TEXT);
}

function validateArgs(values: unknown): asserts values is CliArgValues {
  ow(
    values,
    ow.object.exactShape({
      output: ow.optional.string.nonEmpty,
      format: ow.optional.string.nonEmpty,
      help: ow.boolean,
      claude: ow.boolean,
      codex: ow.boolean,
      opencode: ow.boolean,
    }),
  );
}

function inferFormat(
  formatArg: string | undefined,
  outputArg: string | undefined,
) {
  if (formatArg) {
    ow(formatArg, ow.string.oneOf(["png", "svg", "json"] as const));

    return formatArg;
  }

  if (outputArg) {
    const outputExtension = extname(outputArg).toLowerCase();

    if (outputExtension === ".svg") {
      return "svg" as const;
    }

    if (outputExtension === ".json") {
      return "json" as const;
    }
  }

  return "png" as const;
}

async function writeOutputImage(
  outputPath: string,
  format: Exclude<OutputFormat, "json">,
  svg: string,
) {
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

function writeOutputJson(outputPath: string, payload: JsonExportPayload) {
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toJsonUsageSummary(summary: UsageSummary): JsonUsageSummary {
  return {
    provider: summary.provider,
    insights: summary.insights,
    daily: summary.daily.map((row) => ({
      date: formatLocalDate(row.date),
      input: row.input,
      output: row.output,
      cache: row.cache,
      total: row.total,
      breakdown: row.breakdown,
    })),
  };
}

function getDateWindow() {
  const end = new Date();

  end.setHours(0, 0, 0, 0);

  const start = new Date(end);

  start.setFullYear(start.getFullYear() - 1);

  return { start, end };
}

function printProviderAvailability(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
) {
  for (const provider of providerIds) {
    const found = rowsByProvider[provider] ? "found" : "not found";

    process.stdout.write(`${providerStatusLabel[provider]} ${found}\n`);
  }
}

function getRequestedProviders(values: CliArgValues) {
  return providerIds.filter((id) => values[id]);
}

function selectProvidersToRender(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  requested: ProviderId[],
) {
  const providersToRender =
    requested.length > 0
      ? requested.filter((provider) => rowsByProvider[provider])
      : providerIds.filter((provider) => rowsByProvider[provider]);

  if (requested.length > 0 && providersToRender.length < requested.length) {
    const missing = requested.filter((provider) => !rowsByProvider[provider]);

    throw new Error(
      `Requested provider data not found: ${missing.map((provider) => providerStatusLabel[provider]).join(", ")}`,
    );
  }

  if (providersToRender.length === 0) {
    throw new Error(
      "No usage data found for Claude code, Codex, or Open code.",
    );
  }

  return providersToRender.map((provider) => rowsByProvider[provider]!);
}

function printRunSummary(
  outputPath: string,
  format: OutputFormat,
  startDate: Date,
  endDate: Date,
  rendered: ProviderId[],
) {
  process.stdout.write(
    `${JSON.stringify(
      {
        output: outputPath,
        format,
        startDate: formatLocalDate(startDate),
        endDate: formatLocalDate(endDate),
        rendered,
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  let spinner: Ora | undefined;

  const parsed = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      help: { type: "boolean", short: "h", default: false },
      claude: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      opencode: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  validateArgs(parsed.values);

  const { values } = parsed;

  if (values.help) {
    printHelp();

    return;
  }

  try {
    spinner = ora({
      text: "Analyzing usage data...",
      spinner: "dots",
    }).start();

    const { start, end } = getDateWindow();

    const format = inferFormat(values.format, values.output);
    const rowsByProvider = await aggregateUsage({ start, end });

    spinner.stop();
    printProviderAvailability(rowsByProvider);

    const exportProviders = selectProvidersToRender(
      rowsByProvider,
      getRequestedProviders(values),
    );

    const outputPath = resolve(
      values.output ?? `./heatmap-last-year.${format}`,
    );

    mkdirSync(dirname(outputPath), { recursive: true });

    if (format === "json") {
      spinner.start("Preparing JSON export...");

      const payload: JsonExportPayload = {
        version: JSON_EXPORT_VERSION,
        start: formatLocalDate(start),
        end: formatLocalDate(end),
        providers: exportProviders.map((provider) =>
          toJsonUsageSummary(provider),
        ),
      };

      spinner.text = "Writing output file...";
      writeOutputJson(outputPath, payload);
    } else {
      spinner.start("Rendering heatmaps...");

      const svg = renderUsageHeatmapsSvg({
        startDate: start,
        endDate: end,
        sections: exportProviders.map(({ provider, daily, insights }) => ({
          daily,
          insights,
          title: heatmapThemes[provider].title,
          colors: heatmapThemes[provider].colors,
        })),
      });

      spinner.text = "Writing output file...";
      await writeOutputImage(outputPath, format, svg);
    }

    spinner.succeed("Analysis complete");

    printRunSummary(
      outputPath,
      format,
      start,
      end,
      exportProviders.map(({ provider }) => provider),
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
