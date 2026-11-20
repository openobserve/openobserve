import { toZonedTime } from "date-fns-tz";
import {
  classicColorPaletteLightTheme,
  classicColorPaletteDarkTheme,
} from "@/utils/dashboard/colorPalette";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import {
  chartBg,
  chartSeriesPrimary,
  chartAxisLine,
  chartCrosshairLabel,
  chartGridLine,
  chartTextColor,
  chartTooltipStyle,
  dataZoomBrushStyle,
} from "@/utils/chartTheme";
import { resolveSeverityFieldValue } from "@/utils/logs/statusParser";
import { BREAKDOWN_EMPTY_LABEL, BREAKDOWN_EMPTY_VALUE } from "@/utils/logs/constants";

export const convertLogData = (
  x: any,
  y: any,
  params: {
    title: any;
    unparsed_x_data: any;
    timezone: string;
    itemStyle?: any;
    modern?: boolean;
  },
) => {
  const modern = !!params.modern;
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
      // `containLabel` skips the half of the top y label above its tick, so keep room for it.
      top: "6",
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
      ...(modern ? chartTooltipStyle() : { textStyle: { fontSize: 12 } }),
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontSize: 12,
          ...(modern ? chartCrosshairLabel() : {}),
        },
      },
    },
    xAxis: {
      type: "time",
      ...(modern ? MODERN_X_AXIS() : {}),
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: !modern,
      },
      ...(modern ? { splitLine: modernSplitLine() } : {}),
      axisPointer: {
        label: {
          precision: 0,
        },
      },
      ...countAxisTicks(Math.max(0, ...[...y].map((v: any) => Number(v) || 0))),
      axisLabel: {
        formatter: formatCountAxisLabel,
        ...(modern ? modernAxisLabel() : {}),
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
        ...(modern ? MODERN_BAR_LAYOUT : {}),
        emphasis: { focus: "series" },
        itemStyle: params.itemStyle
          ? params.itemStyle
          : {
              color: chartSeriesPrimary(),
              ...(modern ? MODERN_BAR_STYLE : {}),
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
// Light steps are darker so each bar keeps 3:1 on the card at 0.85 opacity.
const SEMANTIC_COLORS_LIGHT: Record<string, string> = {
  // severity / log_level / level — severity axis
  fatal: "#E53935",
  emergency: "#E53935",
  alert: "#ea580c",
  critical: "#F4511E",
  error: "#D64541",
  warn: "#B8650A",
  warning: "#B8650A",
  notice: "#16a34a",
  // Info is most of the volume, so it is the softest hue; warn and error stay strong enough to stand out against it.
  info: "#5E95DE",
  debug: "#0E8A99",
  trace: "#90A4AE",
  // status — job/task pipeline axis
  failure: "#D64541",
  timeout: "#FF7043",
  cancelled: "#9E9E9E",
  pending: "#FFC107",
  success: "#43A047",
  ok: "#43A047",
};

export const SEMANTIC_COLORS_DARK: Record<string, string> = {
  fatal: "#E07070",
  emergency: "#E07070",
  alert: "#ea580c",
  critical: "#DC6030",
  error: "#D95C5C",
  warn: "#D4944A",
  warning: "#D4944A",
  notice: "#16a34a",
  info: "#5B8FD0",
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

export const formatCountAxisLabel = (value: number): string =>
  Math.abs(value) < 1_000 ? String(value) : formatUnitValue(getUnitValue(value, "numbers", "", 0));

// Rounds up to an even count of compact units (9.1K -> 10K), so max and mid ticks need no decimals.
export const compactCeil = (max: number): number => {
  if (!(max > 0)) return 2;
  const unit = 1000 ** Math.max(0, Math.floor(Math.log10(max) / 3));
  return Math.ceil(max / (2 * unit)) * 2 * unit;
};

// Three ticks (0, mid, max): fixed interval, because ECharts' nice-number split skips the mid for maxes like 8K.
const countAxisTicks = (dataMax: number) => {
  const max = compactCeil(dataMax);
  return { min: 0, max, interval: max / 2 };
};

// Full strength: the cyan series-1 bar at 0.85 drops under 3:1 on the light card.
const MODERN_BAR_STYLE = { borderRadius: [2, 2, 0, 0] };
// A time axis with many buckets would otherwise shrink bars to hairlines.
const MODERN_BAR_LAYOUT = { barCategoryGap: "15%", barMinWidth: 2 };

// Canvas cannot read CSS, so the axis colors follow the tokens resolved at call time.
const modernAxisLabel = () => ({ color: chartTextColor(), fontSize: 11 });
const modernSplitLine = () => ({
  show: true,
  lineStyle: { color: chartGridLine(), type: "dashed", width: 1 },
});
const MODERN_X_AXIS = () => ({
  axisLabel: { ...modernAxisLabel(), margin: 3 },
  axisLine: { lineStyle: { color: chartAxisLine() } },
  axisTick: { show: false },
});

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
  params: { title: any; timezone: string; breakdownField?: string | null; modern?: boolean },
  isDarkTheme: boolean,
): { options: any } => {
  const modern = !!params.modern;
  const palette = isDarkTheme ? classicColorPaletteDarkTheme : classicColorPaletteLightTheme;

  // ECharts stacks the first series at the bottom: severities stack error, warn, info, debug, so errors form the baseline.
  const SEVERITY_RANK: Record<string, number> = {
    fatal: 0, critical: 0, error: 1, err: 1, warn: 2, warning: 2, info: 3, debug: 4, trace: 5,
  };
  const rank = (c: unknown) => SEVERITY_RANK[String(c ?? "").trim().toLowerCase()] ?? 9;
  const entries = [...breakdownSeries.entries()];
  const ordered = entries.some(([c]) => rank(c) < 9)
    ? [...entries].sort(([a], [b]) => rank(a) - rank(b))
    : entries;

  const series = ordered.map(([category, values]) => {
    // Explicit check so a numeric 0 stays a real category; case is kept as the source sent it.
    const isEmpty =
      category === null || category === undefined || category === BREAKDOWN_EMPTY_VALUE;
    const label = isEmpty ? BREAKDOWN_EMPTY_LABEL : String(category);
    return {
      name: label,
      type: "bar",
      stack: "total",
      ...(modern ? MODERN_BAR_LAYOUT : {}),
      emphasis: { focus: "series" },
      data: xData.map((ts, i) => [
        params.timezone !== "UTC" ? toZonedTime(ts, params.timezone) : ts,
        values[i] ?? 0,
      ]),
      itemStyle: {
        color: isEmpty
          ? chartSeriesPrimary()
          : getSemanticColor(label, isDarkTheme, palette, params.breakdownField),
        ...(modern ? MODERN_BAR_STYLE : {}),
        // A card-colour seam between stacked segments, so adjacent levels are not told apart by hue alone.
        ...(modern ? { borderColor: chartBg(), borderWidth: 1 } : {}),
      },
    };
  });

  const tooltipStyle = chartTooltipStyle();
  const textColor = tooltipStyle.textStyle.color || (isDarkTheme ? "#e0e0e0" : "#222");

  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  return {
    options: {
      backgroundColor: "transparent",
      grid: {
        containLabel: true,
        left: "20",
        right: "20",
        // A breakdown's legend sits on one line at the top right, so the axis keeps the bottom.
        top: series.length > 1 ? "22" : "6",
        bottom: "5",
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
          "max-width: min(25rem, calc(100vw - 1.5rem)) !important; max-height: 20vh !important; overflow-y: auto !important; overflow-x: hidden !important; white-space: normal !important;",
        ...tooltipStyle,
        textStyle: { fontSize: 12, color: textColor },
        axisPointer: {
          type: "cross",
          label: { show: true, fontSize: 12, ...(modern ? chartCrosshairLabel() : {}) },
        },
        formatter: (tooltipParams: any[]) => {
          if (!tooltipParams?.length) return "";

          let html = `<div style="min-width:11.875rem;padding:0.25rem 0;">`;
          // eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel rule must not scale with text or it smears at fractional zoom
          html += `<div style="font-size:0.6875rem;font-weight:500;opacity:0.65;padding:0 0.625rem 0.25rem;margin-bottom:0;border-bottom:1px solid rgba(128,128,128,0.15);color:${textColor}">${esc(tooltipParams[0].axisValueLabel)}</div>`;

          // A breakdown field can have dozens of values; listing the empty ones buries the few with data.
          tooltipParams
            .filter((p: any) => Number(p.value?.[1]) > 0)
            .forEach((p: any) => {
              html += `
              <div style="display:flex;align-items:center;gap:0.375rem;padding:0.0625rem 0.625rem;">
                ${p.marker}
                <span title="${esc(p.seriesName)}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${textColor};font-size:0.75rem">${esc(p.seriesName)}</span>
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
        top: 0,
        right: 16,
        padding: [0, 5],
        // Small square swatches and quiet axis-coloured labels, so the key reads as a caption, not a row of bars.
        icon: "roundRect",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        type: "scroll",
        // An all-caps level (DEBUG, INFO) shows as a word; other breakdown values keep their case.
        formatter: (name: string) =>
          /^[A-Z]{2,}$/.test(name) ? name.charAt(0) + name.slice(1).toLowerCase() : name,
        // ECharts measures legend text on canvas, so the width is a pixel number.
        textStyle: {
          fontSize: 11,
          width: 120,
          overflow: "truncate",
          ...(modern ? { color: modernAxisLabel().color } : {}),
        },
        tooltip: { show: true },
      },
      xAxis: { type: "time", ...(modern ? MODERN_X_AXIS() : {}) },
      yAxis: {
        type: "value",
        axisLine: { show: !modern },
        ...(modern ? { splitLine: modernSplitLine() } : {}),
        axisPointer: { label: { precision: 0 } },
        ...countAxisTicks(
          Math.max(
            0,
            ...xData.map((_, i) =>
              [...breakdownSeries.values()].reduce((sum, v) => sum + (v[i] ?? 0), 0),
            ),
          ),
        ),
        axisLabel: {
          formatter: formatCountAxisLabel,
          ...(modern ? modernAxisLabel() : {}),
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
