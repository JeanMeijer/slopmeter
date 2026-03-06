export interface UsageSummary {
  provider: "claude" | "codex" | "opencode";
  daily: DailyUsage[];
  insights?: Insights;
}

export interface DailyUsage {
  date: Date;
  input: number;
  output: number;
  cache: {
    input: number;
    output: number;
  };
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
  streaks: {
    longest: number;
    current: number;
  };
}

export interface JsonExportPayload {
  version: string;
  start: string;
  end: string;
  providers: JsonUsageSummary[];
}

export interface JsonUsageSummary {
  provider: "claude" | "codex" | "opencode";
  daily: JsonDailyUsage[];
  insights?: Insights;
}

export interface JsonDailyUsage {
  date: string;
  input: number;
  output: number;
  cache: {
    input: number;
    output: number;
  };
  total: number;
  breakdown: ModelUsage[];
}
