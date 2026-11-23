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

import { chartColor } from "@/utils/chartTheme";
import { escapeHtml } from "@/utils/html";
import { getDataValue } from "./aliasUtils";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { groupName, isStandIn, paintByPalette } from "./categoryNodes";
import { undrawnQueryCount } from "./chartTypeGroups";
import { labelColorOn } from "./chartLabelContrast";

export const FUNNEL_SORTS = ["descending", "ascending", "none"] as const;
export const FUNNEL_ORIENTS = ["vertical", "horizontal"] as const;
export const DEFAULT_FUNNEL_SORT = "descending";
export const DEFAULT_FUNNEL_ORIENT = "vertical";
const FUNNEL_CONFIG_KEYS = ["funnel_sort", "funnel_orient", "funnel_show_percent"] as const;
const LABEL_CHAR_WIDTH = 7;
const LABEL_LINE_HEIGHT = 16;
const LABEL_LINE_LENGTH = 20;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 16;
const PLOT_SIDE_SHARE = 0.04;
const STAGE_GAP = 2;
const FALLBACK_PANEL = { width: 800, height: 400 };

/** One funnel stage; `percent` is its share of the largest stage. */
export interface FunnelStage {
  name: string;
  /** The stage's own x value when the shown name stands in for a missing (null) or empty one. */
  rawName?: string | null;
  value: number;
  percent: number;
  itemStyle?: { color: string };
  label?: Record<string, any>;
  labelLine?: { show: boolean };
  labelInside?: boolean;
}

/** What the funnel left out: rows whose value is missing, not a number or negative, and visible queries after the first. */
export interface FunnelNotice {
  skippedRows: number;
  ignoredQueries: number;
}

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const choice = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Funnel settings mean nothing to another type, and would ride along in its saved panel and exports. */
export const dropFunnelConfig = (panel: { type?: string; config?: Record<string, unknown> }) => {
  if (!panel?.config || panel.type === "funnel") return;
  for (const key of FUNNEL_CONFIG_KEYS) delete panel.config[key];
};

/** Sums the y field per x value of the first visible query, in query order, counting the rows left out; percents are of the largest stage. */
export const buildFunnelStages = (
  panelSchema: any,
  data: any[],
): { stages: FunnelStage[]; skippedRows: number } => {
  // Each stage is one measure, so a saved panel with more queries draws only its first visible one.
  const queries: any[] = panelSchema?.queries ?? [];
  const drawn = queries.findIndex((query) => !query?.config?.hide);
  const rows = data?.[drawn];
  const stage = queries[drawn]?.fields?.x?.[0];
  const value = queries[drawn]?.fields?.y?.[0];
  if (!Array.isArray(rows) || !stage || !value) return { stages: [], skippedRows: 0 };
  const byKey = new Map<string | null, FunnelStage>();
  let skippedRows = 0;
  rows.forEach((row: any) => {
    const amount = toNumber(getDataValue(row, value.alias));
    if (amount === null || amount < 0) {
      skippedRows++;
      return;
    }
    const raw = getDataValue(row, stage.alias);
    const key = raw === null || raw === undefined ? null : String(raw);
    const found = byKey.get(key);
    if (found) found.value += amount;
    else {
      const rawName = isStandIn(key) ? { rawName: key } : {};
      byKey.set(key, { name: groupName(key), ...rawName, value: amount, percent: 0 });
    }
  });
  const stages = [...byKey.values()];
  // In query order the first row can be any stage, and a percent above 100 reads as an error.
  const base = Math.max(...stages.map((item) => item.value), 0);
  stages.forEach((item) => {
    item.percent = base > 0 ? (item.value / base) * 100 : 0;
  });
  return { stages, skippedRows };
};

const sortedForDisplay = (stages: FunnelStage[], sort: string) =>
  sort === "none"
    ? [...stages]
    : [...stages].sort((a, b) => (sort === "ascending" ? a.value - b.value : b.value - a.value));

/** Puts each stage's label inside when it fits there, else beside the stage with a leader line, sized to the room left; returns the plot's top and bottom inset. */
export const placeFunnelLabels = (
  stages: FunnelStage[],
  options: {
    horizontal: boolean;
    sort: string;
    panel: { width: number; height: number };
    text: (stage: FunnelStage) => { inside: string; outside: string };
  },
): { top: number; bottom: number } => {
  const { horizontal, panel } = options;
  const ordered = sortedForDisplay(stages, options.sort);
  const max = Math.max(...stages.map((stage) => stage.value), 0);
  const plotWidth = panel.width * (1 - 2 * PLOT_SIDE_SHARE);
  const textWidth = (text: string) =>
    Math.max(...text.split("\n").map((line) => line.length)) * LABEL_CHAR_WIDTH;
  // Distance from a stage edge to the far side of a label above or below it.
  const outsideReach = LABEL_LINE_LENGTH + 5 + LABEL_LINE_HEIGHT / 2 + 2;
  const inset = { top: PLOT_TOP, bottom: PLOT_BOTTOM };

  const place = () => {
    const plotHeight = Math.max(panel.height - inset.top - inset.bottom, 1);
    // The size axis runs across the flow; each stage gets an equal slot along it.
    const across = horizontal ? plotHeight : plotWidth;
    const along = horizontal ? plotWidth : plotHeight;
    const slot = (along - STAGE_GAP * (ordered.length - 1)) / ordered.length;
    const need = { top: 0, bottom: 0 };
    ordered.forEach((stage, index) => {
      // ECharts draws an ascending funnel from its far end, so each stage narrows to the next smaller one.
      const next =
        (options.sort === "ascending" ? ordered[index - 1] : ordered[index + 1])?.value ?? 0;
      const scale = (value: number) => (max > 0 ? (value * across) / max : 0);
      const thickness = scale((stage.value + next) / 2);
      const { inside } = options.text(stage);
      const lines = inside.split("\n").length;
      // The label spans part of the stage along the flow, so it must fit where the stage is thinnest under it.
      const labelAlong = horizontal ? textWidth(inside) : lines * LABEL_LINE_HEIGHT;
      const reach = Math.max(0, 0.5 - labelAlong / 2 / Math.max(slot, 1));
      const narrow = scale(Math.min(stage.value, next));
      const thinnest = narrow + (scale(Math.max(stage.value, next)) - narrow) * reach;
      const fits = horizontal
        ? thinnest >= lines * LABEL_LINE_HEIGHT + 4 && slot >= textWidth(inside) + 8
        : thinnest >= textWidth(inside) + 12 && slot >= LABEL_LINE_HEIGHT;
      stage.labelInside = fits;
      if (fits) {
        stage.label = { position: "inside", color: labelColorOn(stage.itemStyle?.color) };
        stage.labelLine = { show: false };
        return;
      }
      // Alternating sides keeps neighbouring outside labels of a horizontal funnel apart.
      const side = index % 2 ? "bottom" : "top";
      if (horizontal) {
        const edge = max > 0 ? (stage.value * across) / max : 0;
        need[side] = Math.max(need[side], outsideReach - (across - edge) / 2);
      }
      // A horizontal label is centred over its stage, which an ascending funnel lays out from the right.
      const offset = index * (slot + STAGE_GAP) + slot / 2;
      const plotLeft = panel.width * PLOT_SIDE_SHARE;
      const centre =
        options.sort === "ascending" ? plotLeft + plotWidth - offset : plotLeft + offset;
      const room = horizontal
        ? Math.min(2 * slot - 8, 2 * Math.min(centre, panel.width - centre) - 4)
        : plotLeft + (across - thickness) / 2 - LABEL_LINE_LENGTH - 8;
      stage.label = {
        position: horizontal ? side : "right",
        color: chartColor("--color-text-body"),
        width: Math.max(room, LABEL_CHAR_WIDTH * 3),
      };
      stage.labelLine = { show: true };
    });
    return need;
  };

  const need = place();
  if (need.top > 0 || need.bottom > 0) {
    // Make room for labels above or below thick stages, then place again in the smaller plot.
    inset.top = PLOT_TOP + Math.ceil(Math.max(need.top, 0));
    inset.bottom = PLOT_BOTTOM + Math.ceil(Math.max(need.bottom, 0));
    place();
  }
  return inset;
};

const formatPercent = (percent: number) => `${Math.round(percent * 10) / 10}%`;

/** Converts SQL rows into a funnel: one stage per x value, sized by the y value. */
export const convertFunnelData = (panelSchema: any, data: any, store: any, chartPanelRef?: any) => {
  const config = panelSchema?.config ?? {};
  const { stages, skippedRows } = buildFunnelStages(panelSchema, Array.isArray(data) ? data : []);
  const funnelNotice: FunnelNotice = {
    skippedRows,
    ignoredQueries: undrawnQueryCount(panelSchema?.queries),
  };
  const extras = { panelId: panelSchema?.id, funnelNotice };
  if (!stages.length) return { options: { series: [] }, extras };

  paintByPalette(stages, config, store?.state?.theme);
  const format = (value: unknown) =>
    formatUnitValue(getUnitValue(value, config.unit, config.unit_custom, config.decimals));
  const showPercent = config.funnel_show_percent === true;
  const describe = (stage: FunnelStage | undefined, value: unknown) =>
    showPercent && stage ? `${format(value)} (${formatPercent(stage.percent)})` : format(value);
  const horizontal =
    choice(config.funnel_orient, FUNNEL_ORIENTS, DEFAULT_FUNNEL_ORIENT) === "horizontal";
  const sort = choice(config.funnel_sort, FUNNEL_SORTS, DEFAULT_FUNNEL_SORT);
  const labelText = (stage: FunnelStage) => ({
    inside: `${stage.name}${horizontal ? "\n" : "  "}${describe(stage, stage.value)}`,
    outside: `${stage.name}  ${describe(stage, stage.value)}`,
  });
  const inset = placeFunnelLabels(stages, {
    horizontal,
    sort,
    panel: {
      width: chartPanelRef?.value?.offsetWidth || FALLBACK_PANEL.width,
      height: chartPanelRef?.value?.offsetHeight || FALLBACK_PANEL.height,
    },
    text: labelText,
  });

  const options = {
    backgroundColor: "transparent",
    tooltip: {
      show: true,
      trigger: "item",
      appendToBody: true,
      className: "o2-echarts-tooltip",
      textStyle: { color: chartColor("--color-tooltip-text"), fontSize: 12 },
      backgroundColor: chartColor("--color-tooltip-bg"),
      borderColor: chartColor("--color-tooltip-border"),
      formatter: (params: any) =>
        `${escapeHtml(params?.name ?? "")}: <strong>${escapeHtml(describe(params?.data, params?.value))}</strong>`,
    },
    series: [
      {
        type: "funnel",
        sort,
        orient: horizontal ? "horizontal" : "vertical",
        top: inset.top,
        bottom: inset.bottom,
        left: `${PLOT_SIDE_SHARE * 100}%`,
        width: `${(1 - 2 * PLOT_SIDE_SHARE) * 100}%`,
        minSize: "2%",
        // With every stage at 0 ECharts' value range collapses and it draws each stage half wide.
        max: Math.max(...stages.map((stage) => stage.value)) || 1,
        gap: STAGE_GAP,
        itemStyle: { borderColor: chartColor("--color-surface-base"), borderWidth: 1 },
        label: {
          show: true,
          position: "inside",
          lineHeight: LABEL_LINE_HEIGHT,
          textBorderWidth: 0,
          overflow: "truncate",
          formatter: (params: any) => {
            const text = labelText(params?.data ?? { name: params?.name, value: params?.value });
            return params?.data?.labelInside === false ? text.outside : text.inside;
          },
        },
        labelLine: {
          length: LABEL_LINE_LENGTH,
          lineStyle: { color: chartColor("--color-border-default") },
        },
        labelLayout: { hideOverlap: true },
        emphasis: { label: { fontWeight: "bold" } },
        data: stages,
      },
    ],
  };
  return { options, extras };
};
