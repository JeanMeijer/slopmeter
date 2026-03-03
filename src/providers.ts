import { loadClaudeRows } from "./lib/claude-code";
import { loadCodexRows } from "./lib/codex";
import {
  providerIds,
  providerStatusLabel,
  type CliDailyRow,
  type ProviderData,
  type ProviderId,
} from "./lib/interfaces";
import { loadOpenCodeRows } from "./lib/open-code";

export { providerIds, providerStatusLabel, type CliDailyRow, type ProviderId };

export async function loadProviderRows(
  startDate: string,
  endDate: string,
  timezone: string,
) {
  const [claudeData, codexData, openCodeData] = await Promise.all([
    loadClaudeRows(startDate, endDate, timezone),
    loadCodexRows(startDate, endDate),
    loadOpenCodeRows(startDate, endDate),
  ]);

  return {
    claude: claudeData,
    codex: codexData,
    opencode: openCodeData,
  };
}

export function hasData(providerData: ProviderData) {
  return providerData.daily.some((row) => row.totalTokens > 0);
}

export function getRequestedProviders(values: Record<string, unknown>) {
  const wantClaude = Boolean(values.claude);
  const wantCodex = Boolean(values.codex);
  const wantOpenCode = Boolean(values.opencode);

  const requested = new Set<ProviderId>();
  if (wantClaude) requested.add("claude");
  if (wantCodex) requested.add("codex");
  if (wantOpenCode) requested.add("opencode");

  return providerIds.filter((id) => requested.has(id));
}
