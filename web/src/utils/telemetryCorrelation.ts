// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type {
  ServiceMetadata,
  FieldAlias,
  CorrelationResponse,
  StreamInfo,
  ServiceIdentityConfig,
} from "@/services/service_streams";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";

/**
 * Telemetry Correlation Utilities
 *
 * Tools for correlating logs, traces, and metrics using service_streams data
 */

export type TelemetryType = "logs" | "traces" | "metrics";

export interface TelemetryContext {
  timestamp: number;
  fields: Record<string, any>;
  streamName?: string;
}

export interface CorrelationQuery {
  type: TelemetryType;
  stream: string;
  sql: string;
  filters: Record<string, any>;
  timeRange: {
    start: number;
    end: number;
  };
}

export interface CorrelationResult {
  service: ServiceMetadata;
  queries: CorrelationQuery[];
  correlationData?: CorrelationResponse; // New: detailed correlation info from API
}

/**
 * Extract semantic dimensions from telemetry context
 *
 * Maps raw field names to semantic dimension IDs using semantic groups.
 *
 * @param context - The telemetry context containing fields
 * @param semanticGroups - Semantic field group definitions
 * @param stableOnly - If true, only extract stable dimensions (for correlation).
 *                     Unstable dimensions (pod-id, pod-start-time, etc.) change
 *                     on pod restarts and should not be used for service matching.
 */
export function extractSemanticDimensions(
  context: TelemetryContext,
  semanticGroups: FieldAlias[],
  stableOnly: boolean = false
): Record<string, string> {
  const dimensions: Record<string, string> = {};

  // Iterate groups and their fields in definition order (same as backend processor.rs).
  // First field found in context.fields wins — deterministic, matches ingestion behaviour.
  for (const group of semanticGroups) {
    if (stableOnly && !(group.is_stable ?? false)) {
      continue;
    }
    for (const field of group.fields) {
      const value = context.fields[field];
      if (value !== null && value !== undefined) {
        dimensions[group.id] = String(value);
        break; // first match by group definition order wins
      }
    }
  }

  return dimensions;
}

/**
 * Build a reverse mapping from field name (lowercase) to schematic group ID.
 * Uses definition-order priority: first FieldAlias that includes the field wins.
 * This is the inverse of extractSemanticDimensions.
 *
 * Use this to deduplicate fields by their semantic group when building queries
 * from multiple correlated streams that may use different field names for the
 * same conceptual dimension.
 */
export function buildFieldToGroupIdMap(
  semanticGroups: FieldAlias[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of semanticGroups) {
    for (const field of group.fields) {
      const lower = field.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, group.id);
      }
    }
  }
  return map;
}

/**
 * Filter dimensions to only include fields that are actually used for disambiguation
 *
 * This implements the same logic as the backend to determine which dimensions are relevant
 * for service matching. This reduces the amount of data sent to the _correlate API and
 * ensures we only send dimensions that the backend will actually use.
 *
 * Logic matches backend processor.rs:
 * 1. Use distinguish_by fields from all identity sets (union), OR
 * 2. Use tracked_alias_ids as fallback
 * 3. Always include "service" dimension if present
 *
 * @param allDimensions - All extracted semantic dimensions
 * @param identityConfig - Service identity configuration
 * @returns Filtered dimensions containing only disambiguation fields
 */
export function filterDimensionsForCorrelation(
  allDimensions: Record<string, string>,
  identityConfig: ServiceIdentityConfig
): Record<string, string> {
  // Determine selected fields (same logic as backend)
  let selectedFields: string[] = [];

  if (identityConfig.sets && identityConfig.sets.length > 0) {
    // Use distinguish_by fields from ALL identity sets (union of all sets)
    const allDistinguishByFields = new Set<string>();
    for (const set of identityConfig.sets) {
      if (set.distinguish_by) {
        set.distinguish_by.forEach(field => allDistinguishByFields.add(field));
      }
    }
    selectedFields = Array.from(allDistinguishByFields);
    console.log(`[filterDimensionsForCorrelation] Using distinguish_by from all identity sets:`, selectedFields);
  } else if (identityConfig.tracked_alias_ids && identityConfig.tracked_alias_ids.length > 0) {
    // Fallback to tracked_alias_ids
    selectedFields = identityConfig.tracked_alias_ids;
    console.log(`[filterDimensionsForCorrelation] Using tracked_alias_ids fallback:`, selectedFields);
  } else {
    console.log(`[filterDimensionsForCorrelation] No identity config available, using all dimensions`);
    // No config available, return all dimensions
    return allDimensions;
  }

  // Include selected fields. Add "service" only when not in service_optional mode —
  // including it would make the backend take the service-name fast path and ignore the
  // service_optional toggle (which only triggers when `service` is absent from input).
  const fieldsToKeep = new Set<string>(selectedFields);
  if (!identityConfig.service_optional) {
    fieldsToKeep.add("service");
  }

  // Filter dimensions to only include fields we need
  const filtered = Object.fromEntries(
    Object.entries(allDimensions).filter(([key]) => fieldsToKeep.has(key))
  );

  console.log(`[filterDimensionsForCorrelation] Filtered dimensions:`, {
    fieldsToKeep: Array.from(fieldsToKeep),
    originalCount: Object.keys(allDimensions).length,
    filteredCount: Object.keys(filtered).length,
    original: allDimensions,
    filtered
  });

  return filtered;
}

/**
 * Translate dimensions to field names for a specific telemetry type
 *
 * Uses semantic groups to map dimension IDs to actual field names
 */
function translateDimensionsToFields(
  dimensions: Record<string, string>,
  semanticGroups: FieldAlias[]
): Array<{ dimensionId: string; possibleFields: string[]; value: string }> {
  const translations: Array<{ dimensionId: string; possibleFields: string[]; value: string }> = [];

  for (const [dimensionId, value] of Object.entries(dimensions)) {
    const group = semanticGroups.find((g) => g.id === dimensionId);
    if (group) {
      translations.push({
        dimensionId,
        possibleFields: group.fields,
        value,
      });
    }
  }

  return translations;
}

/**
 * Build WHERE clause conditions using exact field names from StreamInfo.filters
 *
 * Uses the exact field names returned by the _correlate API instead of semantic variations.
 * Skips filters with SELECT_ALL_VALUE (wildcard - means match all values).
 */
function buildExactDimensionConditions(
  filters: Record<string, string>
): string[] {
  const conditions: string[] = [];

  for (const [fieldName, value] of Object.entries(filters)) {
    // Skip SELECT_ALL_VALUE wildcards - these mean "match all values"
    if (value === SELECT_ALL_VALUE) {
      continue;
    }
    // Escape single quotes in value
    const escapedValue = value.replace(/'/g, "''");
    conditions.push(`${fieldName} = '${escapedValue}'`);
  }

  return conditions;
}

/**
 * Generate trace query using exact field names from StreamInfo
 * Timestamp is NOT included in SQL - it's passed as separate from/to query params
 *
 * Uses only the filters from StreamInfo (same as logs/metrics) - service_name
 * is already included in filters if present.
 */
export function buildTraceQuery(
  streamInfo: StreamInfo,
  context: TelemetryContext,
  timeWindowMinutes: number = 5,
  matchedDimensions: Record<string, string> = {}
): CorrelationQuery {
  const conditions: string[] = [];

  const dimensionConditions = buildExactDimensionConditions(matchedDimensions);
  conditions.push(...dimensionConditions);

  // Build SQL WITHOUT timestamp (timestamp passed separately as from/to)
  let sql = `SELECT * FROM "${streamInfo.stream_name}"`;
  if (conditions.length > 0) {
    sql += `\nWHERE ${conditions.join("\n  AND ")}`;
  }
  sql += `\nORDER BY _timestamp DESC\nLIMIT 100`;

  // Calculate time range
  const timeWindowMicros = timeWindowMinutes * 60 * 1000000;
  const startTime = context.timestamp - timeWindowMicros;
  const endTime = context.timestamp + timeWindowMicros;

  return {
    type: "traces",
    stream: streamInfo.stream_name,
    sql,
    filters: matchedDimensions,
    timeRange: {
      start: startTime,
      end: endTime,
    },
  };
}

/**
 * Generate metrics query using exact field names from StreamInfo
 * Timestamp is NOT included in SQL - it's passed as separate from/to query params
 *
 * StreamInfo.filters contains the actual labels that exist in this specific metric stream.
 * These were captured when the metric was processed and stored.
 */
export function buildMetricQuery(
  streamInfo: StreamInfo,
  context: TelemetryContext,
  timeWindowMinutes: number = 5,
  matchedDimensions: Record<string, string> = {}
): CorrelationQuery {
  const conditions: string[] = [];

  const dimensionConditions = buildExactDimensionConditions(matchedDimensions);
  conditions.push(...dimensionConditions);

  // Build SQL WITHOUT timestamp (timestamp passed separately as from/to)
  let sql = `SELECT * FROM "${streamInfo.stream_name}"`;
  if (conditions.length > 0) {
    sql += `\nWHERE ${conditions.join("\n  AND ")}`;
  }
  sql += `\nORDER BY _timestamp DESC\nLIMIT 100`;

  // Calculate time range
  const timeWindowMicros = timeWindowMinutes * 60 * 1000000;
  const startTime = context.timestamp - timeWindowMicros;
  const endTime = context.timestamp + timeWindowMicros;

  return {
    type: "metrics",
    stream: streamInfo.stream_name,
    sql,
    filters: matchedDimensions,
    timeRange: {
      start: startTime,
      end: endTime,
    },
  };
}

/**
 * Generate logs query using exact field names from StreamInfo
 * Timestamp is NOT included in SQL - it's passed as separate from/to query params
 */
export function buildLogQuery(
  streamInfo: StreamInfo,
  context: TelemetryContext,
  timeWindowMinutes: number = 5,
  matchedDimensions: Record<string, string> = {}
): CorrelationQuery {
  const conditions: string[] = [];

  const dimensionConditions = buildExactDimensionConditions(matchedDimensions);
  conditions.push(...dimensionConditions);

  // Build SQL WITHOUT timestamp (timestamp passed separately as from/to)
  let sql = `SELECT * FROM "${streamInfo.stream_name}"`;
  if (conditions.length > 0) {
    sql += `\nWHERE ${conditions.join("\n  AND ")}`;
  }
  sql += `\nORDER BY _timestamp DESC\nLIMIT 100`;

  // Calculate time range
  const timeWindowMicros = timeWindowMinutes * 60 * 1000000;
  const startTime = context.timestamp - timeWindowMicros;
  const endTime = context.timestamp + timeWindowMicros;

  return {
    type: "logs",
    stream: streamInfo.stream_name,
    sql,
    filters: matchedDimensions,
    timeRange: {
      start: startTime,
      end: endTime,
    },
  };
}

/**
 * Generate all correlation queries using data from the _correlate API
 *
 * This function uses the StreamInfo objects returned by the API which contain
 * exact field names for each stream, ensuring queries match actual field names.
 */
export function generateCorrelationQueries(
  service: ServiceMetadata,
  context: TelemetryContext,
  sourceType: TelemetryType,
  semanticGroups: FieldAlias[],
  timeWindowMinutes: number = 5,
  correlationData?: CorrelationResponse
): CorrelationQuery[] {
  const queries: CorrelationQuery[] = [];

  // If we have correlation data from the API, use matched_dimensions for WHERE clauses
  if (correlationData) {
    const dims = correlationData.matched_dimensions ?? {};

    if (sourceType !== "traces") {
      for (const streamInfo of correlationData.related_streams.traces) {
        queries.push(buildTraceQuery(streamInfo, context, timeWindowMinutes, dims));
      }
    }

    if (sourceType !== "metrics") {
      for (const streamInfo of correlationData.related_streams.metrics) {
        queries.push(buildMetricQuery(streamInfo, context, timeWindowMinutes, dims));
      }
    }

    if (sourceType !== "logs") {
      for (const streamInfo of correlationData.related_streams.logs) {
        queries.push(buildLogQuery(streamInfo, context, timeWindowMinutes, dims));
      }
    }
  }

  return queries;
}

/**
 * Find matching service by dimensions
 *
 * Searches through services to find ones matching extracted dimensions
 */
export function findMatchingService(
  services: ServiceMetadata[],
  dimensions: Record<string, string>
): ServiceMetadata | null {
  // Find service with most matching dimensions
  let bestMatch: ServiceMetadata | null = null;
  let bestMatchScore = 0;

  for (const service of services) {
    let matchScore = 0;

    for (const [dimId, dimValue] of Object.entries(dimensions)) {
      if (service.dimensions[dimId] === dimValue) {
        matchScore++;
      }
    }

    // Require at least one dimension match
    if (matchScore > 0 && matchScore > bestMatchScore) {
      bestMatch = service;
      bestMatchScore = matchScore;
    }
  }

  return bestMatch;
}
