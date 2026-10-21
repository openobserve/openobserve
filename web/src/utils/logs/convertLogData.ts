import { toZonedTime } from "date-fns-tz";
import {
  classicColorPaletteLightTheme,
  classicColorPaletteDarkTheme,
} from "@/utils/dashboard/colorPalette";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { dataZoomBrushStyle } from "@/utils/chartTheme";
import { resolveSeverityFieldValue } from "@/utils/logs/statusParser";
import { BREAKDOWN_EMPTY_LABEL, BREAKDOWN_EMPTY_VALUE } from "@/utils/logs/constants";
import { getDefaultTheme } from "@/constants/themes";

export const convertLogData = (
  x: any,
  y: any,
  params: {
    title: any;
    unparsed_x_data: any;
    timezone: string;
    itemStyle?: any;
  },
) => {
  const options: any = {
    title: {
      left: "center",
      textStyle: {
        fontSize: 12,
        fontWeight: "normal",
      },
    },
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      // 8 rather than 5: `containLabel` reserves room for the axis labels but
      // not for the half of the topmost y-axis label that sits above its tick,
      // which clipped that number against the top of the histogram strip.
      top: "8",
      bottom: "5",
    },
    tooltip: {
      show: true,
      trigger: "axis",
      // Render the tooltip on <body> so it overflows the short (6.25rem)
      // histogram strip instead of being clipped by the scroll container's
      // overflow. confine:false lets it extend past the chart bounds.
      appendToBody: true,
      confine: false,
      textStyle: {
        fontSize: 12,
      },
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
        },
      },
    },
    xAxis: {
      type: "time",
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: true,
      },
      axisPointer: {
        label: {
          precision: 0,
        },
      },
      splitNumber: 3,
      axisLabel: {
        formatter: function (value: any) {
          return formatUnitValue(getUnitValue(value, "numbers", "", 2));
        },
      },
    },
    toolbox: {
      orient: "vertical",
      show: true,
      showTitle: false,
      tooltip: {
        show: false,
      },
      itemSize: 0,
      itemGap: 0,
      // it is used to hide toolbox buttons
      bottom: "100%",
      feature: {
        dataZoom: {
          brushStyle: dataZoomBrushStyle(),
          show: true,
          yAxisIndex: "none",
        },
      },
    },
    series: [
      {
        data: [...x].map((it: any, index: any) => [
          params.timezone != "UTC" ? toZonedTime(it, params.timezone) : it,
          y[index] || 0,
        ]),
        type: "bar",
        emphasis: { focus: "series" },
        itemStyle: params.itemStyle
          ? params.itemStyle
          : {
              // Reads the applied `dark` class because this runs outside component scope, where useTheme() is unavailable.
              color: getThemeAccentColor(document.documentElement.classList.contains("dark")),
            },
      },
    ],
  };
  return { options };
};

export const formatDate = (date: any) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const getSeriesHash = (seriesName: string, palette: string[]): number => {
  let hash = 0;
  if (seriesName.length === 0) return 0;
  for (let i = 0; i < seriesName.length; i++) {
    const char = seriesName.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash) % palette.length;
};

// Semantic colors for recognized log-level / status categories.
// Keys are lowercase; lookup normalizes the category before matching.
// Must stay aligned with STATUS_COLORS / STATUS_COLORS_DARK in statusParser.ts.
const SEMANTIC_COLORS_LIGHT: Record<string, string> = {
  // severity / log_level / level — severity axis
  fatal: "#E53935",
  emergency: "#E53935",
  alert: "#ea580c",
  critical: "#F4511E",
  error: "#EF5350",
  warn: "#FB8C00",
  warning: "#FB8C00",
  notice: "#16a34a",
  info: "#1E88E5",
  debug: "#00ACC1",
  trace: "#90A4AE",
  // status — job/task pipeline axis
  failure: "#EF5350",
  timeout: "#FF7043",
  cancelled: "#9E9E9E",
  pending: "#FFC107",
  success: "#43A047",
  ok: "#43A047",
};

const SEMANTIC_COLORS_DARK: Record<string, string> = {
  fatal: "#E07070",
  emergency: "#E07070",
  alert: "#ea580c",
  critical: "#DC6030",
  error: "#D95C5C",
  warn: "#D4944A",
  warning: "#D4944A",
  notice: "#16a34a",
  info: "#4D8FD4",
  debug: "#3DAAB8",
  trace: "#7A9BAA",
  failure: "#D95C5C",
  timeout: "#D47845",
  cancelled: "#909090",
  pending: "#D4A83A",
  success: "#4DAD55",
  ok: "#4DAD55",
};

export const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
};

// The applied theme writes the accent on <body> in dark mode and on <html> in light mode.
const getThemeAccentColor = (isDarkMode: boolean): string => {
  const target = isDarkMode ? document.body : document.documentElement;
  const accent = getComputedStyle(target).getPropertyValue("--color-theme-accent").trim();
  return accent || getDefaultTheme()[isDarkMode ? "dark" : "light"].themeColor;
};

const getSemanticColor = (
  label: unknown,
  isDarkTheme: boolean,
  fallbackPalette: string[],
  breakdownField?: string | null,
): string => {
  const map = isDarkTheme ? SEMANTIC_COLORS_DARK : SEMANTIC_COLORS_LIGHT;
  const lowerLabel = String(label ?? "")
    .trim()
    .toLowerCase();

  if (Object.hasOwn(map, lowerLabel)) return map[lowerLabel];

  const resolved = breakdownField ? resolveSeverityFieldValue(breakdownField, label) : null;
  if (resolved && map[resolved.level]) return map[resolved.level];

  return fallbackPalette[getSeriesHash(String(label), fallbackPalette)];
};

export const convertStackedLogData = (
  xData: number[],
  breakdownSeries: Map<string, number[]>,
  params: { title: any; timezone: string; breakdownField?: string | null },
  isDarkTheme: boolean,
): { options: any } => {
  const palette = isDarkTheme ? classicColorPaletteDarkTheme : classicColorPaletteLightTheme;

  const series = [...breakdownSeries.entries()].map(([category, values]) => {
    // Explicit check so a numeric 0 stays a real category; case is kept as the source sent it.
    const isEmpty =
      category === null || category === undefined || category === BREAKDOWN_EMPTY_VALUE;
    const label = isEmpty ? BREAKDOWN_EMPTY_LABEL : String(category);
    return {
      name: label,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      data: xData.map((ts, i) => [
        params.timezone !== "UTC" ? toZonedTime(ts, params.timezone) : ts,
        values[i] ?? 0,
      ]),
      itemStyle: {
        color: isEmpty
          ? getThemeAccentColor(isDarkTheme)
          : getSemanticColor(label, isDarkTheme, palette, params.breakdownField),
      },
    };
  });

  const textColor = isDarkTheme ? "#e0e0e0" : "#222";

  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return {
    options: {
      backgroundColor: "transparent",
      grid: {
        containLabel: true,
        left: "20",
        right: "20",
        // Matches convertLogData: 3 extra pixels so the topmost y-axis number
        // is not clipped by the top of the histogram strip.
        top: "8",
        bottom: series.length > 1 ? "20" : "5",
      },
      tooltip: {
        show: true,
        trigger: "axis",
        appendToBody: true,
        confine: false,
        enterable: true,
        // Cap the ECharts tooltip container at 20vh and let it scroll
        // vertically when a high-cardinality breakdown overflows.
        // !important is required because ECharts writes inline styles.
        extraCssText:
          "max-height: 20vh !important; overflow-y: auto !important; overflow-x: hidden !important; white-space: normal !important;",
        backgroundColor: isDarkTheme ? "#1e1e2e" : "#ffffff",
        borderColor: isDarkTheme ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
        textStyle: { fontSize: 12, color: textColor },
        axisPointer: {
          type: "cross",
          label: { show: true, fontSize: 12 },
        },
        formatter: (tooltipParams: any[]) => {
          if (!tooltipParams?.length) return "";

          let html = `<div style="min-width:11.875rem;padding:0.25rem 0;">`;
          // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
          html += `<div style="font-size:0.6875rem;font-weight:500;opacity:0.65;padding:0 0.625rem 0.25rem;margin-bottom:0;border-bottom:1px solid rgba(128,128,128,0.15);color:${textColor}">${esc(tooltipParams[0].axisValueLabel)}</div>`;

          tooltipParams.forEach((p: any) => {
            html += `
              <div style="display:flex;align-items:center;gap:0.375rem;padding:0.0625rem 0.625rem;">
                ${p.marker}
                <span style="flex:1;color:${textColor};font-size:0.75rem">${esc(p.seriesName)}</span>
                <span style="font-weight:600;color:${textColor};min-width:2rem;text-align:right;font-size:0.75rem">${esc(formatCount(p.value[1]))}</span>
              </div>`;
            // p.marker is ECharts-generated HTML (a colored dot span) — intentionally not escaped
          });

          html += `</div>`;
          return html;
        },
      },
      legend: {
        show: series.length > 1,
        bottom: 0,
        type: "scroll",
        textStyle: { fontSize: 11 },
      },
      xAxis: { type: "time" },
      yAxis: {
        type: "value",
        axisLine: { show: true },
        axisPointer: { label: { precision: 0 } },
        splitNumber: 3,
        axisLabel: {
          formatter: (value: number) => formatUnitValue(getUnitValue(value, "numbers", "", 2)),
        },
      },
      toolbox: {
        orient: "vertical",
        show: true,
        showTitle: false,
        tooltip: { show: false },
        itemSize: 0,
        itemGap: 0,
        bottom: "100%",
        feature: {
          dataZoom: {
            brushStyle: dataZoomBrushStyle(),
            show: true,
            yAxisIndex: "none",
          },
        },
      },
      series,
    },
  };
};
