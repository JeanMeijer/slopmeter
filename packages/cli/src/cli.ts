import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import ora, { type Ora } from "ora";
import ow from "ow";
import sharp from "sharp";
import { heatmapThemes, renderUsageHeatmapsSvg } from "./graph";
import type { DailyUsage, Insights } from "./interfaces";
import { formatLocalDate } from "./lib/utils";
import {
  aggregateUsage,
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./providers";

type OutputFormat = "png" | "svg" | "json";
type CliArgValues = {
  output?: string;
  format?: string;
  help: boolean;
  claude: boolean;
  codex: boolean;
  opencode: boolean;
};

const PNG_BASE_WIDTH = 1000;
const PNG_SCALE = 4;
const PNG_RENDER_WIDTH = PNG_BASE_WIDTH * PNG_SCALE;
const JSON_EXPORT_VERSION = "2026-03-03";

interface JsonExportProvider {
  id: ProviderId;
  title: string;
  colors: string[];
  daily: DailyUsage[];
  insights?: Insights;
}

interface JsonExportPayload {
  version: typeof JSON_EXPORT_VERSION;
  startDate: string;
  endDate: string;
  weekStart: "monday";
  providers: JsonExportProvider[];
}

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

    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    const format = inferFormat(values.format, values.output);

    const rowsByProvider = await aggregateUsage({ start, end });

    spinner.stop();

    for (const provider of providerIds) {
      const found = rowsByProvider[provider] ? "found" : "not found";

      process.stdout.write(`${providerStatusLabel[provider]} ${found}\n`);
    }

    const requested = providerIds.filter(
      (id) => values[id as keyof CliArgValues],
    );
    const explicit = requested.length > 0;
    const candidates = explicit ? requested : providerIds;
    const providersToRender = candidates.filter((p) => rowsByProvider[p]);

    if (explicit && providersToRender.length < requested.length) {
      const missing = requested.filter((p) => !rowsByProvider[p]);

      throw new Error(
        `Requested provider data not found: ${missing.map((p) => providerStatusLabel[p]).join(", ")}`,
      );
    }

    if (providersToRender.length === 0) {
      throw new Error(
        "No usage data found for Claude code, Codex, or Open code.",
      );
    }

    const exportProviders = providersToRender.map((provider) => {
      const data = rowsByProvider[provider]!;

      return {
        id: provider,
        daily: data.daily,
        title: heatmapThemes[provider].title,
        colors: heatmapThemes[provider].colors,
        insights: data.insights,
      };
    });

    const outputPath = resolve(
      values.output ?? `./heatmap-last-year.${format}`,
    );
    mkdirSync(dirname(outputPath), { recursive: true });

    if (format === "json") {
      spinner.start("Preparing JSON export...");

      const payload: JsonExportPayload = {
        version: JSON_EXPORT_VERSION,
        startDate: formatLocalDate(start),
        endDate: formatLocalDate(end),
        weekStart: "monday",
        providers: exportProviders,
      };

      spinner.text = "Writing output file...";
      writeOutputJson(outputPath, payload);
    } else {
      spinner.start("Rendering heatmaps...");

      const svg = renderUsageHeatmapsSvg({
        startDate: start,
        endDate: end,
        sections: exportProviders,
      });

      spinner.text = "Writing output file...";
      await writeOutputImage(outputPath, format, svg);
    }

    spinner.succeed("Analysis complete");

    process.stdout.write(
      `${JSON.stringify(
        {
          output: outputPath,
          format,
          startDate: formatLocalDate(start),
          endDate: formatLocalDate(end),
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
