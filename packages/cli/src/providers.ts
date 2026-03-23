import type { UsageSummary } from "./interfaces";
import { isAmpAvailable, loadAmpRows } from "./lib/amp";
import { isClaudeAvailable, loadClaudeRows } from "./lib/claude-code";
import { isCodexAvailable, loadCodexRows } from "./lib/codex";
import { isCrushAvailable, loadCrushRows } from "./lib/crush";
import { isCursorAvailable, loadCursorRows } from "./lib/cursor";
import { isGeminiAvailable, loadGeminiRows } from "./lib/gemini";
import {
  defaultProviderIds,
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./lib/interfaces";
import { isAntigravityAvailable, loadAntigravityRows } from "./lib/antigravity";
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
    amp: false,
    claude: false,
    codex: false,
    crush: false,
    cursor: false,
    gemini: false,
    opencode: false,
    pi: false,
    antigravity: false,
  };
}

export async function isProviderAvailable(provider: ProviderId): Promise<boolean> {
  switch (provider) {
    case "amp":
      return isAmpAvailable();
    case "claude":
      return isClaudeAvailable();
    case "codex":
      return isCodexAvailable();
    case "crush":
      return isCrushAvailable();
    case "cursor":
      return isCursorAvailable();
    case "gemini":
      return isGeminiAvailable();
    case "opencode":
      return isOpenCodeAvailable();
    case "pi":
      return isPiAvailable();
    case "antigravity":
      return isAntigravityAvailable();
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
    amp: null,
    claude: null,
    codex: null,
    cursor: null,
    gemini: null,
    opencode: null,
    pi: null,
    crush: null,
    antigravity: null,
  };
  const warnings: string[] = [];

  for (const provider of providersToLoad) {
    let summary: UsageSummary;

    switch (provider) {
      case "amp":
        summary = await loadAmpRows(start, end);
        break;
      case "claude":
        summary = await loadClaudeRows(start, end);
        break;
      case "codex":
        summary = await loadCodexRows(start, end, warnings);
        break;
      case "crush":
        summary = await loadCrushRows(start, end);
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
      case "antigravity":
        summary = await loadAntigravityRows(start, end);
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
