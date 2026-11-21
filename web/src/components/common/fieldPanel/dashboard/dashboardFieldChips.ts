// Copyright 2026 OpenObserve Inc.

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { isFlowChart, isHtmlPanel } from "@/utils/dashboard/chartTypeGroups";
import type { PanelAxis } from "@/composables/dashboard/usePanelFields";
import type { ChipSpec } from "../fieldPanel.types";
import { FUNCTION_FIELDS_GROUP, QUERY_FIELDS_GROUP } from "./dashboardFieldRows";

/** Single-slot targets: their chip disables once the query holds a field there. */
export const SLOT_TARGETS = [
  "latitude",
  "longitude",
  "weight",
  "name",
  "value_for_maps",
  "source",
  "target",
  "value",
] as const;

const BREAKDOWN_CHART_TYPES = new Set([
  "area",
  "bar",
  "line",
  "h-bar",
  "h-stacked",
  "scatter",
  "area-stacked",
  "stacked",
  "state-timeline",
  "distribution",
  "treemap",
  "sunburst",
  "hostmap",
]);

export type ChipTarget =
  | "x"
  | "y"
  | "z"
  | "breakdown"
  | "filter"
  | "latitude"
  | "longitude"
  | "weight"
  | "name"
  | "value_for_maps"
  | "source"
  | "target"
  | "value";

export type SlotTarget = (typeof SLOT_TARGETS)[number];

/** A row's group says where it came from; a name alone can repeat across query, function and stream groups. */
export interface ChipRow {
  group?: string;
}

export interface ChipContext {
  chartType: string;
  pageKey: string;
  promql: boolean;
  customQuery: boolean;
  filledSlots: Set<SlotTarget>;
  notAllowed: { x: boolean; y: boolean; z: boolean; breakdown: boolean };
  /** Axes the chart type never takes, as opposed to axes it has filled. */
  unsupported: Record<PanelAxis, boolean>;
}

// Query and function fields are the only rows a custom SQL query can place.
const isDerived = (row: ChipRow) =>
  row.group === QUERY_FIELDS_GROUP || row.group === FUNCTION_FIELDS_GROUP;

/** Whether the panel places fields at all: PromQL, the logs Visualize tab, custom charts and HTML panels have no axes. */
export const chipsAvailable = (ctx: ChipContext): boolean =>
  !ctx.promql &&
  ctx.pageKey !== "logs" &&
  ctx.chartType !== "custom_chart" &&
  !isHtmlPanel(ctx.chartType);

/** Whether a row offers any chip; a row without one has no drop target either. */
export const hasChips = (ctx: ChipContext, row: ChipRow): boolean =>
  chipsAvailable(ctx) && !(ctx.customQuery && !isDerived(row));

const chip = (
  target: ChipTarget,
  testId: string,
  label: I18nText,
  tooltip: I18nText,
  disabled = false,
): ChipSpec => ({ target, testId: `dashboard-add-${testId}-data`, label, tooltip, disabled });

// A custom SQL query has no builder filter, and a VRL output field cannot be filtered on before the function runs.
const filterChip = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => {
  if (ctx.customQuery) return [];
  const vrl = row.group === FUNCTION_FIELDS_GROUP;
  const spec = chip("filter", "filter", t("panel.addFilterShort"), t("panel.filters"), vrl);
  return [vrl ? { ...spec, reason: t("panel.chipFilterVrlReason") } : spec];
};

const geomapChips = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => [
  chip(
    "latitude",
    "latitude",
    t("panel.addLatitudeShort"),
    t("panel.latitude"),
    ctx.filledSlots.has("latitude"),
  ),
  chip(
    "longitude",
    "longitude",
    t("panel.addLongitudeShort"),
    t("panel.longitude"),
    ctx.filledSlots.has("longitude"),
  ),
  chip(
    "weight",
    "weight",
    t("panel.addWeightShort"),
    t("panel.weight"),
    ctx.filledSlots.has("weight"),
  ),
  ...filterChip(ctx, row, t),
];

// Maps keeps its +F on every row, VRL fields included.
const mapsChips = (ctx: ChipContext, t: TranslateFn): ChipSpec[] => [
  chip("name", "x", t("panel.addNameShort"), t("common.name"), ctx.filledSlots.has("name")),
  chip(
    "value_for_maps",
    "y",
    t("panel.addValueShort"),
    t("panel.value"),
    ctx.filledSlots.has("value_for_maps"),
  ),
  chip("filter", "filter", t("panel.addFilterShort"), t("panel.filters")),
];

const flowChips = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => [
  chip(
    "source",
    "source",
    t("panel.addSourceShort"),
    t("panel.source"),
    ctx.filledSlots.has("source"),
  ),
  chip(
    "target",
    "target",
    t("panel.addTargetShort"),
    t("panel.target"),
    ctx.filledSlots.has("target"),
  ),
  chip("value", "value", t("panel.addValueShort"), t("panel.value"), ctx.filledSlots.has("value")),
  ...filterChip(ctx, row, t),
];

// A horizontal bar draws x on the vertical axis, so the first two chips read the other way round.
const standardChips = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => {
  const horizontal = ctx.chartType === "h-bar";
  const chips = [
    chip(
      "x",
      "x",
      raw(horizontal ? "+Y" : "+X"),
      horizontal ? t("panel.yAxisShort") : t("panel.xAxisShort"),
      ctx.notAllowed.x,
    ),
    chip(
      "y",
      "y",
      raw(horizontal ? "+X" : "+Y"),
      horizontal ? t("panel.xAxisShort") : t("panel.yAxisShort"),
      ctx.notAllowed.y,
    ),
  ];
  if (ctx.chartType === "table") {
    chips.push(
      chip(
        "breakdown",
        "p",
        t("panel.addPivotShort"),
        t("panel.pivotField"),
        ctx.notAllowed.breakdown,
      ),
    );
  }
  if (BREAKDOWN_CHART_TYPES.has(ctx.chartType)) {
    chips.push(
      chip(
        "breakdown",
        "b",
        t("panel.addBreakdownShort"),
        t("panel.breakdown"),
        ctx.notAllowed.breakdown,
      ),
    );
  }
  if (ctx.chartType === "heatmap") {
    chips.push(chip("z", "z", t("panel.addZAxisShort"), t("panel.zAxis"), ctx.notAllowed.z));
  }
  return [...chips, ...filterChip(ctx, row, t)];
};

const chipsForChart = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => {
  if (ctx.chartType === "geomap") return geomapChips(ctx, row, t);
  if (ctx.chartType === "maps") return mapsChips(ctx, t);
  if (isFlowChart(ctx.chartType)) return flowChips(ctx, row, t);
  return standardChips(ctx, row, t);
};

// A disabled axis chip is either an axis the chart type never takes or one it has filled; slot chips are only ever filled.
const disabledReason = (ctx: ChipContext, spec: ChipSpec, t: TranslateFn): I18nText => {
  const target = spec.tooltip ?? spec.label;
  const unsupported = ctx.unsupported[spec.target as PanelAxis] === true;
  return t(unsupported ? "panel.chipUnusedReason" : "panel.chipFullReason", { target });
};

/** The chips of one row for the panel's chart type, in display order. */
export const buildDashboardChips = (ctx: ChipContext, row: ChipRow, t: TranslateFn): ChipSpec[] => {
  if (!hasChips(ctx, row)) return [];
  return chipsForChart(ctx, row, t).map((spec) =>
    spec.disabled && !spec.reason ? { ...spec, reason: disabledReason(ctx, spec, t) } : spec,
  );
};
