import { loadClaudeRows } from "./lib/claude-code";
import { loadCodexRows } from "./lib/codex";
import {
  providerIds,
  providerStatusLabel,
  type CliDailyRow,
  type ProviderId,
  type ProviderRows,
} from "./lib/interfaces";
import { loadOpenCodeRows } from "./lib/open-code";

export { providerIds, providerStatusLabel, type CliDailyRow, type ProviderId };

export async function loadProviderRows(
  startDate: string,
  endDate: string,
  timezone: string,
): Promise<ProviderRows> {
  const [claudeRows, codexRows, openCodeRows] = await Promise.all([
    loadClaudeRows(startDate, endDate, timezone),
    loadCodexRows(startDate, endDate),
    loadOpenCodeRows(startDate, endDate),
  ]);

  return {
    claude: claudeRows,
    codex: codexRows,
    opencode: openCodeRows,
  };
}

export function hasData(rows: CliDailyRow[]) {
  return rows.some((row) => row.totalTokens > 0);
}

export function getRequestedProviders(values: Record<string, unknown>) {
  const wantClaude = Boolean(values.claude || values.Claude || values.cloudCode || values.CloudCode);
  const wantCodex = Boolean(values.codex || values.Codex);
  const wantOpenCode = Boolean(values.opencode || values.OpenCode || values.OpenCodex);

  const requested = new Set<ProviderId>();
  if (wantClaude) requested.add("claude");
  if (wantCodex) requested.add("codex");
  if (wantOpenCode) requested.add("opencode");

  return providerIds.filter((id) => requested.has(id));
}
