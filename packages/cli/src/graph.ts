import svgBuilder, { type SVGBuilderInstance } from "svg-builder";
import type { DailyUsage, Insights, ModelUsage } from "./interfaces";
import type { ProviderId } from "./lib/interfaces";
import { formatLocalDate } from "./lib/utils";

type HeatmapThemeId = ProviderId | "all";

interface HeatmapTheme {
  title: string;
  titleCaption?: string;
  colors: {
    light: string[];
    dark: string[];
  };
}

export type ColorMode = "light" | "dark";

interface CalendarGrid {
  weeks: (string | null)[][];
  monthLabels: (string | null)[];
}

interface SectionLayout {
  width: number;
  height: number;
  gridTop: number;
  leftLabelWidth: number;
  cellSize: number;
  gap: number;
  headerCaptionY: number;
  headerValueY: number;
  titleY: number;
  monthLabelY: number;
  legendY: number;
  noteY: number;
  footerCaptionY: number;
  footerValueY: number;
}

interface DrawHeatmapSectionOptions {
  x: number;
  y: number;
  grid: CalendarGrid;
  layout: SectionLayout;
  daily: DailyUsage[];
  insights?: Insights;
  title: string;
  titleCaption?: string;
  colors: HeatmapTheme["colors"];
  colorMode: ColorMode;
  palette: SurfacePalette;
}

interface RenderUsageHeatmapsSvgSection {
  daily: DailyUsage[];
  insights?: Insights;
  title: string;
  titleCaption?: string;
  colors: HeatmapTheme["colors"];
}

interface ModelUsageRow {
  caption: string;
  data?: ModelUsage;
  placeholder?: string;
}

interface RenderUsageHeatmapsSvgOptions {
  startDate: Date;
  endDate: Date;
  sections: RenderUsageHeatmapsSvgSection[];
  colorMode: ColorMode;
}

interface SurfacePalette {
  background: string;
  text: string;
  muted: string;
}

export const heatmapThemes: Record<HeatmapThemeId, HeatmapTheme> = {
  amp: {
    title: "Amp",
    colors: {
      light: [
        "#ecfeff", // cyan-50
        "#a5f3fc", // cyan-200
        "#67e8f9", // cyan-300
        "#06b6d4", // cyan-500
        "#0e7490", // cyan-700
      ],
      dark: [
        "#083344", // cyan-950
        "#155e75", // cyan-800
        "#0891b2", // cyan-600
        "#22d3ee", // cyan-400
        "#a5f3fc", // cyan-200
      ],
    },
  },
  claude: {
    title: "Claude Code",
    colors: {
      light: [
        "#fff7ed", // orange-50
        "#fed7aa", // orange-200
        "#fdba74", // orange-300
        "#f97316", // orange-500
        "#c2410c", // orange-700
      ],
      dark: [
        "#292524", // stone-800
        "#9a3412", // orange-800
        "#c2410c", // orange-700
        "#f97316", // orange-500
        "#fdba74", // orange-300
      ],
    },
  },
  codex: {
    title: "Codex",
    colors: {
      light: [
        "#e0e7ff", // indigo-100
        "#a5b4fc", // indigo-300
        "#818cf8", // indigo-400
        "#4f46e5", // indigo-600
        "#312e81", // indigo-900
      ],
      dark: [
        "#1e1b4b", // indigo-950
        "#312e81", // indigo-900
        "#4338ca", // indigo-700
        "#818cf8", // indigo-400
        "#c7d2fe", // indigo-200
      ],
    },
  },
  cursor: {
    title: "Cursor",
    colors: {
      light: [
        "#fff7ed", // orange-50
        "#fed7aa", // orange-200
        "#fdba74", // orange-300
        "#f97316", // orange-500
        "#9a3412", // orange-800
      ],
      dark: [
        "#431407", // orange-950
        "#9a3412", // orange-800
        "#c2410c", // orange-700
        "#f97316", // orange-500
        "#fdba74", // orange-300
      ],
    },
  },
  gemini: {
    title: "Gemini CLI",
    colors: {
      light: [
        "#eff6ff", // blue-50
        "#bfdbfe", // blue-200
        "#93c5fd", // blue-300
        "#3b82f6", // blue-500
        "#1d4ed8", // blue-700
      ],
      dark: [
        "#172554", // blue-950
        "#1d4ed8", // blue-700
        "#2563eb", // blue-600
        "#60a5fa", // blue-400
        "#bfdbfe", // blue-200
      ],
    },
  },
  opencode: {
    title: "Open Code",
    colors: {
      light: [
        "#f5f5f5", // neutral-100
        "#d4d4d4", // neutral-300
        "#a3a3a3", // neutral-400
        "#525252", // neutral-600
        "#171717", // neutral-900
      ],
      dark: [
        "#262626", // neutral-800
        "#525252", // neutral-600
        "#737373", // neutral-500
        "#a3a3a3", // neutral-400
        "#fafafa", // neutral-50
      ],
    },
  },
  pi: {
    title: "Pi Coding Agent",
    colors: {
      light: [
        "#ecfdf5", // emerald-50
        "#a7f3d0", // emerald-200
        "#6ee7b7", // emerald-300
        "#10b981", // emerald-500
        "#047857", // emerald-700
      ],
      dark: [
        "#022c22", // emerald-950
        "#065f46", // emerald-800
        "#059669", // emerald-600
        "#34d399", // emerald-400
        "#a7f3d0", // emerald-200
      ],
    },
  },
  crush: {
    title: "Crush",
    colors: {
      light: [
        "#fff1f2", // rose-50
        "#fecdd3", // rose-200
        "#fda4af", // rose-300
        "#fb7185", // rose-400
        "#be123c", // rose-700
      ],
      dark: [
        "#4c0519", // rose-950
        "#9f1239", // rose-800
        "#e11d48", // rose-600
        "#fb7185", // rose-400
        "#fecdd3", // rose-200
      ],
    },
  },
  antigravity: {
    title: "Google Antigravity",
    colors: {
      light: [
        "#eff6ff", // blue-50
        "#bfdbfe", // blue-200
        "#60a5fa", // blue-400
        "#2563eb", // blue-600
        "#1e3a8a", // blue-900
      ],
      dark: [
        "#172554", // blue-950
        "#1d4ed8", // blue-700
        "#2563eb", // blue-600
        "#60a5fa", // blue-400
        "#bfdbfe", // blue-200
      ],
    },
  },
  all: {
    title: "All Providers",
    titleCaption: "Total usage from",
    colors: {
      light: [
        "#f0fdf4", // green-50
        "#bbf7d0", // green-200
        "#4ade80", // green-400
        "#16a34a", // green-600
        "#14532d", // green-900
      ],
      dark: [
        "#052e16", // green-950
        "#15803d", // green-700
        "#16a34a", // green-600
        "#4ade80", // green-400
        "#bbf7d0", // green-200
      ],
    },
  },
};

const daysOfWeekMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const numberFormatter = new Intl.NumberFormat("en-US");
const fontFamily =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const providerTitleFontSize = 20;
const metricCaptionFontSize = 9;
const metricValueFontSize = 14;
const captionValueGap = 4;
const heatmapGamma = 0.7;

const surfacePalettes: Record<ColorMode, SurfacePalette> = {
  light: {
    background: "#ffffff",
    text: "#0f172a",
    muted: "#737373",
  },
  dark: {
    background: "#171717",
    text: "#fafafa",
    muted: "#a3a3a3",
  },
};

const emptyCellFill: Record<ColorMode, string> = {
  light: "#f5f5f5", // neutral-100
  dark: "#262626", // neutral-800
};

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

  return numberFormatter.format(value);
}

function formatModelUsageMetric(model: ModelUsage) {
  if (model.metric?.unit === "messages") {
    return `${numberFormatter.format(model.metric.value)} msgs`;
  }

  return formatTokenTotal(model.tokens.total);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function caption(value: string) {
  return value.toUpperCase();
}

function getAllDays(start: Date, end: Date) {
  const days: string[] = [];
  const curr = new Date(start);

  while (curr <= end) {
    days.push(formatLocalDate(curr));
    curr.setDate(curr.getDate() + 1);
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

function chunkByWeek(days: (string | null)[]): (string | null)[][] {
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

  const scaled = Math.pow(value / max, heatmapGamma);
  const index = Math.ceil(scaled * (colorCount - 1));

  return Math.min(Math.max(index, 0), colorCount - 1);
}

function formatShortDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getCalendarGrid(startDate: Date, endDate: Date) {
  const allDays = getAllDays(startDate, endDate);
  const paddedDays = padToWeekStartMonday(allDays);
  const weeks = chunkByWeek(paddedDays);

  const monthLabels = weeks.map((week, i) => {
    const label = getMonthLabel(week);
    const prevLabel = i > 0 ? getMonthLabel(weeks[i - 1]) : null;

    return label !== prevLabel ? label : null;
  });

  return { weeks, monthLabels };
}

function getSectionLayout(weekCount: number) {
  const cellSize = 11;
  const gap = 2;
  const leftLabelWidth = 34;
  const rightPadding = 20;
  const headerCaptionY = 0;
  const headerValueY = headerCaptionY + metricCaptionFontSize + captionValueGap;
  const topMetricHeight = headerValueY + metricValueFontSize;
  const topPadding = Math.max(providerTitleFontSize, topMetricHeight) + 20;
  const monthHeaderHeight = 20;
  const titleY = 0;
  const monthLabelY = topPadding + 4;
  const gridTop = topPadding + monthHeaderHeight;
  const gridHeight = 7 * cellSize + 6 * gap;
  const gridWidth = weekCount * cellSize + Math.max(weekCount - 1, 0) * gap;
  const legendY = gridTop + gridHeight + 28;
  const legendBottomY = legendY + cellSize;
  const noteY = legendBottomY + 14;
  const footerTopPadding = 48;
  const footerCaptionY = legendBottomY + footerTopPadding;
  const footerValueY = footerCaptionY + metricCaptionFontSize + captionValueGap;
  const statsBottomPadding = 12;
  const width = leftLabelWidth + gridWidth + rightPadding;
  const height = footerValueY + metricValueFontSize + statsBottomPadding;

  return {
    width,
    height,
    gridTop,
    leftLabelWidth,
    cellSize,
    gap,
    headerCaptionY,
    headerValueY,
    titleY,
    monthLabelY,
    legendY,
    noteY,
    footerCaptionY,
    footerValueY,
  };
}

function drawHeatmapSection(
  svg: SVGBuilderInstance,
  {
    x,
    y,
    grid,
    layout,
    daily,
    insights,
    title,
    titleCaption,
    colors,
    colorMode,
    palette,
  }: DrawHeatmapSectionOptions,
) {
  const colorsForMode = colors[colorMode];
  const legendColors = [emptyCellFill[colorMode], ...colorsForMode.slice(1)];
  const valueByDate = new Map<string, number>();
  const rightEdge = x + layout.width - 8;
  const leftColumnX = x + 8;
  let maxValue = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalActivity = 0;
  let firstActivityOnlyDate: string | null = null;
  let firstMeasuredDate: string | null = null;

  for (const row of daily) {
    const dateKey = formatLocalDate(row.date);
    const displayValue = row.displayValue ?? row.total;

    valueByDate.set(dateKey, displayValue);
    maxValue = Math.max(maxValue, displayValue);
    totalActivity += displayValue;
    if (row.total <= 0 && displayValue > 0) {
      if (!firstActivityOnlyDate || dateKey < firstActivityOnlyDate) {
        firstActivityOnlyDate = dateKey;
      }
    } else if (
      row.total > 0 &&
      (!firstMeasuredDate || dateKey < firstMeasuredDate)
    ) {
      firstMeasuredDate = dateKey;
    }
    totalInputTokens += row.input;
    totalOutputTokens += row.output;
    totalTokens += row.total;
  }

  const topMetricGap = 120;
  const headerInputX = rightEdge - topMetricGap * 2;
  const headerOutputX = rightEdge - topMetricGap;
  const hasMeasuredTokens = totalTokens > 0;
  const totalTokensLabel = hasMeasuredTokens
    ? formatTokenTotal(totalTokens)
    : totalActivity > 0
      ? `${totalActivity.toLocaleString("en-US")} events`
      : "0";
  const totalInputLabel = hasMeasuredTokens
    ? formatTokenTotal(totalInputTokens)
    : "N/A";
  const totalOutputLabel = hasMeasuredTokens
    ? formatTokenTotal(totalOutputTokens)
    : "N/A";
  const longestStreak = insights?.streaks.longest ?? 0;
  const currentStreak = insights?.streaks.current ?? 0;

  if (titleCaption) {
    svg = svg.text(
      {
        x: leftColumnX,
        y: y + layout.headerCaptionY,
        fill: palette.muted,
        "font-size": metricCaptionFontSize,
        "font-weight": 600,
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      caption(titleCaption),
    );

    svg = svg.text(
      {
        x: leftColumnX,
        y: y + layout.headerValueY,
        fill: palette.text,
        "font-size": metricValueFontSize,
        "font-weight": 600,
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      title,
    );
  } else {
    svg = svg.text(
      {
        x: leftColumnX,
        y: y + layout.titleY,
        fill: palette.text,
        "font-size": providerTitleFontSize,
        "font-weight": 600,
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      title,
    );
  }

  svg = svg.text(
    {
      x: headerInputX,
      y: y + layout.headerCaptionY,
      fill: palette.muted,
      "font-size": metricCaptionFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    caption(hasMeasuredTokens ? "Input tokens" : "Input tokens"),
  );

  svg = svg.text(
    {
      x: headerInputX,
      y: y + layout.headerValueY,
      fill: palette.text,
      "font-size": metricValueFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    totalInputLabel,
  );

  svg = svg.text(
    {
      x: headerOutputX,
      y: y + layout.headerCaptionY,
      fill: palette.muted,
      "font-size": metricCaptionFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    caption(hasMeasuredTokens ? "Output tokens" : "Output tokens"),
  );

  svg = svg.text(
    {
      x: headerOutputX,
      y: y + layout.headerValueY,
      fill: palette.text,
      "font-size": metricValueFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    totalOutputLabel,
  );

  svg = svg.text(
    {
      x: rightEdge,
      y: y + layout.headerCaptionY,
      fill: palette.muted,
      "font-size": metricCaptionFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    caption(hasMeasuredTokens ? "Total tokens" : "Activity"),
  );

  svg = svg.text(
    {
      x: rightEdge,
      y: y + layout.headerValueY,
      fill: palette.text,
      "font-size": metricValueFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    totalTokensLabel,
  );

  for (let i = 0; i < 7; i += 1) {
    const dayY =
      y +
      layout.gridTop +
      i * (layout.cellSize + layout.gap) +
      layout.cellSize / 2;

    const dayLabel = i === 0 || i === 6 ? daysOfWeekMonday[i] : "";

    svg = svg.text(
      {
        x: x + layout.leftLabelWidth - 6,
        y: dayY,
        fill: palette.muted,
        "font-size": 10,
        "text-anchor": "end",
        "dominant-baseline": "middle",
        "font-family": fontFamily,
      },
      dayLabel,
    );
  }

  for (let weekIndex = 0; weekIndex < grid.weeks.length; weekIndex += 1) {
    const monthLabel = grid.monthLabels[weekIndex];

    if (monthLabel) {
      const monthX =
        x + layout.leftLabelWidth + weekIndex * (layout.cellSize + layout.gap);

      svg = svg.text(
        {
          x: monthX,
          y: y + layout.monthLabelY,
          fill: palette.muted,
          "font-size": 10,
          "font-family": fontFamily,
        },
        monthLabel,
      );
    }

    const week = grid.weeks[weekIndex];

    for (let dayIndex = 0; dayIndex < week.length; dayIndex += 1) {
      const day = week[dayIndex];

      if (!day) {
        continue;
      }

      const value = valueByDate.get(day) ?? 0;
      const colorIndex = defaultColourMap(
        value,
        maxValue,
        colorsForMode.length,
      );
      const fill =
        value <= 0 ? emptyCellFill[colorMode] : colorsForMode[colorIndex];
      const dayX =
        x + layout.leftLabelWidth + weekIndex * (layout.cellSize + layout.gap);
      const dayY =
        y + layout.gridTop + dayIndex * (layout.cellSize + layout.gap);
      const rectAttributes: Record<string, string | number> = {
        x: dayX,
        y: dayY,
        width: layout.cellSize,
        height: layout.cellSize,
        rx: 3,
        ry: 3,
        fill,
      };

      svg = svg.rect(rectAttributes);
    }
  }

  const legendStartX = x + layout.leftLabelWidth;
  const legendY = y + layout.legendY;

  svg = svg.text(
    {
      x: legendStartX,
      y: legendY + 10,
      fill: palette.muted,
      "font-size": 10,
      "font-weight": 600,
      "font-family": fontFamily,
    },
    caption("Less"),
  );

  for (let i = 0; i < legendColors.length; i += 1) {
    const legendX = legendStartX + 28 + i * (layout.cellSize + 3);

    svg = svg.rect({
      x: legendX,
      y: legendY,
      width: layout.cellSize,
      height: layout.cellSize,
      rx: 3,
      ry: 3,
      fill: legendColors[i],
    });
  }

  svg = svg.text(
    {
      x: legendStartX + 28 + legendColors.length * (layout.cellSize + 3) + 6,
      y: legendY + 10,
      fill: palette.muted,
      "font-size": 10,
      "font-weight": 600,
      "font-family": fontFamily,
    },
    caption("More"),
  );

  if (firstActivityOnlyDate && firstMeasuredDate) {
    const noteX = x + layout.width / 2;
    const noteY = y + layout.gridTop + 7 * layout.cellSize + 6 * layout.gap + 8;

    svg = svg.text(
      {
        x: noteX,
        y: noteY,
        fill: palette.muted,
        "font-size": 10,
        "text-anchor": "middle",
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      `Claude started logging full token telemetry on ${formatShortDate(firstMeasuredDate)}; earlier activity may be undercounted.`,
    );
  }

  const rightColumnX = rightEdge;
  const leftSecondaryX = leftColumnX + 250;
  const rightPrimaryX = rightColumnX - 160;

  const leftRows: ModelUsageRow[] = [
    {
      caption: "Most used model",
      data: insights?.mostUsedModel,
      placeholder: "Not tracked",
    },
    {
      caption: "Recent use (last 30 days)",
      data: insights?.recentMostUsedModel,
      placeholder: "Not tracked",
    },
  ];

  for (const [index, row] of leftRows.entries()) {
    const captionY = layout.footerCaptionY;
    const valueY = layout.footerValueY;
    const modelX = index === 0 ? leftColumnX : leftSecondaryX;

    svg = svg.text(
      {
        x: modelX,
        y: y + captionY,
        fill: palette.muted,
        "font-size": metricCaptionFontSize,
        "font-weight": 600,
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      caption(row.caption),
    );

    svg = svg.text(
      {
        x: modelX,
        y: y + valueY,
        "dominant-baseline": "hanging",
        "font-family": fontFamily,
      },
      row.data
        ? `<tspan fill="${palette.text}" font-size="${metricValueFontSize}" font-weight="600">${escapeXml(truncateText(row.data.name, 20))}</tspan><tspan dx="6" fill="${palette.muted}" font-size="${metricValueFontSize}" font-weight="400">(${escapeXml(formatModelUsageMetric(row.data))})</tspan>`
        : `<tspan fill="${palette.muted}" font-size="${metricValueFontSize}" font-weight="500">${escapeXml(row.placeholder ?? "Unavailable")}</tspan>`,
    );
  }

  svg = svg.text(
    {
      x: rightPrimaryX,
      y: y + layout.footerCaptionY,
      fill: palette.muted,
      "font-size": metricCaptionFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    caption("Longest streak"),
  );

  svg = svg.text(
    {
      x: rightPrimaryX,
      y: y + layout.footerValueY,
      fill: palette.text,
      "font-size": metricValueFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    `${numberFormatter.format(longestStreak)} days`,
  );

  svg = svg.text(
    {
      x: rightColumnX,
      y: y + layout.footerCaptionY,
      fill: palette.muted,
      "font-size": metricCaptionFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    caption("Current streak"),
  );

  svg = svg.text(
    {
      x: rightColumnX,
      y: y + layout.footerValueY,
      fill: palette.text,
      "font-size": metricValueFontSize,
      "font-weight": 600,
      "text-anchor": "end",
      "dominant-baseline": "hanging",
      "font-family": fontFamily,
    },
    `${numberFormatter.format(currentStreak)} days`,
  );

  return svg;
}

export function renderUsageHeatmapsSvg({
  startDate,
  endDate,
  sections,
  colorMode,
}: RenderUsageHeatmapsSvgOptions) {
  const grid = getCalendarGrid(startDate, endDate);
  const layout = getSectionLayout(grid.weeks.length);
  const palette = surfacePalettes[colorMode];
  const horizontalPadding = 18;
  const topPadding = 30;
  const bottomPadding = 18;
  const sectionGap = 40;

  const width = horizontalPadding * 2 + layout.width;
  const height =
    topPadding +
    bottomPadding +
    sections.length * layout.height +
    Math.max(sections.length - 1, 0) * sectionGap;

  let svg = svgBuilder
    .create()
    .width(width)
    .height(height)
    .viewBox(`0 0 ${width} ${height}`)
    .rect({
      x: -2,
      y: -2,
      width: width + 4,
      height: height + 4,
      fill: palette.background,
    });

  sections.forEach((section, index) => {
    const sectionY = topPadding + index * (layout.height + sectionGap);

    svg = drawHeatmapSection(svg, {
      x: horizontalPadding,
      y: sectionY,
      grid,
      layout,
      daily: section.daily,
      insights: section.insights,
      title: section.title,
      titleCaption: section.titleCaption,
      colors: section.colors,
      colorMode,
      palette,
    });
  });

  return svg.render();
}
