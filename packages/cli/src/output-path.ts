import type { ProviderId } from "./lib/interfaces";

type OutputFormat = "png" | "svg" | "json";

interface ProviderSelectionValues {
  all: boolean;
  amp: boolean;
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  gemini: boolean;
  opencode: boolean;
  pi: boolean;
}

const outputProviderIds: ProviderId[] = [
  "amp",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
];

export function getRequestedProvidersForOutput(
  values: ProviderSelectionValues,
) {
  return outputProviderIds.filter((provider) => values[provider]);
}

export function getDefaultOutputSuffix(values: ProviderSelectionValues) {
  if (values.all) {
    return "_all";
  }

  const requestedProviders = getRequestedProvidersForOutput(values);

  if (requestedProviders.length === 0) {
    return "";
  }

  return `_${requestedProviders.join("_")}`;
}

export function getDefaultOutputPath(
  values: ProviderSelectionValues,
  format: OutputFormat,
) {
  return `./heatmap-last-year${getDefaultOutputSuffix(values)}.${format}`;
}
