export type ProviderId =
  | "amp"
  | "claude"
  | "codex"
  | "cursor"
  | "crush"
  | "gemini"
  | "opencode"
  | "pi"
  | "antigravity";

export const providerIds: ProviderId[] = [
  "amp",
  "claude",
  "codex",
  "cursor",
  "gemini",
  "opencode",
  "pi",
  "crush",
  "antigravity",
];

export const defaultProviderIds: ProviderId[] = ["claude", "codex", "cursor"];

export const providerStatusLabel: Record<ProviderId, string> = {
  amp: "Amp",
  claude: "Claude code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "Open Code",
  pi: "Pi Coding Agent",
  crush: "Crush",
  antigravity: "Google Antigravity",
};
