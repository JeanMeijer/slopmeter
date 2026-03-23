"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type CodegraphProviderId =
  | "claude"
  | "codex"
  | "cursor"
  | "opencode"
  | "pi"
  | "crush";

export interface CodegraphModelUsage {
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
  metric?: {
    unit: "tokens" | "messages";
    value: number;
  };
}

export interface CodegraphDailyUsage {
  date: string;
  input: number;
  output: number;
  cache: {
    input: number;
    output: number;
  };
  total: number;
  breakdown: CodegraphModelUsage[];
}

export interface CodegraphProviderInsights {
  mostUsedModel?: CodegraphModelUsage;
  recentMostUsedModel?: CodegraphModelUsage;
}

export interface CodegraphProviderData {
  id: CodegraphProviderId;
  title: string;
  colors: string[];
  daily: CodegraphDailyUsage[];
  insights?: CodegraphProviderInsights;
}

export interface CodegraphExportData {
  version: string;
  start: string;
  end: string;
  providers: CodegraphProviderData[];
}

const heatmapVariants = cva("", {
  variants: {
    variant: {
      claude:
        "[--heatmap-0:var(--heatmap-claude-0)] [--heatmap-1:var(--heatmap-claude-1)] [--heatmap-2:var(--heatmap-claude-2)] [--heatmap-3:var(--heatmap-claude-3)] [--heatmap-4:var(--heatmap-claude-4)]",
      codex:
        "[--heatmap-0:var(--heatmap-codex-0)] [--heatmap-1:var(--heatmap-codex-1)] [--heatmap-2:var(--heatmap-codex-2)] [--heatmap-3:var(--heatmap-codex-3)] [--heatmap-4:var(--heatmap-codex-4)]",
      cursor:
        "[--heatmap-0:var(--heatmap-cursor-0)] [--heatmap-1:var(--heatmap-cursor-1)] [--heatmap-2:var(--heatmap-cursor-2)] [--heatmap-3:var(--heatmap-cursor-3)] [--heatmap-4:var(--heatmap-cursor-4)]",
      opencode:
        "[--heatmap-0:var(--heatmap-opencode-0)] [--heatmap-1:var(--heatmap-opencode-1)] [--heatmap-2:var(--heatmap-opencode-2)] [--heatmap-3:var(--heatmap-opencode-3)] [--heatmap-4:var(--heatmap-opencode-4)]",
      crush:
        "[--heatmap-0:var(--heatmap-crush-0)] [--heatmap-1:var(--heatmap-crush-1)] [--heatmap-2:var(--heatmap-crush-2)] [--heatmap-3:var(--heatmap-crush-3)] [--heatmap-4:var(--heatmap-crush-4)]",
      pi: "[--heatmap-0:var(--heatmap-pi-0)] [--heatmap-1:var(--heatmap-pi-1)] [--heatmap-2:var(--heatmap-pi-2)] [--heatmap-3:var(--heatmap-pi-3)] [--heatmap-4:var(--heatmap-pi-4)]",
    },
  },
  defaultVariants: {
    variant: "claude",
  },
});

export interface AgentUsageHeatmapProps
  extends React.ComponentProps<"div">, VariantProps<typeof heatmapVariants> {
  data: CodegraphExportData;
  cellSize?: number;
  gap?: number;
}

interface AgentUsageHeatmapSectionProps {
  provider: CodegraphProviderData;
  allDays: string[];
  weeks: (string | null)[][];
  monthLabels: (string | null)[];
  cellSize: number;
  gap: number;
}

const daysOfWeekMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getAllDays(start: string, end: string) {
  const days: string[] = [];
  const current = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  while (current <= endDate) {
    days.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function getMondayBasedWeekday(dateIso: string) {
  const sundayBased = new Date(`${dateIso}T00:00:00`).getDay();

  return (sundayBased + 6) % 7;
}

function padToWeekStartMonday(days: string[]) {
  const firstDay = getMondayBasedWeekday(days[0]);
  const padding = new Array(firstDay).fill(null);

  return [...padding, ...days];
}

function chunkByWeek(days: (string | null)[]) {
  const weeks: (string | null)[][] = [];

  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return weeks;
}

function getMonthLabel(week: (string | null)[]) {
  const lastDay = [...week].reverse().find(Boolean);

  if (!lastDay) {
    return null;
  }

  return new Date(`${lastDay}T00:00:00`).toLocaleString("en-US", {
    month: "short",
  });
}

function defaultColourMap(value: number, max: number, colorCount: number) {
  if (max <= 0 || value <= 0) {
    return 0;
  }

  const index = Math.ceil((value / max) * (colorCount - 1));

  return Math.min(Math.max(index, 0), colorCount - 1);
}

function formatTokenTotal(value: number) {
  const units = [
    { size: 1_000_000_000_000, suffix: "T" },
    { size: 1_000_000_000, suffix: "B" },
    { size: 1_000_000, suffix: "M" },
    { size: 1_000, suffix: "K" },
  ];

  for (const unit of units) {
    if (value >= unit.size) {
      const scaled = value / unit.size;
      const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      const compact = scaled
        .toFixed(precision)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1");

      return `${compact}${unit.suffix}`;
    }
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function formatModelUsageMetric(model: CodegraphModelUsage) {
  if (model.metric?.unit === "messages") {
    return `${new Intl.NumberFormat("en-US").format(model.metric.value)} msgs`;
  }

  return formatTokenTotal(model.tokens.total);
}

function computeStreaks(allDays: string[], valueByDate: Map<string, number>) {
  let longestStreak = 0;
  let running = 0;

  for (const day of allDays) {
    const active = (valueByDate.get(day) ?? 0) > 0;

    if (active) {
      running += 1;

      if (running > longestStreak) {
        longestStreak = running;
      }
    } else {
      running = 0;
    }
  }

  let currentStreak = 0;

  for (let i = allDays.length - 1; i >= 0; i -= 1) {
    const day = allDays[i];
    const active = (valueByDate.get(day) ?? 0) > 0;

    if (!active) {
      break;
    }

    currentStreak += 1;
  }

  return { longestStreak, currentStreak };
}

function formatLocalDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function buildMonthLabels(weeks: (string | null)[][]) {
  return weeks.map((week, i) => {
    const label = getMonthLabel(week);
    const previous = i > 0 ? getMonthLabel(weeks[i - 1]) : null;

    if (label !== previous) {
      return label;
    }

    return null;
  });
}

function getColorScale() {
  return [
    "var(--heatmap-0)",
    "var(--heatmap-1)",
    "var(--heatmap-2)",
    "var(--heatmap-3)",
    "var(--heatmap-4)",
  ];
}

interface MetricProps {
  caption: string;
  value: string;
  muted?: boolean;
}

function Metric({ caption, value, muted }: MetricProps) {
  return (
    <div className="flex min-w-[120px] flex-col items-end text-right">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {caption}
      </span>
      <span
        className={cn(
          "text-sm font-semibold",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function AgentUsageHeatmapSection({
  provider,
  allDays,
  weeks,
  monthLabels,
  cellSize,
  gap,
}: AgentUsageHeatmapSectionProps) {
  const rowByDate = new Map(provider.daily.map((row) => [row.date, row]));
  const valueByDate = new Map(
    provider.daily.map((row) => [row.date, row.total]),
  );
  const maxValue = Math.max(0, ...provider.daily.map((row) => row.total));

  const totalInput = provider.daily.reduce((sum, row) => sum + row.input, 0);
  const totalOutput = provider.daily.reduce((sum, row) => sum + row.output, 0);
  const totalTokens = provider.daily.reduce((sum, row) => sum + row.total, 0);
  const { longestStreak, currentStreak } = computeStreaks(allDays, valueByDate);
  const colorScale = getColorScale();

  return (
    <section className="rounded-xl border bg-card p-4 text-card-foreground md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{provider.title}</h3>
        <div className="flex flex-wrap justify-end gap-4">
          <Metric caption="Input tokens" value={formatTokenTotal(totalInput)} />
          <Metric
            caption="Output tokens"
            value={formatTokenTotal(totalOutput)}
          />
          <Metric
            caption="Total tokens"
            value={formatTokenTotal(totalTokens)}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <div
          role="grid"
          aria-label={`${provider.title} usage heatmap`}
          className="grid min-w-max"
          style={{
            gap,
            gridTemplateColumns: `max-content repeat(${weeks.length}, ${cellSize}px)`,
            gridTemplateRows: `repeat(8, ${cellSize}px)`,
          }}
        >
          {daysOfWeekMonday.map((day, dayIndex) => {
            const showLabel = dayIndex === 0 || dayIndex === 6;

            if (!showLabel) {
              return (
                <div
                  key={`day-label-${day}`}
                  style={{
                    gridColumn: 1,
                    gridRow: dayIndex + 2,
                  }}
                />
              );
            }

            return (
              <div
                key={`day-label-${day}`}
                className="pr-2 text-[10px] text-muted-foreground"
                style={{
                  gridColumn: 1,
                  gridRow: dayIndex + 2,
                }}
              >
                {day}
              </div>
            );
          })}

          {weeks.map((_, weekIndex) => {
            const label = monthLabels[weekIndex];

            return (
              <div
                key={`month-${weekIndex}`}
                className="text-[10px] text-muted-foreground"
                style={{
                  gridColumn: weekIndex + 2,
                  gridRow: 1,
                }}
              >
                {label}
              </div>
            );
          })}

          {weeks.map((week, weekIndex) => {
            return week.map((day, dayIndex) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${weekIndex}-${dayIndex}`}
                    style={{
                      gridColumn: weekIndex + 2,
                      gridRow: dayIndex + 2,
                    }}
                  />
                );
              }

              const dayRow = rowByDate.get(day) ?? {
                date: day,
                input: 0,
                output: 0,
                cache: { input: 0, output: 0 },
                total: 0,
                breakdown: [],
              };
              const colorIndex = defaultColourMap(
                dayRow.total,
                maxValue,
                colorScale.length,
              );
              const fill = colorScale[colorIndex];

              return (
                <Tooltip key={`cell-${day}`}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="rounded-[4px] bg-(--item-color) transition-colors"
                      style={
                        {
                          gridColumn: weekIndex + 2,
                          gridRow: dayIndex + 2,
                          width: cellSize,
                          height: cellSize,
                          "--item-color": fill,
                        } as React.CSSProperties
                      }
                      aria-label={`${day}: ${dayRow.total} total tokens`}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">
                        {new Date(`${day}T00:00:00`).toDateString()}
                      </div>
                      <div className="text-muted-foreground">
                        {formatTokenTotal(dayRow.total)} total tokens
                      </div>
                      <div className="text-muted-foreground">
                        In: {formatTokenTotal(dayRow.input)} | Out:{" "}
                        {formatTokenTotal(dayRow.output)}
                      </div>
                      {dayRow.breakdown.slice(0, 3).map((model) => {
                        return (
                          <div
                            key={`${day}-${model.name}`}
                            className="text-muted-foreground"
                          >
                            {model.name}: {formatTokenTotal(model.tokens.total)}
                          </div>
                        );
                      })}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            });
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Less</span>
        <div className="flex items-center gap-1">
          {colorScale.map((color, index) => {
            return (
              <span
                key={`legend-${provider.id}-${index}`}
                className="rounded-[4px] bg-(--item-color)"
                style={
                  {
                    width: cellSize,
                    height: cellSize,
                    "--item-color": color,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
        <span>More</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Metric
          caption="Most used model"
          value={
            provider.insights?.mostUsedModel
              ? `${provider.insights.mostUsedModel.name} (${formatModelUsageMetric(provider.insights.mostUsedModel)})`
              : "Not tracked"
          }
          muted={!provider.insights?.mostUsedModel}
        />

        <Metric
          caption="Recent use (last 30 days)"
          value={
            provider.insights?.recentMostUsedModel
              ? `${provider.insights.recentMostUsedModel.name} (${formatModelUsageMetric(provider.insights.recentMostUsedModel)})`
              : "Not tracked"
          }
          muted={!provider.insights?.recentMostUsedModel}
        />

        <Metric caption="Longest streak" value={`${longestStreak} days`} />
        <Metric caption="Current streak" value={`${currentStreak} days`} />
      </div>
    </section>
  );
}

export function AgentUsageHeatmap({
  data,
  className,
  cellSize = 11,
  gap = 2,
  variant = "claude",
  ...props
}: AgentUsageHeatmapProps) {
  const allDays = getAllDays(data.start, data.end);
  const paddedDays = padToWeekStartMonday(allDays);
  const weeks = chunkByWeek(paddedDays);
  const monthLabels = buildMonthLabels(weeks);
  const provider = data.providers.find((item) => item.id === variant);

  if (!provider) {
    return null;
  }

  return (
    <TooltipProvider>
      <div
        className={cn(heatmapVariants({ variant }), "space-y-6", className)}
        {...props}
      >
        <AgentUsageHeatmapSection
          provider={provider}
          allDays={allDays}
          weeks={weeks}
          monthLabels={monthLabels}
          cellSize={cellSize}
          gap={gap}
        />
      </div>
    </TooltipProvider>
  );
}

export default AgentUsageHeatmap;
