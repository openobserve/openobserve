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
import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { colorToRgba } from "./colorPalette";
import { getFieldLabel } from "./fieldLabel";
import {
  echartsPaletteColor,
  getSeriesThresholds,
  resolveStepValues,
  type Thresholds,
} from "./thresholds";

export const BAR_GAUGE_MODES = ["gradient", "lcd", "basic"] as const;
export const BAR_GAUGE_ORIENTATIONS = ["horizontal", "vertical"] as const;

const DEFAULT_MODE = "gradient";
const GRADIENT_START_ALPHA = 0.35;
const LCD_CELL_LENGTH = 6;
const LCD_CELL_GAP = 2;
const VALUE_LABEL_ROOM = 64;
const BAR_CATEGORY_GAP = "30%";

/** One bar: a reduced series value on its own min..max range, in the colour the gauge converter gave it. */
export interface BarGaugeItem {
  name: string;
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

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** The bars behind gauge options: one per dial, named by its label or else the value field. */
export const barGaugeItems = (gaugeOptions: any, panelSchema: any): BarGaugeItem[] => {
  const query = panelSchema?.queries?.[0];
  const yField = query?.fields?.y?.[0];
  const fallbackName =
    getFieldLabel(yField, panelSchema?.config, query?.customQuery) || yField?.alias || "";
  const noValue = String(panelSchema?.config?.no_value_replacement ?? "");
  const series: any[] = Array.isArray(gaugeOptions?.series) ? gaugeOptions.series : [];
  return series
    .filter((gauge) => gauge?.type === "gauge" && gauge?.data?.[0])
    .map((gauge, index) => {
      const item = gauge.data[0];
      const value = toNumber(item.value);
      const formatter = item.detail?.formatter;
      const text =
        value === null
          ? noValue
          : typeof formatter === "function"
            ? String(formatter(value))
            : String(value);
      return {
        name: String(item.name || fallbackName),
        value,
        min: toNumber(gauge.min) ?? 0,
        max: toNumber(gauge.max) ?? 100,
        color: item.itemStyle?.color || echartsPaletteColor(index),
        text,
      };
    });
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
  const value = item.value ?? item.min;
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
  max: number,
) => {
  const cell = {
    type: "pictorialBar",
    symbol: "rect",
    symbolRepeat: "fixed",
    symbolMargin: LCD_CELL_GAP,
    symbolSize: horizontal ? [LCD_CELL_LENGTH, "70%"] : ["70%", LCD_CELL_LENGTH],
    symbolClip: true,
    symbolBoundingData: max,
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
        value: Math.min(item.value, range.to),
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
            value: max,
            itemStyle: { color: chartColor("--color-border-subtle") },
          })),
        },
      ]
    : [];
  return [...unlit, ...lit];
};

/** Converts gauge-converted options into a bar gauge: one bar per dial, coloured by its thresholds. */
export const convertBarGaugeData = (gaugeOptions: any, panelSchema: any) => {
  const config = panelSchema?.config ?? {};
  const items = barGaugeItems(gaugeOptions, panelSchema);
  if (!items.length) return { series: [] };
  const mode = (BAR_GAUGE_MODES as readonly string[]).includes(config.bar_gauge_mode)
    ? config.bar_gauge_mode
    : DEFAULT_MODE;
  const horizontal = config.bar_gauge_orientation !== "vertical";
  const showUnfilled = config.bar_gauge_show_unfilled !== false;
  const min = Math.min(...items.map((item) => item.min));
  const max = Math.max(...items.map((item) => item.max));
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
    label: {
      show: true,
      position: horizontal ? "right" : "top",
      color: chartColor("--color-text-heading"),
      formatter: (params: any) => items[params.dataIndex]?.text ?? "",
    },
    data: items.map((item, index) => ({
      name: item.name,
      value: item.value ?? min,
      itemStyle: {
        color: lcd
          ? "transparent"
          : mode === "gradient"
            ? gradientFill(item, bandsByItem[index], horizontal)
            : item.color,
      },
    })),
  };

  const categoryAxis = {
    type: "category",
    data: items.map((item) => item.name),
    inverse: horizontal,
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: {
      color: chartColor("--color-text-secondary"),
      overflow: "truncate",
      width: horizontal ? 160 : undefined,
      interval: 0,
    },
  };
  const valueAxis = { type: "value", min, max, show: false };

  return {
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: 8,
      right: horizontal ? VALUE_LABEL_ROOM : 8,
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
        return `${marker}${escapeHtml(item.name)}: <strong>${escapeHtml(item.text)}</strong>`;
      },
    },
    legend: { show: false },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [
      ...(lcd ? lcdSeries(items, bandsByItem, horizontal, showUnfilled, max) : []),
      valueBar,
    ],
  };
};
