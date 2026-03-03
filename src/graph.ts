import svgBuilder from "svg-builder";
import type { CliDailyRow, ProviderId } from "./lib/interfaces";
import { formatLocalDate } from "./lib/utils";

type SvgBuilder = ReturnType<typeof svgBuilder.create>;

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
  titleY: number;
  monthLabelY: number;
  legendY: number;
}

interface DrawHeatmapSectionOptions {
  x: number;
  y: number;
  grid: CalendarGrid;
  layout: SectionLayout;
  daily: CliDailyRow[];
  title: string;
  colors: string[];
}

interface RenderUsageHeatmapsSvgSection {
  daily: CliDailyRow[];
  title: string;
  colors: string[];
}

interface RenderUsageHeatmapsSvgOptions {
  startDate: string;
  endDate: string;
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

function getAllDays(start: string, end: string) {
  const days: string[] = [];
  let curr = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  while (curr <= endDate) {
    days.push(formatLocalDate(curr));
    curr.setDate(curr.getDate() + 1);
  }

  return days;
}

function getMondayBasedWeekday(dateIso: string) {
  const sundayBased = new Date(`${dateIso}T00:00:00`).getDay();
  return (sundayBased + 6) % 7;
}

function padToWeekStartMonday(days: string[]): (string | null)[] {
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

  return new Date(`${lastDay}T00:00:00`).toLocaleString("en-US", { month: "short" });
}

function defaultColourMap(value: number, max: number, colorCount: number) {
  if (colorCount <= 0) return 0;
  if (max <= 0 || value <= 0) return 0;

  const index = Math.ceil((value / max) * (colorCount - 1));
  return Math.min(Math.max(index, 0), colorCount - 1);
}

function getCalendarGrid(startDate: string, endDate: string) {
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
  const cellSize = 14;
  const gap = 4;
  const leftLabelWidth = 34;
  const rightPadding = 20;
  const topPadding = 40;
  const monthHeaderHeight = 20;
  const titleY = 16;
  const monthLabelY = topPadding + 4;
  const gridTop = topPadding + monthHeaderHeight;
  const gridHeight = 7 * cellSize + 6 * gap;
  const gridWidth = weekCount * cellSize + Math.max(weekCount - 1, 0) * gap;
  const legendY = gridTop + gridHeight + 10;
  const legendHeight = 30;
  const width = leftLabelWidth + gridWidth + rightPadding;
  const height = gridTop + gridHeight + legendHeight;

  return {
    width,
    height,
    gridTop,
    leftLabelWidth,
    cellSize,
    gap,
    titleY,
    monthLabelY,
    legendY,
  };
}

function drawHeatmapSection(
  svg: SvgBuilder,
  { x, y, grid, layout, daily, title, colors }: DrawHeatmapSectionOptions,
) {
  const valueByDate = new Map<string, number>(daily.map((row) => [row.date, row.totalTokens]));
  const maxValue = Math.max(...daily.map((row) => row.totalTokens), 0);

  svg = svg.text(
    {
      x: x + 8,
      y: y + layout.titleY,
      fill: "#0f172a",
      "font-size": 12,
      "font-weight": 600,
      "font-family": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    },
    title,
  );

  for (let i = 0; i < 7; i += 1) {
    const dayY = y + layout.gridTop + i * (layout.cellSize + layout.gap) + layout.cellSize / 2;

    svg = svg.text(
      {
        x: x + layout.leftLabelWidth - 6,
        y: dayY,
        fill: "#64748b",
        "font-size": 10,
        "text-anchor": "end",
        "dominant-baseline": "middle",
        "font-family": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      },
      daysOfWeekMonday[i],
    );
  }

  for (let weekIndex = 0; weekIndex < grid.weeks.length; weekIndex += 1) {
    const monthLabel = grid.monthLabels[weekIndex];

    if (monthLabel) {
      const monthX = x + layout.leftLabelWidth + weekIndex * (layout.cellSize + layout.gap);
      svg = svg.text(
        {
          x: monthX,
          y: y + layout.monthLabelY,
          fill: "#475569",
          "font-size": 10,
          "font-family": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
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

      const value = Math.max(valueByDate.get(day) ?? 0, 0);
      const colorIndex = defaultColourMap(value, maxValue, colors.length);
      const fill = colors[colorIndex];

      const dayX = x + layout.leftLabelWidth + weekIndex * (layout.cellSize + layout.gap);
      const dayY = y + layout.gridTop + dayIndex * (layout.cellSize + layout.gap);

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
      "font-family": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    },
    "Less",
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
      "font-family": "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    },
    "More",
  );

  return svg;
}

export function renderUsageHeatmapsSvg({
  startDate,
  endDate,
  sections,
}: RenderUsageHeatmapsSvgOptions) {
  const grid = getCalendarGrid(startDate, endDate);
  const layout = getSectionLayout(grid.weeks.length);
  const outerPadding = 12;
  const sectionGap = 28;

  const width = outerPadding * 2 + layout.width;
  const height =
    outerPadding * 2 + sections.length * layout.height + Math.max(sections.length - 1, 0) * sectionGap;

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
      grid,
      layout,
      daily: section.daily,
      title: section.title,
      colors: section.colors,
    });
  });

  return svg.render();
}
