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

// ---------------------------------------------------------------------------
// Shared column-formatting model + helpers.
//
// Single source of truth for table-chart column formatting. BOTH the full
// "Column Formatting" dialog (OverrideConfigPopup.vue, multi-column) and the
// inline per-column header menu (InlineColumnFormat.vue, single-column) edit
// the SAME persisted `config.override_config` array through these helpers, so
// the two editors can never diverge.
//
// The persisted shape (per column) is:
//   { field: { matchBy: "name", value: "<alias>" }, config: [ {type, ...}, ... ] }
// The UI works on the flat `ColumnOverrideUI` shape below and (de)serializes
// to/from the persisted shape on load/save.
// ---------------------------------------------------------------------------

import { useI18n } from "vue-i18n";
import { OVERRIDE_CONFIG_TYPES } from "@/utils/dashboard/tableConfigUtils";

export interface ConditionalRuleUI {
  operator: string;
  threshold: string;
  textColor: string;
  bgColor: string;
}

/** A blank conditional rule row. */
export const emptyConditionalRule = (): ConditionalRuleUI => ({
  operator: "<",
  threshold: "",
  textColor: "",
  bgColor: "",
});

export interface ColumnOverrideUI {
  field: string; // column alias
  unit: string; // "", "numbers", "bytes", "percent", "currency-dollar", "custom", …
  customUnit: string;
  alignment: string; // "left" | "center" | "right" | ""
  textColor: string; // hex or ""
  bgColor: string; // hex or ""
  autoColor: boolean; // unique-value coloring
  cellType: string; // "text" | "progress_bar" | "sparkline"
  progressColor: string;
  sparklineStyle: "line" | "bar";
  conditions: ConditionalRuleUI[];
}

// ── Curated color palettes (from the Column Formatting redesign mockup) ───────
// Small, brand-aligned swatch sets shown in the color pickers, plus a custom
// option. Kept here so the inline menu and the dialog offer identical choices.

/** Text-color swatches (foreground). */
export const TEXT_SWATCHES = [
  "#b91c1c",
  "#a16207",
  "#15803d",
  "#316177",
  "#643cb8",
  "#111827",
  "#6b7280",
];

/** Background-color swatches (soft tints + white). */
export const BG_SWATCHES = [
  "#fef2f2",
  "#fefce8",
  "#f0fdf4",
  "#f5f8f9",
  "#efe5ff",
  "#f3f4f6",
  "#ffffff",
];

/** Accent swatches for progress-bar / sparkline color. */
export const ACCENT_SWATCHES = [
  "#3f7994",
  "#643cb8",
  "#15803d",
  "#a16207",
  "#b91c1c",
  "#2e55a3",
];

/** Compact text/bg swatch sets for conditional rules (kept short so the
 *  per-rule pickers stay on a single row). */
export const COND_TEXT_SWATCHES = ["#b91c1c", "#a16207", "#15803d", "#316177"];
export const COND_BG_SWATCHES = ["#fef2f2", "#fefce8", "#f0fdf4", "#f5f8f9"];

/** A blank UI override row, optionally bound to a column alias. */
export const emptyColumnOverride = (field = ""): ColumnOverrideUI => ({
  field,
  unit: "",
  customUnit: "",
  alignment: "",
  textColor: "",
  bgColor: "",
  autoColor: false,
  cellType: "text",
  progressColor: "",
  sparklineStyle: "line",
  conditions: [],
});

/** Apply the persisted `config[]` items of one entry onto a UI override row. */
const applyConfigItems = (col: ColumnOverrideUI, items: any[]): void => {
  for (const cfg of items ?? []) {
    switch (cfg?.type) {
      case OVERRIDE_CONFIG_TYPES.UNIT:
        col.unit = cfg.value?.unit ?? "";
        col.customUnit = cfg.value?.customUnit ?? "";
        break;
      case OVERRIDE_CONFIG_TYPES.UNIQUE_VALUE_COLOR:
        col.autoColor = !!cfg.autoColor;
        break;
      case OVERRIDE_CONFIG_TYPES.ALIGNMENT:
        col.alignment = cfg.value ?? "";
        break;
      case OVERRIDE_CONFIG_TYPES.TEXT_COLOR:
        col.textColor = cfg.value ?? "";
        break;
      case OVERRIDE_CONFIG_TYPES.BACKGROUND_COLOR:
        col.bgColor = cfg.value ?? "";
        break;
      case OVERRIDE_CONFIG_TYPES.CELL_TYPE:
        col.cellType = cfg.value?.type ?? "text";
        col.progressColor = cfg.value?.color ?? "";
        col.sparklineStyle = cfg.value?.sparklineStyle ?? "line";
        break;
      case OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES:
        col.conditions = (cfg.rules ?? []).map((r: any) => ({
          operator: r.operator ?? "<",
          threshold: r.threshold != null ? String(r.threshold) : "",
          textColor: r.textColor ?? "",
          bgColor: r.bgColor ?? "",
        }));
        break;
    }
  }
};

/**
 * Deserialize ONE column's UI row from the raw override_config array.
 * Used by the inline single-column menu. Returns a blank row if the column
 * has no existing overrides.
 */
export const loadColumnFromRaw = (
  raw: any[] | undefined,
  field: string,
): ColumnOverrideUI => {
  const col = emptyColumnOverride(field);
  for (const entry of raw ?? []) {
    if (entry?.field?.value !== field) continue;
    applyConfigItems(col, entry?.config ?? []);
  }
  return col;
};

/**
 * Deserialize ALL columns from the raw override_config array, one UI row per
 * column. Used by the full dialog.
 */
export const loadAllFromRaw = (raw: any[] | undefined): ColumnOverrideUI[] => {
  const byColumn: Record<string, ColumnOverrideUI> = {};
  for (const entry of raw ?? []) {
    const alias = entry?.field?.value;
    if (!alias) continue;
    if (!byColumn[alias]) byColumn[alias] = emptyColumnOverride(alias);
    applyConfigItems(byColumn[alias], entry?.config ?? []);
  }
  return Object.values(byColumn);
};

/**
 * Serialize a single UI row to its persisted override_config entry, pushing
 * only the config items the user actually set. Returns `null` when the row
 * carries no formatting (so callers can drop it).
 */
export const serializeColumnOverride = (
  c: ColumnOverrideUI,
  isNumeric: boolean,
): any | null => {
  const config: any[] = [];

  if (c.unit && isNumeric)
    config.push({
      type: OVERRIDE_CONFIG_TYPES.UNIT,
      value: { unit: c.unit, customUnit: c.customUnit },
    });
  if (c.alignment)
    config.push({ type: OVERRIDE_CONFIG_TYPES.ALIGNMENT, value: c.alignment });
  if (c.textColor)
    config.push({ type: OVERRIDE_CONFIG_TYPES.TEXT_COLOR, value: c.textColor });
  if (c.bgColor)
    config.push({
      type: OVERRIDE_CONFIG_TYPES.BACKGROUND_COLOR,
      value: c.bgColor,
    });
  if (c.autoColor)
    config.push({
      type: OVERRIDE_CONFIG_TYPES.UNIQUE_VALUE_COLOR,
      autoColor: true,
    });

  if (c.cellType && c.cellType !== "text") {
    config.push({
      type: OVERRIDE_CONFIG_TYPES.CELL_TYPE,
      value: {
        type: c.cellType,
        color: c.progressColor || "",
        sparklineStyle:
          c.cellType === "sparkline" ? c.sparklineStyle || "line" : undefined,
      },
    });
  }

  const validConditions = c.conditions.filter(
    (r) => r.threshold !== "" && r.operator,
  );
  if (validConditions.length) {
    config.push({
      type: OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES,
      rules: validConditions.map((r) => ({
        operator: r.operator,
        threshold: parseFloat(r.threshold),
        textColor: r.textColor || "",
        bgColor: r.bgColor || "",
      })),
    });
  }

  if (!config.length) return null;
  return { field: { matchBy: "name", value: c.field }, config };
};

/**
 * Serialize all UI rows to the persisted override_config array (dialog path).
 * `isNumeric(field)` gates numeric-only config items.
 */
export const serializeOverrides = (
  cols: ColumnOverrideUI[],
  isNumeric: (field: string) => boolean,
): any[] =>
  cols
    .filter((c) => c.field)
    .map((c) => serializeColumnOverride(c, isNumeric(c.field)))
    .filter((entry) => entry != null);

/**
 * Merge a single column's serialized entry back into the full override_config
 * array, preserving every other column's entry (inline single-column path).
 * Pass `entry = null` to remove the column's overrides entirely (Reset column).
 */
export const upsertColumnOverride = (
  raw: any[] | undefined,
  field: string,
  entry: any | null,
): any[] => {
  const rest = (raw ?? []).filter((e) => e?.field?.value !== field);
  return entry ? [...rest, entry] : rest;
};

/**
 * The option lists shown in the formatting controls. i18n-bound, so this is a
 * composable. Shared by the dialog and the inline menu so the choices stay
 * identical in both.
 */
export const useColumnFormattingOptions = () => {
  const { t } = useI18n();

  const unitOptions = [
    { label: t("dashboard.default"), value: "" },
    { label: t("dashboard.numbers"), value: "numbers" },
    { label: t("dashboard.bytes"), value: "bytes" },
    { label: t("dashboard.kilobytes"), value: "kilobytes" },
    { label: t("dashboard.megabytes"), value: "megabytes" },
    { label: t("dashboard.bytesPerSecond"), value: "bps" },
    { label: t("dashboard.seconds"), value: "seconds" },
    { label: t("dashboard.milliseconds"), value: "milliseconds" },
    { label: t("dashboard.microseconds"), value: "microseconds" },
    { label: t("dashboard.nanoseconds"), value: "nanoseconds" },
    { label: t("dashboard.percent1"), value: "percent-1" },
    { label: t("dashboard.percent"), value: "percent" },
    { label: t("dashboard.currencyDollar"), value: "currency-dollar" },
    { label: t("dashboard.currencyEuro"), value: "currency-euro" },
    { label: t("dashboard.currencyPound"), value: "currency-pound" },
    { label: t("dashboard.currencyYen"), value: "currency-yen" },
    { label: t("dashboard.currencyRupees"), value: "currency-rupee" },
    { label: t("dashboard.custom"), value: "custom" },
  ];

  const alignOptions = [
    { value: "left", label: t("dashboard.alignLeft") },
    { value: "center", label: t("dashboard.alignCenter") },
    { value: "right", label: t("dashboard.alignRight") },
  ];

  const sparklineStyleOptions = [
    { value: "line", label: t("dashboard.sparklineStyleLine") },
    { value: "bar", label: t("dashboard.sparklineStyleBar") },
  ];

  const conditionOperators = [
    { label: "<", value: "<" },
    { label: ">", value: ">" },
    { label: "<=", value: "<=" },
    { label: ">=", value: ">=" },
    { label: "=", value: "=" },
    { label: "!=", value: "!=" },
  ];

  return {
    unitOptions,
    alignOptions,
    sparklineStyleOptions,
    conditionOperators,
  };
};
