import type { UsageSummary } from "./interfaces";
import { loadClaudeRows } from "./lib/claude-code";
import { loadCodexRows } from "./lib/codex";
import { providerIds, providerStatusLabel, type ProviderId } from "./lib/interfaces";
import { loadOpenCodeRows } from "./lib/open-code";

export { providerIds, providerStatusLabel, type ProviderId };

interface AggregateUsageOptions {
  start: Date;
  end: Date;
  timezone: string;
}

export async function aggregateUsage({
  start,
  end,
  timezone,
}: AggregateUsageOptions): Promise<Record<ProviderId, UsageSummary | null>> {
  const [claude, codex, opencode] = await Promise.all([
    loadClaudeRows(start, end, timezone),
    loadCodexRows(start, end),
    loadOpenCodeRows(start, end),
  ]);

  return {
    claude: claude.daily.some((row) => row.total > 0) ? claude : null,
    codex: codex.daily.some((row) => row.total > 0) ? codex : null,
    opencode: opencode.daily.some((row) => row.total > 0) ? opencode : null,
  };
}
