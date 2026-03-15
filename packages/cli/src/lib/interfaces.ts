export type ProviderId = "claude" | "codex" | "cursor" | "opencode" | "pi";
export type Granularity = "day" | "hour";

export const providerIds: ProviderId[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "pi",
];

export const providerStatusLabel: Record<ProviderId, string> = {
  claude: "Claude code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "Open Code",
  pi: "Pi Coding Agent",
};
