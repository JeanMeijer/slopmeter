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
}

export async function aggregateUsage({
  start,
  end,
}: AggregateUsageOptions): Promise<Record<ProviderId, UsageSummary | null>> {
  const [claude, codex, opencode] = await Promise.all([
    loadClaudeRows(start, end),
    loadCodexRows(start, end),
    loadOpenCodeRows(start, end),
  ]);

  return {
    claude: hasUsage(claude) ? claude : null,
    codex: hasUsage(codex) ? codex : null,
    opencode: hasUsage(opencode) ? opencode : null,
  };
}
