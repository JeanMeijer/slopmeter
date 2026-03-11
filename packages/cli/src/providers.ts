import type { UsageSummary } from "./interfaces";
import { loadClaudeRows } from "./lib/claude-code";
import { loadCodexRows } from "./lib/codex";
import {
  providerIds,
  providerStatusLabel,
  type ProviderId,
} from "./lib/interfaces";
import { loadOpenCodeRows } from "./lib/open-code";
import { hasUsage } from "./lib/utils";

export { providerIds, providerStatusLabel, type ProviderId };

interface AggregateUsageOptions {
  start: Date;
  end: Date;
  providers?: ProviderId[];
}

export async function aggregateUsage({
  start,
  end,
  providers,
}: AggregateUsageOptions): Promise<Record<ProviderId, UsageSummary | null>> {
  const requestedProviders = providers?.length ? providers : providerIds;
  const rowsByProvider: Record<ProviderId, UsageSummary | null> = {
    claude: null,
    codex: null,
    opencode: null,
  };

  for (const provider of requestedProviders) {
    const summary =
      provider === "claude"
        ? await loadClaudeRows(start, end)
        : provider === "codex"
          ? await loadCodexRows(start, end)
          : await loadOpenCodeRows(start, end);

    rowsByProvider[provider] = hasUsage(summary) ? summary : null;
  }

  return rowsByProvider;
}
