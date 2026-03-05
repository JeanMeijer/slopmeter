export interface UsageSummary {
  provider: "claude" | "codex" | "opencode";
  daily: DailyUsage[];
  insights?: Insights;
}

export interface DailyUsage {
  input: number;
  output: number;
  cache: {
    input: number;
    output: number;
  }
  total: number;
  // usage by model, sorted by total tokens
  breakdown: ModelUsage[];
}

export interface ModelUsage {
  name: string;
  tokens: {
    input: number;
    output: number;
    cache: {
      input: number;
      output: number;
    };
    total: number;
  };
}

export interface Insights {
  mostUsedModel?: ModelUsage;
  recentMostUsedModel?: ModelUsage;
}
