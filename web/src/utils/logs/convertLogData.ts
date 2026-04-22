import { toZonedTime } from "date-fns-tz";
import {
  classicColorPaletteLightTheme,
  classicColorPaletteDarkTheme,
} from "@/utils/dashboard/colorPalette";

export const convertLogData = (
  x: any,
  y: any,
  params: {
    title: any;
    unparsed_x_data: any;
    timezone: string;
    itemStyle: any;
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
      top: "5",
      bottom: "0",
    },
    tooltip: {
      show: true,
      trigger: "axis",
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
      // show three tick marks: 0, mid, max
      interval: y.reduce((a: number, b: number) => Math.max(a, b), 0) / 2,
      axisLabel: {
        formatter: function (value: any) {
          return Math.round(value);
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
              color: (() => {
                const isDarkMode = document.body.classList.contains('body--dark');
                if (isDarkMode) {
                  return getComputedStyle(document.body)
                    .getPropertyValue("--o2-dark-theme-color")
                    .trim();
                } else {
                  return getComputedStyle(document.documentElement)
                    .getPropertyValue("--o2-theme-color")
                    .trim();
                }
              })(),
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
const SEMANTIC_COLORS_LIGHT: Record<string, string> = {
  // severity / log_level / level — severity axis
  fatal:     "#E53935",
  critical:  "#F4511E",
  error:     "#EF5350",
  warn:      "#FB8C00",
  warning:   "#FB8C00",
  info:      "#1E88E5",
  debug:     "#00ACC1",
  trace:     "#90A4AE",
  // status — job/task pipeline axis
  failure:   "#EF5350",
  timeout:   "#FF7043",
  cancelled: "#9E9E9E",
  pending:   "#FFC107",
  success:   "#43A047",
  // untagged
  "(empty)": "#BDBDBD",
};

const SEMANTIC_COLORS_DARK: Record<string, string> = {
  fatal:     "#E07070",
  critical:  "#DC6030",
  error:     "#D95C5C",
  warn:      "#D4944A",
  warning:   "#D4944A",
  info:      "#4D8FD4",
  debug:     "#3DAAB8",
  trace:     "#7A9BAA",
  failure:   "#D95C5C",
  timeout:   "#D47845",
  cancelled: "#909090",
  pending:   "#D4A83A",
  success:   "#4DAD55",
  "(empty)": "#707070",
};

export const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
};

const getSemanticColor = (
  label: string,
  isDarkTheme: boolean,
  fallbackPalette: string[],
): string => {
  const map = isDarkTheme ? SEMANTIC_COLORS_DARK : SEMANTIC_COLORS_LIGHT;
  return map[label.toLowerCase()] ?? fallbackPalette[getSeriesHash(label, fallbackPalette)];
};

export const convertStackedLogData = (
  xData: number[],
  breakdownSeries: Map<string, number[]>,
  params: { title: any; timezone: string; breakdownField?: string | null },
  isDarkTheme: boolean,
): { options: any } => {
  const palette = isDarkTheme
    ? classicColorPaletteDarkTheme
    : classicColorPaletteLightTheme;

  const series = [...breakdownSeries.entries()].map(([category, values]) => {
    const label = category || "(empty)";
    const displayLabel = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
    return {
      name: displayLabel,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      data: xData.map((ts, i) => [
        params.timezone !== "UTC" ? toZonedTime(ts, params.timezone) : ts,
        values[i] ?? 0,
      ]),
      itemStyle: {
        color: getSemanticColor(label, isDarkTheme, palette),
      },
    };
  });

  const textColor  = isDarkTheme ? "#e0e0e0" : "#222";
  const rowHoverBg = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const esc = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return {
    options: {
      backgroundColor: "transparent",
      grid: {
        containLabel: true,
        left: "20",
        right: "20",
        top: "5",
        bottom: "20",
      },
      tooltip: {
        show: true,
        trigger: "axis",
        appendToBody: true,
        confine: false,
        enterable: true,
        backgroundColor: isDarkTheme ? "#1e1e2e" : "#ffffff",
        borderColor: isDarkTheme ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
        textStyle: { fontSize: 12, color: textColor },
        axisPointer: {
          type: "cross",
          label: { show: true, fontSize: 12 },
        },
        formatter: (tooltipParams: any[]) => {
          if (!tooltipParams?.length) return "";

          // Inject a scoped hover style — avoids inline event handlers which
          // are blocked by strict CSP and are a code-quality antipattern.
          let html = `
            <style>
              .oo-tt-row:hover { background: ${rowHoverBg}; }
            </style>
            <div style="min-width:190px;padding:4px 0;">`;

          html += `<div style="font-size:11px;font-weight:500;opacity:0.65;padding:0 10px 4px;margin-bottom:0;border-bottom:1px solid rgba(128,128,128,0.15);color:${textColor}">${esc(tooltipParams[0].axisValueLabel)}</div>`;

          tooltipParams.forEach((p: any) => {
            html += `
              <div class="oo-tt-row" style="display:flex;align-items:center;gap:6px;padding:1px 10px;">
                ${p.marker}
                <span style="flex:1;color:${textColor};font-size:12px">${esc(p.seriesName)}</span>
                <span style="font-weight:600;color:${textColor};min-width:32px;text-align:right;font-size:12px">${esc(formatCount(p.value[1]))}</span>
              </div>`;
            // p.marker is ECharts-generated HTML (a colored dot span) — intentionally not escaped
          });

          html += `</div>`;
          return html;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        type: "scroll",
        textStyle: { fontSize: 11 },
      },
      xAxis: { type: "time" },
      yAxis: {
        type: "value",
        axisLine: { show: true },
        axisPointer: { label: { precision: 0 } },
        axisLabel: {
          formatter: (value: number) => Math.round(value).toString(),
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
        feature: { dataZoom: { show: true, yAxisIndex: "none" } },
      },
      series,
    },
  };
};
