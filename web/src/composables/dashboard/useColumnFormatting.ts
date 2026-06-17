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
// Single source of truth for table-chart column formatting. The "Column
// Formatting" dialog (OverrideConfigPopup.vue) edits the persisted
// `config.override_config` array through these helpers.
//
// The persisted shape (per column) is:
//   { field: { matchBy: "name", value: "<alias>" }, config: [ {type, ...}, ... ] }
// The UI works on the flat `ColumnOverrideUI` shape below and (de)serializes
// to/from the persisted shape on load/save.
// ---------------------------------------------------------------------------

import { useI18n } from "vue-i18n";
import { OVERRIDE_CONFIG_TYPES } from "@/utils/dashboard/tableConfigUtils";

// Unset/optional fields use `null` (never ""), matching the panel-config
// convention (useDashboardPanelDefaults: unit/colors default to null). A null
// value means "not set" → the renderer falls back to the panel-level default.
export interface ConditionalRuleUI {
  operator: string;
  threshold: string; // bound to a number input; "" while empty
  textColor: string | null; // hex or null
  bgColor: string | null; // hex or null
}

/** A blank conditional rule row. */
export const emptyConditionalRule = (): ConditionalRuleUI => ({
  operator: "<",
  threshold: "",
  textColor: null,
  bgColor: null,
});

export interface ColumnOverrideUI {
  field: string; // column alias
  // "auto" === detect numeric-ness from the data; "num"/"text" force it.
  fieldType: "auto" | "num" | "text";
  // null === "Default" (inherit the panel-level unit). Otherwise one of
  // "numbers", "bytes", "percent", "currency-dollar", "custom", …
  unit: string | null;
  customUnit: string | null;
  alignment: string | null; // "left" | "center" | "right" | null
  textColor: string | null; // hex or null
  bgColor: string | null; // hex or null
  autoColor: boolean; // unique-value coloring
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

/** Compact text/bg swatch sets for conditional rules (kept short so the
 *  per-rule pickers stay on a single row). */
export const COND_TEXT_SWATCHES = ["#b91c1c", "#a16207", "#15803d", "#316177"];
export const COND_BG_SWATCHES = ["#fef2f2", "#fefce8", "#f0fdf4", "#f5f8f9"];

/** A blank UI override row, optionally bound to a column alias. */
export const emptyColumnOverride = (field = ""): ColumnOverrideUI => ({
  field,
  fieldType: "auto",
  unit: null,
  customUnit: null,
  alignment: null,
  textColor: null,
  bgColor: null,
  autoColor: false,
  conditions: [],
});

/** Apply the persisted `config[]` items of one entry onto a UI override row. */
const applyConfigItems = (col: ColumnOverrideUI, items: any[]): void => {
  for (const cfg of items ?? []) {
    switch (cfg?.type) {
      case OVERRIDE_CONFIG_TYPES.FIELD_TYPE:
        col.fieldType = cfg.value ?? "auto";
        break;
      case OVERRIDE_CONFIG_TYPES.UNIT:
        col.unit = cfg.value?.unit ?? null;
        col.customUnit = cfg.value?.customUnit ?? null;
        break;
      case OVERRIDE_CONFIG_TYPES.UNIQUE_VALUE_COLOR:
        col.autoColor = !!cfg.autoColor;
        break;
      case OVERRIDE_CONFIG_TYPES.ALIGNMENT:
        col.alignment = cfg.value ?? null;
        break;
      case OVERRIDE_CONFIG_TYPES.TEXT_COLOR:
        col.textColor = cfg.value ?? null;
        break;
      case OVERRIDE_CONFIG_TYPES.BACKGROUND_COLOR:
        col.bgColor = cfg.value ?? null;
        break;
      case OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES:
        col.conditions = (cfg.rules ?? []).map((r: any) => ({
          operator: r.operator ?? "<",
          threshold: r.threshold != null ? String(r.threshold) : "",
          textColor: r.textColor ?? null,
          bgColor: r.bgColor ?? null,
        }));
        break;
    }
  }
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
): any | null => {
  const config: any[] = [];

  if (c.fieldType && c.fieldType !== "auto")
    config.push({ type: OVERRIDE_CONFIG_TYPES.FIELD_TYPE, value: c.fieldType });
  if (c.unit)
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
 */
export const serializeOverrides = (cols: ColumnOverrideUI[]): any[] =>
  cols
    .filter((c) => c.field)
    .map((c) => serializeColumnOverride(c))
    .filter((entry) => entry != null);

/**
 * Canonical unit dropdown options (Default + all units). Single source of truth
 * shared by the panel config (ConfigPanel.vue) and the column-formatting dialog
 * so the two never drift. Takes the i18n `t` so it stays framework-agnostic.
 * `value: null` === "Default" (inherit the panel-level unit).
 */
export const getUnitOptions = (
  t: (key: string) => string,
): Array<{ label: string; value: string | null }> => [
  { label: t("dashboard.default"), value: null },
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

/**
 * The option lists shown in the formatting controls. i18n-bound, so this is a
 * composable. Shared by the dialog and the inline menu so the choices stay
 * identical in both.
 */
export const useColumnFormattingOptions = () => {
  const { t } = useI18n();

  const unitOptions = getUnitOptions(t);

  const fieldTypeOptions = [
    { value: "auto", label: t("dashboard.auto") },
    { value: "num", label: t("dashboard.typeNumeric") },
    { value: "text", label: t("dashboard.typeText") },
  ];

  const alignOptions = [
    { value: "left", label: t("dashboard.alignLeft") },
    { value: "center", label: t("dashboard.alignCenter") },
    { value: "right", label: t("dashboard.alignRight") },
  ];

  const conditionOperators = [
    { label: t("dashboard.opLessThan"), value: "<" },
    { label: t("dashboard.opGreaterThan"), value: ">" },
    { label: t("dashboard.opLessThanEqual"), value: "<=" },
    { label: t("dashboard.opGreaterThanEqual"), value: ">=" },
    { label: t("dashboard.opEqual"), value: "=" },
    { label: t("dashboard.opNotEqual"), value: "!=" },
  ];

  return {
    unitOptions,
    fieldTypeOptions,
    alignOptions,
    conditionOperators,
  };
};
