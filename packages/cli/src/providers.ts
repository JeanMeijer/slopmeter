import type { UsageSummary } from "./interfaces";
import { isClaudeAvailable, loadClaudeRows } from "./lib/claude-code";
import { isCodexAvailable, loadCodexRows } from "./lib/codex";
import { isCursorAvailable, loadCursorRows } from "./lib/cursor";
import { isGeminiAvailable, loadGeminiRows } from "./lib/gemini";
import {
  defaultProviderIds,
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./lib/interfaces";
import { isOpenCodeAvailable, loadOpenCodeRows } from "./lib/open-code";
import { isPiAvailable, loadPiRows } from "./lib/pi";
import { hasUsage, mergeUsageSummaries } from "./lib/utils";

export { defaultProviderIds, providerIds, providerStatusLabel, type ProviderId };

interface AggregateUsageOptions {
  start: Date;
  end: Date;
  requestedProviders?: ProviderId[];
}

export interface AggregateUsageResult {
  rowsByProvider: Record<ProviderId, UsageSummary | null>;
  warnings: string[];
}

export type ProviderAvailability = Record<ProviderId, boolean>;

function createEmptyProviderAvailability(): ProviderAvailability {
  return {
    claude: false,
    codex: false,
    cursor: false,
    gemini: false,
    opencode: false,
    pi: false,
  };
}

export async function isProviderAvailable(provider: ProviderId): Promise<boolean> {
  switch (provider) {
    case "claude":
      return isClaudeAvailable();
    case "codex":
      return isCodexAvailable();
    case "cursor":
      return isCursorAvailable();
    case "gemini":
      return isGeminiAvailable();
    case "opencode":
      return isOpenCodeAvailable();
    case "pi":
      return isPiAvailable();
    default: {
      const exhaustiveCheck: never = provider;

      throw new Error(`Unhandled provider: ${String(exhaustiveCheck)}`);
    }
  }
}

export async function getProviderAvailability(
  providers: ProviderId[] = providerIds,
): Promise<ProviderAvailability> {
  const availability = createEmptyProviderAvailability();

  for (const provider of providers) {
    availability[provider] = await isProviderAvailable(provider);
  }

  return availability;
}

export function mergeProviderUsage(
  rowsByProvider: Record<ProviderId, UsageSummary | null>,
  end: Date,
): UsageSummary | null {
  const summaries = providerIds
    .map((provider) => rowsByProvider[provider])
    .filter((summary): summary is UsageSummary => summary !== null);

  if (summaries.length === 0) {
    return null;
  }

  return mergeUsageSummaries("all", summaries, end);
}

export async function aggregateUsage({
  start,
  end,
  requestedProviders,
}: AggregateUsageOptions): Promise<AggregateUsageResult> {
  const providersToLoad = requestedProviders?.length
    ? requestedProviders
    : providerIds;
  const rowsByProvider: Record<ProviderId, UsageSummary | null> = {
    claude: null,
    codex: null,
    cursor: null,
    gemini: null,
    opencode: null,
    pi: null,
  };
  const warnings: string[] = [];

  for (const provider of providersToLoad) {
    let summary: UsageSummary;

    switch (provider) {
      case "claude":
        summary = await loadClaudeRows(start, end);
        break;
      case "codex":
        summary = await loadCodexRows(start, end, warnings);
        break;
      case "cursor":
        summary = await loadCursorRows(start, end);
        break;
      case "gemini":
        summary = await loadGeminiRows(start, end);
        break;
      case "opencode":
        summary = await loadOpenCodeRows(start, end);
        break;
      case "pi":
        summary = await loadPiRows(start, end);
        break;
      default: {
        const exhaustiveCheck: never = provider;

        throw new Error(`Unhandled provider: ${String(exhaustiveCheck)}`);
      }
    }

    rowsByProvider[provider] = hasUsage(summary) ? summary : null;
  }

  return { rowsByProvider, warnings };
}
