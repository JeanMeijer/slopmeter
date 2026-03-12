import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import ora, { type Ora } from "ora";
import ow from "ow";
import sharp from "sharp";
import { heatmapThemes, renderUsageHeatmapsSvg, type ColorMode } from "./graph";
import type {
  JsonExportPayload,
  JsonDailyUsage,
  JsonUsageSummary,
  UsageSummary,
  UsageProviderId,
} from "./interfaces";
import type { ProviderId } from "./providers";
import { formatLocalDate, mergeUsageSummaries } from "./lib/utils";
import {
  aggregateUsage,
  mergeProviderUsage,
  providerIds,
  providerStatusLabel,
} from "./providers";

type OutputFormat = "png" | "svg" | "json";
interface CliArgValues {
  output?: string;
  format?: string;
  help: boolean;
  dark: boolean;
  all: boolean;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  opencode: boolean;
  pi: boolean;
  merge?: string[];
}

const PNG_BASE_WIDTH = 1000;
const PNG_SCALE = 4;
const PNG_RENDER_WIDTH = PNG_BASE_WIDTH * PNG_SCALE;
const JSON_EXPORT_VERSION = "2026-03-03";

const HELP_TEXT = `slopmeter

Generate rolling 1-year usage heatmap image(s) (today is the latest day).

Usage:
  slopmeter [--all] [--claude] [--codex] [--cursor] [--opencode] [--pi] [--dark] [--format png|svg|json] [--output ./heatmap-last-year.png]
  slopmeter --merge export1.json --merge export2.json [--dark] [--format png|svg|json] [--output merged.png]

Options:
  --all                       Render one merged graph for all providers
  --claude                    Render Claude Code graph
  --codex                     Render Codex graph
  --cursor                    Render Cursor graph
  --opencode                  Render Open Code graph
  --pi                        Render Pi Coding Agent graph
  --merge <files...>          Merge multiple JSON exports into one heatmap
  --dark                      Render with the dark theme
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
      dark: ow.boolean,
      all: ow.boolean,
      claude: ow.boolean,
      codex: ow.boolean,
      cursor: ow.boolean,
      opencode: ow.boolean,
      pi: ow.boolean,
      merge: ow.optional.array.ofType(ow.string.nonEmpty),
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
  background: string,
) {
  if (format === "svg") {
    writeFileSync(outputPath, svg, "utf8");

    return;
  }

  const pngBuffer = await sharp(Buffer.from(svg), { density: 192 })
    .resize({ width: PNG_RENDER_WIDTH })
    .flatten({ background })
    .png()
    .toBuffer();

  writeFileSync(outputPath, pngBuffer);
}

function writeOutputJson(outputPath: string, payload: JsonExportPayload) {
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function jsonDailyToUsageSummary(json: JsonUsageSummary): UsageSummary {
  return {
    provider: json.provider,
    insights: json.insights,
    daily: json.daily.map((row: JsonDailyUsage) => ({
      date: new Date(`${row.date}T00:00:00`),
      input: row.input ?? 0,
      output: row.output ?? 0,
      cache: row.cache ?? { input: 0, output: 0 },
      total: row.total ?? 0,
      displayValue: row.displayValue,
      breakdown: row.breakdown ?? [],
    })),
  };
}

function loadJsonExports(filePaths: string[]): UsageSummary[] {
  const summaries: UsageSummary[] = [];

  for (const filePath of filePaths) {
    const raw = readFileSync(resolve(filePath), "utf8");
    const payload = JSON.parse(raw) as JsonExportPayload;

    for (const provider of payload.providers) {
      summaries.push(jsonDailyToUsageSummary(provider));
    }
  }

  return summaries;
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
      displayValue: row.displayValue,
      breakdown: row.breakdown,
    })),
  };
}

function getDateWindow() {
  const start = new Date();

  start.setHours(0, 0, 0, 0);
  start.setFullYear(start.getFullYear() - 1);

  const end = new Date();

  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function printProviderAvailability(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  providers: ProviderId[],
) {
  for (const provider of providers) {
    const found = rowsByProvider[provider] ? "found" : "not found";

    process.stdout.write(`${providerStatusLabel[provider]} ${found}\n`);
  }
}

function getRequestedProviders(values: CliArgValues) {
  return providerIds.filter((id) => values[id]);
}

function getOutputProviders(
  values: CliArgValues,
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  end: Date,
) {
  if (!values.all) {
    return selectProvidersToRender(
      rowsByProvider,
      getRequestedProviders(values),
    );
  }

  const merged = mergeProviderUsage(rowsByProvider, end);

  if (!merged) {
    throw new Error(
      "No usage data found for Claude Code, Codex, Cursor, Open Code, or Pi Coding Agent.",
    );
  }

  return [merged];
}

function getMergedProviderTitle(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
) {
  return providerIds
    .filter((provider) => rowsByProvider[provider] !== null)
    .map((provider) => heatmapThemes[provider].title)
    .join(" / ");
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
      "No usage data found for Claude Code, Codex, Cursor, Open Code, or Pi Coding Agent.",
    );
  }

  return providersToRender.map((provider) => rowsByProvider[provider]!);
}

function printRunSummary(
  outputPath: string,
  format: OutputFormat,
  colorMode: ColorMode,
  startDate: Date,
  endDate: Date,
  rendered: UsageProviderId[],
) {
  process.stdout.write(
    `${JSON.stringify(
      {
        output: outputPath,
        format,
        colorMode,
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
      dark: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      claude: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      cursor: { type: "boolean", default: false },
      opencode: { type: "boolean", default: false },
      pi: { type: "boolean", default: false },
      merge: { type: "string", multiple: true },
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
    const { start, end } = getDateWindow();
    const colorMode: ColorMode = values.dark ? "dark" : "light";
    const format = inferFormat(values.format, values.output);

    if (values.merge && values.merge.length > 0) {
      spinner = ora({
        text: "Merging JSON exports...",
        spinner: "dots",
      }).start();

      const summaries = loadJsonExports(values.merge);

      if (summaries.length === 0) {
        throw new Error("No provider data found in the given JSON files.");
      }

      const grouped = new Map<UsageProviderId, UsageSummary[]>();

      for (const summary of summaries) {
        const existing = grouped.get(summary.provider) ?? [];

        existing.push(summary);
        grouped.set(summary.provider, existing);
      }

      const merged: UsageSummary[] = [];

      for (const [provider, group] of grouped) {
        merged.push(
          group.length === 1
            ? group[0]
            : mergeUsageSummaries(provider, group, end),
        );
      }

      const outputPath = resolve(
        values.output ?? `./heatmap-last-year.${format}`,
      );

      mkdirSync(dirname(outputPath), { recursive: true });

      if (format === "json") {
        spinner.text = "Writing output file...";

        const payload: JsonExportPayload = {
          version: JSON_EXPORT_VERSION,
          start: formatLocalDate(start),
          end: formatLocalDate(end),
          providers: merged.map((s) => toJsonUsageSummary(s)),
        };

        writeOutputJson(outputPath, payload);
      } else {
        spinner.text = "Rendering heatmaps...";

        const svg = renderUsageHeatmapsSvg({
          startDate: start,
          endDate: end,
          colorMode,
          sections: merged.map(({ provider, daily, insights }) => ({
            daily,
            insights,
            title: heatmapThemes[provider]?.title ?? provider,
            titleCaption: heatmapThemes[provider]?.titleCaption,
            colors: heatmapThemes[provider]?.colors ?? heatmapThemes.claude.colors,
          })),
        });
        const background = colorMode === "dark" ? "#171717" : "#ffffff";

        spinner.text = "Writing output file...";
        await writeOutputImage(outputPath, format, svg, background);
      }

      spinner.succeed("Merge complete");

      printRunSummary(
        outputPath,
        format,
        colorMode,
        start,
        end,
        merged.map(({ provider }) => provider),
      );

      return;
    }

    spinner = ora({
      text: "Analyzing usage data...",
      spinner: "dots",
    }).start();

    const requestedProviders = values.all
      ? providerIds
      : getRequestedProviders(values);
    const inspectedProviders =
      requestedProviders.length > 0 ? requestedProviders : providerIds;
    const { rowsByProvider, warnings } = await aggregateUsage({
      start,
      end,
      requestedProviders,
    });

    spinner.stop();

    for (const warning of warnings) {
      process.stderr.write(`${warning}\n`);
    }

    printProviderAvailability(rowsByProvider, inspectedProviders);

    const exportProviders = getOutputProviders(values, rowsByProvider, end);

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
        colorMode,
        sections: exportProviders.map(({ provider, daily, insights }) => ({
          daily,
          insights,
          title:
            provider === "all"
              ? getMergedProviderTitle(rowsByProvider)
              : heatmapThemes[provider].title,
          titleCaption: heatmapThemes[provider].titleCaption,
          colors: heatmapThemes[provider].colors,
        })),
      });
      const background = colorMode === "dark" ? "#171717" : "#ffffff";

      spinner.text = "Writing output file...";
      await writeOutputImage(outputPath, format, svg, background);
    }

    spinner.succeed("Analysis complete");

    printRunSummary(
      outputPath,
      format,
      colorMode,
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
