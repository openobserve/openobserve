// Copyright 2025 OpenObserve Inc.
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
  SemanticFieldGroup,
  CorrelationResponse,
  StreamInfo,
} from "@/services/service_streams";

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
 * Maps raw field names to semantic dimension IDs using semantic groups
 */
export function extractSemanticDimensions(
  context: TelemetryContext,
  semanticGroups: SemanticFieldGroup[]
): Record<string, string> {
  const dimensions: Record<string, string> = {};

  // Build reverse lookup: field name -> dimension ID
  const fieldToDimension = new Map<string, string>();
  for (const group of semanticGroups) {
    for (const field of group.fields) {
      fieldToDimension.set(field, group.id);
    }
  }

  // Extract dimensions from context fields
  for (const [fieldName, value] of Object.entries(context.fields)) {
    const dimensionId = fieldToDimension.get(fieldName);
    if (dimensionId && value !== null && value !== undefined) {
      dimensions[dimensionId] = String(value);
    }
  }

  return dimensions;
}

/**
 * Translate dimensions to field names for a specific telemetry type
 *
 * Uses semantic groups to map dimension IDs to actual field names
 */
function translateDimensionsToFields(
  dimensions: Record<string, string>,
  semanticGroups: SemanticFieldGroup[]
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
 * Uses the exact field names returned by the _correlate API instead of semantic variations
 */
function buildExactDimensionConditions(
  filters: Record<string, string>
): string[] {
  const conditions: string[] = [];

  for (const [fieldName, value] of Object.entries(filters)) {
    // Escape single quotes in value
    const escapedValue = value.replace(/'/g, "''");
    conditions.push(`${fieldName} = '${escapedValue}'`);
  }

  return conditions;
}

/**
 * Generate trace query using exact field names from StreamInfo
 * Timestamp is NOT included in SQL - it's passed as separate from/to query params
 */
export function buildTraceQuery(
  serviceName: string,
  streamInfo: StreamInfo,
  context: TelemetryContext,
  timeWindowMinutes: number = 5
): CorrelationQuery {
  const conditions: string[] = [];

  // Add service name condition
  const escapedServiceName = serviceName.replace(/'/g, "''");
  conditions.push(`service_name = '${escapedServiceName}'`);

  // Add dimension conditions using exact field names from StreamInfo.filters
  const dimensionConditions = buildExactDimensionConditions(streamInfo.filters);
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
    filters: streamInfo.filters,
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
  timeWindowMinutes: number = 5
): CorrelationQuery {
  const conditions: string[] = [];

  // Add dimension conditions using exact field names from StreamInfo.filters
  // These filters contain ONLY the labels that actually exist in this metric stream
  const dimensionConditions = buildExactDimensionConditions(streamInfo.filters);
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
    filters: streamInfo.filters,
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
  timeWindowMinutes: number = 5
): CorrelationQuery {
  const conditions: string[] = [];

  // Add dimension conditions using exact field names from StreamInfo.filters
  const dimensionConditions = buildExactDimensionConditions(streamInfo.filters);
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
    filters: streamInfo.filters,
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
  semanticGroups: SemanticFieldGroup[],
  timeWindowMinutes: number = 5,
  correlationData?: CorrelationResponse
): CorrelationQuery[] {
  const queries: CorrelationQuery[] = [];

  // If we have correlation data from the API, use the exact StreamInfo with field names
  if (correlationData) {
    const serviceName = correlationData.service_name;

    // Generate queries for each target type (excluding source type)
    if (sourceType !== "traces") {
      for (const streamInfo of correlationData.related_streams.traces) {
        queries.push(buildTraceQuery(serviceName, streamInfo, context, timeWindowMinutes));
      }
    }

    if (sourceType !== "metrics") {
      for (const streamInfo of correlationData.related_streams.metrics) {
        queries.push(buildMetricQuery(streamInfo, context, timeWindowMinutes));
      }
    }

    if (sourceType !== "logs") {
      for (const streamInfo of correlationData.related_streams.logs) {
        queries.push(buildLogQuery(streamInfo, context, timeWindowMinutes));
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
