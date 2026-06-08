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

/** Build a fast-lookup cache from the panel's `config.mappings` array. */
export const buildValueMappingCache = (
  mappings: any,
): Map<any, string> | null => {
  if (!mappings || !Array.isArray(mappings)) {
    return null;
  }

  const cache = new Map<any, string>();

  mappings.forEach((mapping: any) => {
    if (mapping && mapping.text != null && mapping.text !== "") {
      if (mapping.type === "regex") {
        // Regex mapping – stored with a special prefix; pattern tested during lookup
        cache.set(`__regex_${mapping.pattern ?? ""}`, mapping.text);
      } else if (mapping.from !== undefined && mapping.to !== undefined) {
        // Range mapping – encoded key so direct + range share the same Map
        cache.set(`__range_${mapping.from}_${mapping.to}`, mapping.text);
      } else if (mapping.value !== undefined && mapping.value !== null) {
        cache.set(mapping.value, mapping.text);
      }
    }
  });

  return cache.size > 0 ? cache : null;
};

/** Look up a value in the pre-built mapping cache (direct then range). */
export const lookupValueMapping = (
  value: any,
  cache: Map<any, string> | null,
): string | undefined | null => {
  if (!cache) return null;

  // Direct match
  if (cache.has(value)) {
    return cache.get(value);
  }

  // Coerce to string once – mapping values are always stored as strings (from the
  // UI text input) but cell data may be numeric. Reused for range, and regex checks.
  const strValue = String(value);

  // String coercion fallback e.g. key "3" vs numeric value 3
  if (cache.has(strValue)) {
    return cache.get(strValue);
  }

  // Range match (numbers only)
  if (typeof value === "number") {
    const entries = Array.from(cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, text] = entries[i];
      if (typeof key === "string" && key.startsWith("__range_")) {
        const parts = key.split("_");
        const from = parseFloat(parts[3]);
        const to = parseFloat(parts[4]);
        if (!isNaN(from) && !isNaN(to) && value >= from && value <= to) {
          return text;
        }
      }
    }
  }

  // Regex match
  for (const [key, text] of cache.entries()) {
    if (typeof key === "string" && key.startsWith("__regex_")) {
      const rawPattern = key.slice(8); // "__regex_".length === 8
      try {
        const { pattern, flags } = parseRegexPattern(rawPattern);
        if (new RegExp(pattern, flags).test(strValue)) {
          return text;
        }
      } catch {
        // invalid regex pattern, skip
      }
    }
  }

  return null;
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

export interface OverrideMaps {
  colorConfigMap: Record<string, ColorConfig>;
  unitConfigMap: Record<string, UnitConfig>;
}

/**
 * Parse `config.override_config` into colour and unit lookup maps
 * keyed by lower-cased field alias.
 */
export const parseOverrideConfigs = (
  overrideConfigs: any[] | undefined,
): OverrideMaps => {
  const colorConfigMap: Record<string, ColorConfig> = {};
  const unitConfigMap: Record<string, UnitConfig> = {};

  if (!overrideConfigs) return { colorConfigMap, unitConfigMap };

  for (const o of overrideConfigs) {
    const alias = o?.field?.value;
    const cfg = o?.config?.[0];
    if (alias && cfg) {
      const aliasLower = alias.toLowerCase();
      if (cfg.type === "unique_value_color") {
        colorConfigMap[aliasLower] = { autoColor: cfg.autoColor };
      } else if (cfg.type === "unit") {
        unitConfigMap[aliasLower] = {
          unit: cfg.value?.unit ?? "",
          customUnit: cfg.value?.customUnit ?? "",
        };
      }
    }
  }

  return { colorConfigMap, unitConfigMap };
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
  valueMappingCache: Map<any, string> | null,
  unit: string | null | undefined,
  customUnit: string | null | undefined,
  decimals: number,
  missingValue?: string,
): string => {
  if (val === null || val === undefined) return String(missingValue ?? "");

  const mapped = lookupValueMapping(val, valueMappingCache);
  if (mapped != null) return mapped;

  return typeof val === "number" && !Number.isNaN(val)
    ? `${formatUnitValue(getUnitValue(val, unit, customUnit, decimals)) ?? 0}`
    : val;
};
