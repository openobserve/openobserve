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

// Shared column-formatting model + helpers. UI works on the flat
// `ColumnOverrideUI` shape and (de)serializes to/from the persisted
// `config.override_config` array on load/save.

import { useI18n } from "vue-i18n";
import { OVERRIDE_CONFIG_TYPES } from "@/utils/dashboard/tableConfigUtils";

// null means "not set" → renderer falls back to the panel-level default.
export interface ConditionalRuleUI {
  operator: string;
  threshold: string; // "" while empty
  textColor: string | null;
  bgColor: string | null;
}

export const emptyConditionalRule = (): ConditionalRuleUI => ({
  operator: "<",
  threshold: "",
  textColor: null,
  bgColor: null,
});

export interface ColumnOverrideUI {
  field: string;
  // "auto" detects numeric-ness from the data; "num"/"text" force it.
  fieldType: "auto" | "num" | "text";
  unit: string | null; // null === inherit panel-level unit
  customUnit: string | null;
  alignment: string | null;
  textColor: string | null;
  bgColor: string | null;
  autoColor: boolean; // unique-value coloring
  conditions: ConditionalRuleUI[];
}

export const TEXT_SWATCHES = [
  "#b91c1c",
  "#a16207",
  "#15803d",
  "#316177",
  "#643cb8",
  "#111827",
  "#6b7280",
];

export const BG_SWATCHES = [
  "#fef2f2",
  "#fefce8",
  "#f0fdf4",
  "#f5f8f9",
  "#efe5ff",
  "#f3f4f6",
  "#ffffff",
];


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

/** Apply persisted config items onto a UI override row. */
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

/** Deserialize all columns from the raw override_config array. */
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

/** Serialize a UI row to a persisted entry, or null if it has no formatting. */
export const serializeColumnOverride = (
  c: ColumnOverrideUI,
): any | null => {
  if (!c.field) return null;
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
    (r) =>
      r.operator &&
      r.threshold !== "" &&
      !Number.isNaN(parseFloat(r.threshold)),
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

  return { field: { matchBy: "name", value: c.field }, config };
};

export const serializeOverrides = (cols: ColumnOverrideUI[]): any[] =>
  cols
    .filter((c) => c.field)
    .map((c) => serializeColumnOverride(c))
    .filter((entry) => entry != null);

/** Canonical unit dropdown options shared by panel config and the dialog. */
export const getUnitOptions = (
  t: (key: string) => string,
): Array<{ label: string; value: string | null }> => [
  { label: t("dashboard.default"), value: null },
  { label: t("dashboard.numbers"), value: "numbers" },
  { label: t("dashboard.localeFormat"), value: "locale" },
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

/** i18n-bound option lists for the formatting controls. */
export const useColumnFormattingOptions = () => {
  const { t } = useI18n();

  const unitOptions = getUnitOptions(t);

  const fieldTypeOptions = [
    { value: "auto", label: t("dashboard.auto") },
    { value: "num", label: t("dashboard.typeNumeric") },
    { value: "text", label: t("dashboard.typeText") },
  ];

  // "auto" maps to null alignment (renderer auto-aligns by type).
  const alignOptions = [
    { value: "auto", label: t("dashboard.auto") },
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
