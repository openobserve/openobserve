// Copyright 2023 OpenObserve Inc.
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

import {
  formatUnitValue,
  getUnitValue,
} from "./convertDataIntoUnitValue";

// ---------------------------------------------------------------------------
// Value-mapping helpers
// ---------------------------------------------------------------------------

/** Build a fast-lookup cache from the panel's `config.mappings` array. */
export const buildValueMappingCache = (
  mappings: any,
): Map<any, string> | null => {
  if (!mappings || !Array.isArray(mappings)) {
    return null;
  }

  const cache = new Map<any, string>();

  mappings.forEach((mapping: any) => {
    if (mapping && mapping.text) {
      if (mapping.from !== undefined && mapping.to !== undefined) {
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

  // Range match (numbers only)
  if (typeof value === "number") {
    const entries = Array.from(cache.entries());
    for (let i = 0; i < entries.length; i++) {
      const [key, text] = entries[i];
      if (typeof key === "string" && key.startsWith("__range_")) {
        const parts = key.split("_");
        const from = parseFloat(parts[2]);
        const to = parseFloat(parts[3]);
        if (!isNaN(from) && !isNaN(to) && value >= from && value <= to) {
          return text;
        }
      }
    }
  }

  return null;
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
  if (val === null || val === undefined)
    return String(missingValue ?? "");

  const mapped = lookupValueMapping(val, valueMappingCache);
  if (mapped != null) return mapped;

  return typeof val === "number" && !Number.isNaN(val)
    ? `${formatUnitValue(getUnitValue(val, unit, customUnit, decimals)) ?? 0}`
    : val;
};
