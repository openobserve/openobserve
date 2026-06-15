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

/**
 * Shared utilities for table data converters (SQL, Pivot, PromQL).
 *
 * Centralizes value-mapping lookup, override-config parsing, and
 * formatted-value helpers so every table converter stays in sync
 * when new config options are added.
 */

import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { toZonedTime } from "date-fns-tz";
import { formatDate, isTimeSeries, isTimeStamp } from "./dateTimeUtils";
import { getDataValue } from "./aliasUtils";

/**
 * Persisted `override_config` item type discriminants. Single source of truth
 * shared by the renderer parser (parseOverrideConfigs), the UI (de)serializers
 * (useColumnFormatting), and the Rust schema, so a rename can't silently desync.
 */
export const OVERRIDE_CONFIG_TYPES = {
  UNIT: "unit",
  UNIQUE_VALUE_COLOR: "unique_value_color",
  ALIGNMENT: "alignment",
  TEXT_COLOR: "text_color",
  BACKGROUND_COLOR: "background_color",
  CELL_TYPE: "cell_type",
  CONDITIONAL_STYLES: "conditional_styles",
} as const;

// ---------------------------------------------------------------------------
// Value-mapping helpers
// ---------------------------------------------------------------------------

/**
 * Strip regex literal delimiters if the user entered `/pattern/flags` syntax.
 * Returns the raw pattern and any flags so `new RegExp(pattern, flags)` works.
 */
export const parseRegexPattern = (
  input: string,
): { pattern: string; flags: string } => {
  const match = input.match(/^\/(.+)\/([gimsuy]*)$/);
  if (match) {
    return { pattern: match[1], flags: match[2] };
  }
  return { pattern: input, flags: "" };
};

/**
 * Build a fast-lookup cache from the panel's `config.mappings` array, keyed by
 * value / range / regex. Stores the full mapping object so both `text` and
 * `color` are recoverable (single engine for text and color resolution).
 */
export const buildValueMappingCache = (
  mappings: any,
): Map<any, any> | null => {
  if (!mappings || !Array.isArray(mappings)) {
    return null;
  }

  const cache = new Map<any, any>();

  mappings.forEach((mapping: any) => {
    if (!mapping) return;
    const hasText = mapping.text != null && mapping.text !== "";
    const hasColor = mapping.color != null && mapping.color !== "";
    if (!hasText && !hasColor) return;

    if (mapping.type === "regex") {
      // Regex mapping – stored with a special prefix; pattern tested during lookup
      cache.set(`__regex_${mapping.pattern ?? ""}`, mapping);
    } else if (mapping.from !== undefined && mapping.to !== undefined) {
      // Range mapping – encoded key so direct + range share the same Map
      cache.set(`__range_${mapping.from}_${mapping.to}`, mapping);
    } else if (mapping.value !== undefined && mapping.value !== null) {
      cache.set(mapping.value, mapping);
    }
  });

  return cache.size > 0 ? cache : null;
};

/**
 * Look up the first mapping object matching `value` (direct, then range, then
 * regex). When `requireField` is given, only mappings whose field is non-empty
 * match — mirroring the field-aware semantics of the previous linear scan.
 */
export const lookupValueMappingFull = (
  value: any,
  cache: Map<any, any> | null,
  requireField?: "text" | "color",
): any | null => {
  if (!cache) return null;

  const ok = (m: any) =>
    !requireField || (m && m[requireField] != null && m[requireField] !== "");

  // Direct match (then string-coerced, e.g. key "3" vs numeric value 3)
  let m = cache.get(value);
  if (m !== undefined && ok(m)) return m;

  const strValue = String(value);
  m = cache.get(strValue);
  if (m !== undefined && ok(m)) return m;

  // Range match (numbers only)
  if (typeof value === "number") {
    for (const [key, mapping] of cache.entries()) {
      if (typeof key === "string" && key.startsWith("__range_")) {
        const parts = key.split("_");
        const from = parseFloat(parts[3]);
        const to = parseFloat(parts[4]);
        if (!isNaN(from) && !isNaN(to) && value >= from && value <= to && ok(mapping)) {
          return mapping;
        }
      }
    }
  }

  // Regex match
  for (const [key, mapping] of cache.entries()) {
    if (typeof key === "string" && key.startsWith("__regex_")) {
      const rawPattern = key.slice(8); // "__regex_".length === 8
      try {
        const { pattern, flags } = parseRegexPattern(rawPattern);
        if (new RegExp(pattern, flags).test(strValue) && ok(mapping)) {
          return mapping;
        }
      } catch {
        // invalid regex pattern, skip
      }
    }
  }

  return null;
};

/** Look up the mapped display text for a value (null when none has text). */
export const lookupValueMapping = (
  value: any,
  cache: Map<any, any> | null,
): string | undefined | null => {
  const mapping = lookupValueMappingFull(value, cache, "text");
  return mapping ? mapping.text : null;
};

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

/**
 * Parse a potential timestamp value and return a timezone-aware formatted string.
 * Handles 16-digit microseconds, ISO strings, and standard milliseconds.
 */
export const parseTimestampValue = (
  value: any,
  timezone: string,
): string | null => {
  if (value === undefined || value === null || value === "") return null;

  let timestamp: number;

  // Handle 16-digit microseconds (string or number)
  if (
    (typeof value === "number" || typeof value === "string") &&
    /^\d{16}$/.test(value.toString())
  ) {
    timestamp = parseInt(value.toString()) / 1000;
  } else if (typeof value === "string") {
    // Already formatted "YYYY-MM-DD HH:mm:ss" — return as-is
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
      return value;
    }

    // ISO string with 'T' — treat as UTC if no offset
    const iso8601WithT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    const hasOffsetOrZ =
      /[+-]\d{2}(:?\d{2})?$/.test(value) || value.endsWith("Z");

    const isoString = iso8601WithT && !hasOffsetOrZ ? `${value}Z` : value;
    timestamp = new Date(isoString).getTime();

    if (isNaN(timestamp)) {
      timestamp = new Date(value).getTime();
    }
  } else if (typeof value === "number") {
    timestamp = value;
  } else if (value instanceof Date) {
    timestamp = value.getTime();
  } else {
    timestamp = new Date(value)?.getTime();
  }

  if (isNaN(timestamp)) return null;

  return formatDate(toZonedTime(timestamp, timezone));
};

/**
 * Detect which fields in `fields` are timestamp/time-series columns by
 * checking `functionName` and sampling actual row values.
 *
 * Returns a Set of field aliases that should be formatted as timestamps.
 * Used by both convertTableData and convertPivotTableData.
 */
export const detectTimestampFields = (
  fields: any[],
  tableRows: any[],
): Set<string> => {
  const result = new Set<string>();

  for (const field of fields) {
    if (field?.functionName === "histogram") {
      // Histogram fields always produce datetime values; format them as
      // timestamps regardless of the treatAsNonTimestamp flag so that values
      // like "2026-02-09T18:00:00" are always shown in timezone-aware
      // "YYYY-MM-DD HH:mm:ss" format.
      result.add(field.alias);
    } else {
      const sample = tableRows
        ?.slice(0, Math.min(20, tableRows.length))
        ?.map((it: any) => getDataValue(it, field.alias));
      const isTimeSeriesData = isTimeSeries(sample);
      const isTimeStampData = isTimeStamp(sample, field.treatAsNonTimestamp);

      if (isTimeSeriesData || isTimeStampData) {
        result.add(field.alias);
      }
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Override-config parsing
// ---------------------------------------------------------------------------

export interface ColorConfig {
  autoColor: boolean;
}

export interface UnitConfig {
  unit: string;
  customUnit: string;
}

export interface ColumnStyleConfig {
  alignment?: "left" | "center" | "right";
  textColor?: string;
  bgColor?: string;
}

export interface ConditionalRule {
  operator: "<" | ">" | "<=" | ">=" | "=" | "!=";
  threshold: number;
  textColor?: string;
  bgColor?: string;
}

export interface CellTypeConfig {
  type: "text" | "progress_bar" | "sparkline";
  progressColor?: string;
  sparklineStyle?: "line" | "bar";
}

export interface OverrideMaps {
  colorConfigMap: Record<string, ColorConfig>;
  unitConfigMap: Record<string, UnitConfig>;
  styleConfigMap: Record<string, ColumnStyleConfig>;
  cellTypeConfigMap: Record<string, CellTypeConfig>;
  conditionalRulesMap: Record<string, ConditionalRule[]>;
}

/**
 * Parse `config.override_config` into colour, unit, and style lookup maps
 * keyed by lower-cased field alias.
 * Each override entry may carry multiple config items in its `config[]` array.
 */
export const parseOverrideConfigs = (
  overrideConfigs: any[] | undefined,
): OverrideMaps => {
  const colorConfigMap: Record<string, ColorConfig> = {};
  const unitConfigMap: Record<string, UnitConfig> = {};
  const styleConfigMap: Record<string, ColumnStyleConfig> = {};
  const cellTypeConfigMap: Record<string, CellTypeConfig> = {};
  const conditionalRulesMap: Record<string, ConditionalRule[]> = {};

  if (!overrideConfigs) return { colorConfigMap, unitConfigMap, styleConfigMap, cellTypeConfigMap, conditionalRulesMap };

  for (const o of overrideConfigs) {
    const alias = o?.field?.value;
    if (!alias) continue;
    const aliasLower = alias.toLowerCase();

    for (const cfg of o?.config ?? []) {
      if (!cfg?.type) continue;
      switch (cfg.type) {
        case OVERRIDE_CONFIG_TYPES.UNIT:
          unitConfigMap[aliasLower] = {
            unit: cfg.value?.unit ?? "",
            customUnit: cfg.value?.customUnit ?? "",
          };
          break;
        case OVERRIDE_CONFIG_TYPES.UNIQUE_VALUE_COLOR:
          colorConfigMap[aliasLower] = { autoColor: !!cfg.autoColor };
          break;
        case OVERRIDE_CONFIG_TYPES.ALIGNMENT:
          styleConfigMap[aliasLower] = {
            ...styleConfigMap[aliasLower],
            alignment: cfg.value,
          };
          break;
        case OVERRIDE_CONFIG_TYPES.TEXT_COLOR:
          styleConfigMap[aliasLower] = {
            ...styleConfigMap[aliasLower],
            textColor: cfg.value,
          };
          break;
        case OVERRIDE_CONFIG_TYPES.BACKGROUND_COLOR:
          styleConfigMap[aliasLower] = {
            ...styleConfigMap[aliasLower],
            bgColor: cfg.value,
          };
          break;
        case OVERRIDE_CONFIG_TYPES.CELL_TYPE:
          cellTypeConfigMap[aliasLower] = {
            type: cfg.value?.type ?? "text",
            progressColor: cfg.value?.color ?? "",
            sparklineStyle: cfg.value?.sparklineStyle ?? "line",
          };
          break;
        case OVERRIDE_CONFIG_TYPES.CONDITIONAL_STYLES:
          conditionalRulesMap[aliasLower] = (cfg.rules ?? []).map((r: any) => ({
            operator: r.operator ?? "<",
            threshold: typeof r.threshold === "number" ? r.threshold : parseFloat(r.threshold) || 0,
            textColor: r.textColor ?? "",
            bgColor: r.bgColor ?? "",
          }));
          break;
      }
    }
  }

  return { colorConfigMap, unitConfigMap, styleConfigMap, cellTypeConfigMap, conditionalRulesMap };
};

/**
 * Apply parsed override maps (alignment, auto-color, text/bg color, cell type,
 * conditional rules) onto a renderer column object, keyed by lower-cased alias.
 * Shared by the table converters so override application can't drift between
 * the SQL, multi-query and PromQL paths.
 */
export const applyColumnOverrides = (
  obj: any,
  aliasLower: string,
  maps: OverrideMaps,
  defaultAlign: string,
): void => {
  const colStyle = maps.styleConfigMap?.[aliasLower];
  obj.align = colStyle?.alignment || defaultAlign;

  if (maps.colorConfigMap?.[aliasLower]?.autoColor) obj.colorMode = "auto";
  if (colStyle?.textColor) obj.textColor = colStyle.textColor;
  if (colStyle?.bgColor) obj.bgColor = colStyle.bgColor;

  const cellTypeCfg = maps.cellTypeConfigMap?.[aliasLower];
  if (cellTypeCfg?.type && cellTypeCfg.type !== "text") {
    obj.cellType = cellTypeCfg.type;
    if (cellTypeCfg.progressColor) obj.progressColor = cellTypeCfg.progressColor;
    if (cellTypeCfg.sparklineStyle) obj.sparklineStyle = cellTypeCfg.sparklineStyle;
  }

  const condRules = maps.conditionalRulesMap?.[aliasLower];
  if (condRules?.length) obj.conditionalRules = condRules;
};

/**
 * Auto-compute `progressMin`/`progressMax` for every `progress_bar` column from
 * the row data (min clamped to 0, extended for negative-only data). Mutates the
 * column objects. Shared by the SQL and PromQL converters.
 */
export const applyProgressBarBounds = (
  columns: any[] | undefined,
  rows: any[] | undefined,
): void => {
  if (!Array.isArray(columns) || !Array.isArray(rows)) return;

  for (const col of columns) {
    if (col?.cellType !== "progress_bar") continue;

    const fieldKey = col.field;
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      const v = parseFloat(String(row?.[fieldKey]));
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }

    if (max === -Infinity) {
      col.progressMin = 0;
      col.progressMax = 100;
    } else {
      col.progressMin = Math.min(0, min);
      col.progressMax = max;
    }
  }
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a numeric cell value:
 *  1. Check value mapping first (returns display text if matched)
 *  2. Otherwise apply unit / decimal formatting
 */
export const formatNumericValue = (
  val: any,
  valueMappingCache: Map<any, any> | null,
  unit: string | null | undefined,
  customUnit: string | null | undefined,
  decimals: number,
  missingValue = "",
): string => {
  if (val === null || val === undefined || val === "")
    return String(missingValue ?? "");

  const mapped = lookupValueMapping(val, valueMappingCache);
  if (mapped != null) return mapped;

  // !Number.isNaN (not typeof number) so numeric strings format too, matching
  // the converter's inline closures.
  return !Number.isNaN(val)
    ? `${formatUnitValue(getUnitValue(val, unit, customUnit, decimals)) ?? 0}`
    : val;
};
