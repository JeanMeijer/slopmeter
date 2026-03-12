import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import ora, { type Ora } from "ora";
import ow from "ow";
import sharp from "sharp";
import { heatmapThemes, renderUsageHeatmapsSvg, type ColorMode } from "./graph";
import type {
  JsonExportPayload,
  JsonUsageSummary,
  UsageSummary,
  UsageProviderId,
} from "./interfaces";
import { getDefaultOutputPath } from "./output-path";
import type { ProviderId } from "./providers";
import { formatLocalDate } from "./lib/utils";
import {
  aggregateUsage,
  defaultProviderIds,
  getProviderAvailability,
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
  amp: boolean;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  gemini: boolean;
  opencode: boolean;
  pi: boolean;
}

const PNG_BASE_WIDTH = 1000;
const PNG_SCALE = 4;
const PNG_RENDER_WIDTH = PNG_BASE_WIDTH * PNG_SCALE;
const JSON_EXPORT_VERSION = "2026-03-13";

const HELP_TEXT = `slopmeter

Generate rolling 1-year usage heatmap image(s) (today is the latest day).

Usage:
  slopmeter [--all] [--amp] [--claude] [--codex] [--cursor] [--gemini] [--opencode] [--pi] [--dark] [--format png|svg|json] [--output ./heatmap-last-year.png]

Options:
  --all                       Render one merged graph for all providers
  --amp                       Render Amp graph
  --claude                    Render Claude Code graph
  --codex                     Render Codex graph
  --cursor                    Render Cursor graph
  --gemini                    Render Gemini CLI graph
  --opencode                  Render Open Code graph
  --pi                        Render Pi Coding Agent graph
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
      amp: ow.boolean,
      claude: ow.boolean,
      codex: ow.boolean,
      cursor: ow.boolean,
      gemini: ow.boolean,
      opencode: ow.boolean,
      pi: ow.boolean,
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
  availabilityByProvider: Record<ProviderId, boolean>,
  providers: ProviderId[],
) {
  for (const provider of providers) {
    const status = availabilityByProvider[provider] ? "available" : "not available";

    process.stdout.write(`${providerStatusLabel[provider]} ${status}\n`);
  }
}

function getRequestedProviders(values: CliArgValues) {
  return providerIds.filter((id) => values[id]);
}

function getMergedNoDataMessage() {
  return "No usage data found for Amp, Claude Code, Codex, Cursor, Gemini CLI, Open Code, or Pi Coding Agent.";
}

function getRequestedMissingProvidersMessage(missing: ProviderId[]) {
  return `Requested provider data not found: ${missing.map((provider) => providerStatusLabel[provider]).join(", ")}`;
}

function getNoDataMessage() {
  return getMergedNoDataMessage();
}

function getOutputProviders(
  values: CliArgValues,
  availabilityByProvider: Record<ProviderId, boolean>,
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  end: Date,
) {
  if (!values.all) {
    return selectProvidersToRender(
      availabilityByProvider,
      rowsByProvider,
      getRequestedProviders(values),
    );
  }

  const merged = mergeProviderUsage(rowsByProvider, end);

  if (!merged) {
    throw new Error(getMergedNoDataMessage());
  }

  return [merged];
}

function getDefaultOutputProviderIds(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
) {
  const selected: ProviderId[] = [];
  const fallbackProviders = providerIds.filter(
    (provider) => !defaultProviderIds.includes(provider),
  );

  for (const provider of [...defaultProviderIds, ...fallbackProviders]) {
    if (!rowsByProvider[provider] || selected.includes(provider)) {
      continue;
    }

    selected.push(provider);

    if (selected.length === 3) {
      return selected;
    }
  }

  return selected;
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
  availabilityByProvider: Record<ProviderId, boolean>,
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  requested: ProviderId[],
) {
  const defaultProviders = getDefaultOutputProviderIds(rowsByProvider);
  const providersToRender =
    requested.length > 0
      ? requested.filter((provider) => rowsByProvider[provider])
      : defaultProviders.filter((provider) => rowsByProvider[provider]);

  if (requested.length > 0 && providersToRender.length < requested.length) {
    const missing = requested.filter((provider) => !rowsByProvider[provider]);

    throw new Error(getRequestedMissingProvidersMessage(missing));
  }

  if (providersToRender.length === 0) {
    const availableProviders = providerIds.filter(
      (provider) => availabilityByProvider[provider],
    );

    if (availableProviders.length > 0) {
      const availableLabels = availableProviders
        .map((provider) => providerStatusLabel[provider])
        .join(", ");
      const defaultLabels = defaultProviderIds
        .map((provider) => providerStatusLabel[provider])
        .join(", ");

      throw new Error(
        `No usage data found for available providers (${availableLabels}). Preferred order is ${defaultLabels}. Use --all or specify providers explicitly.`,
      );
    }

    throw new Error(getNoDataMessage());
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
      amp: { type: "boolean", default: false },
      claude: { type: "boolean", default: false },
      codex: { type: "boolean", default: false },
      cursor: { type: "boolean", default: false },
      gemini: { type: "boolean", default: false },
      opencode: { type: "boolean", default: false },
      pi: { type: "boolean", default: false },
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
    const colorMode: ColorMode = values.dark ? "dark" : "light";
    const format = inferFormat(values.format, values.output);
    const requestedProviders = values.all
      ? providerIds
      : getRequestedProviders(values);
    const inspectedProviders =
      requestedProviders.length > 0 ? requestedProviders : providerIds;
    const availabilityByProvider =
      await getProviderAvailability(inspectedProviders);
    const { rowsByProvider, warnings } = await aggregateUsage({
      start,
      end,
      requestedProviders,
    });

    spinner.stop();

    for (const warning of warnings) {
      process.stderr.write(`${warning}\n`);
    }

    printProviderAvailability(availabilityByProvider, inspectedProviders);

    const exportProviders = getOutputProviders(
      values,
      availabilityByProvider,
      rowsByProvider,
      end,
    );

    const outputPath = resolve(
      values.output ?? getDefaultOutputPath(values, format),
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
