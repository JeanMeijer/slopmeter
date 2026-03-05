import svgBuilder, { type SVGBuilderInstance } from "svg-builder";
import type { DailyUsage, Insights, ModelUsage } from "./interfaces";
import type { ProviderId } from "./lib/interfaces";
import { formatLocalDate } from "./lib/utils";

interface HeatmapTheme {
  title: string;
  colors: string[];
}

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
  titleY: number;
  monthLabelY: number;
  legendY: number;
  footerCaptionY: number;
  footerValueY: number;
}

interface DrawHeatmapSectionOptions {
  x: number;
  y: number;
  allDays: string[];
  grid: CalendarGrid;
  layout: SectionLayout;
  daily: DailyUsage[];
  insights?: Insights;
  title: string;
  colors: string[];
}

interface RenderUsageHeatmapsSvgSection {
  daily: DailyUsage[];
  insights?: Insights;
  title: string;
  colors: string[];
}

interface ModelUsageRow {
  caption: string;
  data: ModelUsage;
}

interface RenderUsageHeatmapsSvgOptions {
  startDate: Date;
  endDate: Date;
  sections: RenderUsageHeatmapsSvgSection[];
}

export const heatmapThemes: Record<ProviderId, HeatmapTheme> = {
  claude: {
    title: "Claude Code",
    colors: [
      "#fff7ed", // orange-50
      "#fed7aa", // orange-200
      "#fdba74", // orange-300
      "#f97316", // orange-500
      "#c2410c", // orange-700
    ],
  },
  codex: {
    title: "Codex",
    colors: [
      "#e0e7ff", // indigo-100
      "#a5b4fc", // indigo-300
      "#818cf8", // indigo-400
      "#4f46e5", // indigo-600
      "#312e81", // indigo-900
    ],
  },
  opencode: {
    title: "Open Code",
    colors: [
      "#f5f5f5", // neutral-100
      "#d4d4d4", // neutral-300
      "#a3a3a3", // neutral-400
      "#525252", // neutral-600
      "#171717", // neutral-900
    ],
  },
};

const daysOfWeekMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const numberFormatter = new Intl.NumberFormat("en-US");
const fontFamily =
  "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

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

  const index = Math.ceil((value / max) * (colorCount - 1));
  return Math.min(Math.max(index, 0), colorCount - 1);
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
  const metricCaptionValueGap = 15;
  const headerValueY = 16;
  const headerCaptionY = headerValueY - metricCaptionValueGap;
  const topPadding = 40;
  const monthHeaderHeight = 20;
  const titleY = headerValueY;
  const monthLabelY = topPadding + 4;
  const gridTop = topPadding + monthHeaderHeight;
  const gridHeight = 7 * cellSize + 6 * gap;
  const gridWidth = weekCount * cellSize + Math.max(weekCount - 1, 0) * gap;
  const legendY = gridTop + gridHeight + 10;
  const legendBottomY = legendY + cellSize;
  const footerTopPadding = 18;
  const footerCaptionY = legendBottomY + footerTopPadding;
  const footerValueY = footerCaptionY + metricCaptionValueGap;
  const statsBottomPadding = 12;
  const width = leftLabelWidth + gridWidth + rightPadding;
  const height = footerValueY + statsBottomPadding;

  return {
    width,
    height,
    gridTop,
    leftLabelWidth,
    cellSize,
    gap,
    headerCaptionY,
    titleY,
    monthLabelY,
    legendY,
    footerCaptionY,
    footerValueY,
  };
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

function drawHeatmapSection(
  svg: SVGBuilderInstance,
  {
    x,
    y,
    allDays,
    grid,
    layout,
    daily,
    insights,
    title,
    colors,
  }: DrawHeatmapSectionOptions,
) {
  const valueByDate = new Map<string, number>();
  for (const row of daily) {
    valueByDate.set(row.date, row.total);
  }
  const maxValue = Math.max(...daily.map((row) => row.total), 0);
  const rightEdge = x + layout.width - 8;
  const leftColumnX = x + 8;
  const totalInputTokens = daily.reduce((sum, row) => sum + row.input, 0);
  const totalOutputTokens = daily.reduce((sum, row) => sum + row.output, 0);
  const totalTokens = daily.reduce((sum, row) => sum + row.total, 0);
  const topMetricGap = 120;
  const headerInputX = rightEdge - topMetricGap * 2;
  const headerOutputX = rightEdge - topMetricGap;
  const totalTokensLabel = formatTokenTotal(totalTokens);
  const totalInputLabel = formatTokenTotal(totalInputTokens);
  const totalOutputLabel = formatTokenTotal(totalOutputTokens);
  const { longestStreak, currentStreak } = computeStreaks(allDays, valueByDate);

  svg = svg.text(
    {
      x: leftColumnX,
      y: y + layout.titleY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "font-family": fontFamily,
    },
    title,
  );

  svg = svg.text(
    {
      x: headerInputX,
      y: y + layout.headerCaptionY,
      fill: "#64748b",
      "font-size": 9,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    caption("Input tokens"),
  );

  svg = svg.text(
    {
      x: headerInputX,
      y: y + layout.titleY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    totalInputLabel,
  );

  svg = svg.text(
    {
      x: headerOutputX,
      y: y + layout.headerCaptionY,
      fill: "#64748b",
      "font-size": 9,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    caption("Output tokens"),
  );

  svg = svg.text(
    {
      x: headerOutputX,
      y: y + layout.titleY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    totalOutputLabel,
  );

  svg = svg.text(
    {
      x: rightEdge,
      y: y + layout.headerCaptionY,
      fill: "#64748b",
      "font-size": 9,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    caption("Total tokens"),
  );

  svg = svg.text(
    {
      x: rightEdge,
      y: y + layout.titleY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "text-anchor": "end",
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
        fill: "#64748b",
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
          fill: "#475569",
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
      const colorIndex = defaultColourMap(value, maxValue, colors.length);
      const fill = colors[colorIndex];

      const dayX =
        x + layout.leftLabelWidth + weekIndex * (layout.cellSize + layout.gap);
      const dayY =
        y + layout.gridTop + dayIndex * (layout.cellSize + layout.gap);

      svg = svg.rect({
        x: dayX,
        y: dayY,
        width: layout.cellSize,
        height: layout.cellSize,
        rx: 3,
        ry: 3,
        fill,
      });
    }
  }

  const legendStartX = x + layout.leftLabelWidth;
  const legendY = y + layout.legendY;

  svg = svg.text(
    {
      x: legendStartX,
      y: legendY + 10,
      fill: "#64748b",
      "font-size": 10,
      "font-weight": 600,
      "font-family": fontFamily,
    },
    caption("Less"),
  );

  for (let i = 0; i < colors.length; i += 1) {
    const legendX = legendStartX + 28 + i * (layout.cellSize + 3);
    svg = svg.rect({
      x: legendX,
      y: legendY,
      width: layout.cellSize,
      height: layout.cellSize,
      rx: 3,
      ry: 3,
      fill: colors[i],
    });
  }

  svg = svg.text(
    {
      x: legendStartX + 28 + colors.length * (layout.cellSize + 3) + 6,
      y: legendY + 10,
      fill: "#64748b",
      "font-size": 10,
      "font-weight": 600,
      "font-family": fontFamily,
    },
    caption("More"),
  );

  const rightColumnX = rightEdge;
  const leftSecondaryX = leftColumnX + 250;
  const rightPrimaryX = rightColumnX - 160;

  const leftRows: ModelUsageRow[] = [];

  if (insights?.mostUsedModel) {
    leftRows.push({ caption: "Most used model", data: insights.mostUsedModel });
  }

  if (insights?.recentMostUsedModel) {
    leftRows.push({
      caption: "Recent use (last 30 days)",
      data: insights.recentMostUsedModel,
    });
  }

  for (const [index, row] of leftRows.entries()) {
    const captionY = layout.footerCaptionY;
    const valueY = layout.footerValueY;
    const modelName = truncateText(row.data.name, 20);
    const modelX = index === 0 ? leftColumnX : leftSecondaryX;
    const tokenLabel = `(${formatTokenTotal(row.data.tokens.total)})`;

    svg = svg.text(
      {
        x: modelX,
        y: y + captionY,
        fill: "#64748b",
        "font-size": 9,
        "font-weight": 600,
        "font-family": fontFamily,
      },
      caption(row.caption),
    );

    svg = svg.text(
      {
        x: modelX,
        y: y + valueY,
        "font-family": fontFamily,
      },
      `<tspan fill="#0f172a" font-size="12" font-weight="600">${escapeXml(modelName)}</tspan><tspan dx="6" fill="#64748b" font-size="11" font-weight="400">${tokenLabel}</tspan>`,
    );
  }

  svg = svg.text(
    {
      x: rightPrimaryX,
      y: y + layout.footerCaptionY,
      fill: "#64748b",
      "font-size": 9,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    caption("Longest streak"),
  );

  svg = svg.text(
    {
      x: rightPrimaryX,
      y: y + layout.footerValueY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    `${numberFormatter.format(longestStreak)} days`,
  );

  svg = svg.text(
    {
      x: rightColumnX,
      y: y + layout.footerCaptionY,
      fill: "#64748b",
      "font-size": 9,
      "font-weight": 600,
      "text-anchor": "end",
      "font-family": fontFamily,
    },
    caption("Current streak"),
  );

  svg = svg.text(
    {
      x: rightColumnX,
      y: y + layout.footerValueY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "text-anchor": "end",
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
}: RenderUsageHeatmapsSvgOptions) {
  const allDays = getAllDays(startDate, endDate);
  const grid = getCalendarGrid(startDate, endDate);
  const layout = getSectionLayout(grid.weeks.length);
  const outerPadding = 18;
  const sectionGap = 40;

  const width = outerPadding * 2 + layout.width;
  const height =
    outerPadding * 2 +
    sections.length * layout.height +
    Math.max(sections.length - 1, 0) * sectionGap;

  let svg = svgBuilder
    .create()
    .width(width)
    .height(height)
    .viewBox(`0 0 ${width} ${height}`)
    .rect({ x: 0, y: 0, width, height, fill: "#ffffff" });

  sections.forEach((section, index) => {
    const sectionY = outerPadding + index * (layout.height + sectionGap);
    svg = drawHeatmapSection(svg, {
      x: outerPadding,
      y: sectionY,
      allDays,
      grid,
      layout,
      daily: section.daily,
      insights: section.insights,
      title: section.title,
      colors: section.colors,
    });
  });

  return svg.render();
}
