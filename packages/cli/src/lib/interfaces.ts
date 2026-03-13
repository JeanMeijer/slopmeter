export type ProviderId =
  | "claude"
  | "codex"
  | "cursor"
  | "gemini"
  | "opencode"
  | "pi";

export const providerIds: ProviderId[] = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
];

export const defaultProviderIds: ProviderId[] = ["claude", "codex", "cursor"];

export const providerStatusLabel: Record<ProviderId, string> = {
  claude: "Claude code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "Open Code",
  pi: "Pi Coding Agent",
};
