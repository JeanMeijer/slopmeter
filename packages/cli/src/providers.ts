import type { UsageSummary } from "./interfaces";
import { loadClaudeRows } from "./lib/claude-code";
import { loadCodexRows } from "./lib/codex";
import { loadCrushRows } from "./lib/crush";
import { loadCursorRows } from "./lib/cursor";
import {
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./lib/interfaces";
import { loadOpenCodeRows } from "./lib/open-code";
import { loadPiRows } from "./lib/pi";
import { hasUsage, mergeUsageSummaries } from "./lib/utils";

export { providerIds, providerStatusLabel, type ProviderId };

interface AggregateUsageOptions {
  start: Date;
  end: Date;
  requestedProviders?: ProviderId[];
}

export interface AggregateUsageResult {
  rowsByProvider: Record<ProviderId, UsageSummary | null>;
  warnings: string[];
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
    opencode: null,
    pi: null,
    crush: null,
  };
  const warnings: string[] = [];

  for (const provider of providersToLoad) {
    const summary =
      provider === "claude"
        ? await loadClaudeRows(start, end)
        : provider === "codex"
          ? await loadCodexRows(start, end, warnings)
          : provider === "cursor"
            ? await loadCursorRows(start, end)
            : provider === "opencode"
              ? await loadOpenCodeRows(start, end)
              : provider === "pi"
                ? await loadPiRows(start, end)
                : await loadCrushRows(start, end);

    rowsByProvider[provider] = hasUsage(summary) ? summary : null;
  }

  return { rowsByProvider, warnings };
}
