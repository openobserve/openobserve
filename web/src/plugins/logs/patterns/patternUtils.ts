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
 * Extract constant (non-variable) string segments from a pattern template.
 *
 * Pattern templates contain variable placeholders like <*>, <:TIMESTAMP>, etc.
 * This splits on those placeholders and returns segments longer than 10 chars,
 * which are safe to use as match_all() search terms.
 */
export const extractConstantsFromPattern = (template: string): string[] => {
  const constants: string[] = [];
  const parts = template.split(/<[*:][^>]*>/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 10) {
      constants.push(trimmed);
    }
  }
  return constants;
};

/**
 * Escape a string for use inside a match_all('...') SQL clause.
 * Order matters: backslash must be escaped first.
 */
export const escapeForMatchAll = (str: string): string => {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
};

/**
 * Build a SQL query for a pattern against a given stream.
 * Returns a SELECT * with match_all() WHERE clauses for each constant segment.
 */
export const buildPatternSqlQuery = (
  template: string,
  streamName: string,
): string => {
  const constants = extractConstantsFromPattern(template);
  let sql = `SELECT * FROM '${streamName}'`;
  if (constants.length > 0) {
    const conditions = constants.map(
      (c) => `match_all('${escapeForMatchAll(c)}')`,
    );
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  return sql;
};

/**
 * Derive a human-readable alert name from a pattern template and stream name.
 * Prefixes with "Anomaly" or "Alert", includes stream name, caps at 60 chars.
 */
export const buildAlertNameFromPattern = (
  template: string,
  streamName: string,
  isAnomaly: boolean,
): string => {
  const prefix = isAnomaly ? "Anomaly" : "Alert";
  const words = template
    .replace(/<[^>]*>/g, " ")
    .split(/[\s\W]+/)
    .filter((w) => /[a-zA-Z]{2,}/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .slice(0, 5);
  const suffix = words.length > 0 ? words.join("_") : streamName;
  const name = `${prefix}_${streamName}_${suffix}`;
  return name.slice(0, 60).replace(/_+$/, "");
};

export interface PatternAlertData {
  streamName: string;
  streamType: string;
  sqlQuery: string;
  patternTemplate: string;
  alertName: string;
  periodMinutes: number;
  patternId: string;
  patternFrequency: number;
  patternPercentage: number;
  isAnomaly: boolean;
  totalLogsAnalyzed: number;
}

/**
 * Build the full patternData payload used to pre-fill the AddAlert form.
 */
// ── Frequency bar color thresholds ──
export const FREQUENCY_BAR_THRESHOLD_HIGH = 5;
export const FREQUENCY_BAR_THRESHOLD_MID = 20;

export const getFrequencyBarColor = (
  percentage: number,
  isAnomaly: boolean,
): string => {
  if (isAnomaly) return "var(--o2-anomaly-bar, #ef4444)";
  if (percentage >= FREQUENCY_BAR_THRESHOLD_HIGH)
    return "var(--o2-primary-color)";
  if (percentage >= 1)
    return "var(--o2-secondary-bar, #f59e0b)";
  return "var(--o2-text-muted, #9ca3af)";
};

// ── Pattern clustering ──
export const extractConstantKey = (template: string): string => {
  return template.replace(/<[:*][^>]*>/g, "<*>");
};

export interface PatternCluster {
  basePattern: string;
  variations: any[];
  totalFrequency: number;
  totalPercentage: number;
}

export const clusterPatterns = (patterns: any[]): PatternCluster[] => {
  const groups = new Map<string, PatternCluster>();
  for (const p of patterns) {
    const key = extractConstantKey(p.template ?? "");
    const existing = groups.get(key);
    if (existing) {
      existing.variations.push(p);
      existing.totalFrequency += p.frequency ?? 0;
      existing.totalPercentage += p.percentage ?? 0;
    } else {
      groups.set(key, {
        basePattern: key,
        variations: [p],
        totalFrequency: p.frequency ?? 0,
        totalPercentage: p.percentage ?? 0,
      });
    }
  }
  return Array.from(groups.values());
};

// ── CSV export ──
export const exportPatternsAsCSV = (patterns: any[]): string => {
  const headers = [
    "Template",
    "Description",
    "Frequency",
    "Percentage",
    "Is Anomaly",
    "Pattern ID",
  ];
  const rows = patterns.map((p: any) => [
    `"${(p.template ?? "").replace(/"/g, '""')}"`,
    `"${(p.description ?? "").replace(/"/g, '""')}"`,
    p.frequency ?? 0,
    (p.percentage ?? 0).toFixed(2),
    p.is_anomaly ? "Yes" : "No",
    p.pattern_id ?? "",
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
};

export const buildPatternAlertData = (
  pattern: any,
  streamName: string,
  periodMinutes: number,
  totalLogsAnalyzed: number,
): PatternAlertData => {
  const isAnomaly = !!pattern.is_anomaly;
  return {
    streamName,
    streamType: "logs",
    sqlQuery: buildPatternSqlQuery(pattern.template, streamName),
    patternTemplate: pattern.template,
    alertName: buildAlertNameFromPattern(pattern.template, streamName, isAnomaly),
    periodMinutes,
    patternId: pattern.pattern_id || "",
    patternFrequency: pattern.frequency || 0,
    patternPercentage: pattern.percentage || 0,
    isAnomaly,
    totalLogsAnalyzed,
  };
};
