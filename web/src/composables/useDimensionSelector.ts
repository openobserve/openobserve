// Copyright 2025 OpenObserve Inc.
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
 * Smart dimension selection for volume/latency analysis
 * Combines schema metadata with actual data samples to select optimal grouping dimensions
 */

interface FieldMetadata {
  name: string;
  type?: string;
  isIndexed?: boolean;
  isFTS?: boolean;
  isInteresting?: boolean;
}

interface FieldStats {
  uniqueValues: Set<string>;
  occurrences: number;
  totalLength: number;
  nullCount: number;
}

interface ScoredField {
  fieldName: string;
  score: number;
  cardinality: number;
  coverage: number;
  avgLength: number;
  reason: string;
}

/**
 * Check if field name matches high-cardinality patterns (IDs, timestamps, etc.)
 */
function isHighCardinalityPattern(name: string): boolean {
  const badPatterns = [
    // IDs and unique identifiers
    /_id$/i, /_uuid$/i, /^id$/i, /_key$/i,
    /user_?id/i, /customer_?id/i, /session_?id/i, /request_?id/i,
    /trace_?id/i, /span_?id/i, /transaction_?id/i,
    /correlation_?id/i, /tracking_?id/i,

    // Timestamps
    /timestamp/i, /_time$/i, /_at$/i, /datetime/i,

    // Long text fields
    /message$/i, /msg$/i, /_message$/i, /^body$/i,
    /stack_?trace/i, /backtrace/i, /stack$/i,
    /description$/i, /^text$/i, /content$/i,

    // URLs and paths
    /^url$/i, /^uri$/i, /full_?path/i, /query_?string/i,
    /referer/i, /user_?agent/i,
  ];

  return badPatterns.some(pattern => pattern.test(name));
}

/**
 * Check if field name matches known good patterns (log levels, services, etc.)
 */
function matchesGoodPattern(name: string): boolean {
  const goodPatterns = [
    // Log metadata
    /^level$/i, /log_?level/i, /severity/i, /priority/i,

    // Service/Application
    /^service$/i, /service_?name/i, /^app/i, /application/i,
    /component/i, /module/i,

    // Environment
    /^env$/i, /environment/i, /^stage$/i, /deployment/i,

    // Infrastructure
    /^host$/i, /hostname/i, /^server$/i, /^node$/i,
    /pod_?name/i, /container/i, /^cluster$/i,
    /region$/i, /zone$/i, /datacenter/i, /availability/i,

    // HTTP
    /^status$/i, /status_?code/i, /http_?status/i, /response_?status/i,
    /^method$/i, /http_?method/i, /request_?method/i, /verb$/i,
    /^endpoint$/i, /^route$/i, /^handler$/i, /^path$/i,

    // Errors
    /error_?type/i, /exception_?type/i, /error_?code/i, /error_?class/i,
    /^category$/i, /^type$/i,

    // User context (non-PII)
    /user_?role/i, /user_?type/i, /^role$/i, /account_?type/i,

    // Versions
    /^version$/i, /build/i, /release/i,
  ];

  return goodPatterns.some(pattern => pattern.test(name));
}

/**
 * Check if field is a system/internal field
 */
function isSystemField(name: string): boolean {
  return name.startsWith('_') || name === 'o2_timestamp';
}

/**
 * Analyze field from log samples to gather statistics
 */
function analyzeFieldFromSamples(
  fieldName: string,
  logSamples: any[]
): FieldStats {
  const stats: FieldStats = {
    uniqueValues: new Set(),
    occurrences: 0,
    totalLength: 0,
    nullCount: 0,
  };

  logSamples.forEach(log => {
    const value = log[fieldName];

    if (value === null || value === undefined) {
      stats.nullCount++;
      return;
    }

    const stringValue = String(value);
    stats.uniqueValues.add(stringValue);
    stats.occurrences++;
    stats.totalLength += stringValue.length;
  });

  return stats;
}

/**
 * Score a field based on multiple criteria
 */
function scoreField(
  fieldName: string,
  fieldMeta: FieldMetadata | undefined,
  stats: FieldStats,
  sampleCount: number
): ScoredField {
  let score = 0;
  const reasons: string[] = [];

  // Calculate derived metrics
  const cardinality = stats.uniqueValues.size;
  const coverage = stats.occurrences / sampleCount;
  const avgLength = stats.occurrences > 0 ? stats.totalLength / stats.occurrences : 0;

  // IMMEDIATE DISQUALIFIERS

  // System fields
  if (isSystemField(fieldName)) {
    return {
      fieldName,
      score: -1000,
      cardinality,
      coverage,
      avgLength,
      reason: "System field (starts with _)",
    };
  }

  // High-cardinality pattern match
  if (isHighCardinalityPattern(fieldName)) {
    return {
      fieldName,
      score: -1000,
      cardinality,
      coverage,
      avgLength,
      reason: "High-cardinality pattern (IDs, timestamps, etc.)",
    };
  }

  // FTS fields are usually long text
  if (fieldMeta?.isFTS) {
    return {
      fieldName,
      score: -1000,
      cardinality,
      coverage,
      avgLength,
      reason: "Full-text search field",
    };
  }

  // Very long average length (likely free text)
  if (avgLength > 100) {
    return {
      fieldName,
      score: -1000,
      cardinality,
      coverage,
      avgLength,
      reason: `Too long (avg ${avgLength.toFixed(0)} chars)`,
    };
  }

  // POSITIVE SCORING

  // Coverage: Higher is better
  if (coverage >= 0.9) {
    score += 50;
    reasons.push("High coverage (90%+)");
  } else if (coverage >= 0.7) {
    score += 35;
    reasons.push("Good coverage (70%+)");
  } else if (coverage >= 0.5) {
    score += 20;
    reasons.push("Medium coverage (50%+)");
  } else if (coverage >= 0.3) {
    score += 10;
    reasons.push("Low coverage (30%+)");
  } else {
    score -= 30;
    reasons.push("Very low coverage (<30%)");
  }

  // Cardinality: Sweet spot is 2-50 unique values
  if (cardinality === 1) {
    score -= 50;
    reasons.push("Only 1 value (not useful)");
  } else if (cardinality >= 2 && cardinality <= 10) {
    score += 100;
    reasons.push(`Perfect cardinality (${cardinality} values)`);
  } else if (cardinality <= 20) {
    score += 80;
    reasons.push(`Good cardinality (${cardinality} values)`);
  } else if (cardinality <= 40) {
    score += 50;
    reasons.push(`Acceptable cardinality (${cardinality} values)`);
  } else if (cardinality <= 60) {
    score += 20;
    reasons.push(`High cardinality (${cardinality} values)`);
  } else {
    // Too many unique values relative to sample size
    const uniquenessRatio = cardinality / sampleCount;
    if (uniquenessRatio > 0.7) {
      score -= 100;
      reasons.push(`Too unique (${cardinality}/${sampleCount} = ${(uniquenessRatio * 100).toFixed(0)}%)`)
    } else {
      score -= 30;
      reasons.push(`Very high cardinality (${cardinality} values)`);
    }
  }

  // Schema metadata bonuses
  if (fieldMeta?.isIndexed) {
    score += 40;
    reasons.push("Indexed field");
  }

  if (fieldMeta?.isInteresting) {
    score += 100;
    reasons.push("User-marked interesting");
  }

  // Pattern matching bonuses
  if (matchesGoodPattern(fieldName)) {
    score += 60;
    reasons.push("Known good pattern");
  }

  return {
    fieldName,
    score,
    cardinality,
    coverage,
    avgLength,
    reason: reasons.join(", ") || "No specific reason",
  };
}

/**
 * Select best dimensions from log samples and schema metadata
 */
export function selectDimensionsFromData(
  logSamples: any[],
  schemaFields: FieldMetadata[],
  maxDimensions: number = 8
): string[] {
  if (logSamples.length < 10) {
    return selectDimensionsFromSchema(schemaFields, maxDimensions);
  }

  // Build schema metadata map
  const schemaMap = new Map<string, FieldMetadata>();
  schemaFields.forEach(field => {
    schemaMap.set(field.name, field);
  });

  // Get all unique field names from samples
  const fieldNames = new Set<string>();
  logSamples.forEach(log => {
    Object.keys(log).forEach(key => fieldNames.add(key));
  });

  // Analyze and score each field
  const scoredFields: ScoredField[] = [];
  fieldNames.forEach(fieldName => {
    const fieldMeta = schemaMap.get(fieldName);
    const stats = analyzeFieldFromSamples(fieldName, logSamples);
    const scored = scoreField(fieldName, fieldMeta, stats, logSamples.length);

    scoredFields.push(scored);
  });

  // Sort by score and take top N
  scoredFields.sort((a, b) => b.score - a.score);
  const selected = scoredFields
    .filter(f => f.score > 0)
    .slice(0, maxDimensions)
    .map(f => f.fieldName);

  // Fallback if no good dimensions found
  if (selected.length === 0) {
    return selectDimensionsFromSchema(schemaFields, maxDimensions);
  }

  return selected;
}

/**
 * Fallback: Select dimensions from schema only (when samples unavailable)
 */
function selectDimensionsFromSchema(
  schemaFields: FieldMetadata[],
  maxDimensions: number
): string[] {
  // Priority list for logs
  const logPriorityList = [
    "level", "log_level", "severity",
    "service", "service_name", "app", "application",
    "environment", "env",
    "host", "hostname", "server",
    "status", "status_code", "http_status",
    "method", "http_method", "request_method",
    "error_type", "exception_type", "error_code",
    "endpoint", "route", "path",
  ];

  const available = schemaFields
    .filter(f => !isSystemField(f.name) && !f.isFTS && !isHighCardinalityPattern(f.name))
    .map(f => f.name);

  // Try priority list first
  const selected = logPriorityList.filter(name => available.includes(name));

  // Add interesting/indexed fields
  const additionalFields = schemaFields
    .filter(f =>
      !selected.includes(f.name) &&
      available.includes(f.name) &&
      (f.isInteresting || f.isIndexed)
    )
    .map(f => f.name);

  selected.push(...additionalFields);

  return selected.slice(0, maxDimensions);
}

/**
 * Select dimensions for traces (uses OTel conventions)
 */
export function selectTraceDimensions(
  schemaFields: FieldMetadata[],
  maxDimensions: number = 8
): string[] {
  const prioritizedDimensions = [
    // Core OTel attributes
    "service_name",
    "span_kind",
    "span_status",
    "operation_name",
    "span_name",
    // HTTP
    "http_method",
    "http_status_code",
    "http_route",
    "http_target",
    // Database
    "db_system",
    "db_operation",
    "db_name",
    // Messaging
    "messaging_system",
    "messaging_operation",
    // RPC
    "rpc_system",
    "rpc_service",
    "rpc_method",
    // Infrastructure
    "host_name",
    "container_name",
    "k8s_pod_name",
    "k8s_namespace_name",
  ];

  const availableFields = new Set(schemaFields.map(f => f.name));
  const existing = prioritizedDimensions.filter(dim => availableFields.has(dim));

  if (existing.length === 0) {
    return ["service_name", "span_kind", "span_status", "operation_name"];
  }

  return existing.slice(0, maxDimensions);
}
