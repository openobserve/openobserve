// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { format as echartsFormat } from "echarts/core";
import { chartAxisTextColor, chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { colorToRgba } from "./colorPalette";
import { getFieldLabel } from "./fieldLabel";
import { calculateWidthText } from "./chartDimensionUtils";
import { GAUGE_EMPTY_GROUP_NAME } from "./gaugeDial";
import { createSeriesOverrideLookup } from "./seriesOverrides";
import {
  echartsPaletteColor,
  getSeriesThresholds,
  resolveStepValues,
  type Thresholds,
} from "./thresholds";

export const BAR_GAUGE_MODES = ["gradient", "lcd", "basic"] as const;
export const BAR_GAUGE_ORIENTATIONS = ["horizontal", "vertical"] as const;
export const DEFAULT_BAR_GAUGE_MODE = "gradient";
export const DEFAULT_BAR_GAUGE_ORIENTATION = "horizontal";

const GRADIENT_START_ALPHA = 0.35;
const LCD_CELL_LENGTH = 6;
const LCD_CELL_GAP = 2;
const VALUE_LABEL_MAX = 160;
const VALUE_LABEL_DISTANCE = 5;
const NAME_LABEL_MAX = 160;
const NAME_LABEL_SHARE = 0.3;
const VALUE_LABEL_SHARE = 0.25;
const NAME_LABEL_MARGIN = 8;
const GRID_EDGE = 8;
const BAR_CATEGORY_GAP = "30%";
const VERTICAL_LABEL_GAP = 4;
const VERTICAL_LABEL_MIN = 24;
const FALLBACK_PANEL_WIDTH = 800;

/** One bar: a reduced series value on its own min..max range, in the colour the gauge converter gave it. */
export interface BarGaugeItem {
  name: string;
  /** The series display-name override, else the name; thresholds and drilldown keep matching `name`. */
  label: string;
  /** The row's own label value when `name` stands in for it, so drilldowns filter on what the data holds. */
  rawName?: string;
  value: number | null;
  min: number;
  max: number;
  color: string;
  text: string;
}

/** A stretch of the range drawn in one colour; without thresholds the whole range is one band. */
export interface BarGaugeBand {
  from: number;
  to: number;
  color: string;
}

/** The parts of a panel query the bar gauge reads: its value field name and whether it orders its own rows. */
interface BarGaugeQuery {
  customQuery?: boolean;
  query?: string;
  fields?: { x?: BarGaugeField[]; y?: BarGaugeField[] };
}

interface BarGaugeField {
  alias?: string;
  sortBy?: string | null;
  isDerived?: boolean;
}

/** A gauge dial as the gauge converters build it, tagged with its query by the multi-query merge. */
interface GaugeDial {
  type?: string;
  silent?: boolean;
  min?: unknown;
  max?: unknown;
  _queryIndex?: number;
  data?: {
    name?: unknown;
    rawName?: string;
    value?: unknown;
    detail?: { formatter?: (value: number) => unknown };
    itemStyle?: { color?: string };
  }[];
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const hasTopLevelOrderBy = (sql: string): boolean => {
  const code = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const orderBy = /order\s+by\b/iy;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    else if (depth === 0 && !/\w/.test(code[i - 1] ?? "")) {
      orderBy.lastIndex = i;
      if (orderBy.test(code)) return true;
    }
  }
  return false;
};

// Derived builder fields never reach ORDER BY, so their sortBy orders nothing.
const queryHasSort = (query: BarGaugeQuery | undefined): boolean =>
  query?.customQuery
    ? hasTopLevelOrderBy(String(query?.query ?? ""))
    : [...(query?.fields?.x ?? []), ...(query?.fields?.y ?? [])].some(
        (field) => !!field?.sortBy && !field?.isDerived,
      );

const compareNames = (a: string, b: string): number => {
  const numeric = a.trim() !== "" && b.trim() !== "" && Number.isFinite(+a) && Number.isFinite(+b);
  return numeric ? +a - +b : a.localeCompare(b, undefined, { numeric: true });
};

/** A bar gauge scales to its data unless the user picked a fixed range. */
export const isBarGaugeAutoRange = (
  queryConfig: { range_mode?: string | null } | null | undefined,
) => queryConfig?.range_mode !== "fixed";

/** Where a value sits on its own min..max, 0 at min and 1 at max, so each bar fills by its own query's range. */
export const barGaugeFraction = (value: number | null, min: number, max: number): number => {
  if (value === null) return 0;
  const span = max - min;
  if (!(span > 0)) return value >= max ? 1 : 0;
  return Math.min(1, Math.max(0, (value - min) / span));
};

/** The drilldown variables of a clicked bar, carrying its real value rather than the 0..1 fill it is drawn at. */
export const barGaugeDrilldownSeries = (params: {
  name?: string;
  data?: { rawName?: string; rawValue?: number | null };
}) => {
  const name = params?.data?.rawName ?? params?.name;
  return { __name: name, __value: params?.data?.rawValue ?? "", __axisValue: name };
};

/** The panel as a gauge for the gauge converters, with each query's unset range resolved to auto. */
export const barGaugeSchemaAsGauge = (panelSchema: any) => ({
  ...panelSchema,
  type: "gauge",
  queries: (panelSchema?.queries ?? []).map((query: any) =>
    isBarGaugeAutoRange(query?.config)
      ? { ...query, config: { ...query?.config, range_mode: "auto" } }
      : query,
  ),
});

/** The bars behind gauge options: one per dial, named by its label or else its query's value field. */
export const barGaugeItems = (gaugeOptions: any, panelSchema: any): BarGaugeItem[] => {
  const queries: BarGaugeQuery[] = panelSchema?.queries ?? [];
  const promql = panelSchema?.queryType === "promql";
  const fallbackNames = queries.map((query) => {
    const yField = query?.fields?.y?.[0];
    return getFieldLabel(yField, panelSchema?.config, query?.customQuery) || yField?.alias || "";
  });
  const noValue = String(panelSchema?.config?.no_value_replacement ?? "");
  const series: GaugeDial[] = Array.isArray(gaugeOptions?.series) ? gaugeOptions.series : [];
  const overrides = createSeriesOverrideLookup(panelSchema?.config);
  // Silent gauges are the display-name title overlays the gauge overrides add, not dials.
  const dials = series
    .filter((gauge) => gauge?.type === "gauge" && !gauge.silent && gauge?.data?.[0])
    .map((gauge) => {
      const item = gauge.data?.[0] ?? {};
      const queryIndex = gauge._queryIndex ?? 0;
      const value = toNumber(item.value);
      const formatter = item.detail?.formatter;
      const text =
        value === null
          ? noValue
          : typeof formatter === "function"
            ? String(formatter(value))
            : String(value);
      // Only an unlabelled dial is blank here: no label field, no rows, or a PromQL legend that resolved to nothing.
      const name = String(item.name ?? "") || (fallbackNames[queryIndex] ?? "");
      const shown = String(overrides.displayName(name));
      return {
        queryIndex,
        item: {
          name,
          label: shown.trim() ? shown : GAUGE_EMPTY_GROUP_NAME,
          rawName: item.rawName,
          value,
          min: toNumber(gauge.min) ?? 0,
          max: toNumber(gauge.max) ?? 100,
          color: item.itemStyle?.color,
          text,
        },
      };
    });
  // An aggregate without ORDER BY comes back in any order, so name order keeps a refreshing panel steady.
  const keepOrder = queries.map((query) => promql || queryHasSort(query));
  dials.sort((a, b) =>
    a.queryIndex !== b.queryIndex
      ? a.queryIndex - b.queryIndex
      : keepOrder[a.queryIndex]
        ? 0
        : compareNames(a.item.name, b.item.name),
  );
  return dials.map(({ item }, index) => ({
    ...item,
    color: item.color || echartsPaletteColor(index),
  }));
};

/** The colour bands of one bar's range from its threshold steps; the part below the first step takes the base colour. */
export const barGaugeBands = (
  item: BarGaugeItem,
  thresholds: Thresholds | null,
  index: number,
): BarGaugeBand[] => {
  if (!thresholds) return [{ from: item.min, to: item.max, color: item.color }];
  const bands: BarGaugeBand[] = [];
  let from = item.min;
  let color = thresholds.baseColor ?? echartsPaletteColor(index);
  for (const step of thresholds.steps) {
    if (step.value > from && step.value < item.max) {
      bands.push({ from, to: step.value, color });
      from = step.value;
    }
    if (step.value <= item.max) color = step.color;
  }
  bands.push({ from, to: item.max, color });
  return bands;
};

const gradientFill = (
  item: BarGaugeItem,
  bands: BarGaugeBand[],
  horizontal: boolean,
): Record<string, unknown> => {
  // The bar stops at the track ends, so the stops sit on the value clamped to the range.
  const value = Math.min(Math.max(item.value ?? item.min, item.min), item.max);
  const span = value - item.min;
  const shown = bands.filter((band) => band.from < value || band.from === item.min);
  const colorStops =
    shown.length > 1 && span > 0
      ? shown.map((band) => ({ offset: (band.from - item.min) / span, color: band.color }))
      : [{ offset: 0, color: colorToRgba(item.color, GRADIENT_START_ALPHA) }];
  colorStops.push({ offset: 1, color: item.color });
  return {
    type: "linear",
    x: 0,
    y: horizontal ? 0 : 1,
    x2: horizontal ? 1 : 0,
    y2: 0,
    colorStops,
  };
};

const lcdSeries = (
  items: BarGaugeItem[],
  bandsByItem: BarGaugeBand[][],
  horizontal: boolean,
  showUnfilled: boolean,
) => {
  const cell = {
    type: "pictorialBar",
    symbol: "rect",
    symbolRepeat: "fixed",
    symbolMargin: LCD_CELL_GAP,
    symbolSize: horizontal ? [LCD_CELL_LENGTH, "70%"] : ["70%", LCD_CELL_LENGTH],
    symbolClip: true,
    symbolBoundingData: 1,
    barGap: "-100%",
    barCategoryGap: BAR_CATEGORY_GAP,
    silent: true,
    tooltip: { show: false },
    animation: false,
  };
  const bandCount = Math.max(...bandsByItem.map((bands) => bands.length));
  // Each band is drawn from the axis start, so lower bands sit on top and hide the higher ones' first cells.
  const lit = Array.from({ length: bandCount }, (_unused, band) => ({
    ...cell,
    z: 3 + bandCount - band,
    data: items.map((item, index) => {
      const range = bandsByItem[index][band];
      if (!range || item.value === null || item.value <= range.from) return "-";
      return {
        value: barGaugeFraction(Math.min(item.value, range.to), item.min, item.max),
        itemStyle: { color: range.color },
      };
    }),
  }));
  const unlit = showUnfilled
    ? [
        {
          ...cell,
          z: 2,
          data: items.map(() => ({
            value: 1,
            itemStyle: { color: chartColor("--color-border-subtle") },
          })),
        },
      ]
    : [];
  return [...unlit, ...lit];
};

/** Converts gauge-converted options into a bar gauge: one bar per dial, coloured by its thresholds. */
export const convertBarGaugeData = (gaugeOptions: any, panelSchema: any, panelWidth?: number) => {
  const config = panelSchema?.config ?? {};
  const items = barGaugeItems(gaugeOptions, panelSchema);
  if (!items.length) return { series: [] };
  const mode = (BAR_GAUGE_MODES as readonly string[]).includes(config.bar_gauge_mode)
    ? config.bar_gauge_mode
    : DEFAULT_BAR_GAUGE_MODE;
  const horizontal = (config.bar_gauge_orientation ?? DEFAULT_BAR_GAUGE_ORIENTATION) !== "vertical";
  const showUnfilled = config.bar_gauge_show_unfilled !== false;
  const bandsByItem = items.map((item, index) => {
    const thresholds = getSeriesThresholds(config, item.name);
    const resolved = thresholds
      ? resolveStepValues(thresholds, { min: item.min, max: item.max })
      : null;
    return barGaugeBands(item, resolved, index);
  });
  const lcd = mode === "lcd";

  const valueBar = {
    type: "bar",
    name: "",
    barGap: "-100%",
    barCategoryGap: BAR_CATEGORY_GAP,
    z: 20,
    ...(showUnfilled && !lcd
      ? { showBackground: true, backgroundStyle: { color: chartColor("--color-border-subtle") } }
      : {}),
    data: items.map((item, index) => ({
      name: item.name,
      value: barGaugeFraction(item.value, item.min, item.max),
      rawName: item.rawName,
      rawValue: item.value,
      itemStyle: {
        color: lcd
          ? "transparent"
          : mode === "gradient"
            ? gradientFill(item, bandsByItem[index], horizontal)
            : item.color,
      },
    })),
  };

  // Vertical labels share the panel width, one slot per bar, so long names truncate instead of running together.
  const width = panelWidth || FALLBACK_PANEL_WIDTH;
  const slotWidth = (width - 2 * GRID_EDGE) / items.length - VERTICAL_LABEL_GAP;
  // Below this width ECharts cuts text without an ellipsis, so labels thin out instead of shrinking further.
  const crowded = !horizontal && slotWidth < VERTICAL_LABEL_MIN;
  const labelWidth = Math.max(slotWidth, VERTICAL_LABEL_MIN);
  // Both horizontal gutters are capped by a share of the panel, so a narrow panel keeps room for the track.
  const gutter = (texts: string[], max: number, share: number) =>
    Math.min(max, width * share, Math.max(...texts.map((text) => calculateWidthText(text))) + 2);
  const valueWidth = horizontal
    ? gutter(
        items.map((item) => item.text),
        VALUE_LABEL_MAX,
        VALUE_LABEL_SHARE,
      )
    : labelWidth;

  // The value text sits past the end of the track, so it never lands on the fill whatever the bar's length.
  const valueLabels = {
    type: "bar",
    name: "",
    barGap: "-100%",
    barCategoryGap: BAR_CATEGORY_GAP,
    z: 1,
    silent: true,
    tooltip: { show: false },
    itemStyle: { color: "transparent" },
    label: {
      show: !crowded,
      position: horizontal ? "right" : "top",
      distance: VALUE_LABEL_DISTANCE,
      width: valueWidth,
      overflow: "truncate",
      color: chartColor("--color-text-heading"),
      formatter: (params: any) => items[params.dataIndex]?.text ?? "",
    },
    data: items.map(() => 1),
  };

  // Horizontal names get a gutter sized to the widest one, so a late web font truncates them instead of clipping at the edge.
  const nameWidth = horizontal
    ? gutter(
        items.map((item) => item.label),
        NAME_LABEL_MAX,
        NAME_LABEL_SHARE,
      )
    : labelWidth;
  const categoryAxis = {
    type: "category",
    data: items.map((item) => item.name),
    inverse: horizontal,
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: {
      color: chartAxisTextColor(),
      overflow: "truncate",
      width: nameWidth,
      margin: NAME_LABEL_MARGIN,
      interval: crowded ? "auto" : 0,
      formatter: (_value: string, index: number) => items[index]?.label ?? "",
    },
  };
  const valueAxis = { type: "value", min: 0, max: 1, show: false };

  return {
    backgroundColor: "transparent",
    grid: {
      containLabel: !horizontal,
      left: horizontal ? GRID_EDGE + nameWidth + NAME_LABEL_MARGIN : GRID_EDGE,
      right: horizontal ? GRID_EDGE + valueWidth + VALUE_LABEL_DISTANCE : GRID_EDGE,
      top: horizontal ? 8 : 24,
      bottom: 8,
    },
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) => {
        const item = items[params?.dataIndex];
        if (!item) return "";
        const marker = echartsFormat.getTooltipMarker(item.color);
        return `${marker}${escapeHtml(item.label)}: <strong>${escapeHtml(item.text)}</strong>`;
      },
    },
    legend: { show: false },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [
      ...(lcd ? lcdSeries(items, bandsByItem, horizontal, showUnfilled) : []),
      valueBar,
      valueLabels,
    ],
  };
};
