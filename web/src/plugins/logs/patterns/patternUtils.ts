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

import { extractStatusFromTemplate, extractStatusFromLog } from "@/utils/logs/statusParser";

/**
 * Extract constant (non-variable) string segments from a pattern template.
 *
 * Pattern templates contain variable placeholders like <*>, <:TIMESTAMP>, etc.
 * This splits on those placeholders and returns segments longer than 10 chars,
 * which are the pattern's *invariant* text and therefore safe, distinctive
 * `match_all()` terms that select exactly that pattern's logs.
 *
 * NOTE: we deliberately do NOT fall back to wildcard sample values for
 * all-wildcard templates. Those values are per-log *examples*, not invariants —
 * `match_all('alice')` for `User <*> logged in` would return only Alice's logs
 * (and combining values across slots can yield a combination that never
 * occurred), so such patterns simply have no reliable Include/Exclude filter.
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

export type PatternSeverityKey = "error" | "warning" | "info" | "debug" | "uncategorized";

/**
 * Single source of truth for the log-level keywords the pattern feature
 * recognizes. Used to build both the "does this template carry a level"
 * matcher here and the inline-highlight matcher in PatternCard, so the two
 * can't drift. (Deliberately excludes ok/success — the pattern UI treats
 * those as uncategorized, unlike statusParser's broader set.)
 */
export const LEVEL_KEYWORD_PATTERN =
  "emergency|emerg|fatal|alert|critical|crit|error|err|warning|warn|notice|info|information|debug|trace|verbose";

// A template counts as carrying a severity only when a level keyword literally
// appears in it — otherwise statusParser's info-default would mislabel every
// level-less pattern as "info".
const EXPLICIT_LEVEL_RE = new RegExp(`\\b(${LEVEL_KEYWORD_PATTERN})\\b`, "i");

// Collapse statusParser's fine-grained level into one of the five filter buckets.
const levelToSeverityBucket = (level: string): PatternSeverityKey => {
  switch (level) {
    case "emergency":
    case "alert":
    case "critical":
    case "error":
      return "error";
    case "warning":
    case "notice":
      return "warning";
    case "debug":
      return "debug";
    default:
      return "info"; // info, ok
  }
};

/**
 * Bucket a pattern into one of the severity-filter groups by parsing a level
 * keyword out of its template. Templates with no level keyword are
 * "uncategorized".
 */
export const patternSeverityKey = (template: string): PatternSeverityKey => {
  if (!template || !EXPLICIT_LEVEL_RE.test(template)) return "uncategorized";
  return levelToSeverityBucket(extractStatusFromTemplate(template).level);
};

/**
 * Severity bucket for a pattern, preferring the backend-provided `level` — read
 * from the log's severity/level field using the same field-priority the logs
 * histogram uses — and normalized through the shared status parser (so numeric
 * syslog severities and string levels both resolve). Falls back to scraping the
 * template text only when no level field was present on the pattern's logs.
 */
export const patternSeverityKeyForPattern = (pattern: any): PatternSeverityKey => {
  const level = pattern?.level;
  if (level !== undefined && level !== null && String(level).trim() !== "") {
    return levelToSeverityBucket(extractStatusFromLog({ level }).level);
  }
  return patternSeverityKey(pattern?.template ?? "");
};

// Static per-severity text-color utility (also used via `bg-current` to fill
// dots, sparkline bars, and the count share bar). Literal strings so Tailwind's
// scanner emits every class.
const SEVERITY_TEXT_CLASS: Record<PatternSeverityKey, string> = {
  error: "text-severity-error-color",
  warning: "text-severity-warning-color",
  info: "text-status-info-text",
  debug: "text-label-chip-ts-text",
  uncategorized: "text-text-secondary",
};

export const severityTextClass = (key: PatternSeverityKey): string => SEVERITY_TEXT_CLASS[key];

/**
 * Severity text-color class for a single level keyword found inside template
 * text, or `null` when it isn't a recognized level. Routes through the same
 * `patternSeverityKey` → `severityTextClass` mapping the status column and
 * chips use, so inline level highlighting can never drift from them.
 */
export const levelColorClass = (levelWord: string): string | null => {
  const key = patternSeverityKey(levelWord);
  return key === "uncategorized" ? null : severityTextClass(key);
};

export type PatternTrendKind = "spike" | "new" | "drop";

// Thresholds mirror the shared RUM classifier (computeTrendAnnotation): the
// recent window averages >= 2x the baseline → spike, <= 0.5x → drop.
const SPIKE_FACTOR = 2;
const DROP_FACTOR = 0.5;

/**
 * Classify a pattern's volume trend from its time buckets for the row badge:
 * "new" when there was no earlier activity but there is recent activity, else
 * spike/drop by the recent-vs-baseline ratio, or `null` when flat.
 *
 * The recent window is the last up-to-4 buckets, with the rest as baseline. We
 * adapt the split to the bucket count (rather than a fixed >4 gate) so short
 * time windows — which the backend bins into few buckets — still surface a
 * trend instead of silently showing nothing. For >= 5 buckets this is identical
 * to a fixed last-4/rest split.
 */
export const patternTrendBadge = (buckets?: number[] | null): PatternTrendKind | null => {
  if (!buckets || buckets.length < 2) return null;
  const recentCount = Math.min(4, buckets.length - 1); // baseline always >= 1
  const recent = buckets.slice(-recentCount);
  const baseline = buckets.slice(0, -recentCount);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);
  if (sum(baseline) === 0 && sum(recent) > 0) return "new";
  const factor = avg(recent) / Math.max(avg(baseline), 0.01);
  if (factor >= SPIKE_FACTOR) return "spike";
  if (factor <= DROP_FACTOR) return "drop";
  return null;
};

export interface PatternBadgeDef {
  /** i18n key for the short badge label (as shown on the row chip). */
  labelKey: string;
  /** i18n key for the one-line legend description. */
  descKey: string;
  /** Token-utility classes for the chip (color pair). */
  class: string;
}

/**
 * Single source of truth for the row badges, shared by the pattern row
 * (PatternCard) and the legend (PatternList) so their labels/colors can't drift.
 * Colors come from existing status token pairs.
 */
export const PATTERN_BADGES: Record<string, PatternBadgeDef> = {
  spike: {
    labelKey: "logs.patternList.badgeSpike",
    descKey: "logs.patternList.badgeSpikeDesc",
    class: "text-status-warning-text bg-status-warning-bg",
  },
  new: {
    labelKey: "logs.patternList.badgeNew",
    descKey: "logs.patternList.badgeNewDesc",
    class: "text-status-info-text bg-status-info-bg",
  },
  drop: {
    labelKey: "logs.patternList.badgeDrop",
    descKey: "logs.patternList.badgeDropDesc",
    class: "text-status-success-text bg-status-success-bg",
  },
  rare: {
    labelKey: "logs.patternList.badgeRare",
    descKey: "logs.patternList.badgeRareDesc",
    class: "text-text-secondary border border-solid border-border-default",
  },
  anomaly: {
    labelKey: "search.anomalyLabel",
    descKey: "logs.patternList.badgeAnomalyDesc",
    class: "text-status-error-text bg-status-error-bg",
  },
};

/** Order the badges appear in the legend. */
export const PATTERN_BADGE_ORDER = ["spike", "new", "drop", "rare", "anomaly"];

/**
 * Describe a bucket width in the largest whole unit that fits, e.g. 1680s ->
 * "28 minutes". Takes the i18n `t` so the unit words and their plural forms come
 * from the locale rather than being built by string concatenation.
 */
export const formatBucketDuration = (
  seconds: number,
  t: (key: string, named: Record<string, unknown>) => string,
): string => {
  const s = Math.max(1, Math.round(seconds));
  if (s % 86400 === 0) return t("logs.patternList.durationDays", { n: s / 86400 });
  if (s % 3600 === 0) return t("logs.patternList.durationHours", { n: s / 3600 });
  if (s % 60 === 0) return t("logs.patternList.durationMinutes", { n: s / 60 });
  return t("logs.patternList.durationSeconds", { n: s });
};

/**
 * Compact large-number formatter for pattern counts:
 * 812 → "812", 1234 → "1.2K", 45600 → "46K", 1_234_567 → "1.2M".
 */
export const compactCount = (n: number): string => {
  if (n < 1000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
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
export const buildPatternSqlQuery = (template: string, streamName: string): string => {
  const constants = extractConstantsFromPattern(template);
  let sql = `SELECT * FROM '${streamName}'`;
  if (constants.length > 0) {
    const conditions = constants.map((c) => `match_all('${escapeForMatchAll(c)}')`);
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
