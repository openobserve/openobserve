//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { shallowRef, toRaw } from "vue";

/**
 * Status Parser for Log Entries
 * =============================
 * Extracts and parses log severity/status information from log entries.
 *
 * Supported Input Formats:
 * - OTEL/Syslog numeric levels (0-7): { "severity": 0 } → info (OTEL UNSPECIFIED)
 * - Syslog numeric levels (1-7): { "syslog.severity": 3 } → error
 * - String levels: { "level": "ERROR" } → error
 * - Custom status fields: { "status": "warning" } → warning
 *
 * Priority System (1 = highest, 8 = lowest):
 * 0: UNSPECIFIED (mapped to info, priority 6)
 * 1: alert, 2: critical, 3: error, 4: warning,
 * 5: notice, 6: info, 7: debug, 8: ok/success
 *
 * Examples:
 * - extractStatusFromLog({ "severity": 0 }) → { level: "info", color: "#1E88E5", priority: 6 }
 * - extractStatusFromLog({ "level": "ERROR" }) → { level: "error", color: "#EF5350", priority: 3 }
 * - extractStatusFromLog({ "syslog.severity": 4 }) → { level: "warning", color: "#FB8C00", priority: 4 }
 * - extractStatusFromLog({ "status": "ok" }) → { level: "ok", color: "#43A047", priority: 8 }
 */

export interface StatusInfo {
  level: string;
  color: string;
  priority: number;
}

/**
 * Color mapping for different log levels
 * Keys must stay aligned with SEMANTIC_COLORS_LIGHT / SEMANTIC_COLORS_DARK in convertLogData.ts.
 */
export const STATUS_COLORS = {
  emergency: "#E53935", // aligned with convertLogData fatal/emergency
  alert: "#ea580c",
  critical: "#F4511E", // aligned with convertLogData critical
  error: "#EF5350", // aligned with convertLogData error
  warning: "#FB8C00", // aligned with convertLogData warn/warning
  notice: "#16a34a",
  info: "#1E88E5", // aligned with convertLogData info
  debug: "#00ACC1", // aligned with convertLogData debug
  ok: "#43A047", // aligned with convertLogData success/ok
} as const;

/**
 * Dark-mode color overrides sourced from convertLogData.ts SEMANTIC_COLORS_DARK.
 * Categories without a convertLogData dark equivalent (alert, notice) fall back to STATUS_COLORS.
 */
export const STATUS_COLORS_DARK: Partial<Record<keyof typeof STATUS_COLORS, string>> = {
  emergency: "#E07070",
  critical: "#DC6030",
  error: "#D95C5C",
  warning: "#D4944A",
  info: "#4D8FD4",
  debug: "#3DAAB8",
  ok: "#4DAD55",
};

/**
 * Standard field names to search for status information
 * Ordered by preference - first match will be used
 */
const STATUS_FIELDS = ["severity", "level", "log_level", "syslog.severity", "status"] as const;

/**
 * Regex to find a standalone log-level keyword in a template or log message string.
 * Matches common syslog / OTEL levels at word boundaries (e.g. "INFO", "ERROR").
 */
const TEMPLATE_LEVEL_RE =
  /\b(emergency|emerg|fatal|alert|critical|crit|error|err|warning|warn|notice|info|information|debug|trace|verbose|ok|success)\b/i;

/**
 * Extract status color from a pattern template or example log message string.
 *
 * Searches the text for a recognised log-level keyword and delegates to
 * `extractStatusFromLog` so the existing colour logic stays in one place.
 *
 * @param text - Pattern template or example log message string
 * @param isDark - Whether dark-mode colours should be used
 * @returns StatusInfo with level, color, and priority (defaults to info)
 */
export function extractStatusFromTemplate(text: string, isDark = false): StatusInfo {
  if (!text || typeof text !== "string") {
    return extractStatusFromLog(null, isDark);
  }
  const match = text.match(TEMPLATE_LEVEL_RE);
  if (match) {
    return extractStatusFromLog({ level: match[1] }, isDark);
  }
  return extractStatusFromLog(null, isDark);
}

/**
 * Extracts status information from a log entry object
 * Searches through common status field names and parses the value
 *
 * @param logEntry - The log entry object to analyze
 * @returns StatusInfo with level, color, and priority
 */
export function extractStatusFromLog(logEntry: any, isDark = false): StatusInfo {
  if (!logEntry || typeof logEntry !== "object") {
    return {
      level: "info",
      color: isDark ? (STATUS_COLORS_DARK.info ?? STATUS_COLORS.info) : STATUS_COLORS.info,
      priority: 6,
    };
  }

  // Search through predefined status fields in order of preference.
  for (const field of STATUS_FIELDS) {
    let statusValue = logEntry[field];

    if (statusValue !== undefined && statusValue !== null) {
      // Skip empty/whitespace-only strings to avoid incorrect conversion to 0.
      if (typeof statusValue === "string" && statusValue.trim() === "") {
        continue;
      }

      // Convert numeric strings to numbers before parsing.
      statusValue = isNaN(Number(statusValue)) ? statusValue : Number(statusValue);
      return applyDarkColor(parseStatusValue(statusValue), isDark);
    }
  }

  // No status field found - default to info level.
  return applyDarkColor({ level: "info", color: STATUS_COLORS.info, priority: 6 }, isDark);
}

function applyDarkColor(info: StatusInfo, isDark: boolean): StatusInfo {
  if (!isDark) return info;
  const darkColor = STATUS_COLORS_DARK[info.level as keyof typeof STATUS_COLORS_DARK];
  return darkColor ? { ...info, color: darkColor } : info;
}

/**
 * Routes status value parsing based on data type
 * Handles both numeric (syslog) and string formats
 *
 * @param value - The status value to parse (number or string)
 * @returns StatusInfo object
 */
function parseStatusValue(value: any): StatusInfo {
  // Numeric syslog severity levels (0-7).
  if (typeof value === "number") {
    return mapNumericStatus(value);
  }

  // String status levels (case-insensitive).
  if (typeof value === "string") {
    return mapStringStatus(value);
  }

  // Unexpected data types (boolean, object, etc.) default to info.
  return { level: "info", color: STATUS_COLORS.info, priority: 6 };
}

/**
 * Maps numeric severity levels to status information
 * Handles both OTEL and syslog severity levels:
 * - 0: OTEL UNSPECIFIED (mapped to info)
 * - 1-7: Syslog severity levels (alert, critical, error, warning, notice, info, debug)
 *
 * @param value - Numeric severity level (0-7)
 * @returns StatusInfo object
 */
function mapNumericStatus(value: number): StatusInfo {
  switch (value) {
    // OTEL UNSPECIFIED (0) - treat as info
    case 0:
      return { level: "info", color: STATUS_COLORS.info, priority: 6 };

    // Action must be taken immediately
    case 1:
      return { level: "alert", color: STATUS_COLORS.alert, priority: 1 };

    // Critical conditions
    case 2:
      return { level: "critical", color: STATUS_COLORS.critical, priority: 2 };

    // Error conditions
    case 3:
      return { level: "error", color: STATUS_COLORS.error, priority: 3 };

    // Warning conditions
    case 4:
      return { level: "warning", color: STATUS_COLORS.warning, priority: 4 };

    // Normal but significant condition
    case 5:
      return { level: "notice", color: STATUS_COLORS.notice, priority: 5 };

    // Informational messages
    case 6:
      return { level: "info", color: STATUS_COLORS.info, priority: 6 };

    // Debug-level messages
    case 7:
      return { level: "debug", color: STATUS_COLORS.debug, priority: 7 };

    // Unexpected numeric values (negative, >7, etc.)
    default:
      return { level: "info", color: STATUS_COLORS.info, priority: 6 };
  }
}

/**
 * Maps string status levels to status information
 * Uses exact full name matching for precise status identification
 *
 * @param value - String status level (case-insensitive)
 * @returns StatusInfo object
 */
function mapStringStatus(value: string): StatusInfo {
  const lowerValue = value.toLowerCase().trim();

  // Emergency/Fatal - system unusable
  if (lowerValue === "emergency" || lowerValue === "emerg" || lowerValue === "fatal") {
    return { level: "emergency", color: STATUS_COLORS.emergency, priority: 0 };
  }

  // Alert - immediate action required
  if (lowerValue === "alert") {
    return { level: "alert", color: STATUS_COLORS.alert, priority: 1 };
  }

  // Critical conditions
  if (lowerValue === "critical" || lowerValue === "crit") {
    return { level: "critical", color: STATUS_COLORS.critical, priority: 2 };
  }

  // Error conditions
  if (lowerValue === "error" || lowerValue === "err") {
    return { level: "error", color: STATUS_COLORS.error, priority: 3 };
  }

  // Warning conditions
  if (lowerValue === "warning" || lowerValue === "warn") {
    return { level: "warning", color: STATUS_COLORS.warning, priority: 4 };
  }

  // Notice - significant but normal condition
  if (lowerValue === "notice") {
    return { level: "notice", color: STATUS_COLORS.notice, priority: 5 };
  }

  // Informational messages
  if (lowerValue === "info" || lowerValue === "information") {
    return { level: "info", color: STATUS_COLORS.info, priority: 6 };
  }

  // Debug messages and detailed logging
  if (lowerValue === "debug" || lowerValue === "trace" || lowerValue === "verbose") {
    return { level: "debug", color: STATUS_COLORS.debug, priority: 7 };
  }

  // Success/OK - positive status indicators
  if (lowerValue === "ok" || lowerValue === "success") {
    return { level: "ok", color: STATUS_COLORS.ok, priority: 8 };
  }

  // Fallback for unrecognized string values
  return { level: "info", color: STATUS_COLORS.info, priority: 6 };
}

export type LogSeverityLevel =
  | "emergency"
  | "alert"
  | "critical"
  | "error"
  | "warning"
  | "notice"
  | "info"
  | "debug"
  | "trace"
  | "ok"
  | "unknown";

export type KnownLogSeverityLevel = Exclude<LogSeverityLevel, "unknown">;

export type LogSeveritySource = "field" | "http" | "message" | "none";

export interface LogSeverity {
  level: LogSeverityLevel;
  source: LogSeveritySource;
  field: string | null;
  /** True when the executed request may have dropped a level field this row lacks. */
  notFetched: boolean;
}

/** Full stored schema of one stream, as the projection guard needs it. */
export interface SeverityStreamSchema {
  fields: ReadonlySet<string>;
  /** User-defined schema fields when the server applies them, else null. */
  udsFields: ReadonlySet<string> | null;
  /** True when a wildcard request on this stream may return only part of its fields. */
  serverMayTruncate: boolean;
}

/** Per-request input of the projection guard. */
export interface SeverityProjection {
  projectedFields: ReadonlySet<string> | "all";
  schemaFor: (row: Record<string, unknown>) => SeverityStreamSchema | null;
}

export interface SeverityProjectionStream {
  name: string;
  schema?: ReadonlyArray<{ name: string }>;
  settings?: { defined_schema_fields?: readonly string[] | null };
}

export interface SeverityProjectionInput {
  sqlMode: boolean;
  quickMode: boolean;
  interestingFields: readonly string[];
  /** Output names of the SQL select list; "all" for a wildcard; null when unparseable. */
  sqlColumns: ReadonlySet<string> | "all" | null;
  streams: readonly SeverityProjectionStream[];
  selectedStreams: readonly string[];
  streamNameField: string;
  quickModeNumFields: number;
  quickModeForceEnabled: boolean;
}

interface SeverityMemoEntry {
  generation: number;
  projection: SeverityProjection | undefined;
  result: LogSeverity;
}

export interface SeveritySqlPredicateOptions {
  includeTiers?: ReadonlyArray<1 | 2 | 3 | 4>;
}

export const SEVERITY_TIER1_FIELDS = [
  "severity",
  "level",
  "log_level",
  "loglevel",
  "severity_text",
  "syslog_severity",
  "syslog.severity",
] as const;

export const SEVERITY_TIER2_FIELDS = ["severity_number", "severitynumber"] as const;

export const SEVERITY_HTTP_FIELDS = [
  "status",
  "status_code",
  "statuscode",
  "http_status",
  "http_status_code",
  "http_response_status_code",
  "response_status",
  "response_code",
] as const;

export const SEVERITY_MESSAGE_FIELDS = ["message", "msg", "body", "log", "content"] as const;

/** Only this many leading characters of a message are scanned (A6). */
export const SEVERITY_MESSAGE_SCAN_CHARS = 512;

const SYSLOG_SEVERITY_FIELDS: ReadonlySet<string> = new Set(["syslog_severity", "syslog.severity"]);

// A Map, so row values such as "constructor" or "__proto__" never hit inherited properties.
const SEVERITY_STRING_ALIASES: ReadonlyMap<string, KnownLogSeverityLevel> = new Map([
  ["emergency", "emergency"],
  ["emerg", "emergency"],
  ["fatal", "emergency"],
  ["panic", "emergency"],
  ["alert", "alert"],
  ["critical", "critical"],
  ["crit", "critical"],
  ["error", "error"],
  ["err", "error"],
  ["failure", "error"],
  ["failed", "error"],
  ["warning", "warning"],
  ["warn", "warning"],
  ["notice", "notice"],
  ["info", "info"],
  ["information", "info"],
  ["informational", "info"],
  ["debug", "debug"],
  ["verbose", "debug"],
  ["trace", "trace"],
  ["ok", "ok"],
  ["success", "ok"],
]);

// OTel short names carry a 2-4 suffix (WARN2, ERROR3); only these bases take one.
const OTEL_SHORT_NAME_BASES: readonly string[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];
const OTEL_SHORT_NAME_DIGITS: readonly string[] = ["2", "3", "4"];

// Index = syslog severity; 0 is emergency only on the syslog fields.
const SYSLOG_LEVELS: readonly KnownLogSeverityLevel[] = [
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "info",
  "debug",
];

const PINO_LEVELS: Readonly<Record<number, KnownLogSeverityLevel>> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warning",
  50: "error",
  60: "emergency",
};

const OTEL_NUMBER_BANDS: ReadonlyArray<{ min: number; max: number; level: KnownLogSeverityLevel }> =
  [
    { min: 1, max: 4, level: "trace" },
    { min: 5, max: 8, level: "debug" },
    { min: 9, max: 12, level: "info" },
    { min: 13, max: 16, level: "warning" },
    { min: 17, max: 20, level: "error" },
    { min: 21, max: 24, level: "emergency" },
  ];

const HTTP_STATUS_BANDS: ReadonlyArray<{ min: number; max: number; level: KnownLogSeverityLevel }> =
  [
    { min: 100, max: 299, level: "ok" },
    { min: 300, max: 399, level: "notice" },
    { min: 400, max: 499, level: "warning" },
    { min: 500, max: 599, level: "error" },
  ];

const INFERABLE_LEVELS: ReadonlySet<KnownLogSeverityLevel> = new Set([
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "info",
  "debug",
  "trace",
]);

const GLOG_LEVELS: Readonly<Record<string, KnownLogSeverityLevel>> = {
  I: "info",
  W: "warning",
  E: "error",
  F: "emergency",
};

// The optional quote after the key also reads JSON bodies such as {"level":"info"}.
const KEY_VALUE_LEVEL_RE = /\b(?:level|lvl|severity|loglevel)"?\s*[=:]\s*"?([A-Za-z]+)/i;
const BRACKETED_LEVEL_RE =
  /[[<(]\s*(EMERG(?:ENCY)?|FATAL|PANIC|ALERT|CRIT(?:ICAL)?|ERROR|ERR|WARN(?:ING)?|NOTICE|INFO|DEBUG|TRACE)\s*[\]>)]/i;
const UPPERCASE_LEVEL_RE =
  /\b(EMERG(?:ENCY)?|FATAL|PANIC|ALERT|CRIT(?:ICAL)?|ERROR|WARN(?:ING)?|NOTICE|INFO|DEBUG|TRACE)\b/;
const GLOG_PREFIX_RE = /^([IWEF])\d{4} \d{2}:\d{2}:\d{2}/;
const STACK_TRACE_RES: readonly RegExp[] = [
  /^Traceback \(most recent call last\)/,
  /^panic: /,
  /^Exception in thread /,
  /^\S+(?:Exception|Error): /,
];

/** Every tier-5 regex, exported so the ReDoS test can time each one directly. */
export const SEVERITY_MESSAGE_REGEXES: readonly RegExp[] = [
  KEY_VALUE_LEVEL_RE,
  BRACKETED_LEVEL_RE,
  UPPERCASE_LEVEL_RE,
  GLOG_PREFIX_RE,
  ...STACK_TRACE_RES,
];

const MESSAGE_RULES: ReadonlyArray<(text: string) => KnownLogSeverityLevel | null> = [
  (text) => inferableCapture(KEY_VALUE_LEVEL_RE.exec(text)),
  (text) => inferableCapture(BRACKETED_LEVEL_RE.exec(text)),
  (text) => inferableCapture(UPPERCASE_LEVEL_RE.exec(text)),
  (text) => {
    const m = GLOG_PREFIX_RE.exec(text);
    return m ? GLOG_LEVELS[m[1]] : null;
  },
  (text) => (STACK_TRACE_RES.some((re) => re.test(text)) ? "error" : null),
];

const SEVERITY_INDICATOR_COLORS: Readonly<Record<KnownLogSeverityLevel, string>> = {
  emergency: "var(--color-log-severity-emergency-indicator)",
  alert: "var(--color-log-severity-alert-indicator)",
  critical: "var(--color-log-severity-critical-indicator)",
  error: "var(--color-log-severity-error-indicator)",
  warning: "var(--color-log-severity-warning-indicator)",
  notice: "var(--color-log-severity-notice-indicator)",
  info: "var(--color-log-severity-info-indicator)",
  debug: "var(--color-log-severity-debug-indicator)",
  trace: "var(--color-log-severity-trace-indicator)",
  ok: "var(--color-log-severity-ok-indicator)",
};

const ALL_KNOWN_LEVELS: readonly KnownLogSeverityLevel[] = [
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "info",
  "debug",
  "trace",
  "ok",
];

const GUARDED_FIELDS: readonly string[] = [
  ...new Set<string>([...SEVERITY_TIER1_FIELDS, ...SEVERITY_TIER2_FIELDS, ...SEVERITY_HTTP_FIELDS]),
];

const UNKNOWN_SEVERITY: LogSeverity = Object.freeze({
  level: "unknown",
  source: "none",
  field: null,
  notFetched: false,
});

const NOT_FETCHED_SEVERITY: LogSeverity = Object.freeze({
  level: "unknown",
  source: "none",
  field: null,
  notFetched: true,
});

// Reactive so rendered rows re-resolve when a schema load or the inference flag invalidates the memo.
const severityGeneration = shallowRef(0);
let severityInferenceEnabled = true;

const severityMemo = new WeakMap<object, SeverityMemoEntry>();

/** Invalidates memoised severities; call whenever a stream schema is replaced. */
export function bumpSeveritySchemaGeneration(): void {
  severityGeneration.value += 1;
}

/** Current schema generation; reading it inside a render re-renders on a bump. */
export function severitySchemaGeneration(): number {
  return severityGeneration.value;
}

/** Turns tier-5 message inference on or off (the `ZO_UI_LOGS_SEVERITY_INFERENCE` kill switch). */
export function setSeverityInferenceEnabled(enabled: boolean): void {
  if (severityInferenceEnabled === enabled) return;
  severityInferenceEnabled = enabled;
  bumpSeveritySchemaGeneration();
}

/** Resolves a row's severity by the A4 tiers, memoised per row object, schema generation and projection. */
export function resolveLogSeverity(row: unknown, projection?: SeverityProjection): LogSeverity {
  if (!row || typeof row !== "object") return UNKNOWN_SEVERITY;
  const key = toRaw(row) as object;
  const generation = severityGeneration.value;
  const cached = severityMemo.get(key);
  if (cached && cached.generation === generation && cached.projection === projection) {
    return cached.result;
  }
  const result = computeLogSeverity(row as Record<string, unknown>, projection);
  severityMemo.set(key, { generation, projection, result });
  return result;
}

/** Resolves one value as if it were the value of `field`, using that field's tier rules. */
export function resolveSeverityFieldValue(
  field: string,
  value: unknown,
): { level: KnownLogSeverityLevel; source: "field" | "http" } | null {
  const name = field.trim().toLowerCase();
  if ((SEVERITY_TIER1_FIELDS as readonly string[]).includes(name)) {
    const level = tier1Level(name, value);
    return level ? { level, source: "field" } : null;
  }
  if ((SEVERITY_TIER2_FIELDS as readonly string[]).includes(name)) {
    const level = otelNumberLevel(value);
    return level ? { level, source: "field" } : null;
  }
  if (name === "status") {
    const level = statusStringLevel(value);
    if (level) return { level, source: "field" };
  }
  if ((SEVERITY_HTTP_FIELDS as readonly string[]).includes(name)) {
    const level = httpLevel(name, value);
    return level ? { level, source: "http" } : null;
  }
  return null;
}

/** Infers a level from the first 512 characters of a message, conservative rules only. */
export function inferSeverityFromMessage(text: string): KnownLogSeverityLevel | null {
  const head = text.slice(0, SEVERITY_MESSAGE_SCAN_CHARS);
  for (const rule of MESSAGE_RULES) {
    const level = rule(head);
    if (level) return level;
  }
  return null;
}

/** Spine/border colour: the level's solid token for every source, transparent for unknown. */
export function severityIndicatorColor(severity: LogSeverity): string {
  if (severity.level === "unknown") return "transparent";
  return SEVERITY_INDICATOR_COLORS[severity.level];
}

/** Row classes carrying the resolved level and its source (test hook). */
export function severityRowClass(severity: LogSeverity): string {
  return `o2-log-level-${severity.level} o2-log-level-src-${severity.source}`;
}

/** Every lowercase string that tier-1 string handling maps to one of `levels`. */
export function severityStringValues(levels: readonly LogSeverityLevel[]): string[] {
  const wanted = new Set(levels);
  const values: string[] = [];
  for (const [alias, level] of SEVERITY_STRING_ALIASES) {
    if (!wanted.has(level)) continue;
    values.push(alias);
    if (OTEL_SHORT_NAME_BASES.includes(alias)) {
      for (const digit of OTEL_SHORT_NAME_DIGITS) values.push(`${alias}${digit}`);
    }
  }
  return values;
}

/** SQL boolean of the on-screen precedence: true when the first recognised level field is in `levels`. */
export function severitySqlPredicate(
  fieldsPresent: readonly string[],
  levels: readonly LogSeverityLevel[],
  options: SeveritySqlPredicateOptions = {},
): string {
  const tiers = new Set(options.includeTiers ?? [1]);
  const present = new Set(fieldsPresent.map((f) => f.toLowerCase()));
  const branches: string[] = [];
  if (tiers.has(1)) {
    for (const field of SEVERITY_TIER1_FIELDS) {
      if (present.has(field)) branches.push(...tier1SqlBranches(field, levels));
    }
  }
  if (tiers.has(2)) {
    for (const field of SEVERITY_TIER2_FIELDS) {
      if (present.has(field)) branches.push(bandSqlBranch(field, OTEL_NUMBER_BANDS, levels));
    }
  }
  if (tiers.has(3) && present.has("status")) branches.push(statusStringSqlBranch(levels));
  if (tiers.has(4)) {
    for (const field of SEVERITY_HTTP_FIELDS) {
      if (present.has(field)) branches.push(...httpSqlBranches(field, levels));
    }
  }
  if (branches.length === 0) return "false";
  return `(CASE ${branches.join(" ")} ELSE false END)`;
}

/** Builds the per-request projection guard input from the executed search state. */
export function buildSeverityProjection(input: SeverityProjectionInput): SeverityProjection {
  const schemas = new Map<string, SeverityStreamSchema>();
  for (const stream of input.streams) {
    if (!input.selectedStreams.includes(stream.name) || !stream.schema?.length) continue;
    const uds = stream.settings?.defined_schema_fields ?? [];
    schemas.set(stream.name, {
      fields: new Set(stream.schema.map((f) => f.name)),
      udsFields: uds.length > 0 && uds.length <= input.quickModeNumFields ? new Set(uds) : null,
      serverMayTruncate:
        input.quickModeForceEnabled && stream.schema.length > input.quickModeNumFields,
    });
  }
  const single = input.selectedStreams.length === 1 ? input.selectedStreams[0] : null;
  return {
    projectedFields: projectedFieldsOf(input),
    schemaFor: (row) => {
      const named = row[input.streamNameField];
      const name = typeof named === "string" && named ? named : single;
      return name ? (schemas.get(name) ?? null) : null;
    },
  };
}

/** Output names of a parsed SQL select list: "all" for a wildcard, null when the list is unreadable. */
export function sqlSelectOutputNames(columns: unknown): ReadonlySet<string> | "all" | null {
  if (columns === "*") return "all";
  if (!Array.isArray(columns)) return null;
  const names = new Set<string>();
  for (const col of columns) {
    const expr = col?.expr;
    if (expr?.type === "column_ref" && expr.column === "*") return "all";
    const alias = typeof col?.as === "string" ? col.as : (col?.as?.value ?? null);
    if (alias) {
      names.add(String(alias));
      continue;
    }
    if (expr?.type !== "column_ref") continue;
    const name = typeof expr.column === "string" ? expr.column : expr.column?.expr?.value;
    if (name != null) names.add(String(name).replace(/^"|"$/g, ""));
  }
  return names;
}

function computeLogSeverity(
  row: Record<string, unknown>,
  projection: SeverityProjection | undefined,
): LogSeverity {
  for (const field of SEVERITY_TIER1_FIELDS) {
    const level = tier1Level(field, row[field]);
    if (level) return { level, source: "field", field, notFetched: false };
  }
  for (const field of SEVERITY_TIER2_FIELDS) {
    const level = otelNumberLevel(row[field]);
    if (level) return { level, source: "field", field, notFetched: false };
  }
  const statusLevel = statusStringLevel(row.status);
  if (statusLevel)
    return { level: statusLevel, source: "field", field: "status", notFetched: false };
  for (const field of SEVERITY_HTTP_FIELDS) {
    const level = httpLevel(field, row[field]);
    if (level) return { level, source: "http", field, notFetched: false };
  }
  if (projection && levelFieldNotFetched(row, projection)) return NOT_FETCHED_SEVERITY;
  if (!severityInferenceEnabled) return UNKNOWN_SEVERITY;
  for (const field of SEVERITY_MESSAGE_FIELDS) {
    const text = row[field];
    if (typeof text !== "string" || text.trim() === "") continue;
    const level = inferSeverityFromMessage(text);
    return level ? { level, source: "message", field, notFetched: false } : UNKNOWN_SEVERITY;
  }
  return UNKNOWN_SEVERITY;
}

function levelFieldNotFetched(
  row: Record<string, unknown>,
  projection: SeverityProjection,
): boolean {
  const schema = projection.schemaFor(row);
  if (!schema) return false;
  for (const field of GUARDED_FIELDS) {
    if (!schema.fields.has(field) || field in row) continue;
    if (projection.projectedFields !== "all") {
      if (!projection.projectedFields.has(field)) return true;
      continue;
    }
    if (schema.serverMayTruncate) return true;
    if (schema.udsFields && !schema.udsFields.has(field)) return true;
  }
  return false;
}

function projectedFieldsOf(input: SeverityProjectionInput): ReadonlySet<string> | "all" {
  if (input.sqlMode) return input.sqlColumns ?? new Set<string>();
  if (input.quickMode && input.interestingFields.length > 0)
    return new Set(input.interestingFields);
  return "all";
}

function inferableCapture(match: RegExpExecArray | null): KnownLogSeverityLevel | null {
  if (!match) return null;
  const level = stringLevel(match[1]);
  return level && INFERABLE_LEVELS.has(level) ? level : null;
}

function stringLevel(raw: string): KnownLogSeverityLevel | null {
  const value = raw.trim().toLowerCase();
  const direct = SEVERITY_STRING_ALIASES.get(value);
  if (direct) return direct;
  const digit = value.slice(-1);
  const base = value.slice(0, -1);
  if (OTEL_SHORT_NAME_DIGITS.includes(digit) && OTEL_SHORT_NAME_BASES.includes(base)) {
    return SEVERITY_STRING_ALIASES.get(base) ?? null;
  }
  return null;
}

function integerOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^-?\d{1,15}$/.test(trimmed) ? Number(trimmed) : null;
}

function syslogLevel(n: number, allowZero: boolean): KnownLogSeverityLevel | null {
  if (n < (allowZero ? 0 : 1) || n > 7) return null;
  return SYSLOG_LEVELS[n];
}

function tier1Level(field: string, value: unknown): KnownLogSeverityLevel | null {
  const n = integerOf(value);
  if (n === null) return typeof value === "string" ? stringLevel(value) : null;
  if (SYSLOG_SEVERITY_FIELDS.has(field)) return syslogLevel(n, true);
  return PINO_LEVELS[n] ?? syslogLevel(n, false);
}

function otelNumberLevel(value: unknown): KnownLogSeverityLevel | null {
  const n = integerOf(value);
  if (n === null) return null;
  return OTEL_NUMBER_BANDS.find((b) => n >= b.min && n <= b.max)?.level ?? null;
}

function statusStringLevel(value: unknown): KnownLogSeverityLevel | null {
  if (typeof value !== "string" || integerOf(value) !== null) return null;
  return stringLevel(value);
}

function httpLevel(field: string, value: unknown): KnownLogSeverityLevel | null {
  const n = integerOf(value);
  if (n === null) return null;
  const band = HTTP_STATUS_BANDS.find((b) => n >= b.min && n <= b.max);
  if (band) return band.level;
  return field === "status" ? syslogLevel(n, false) : null;
}

function sqlQuoteIdentifier(field: string): string {
  return `"${field.replace(/"/g, '""')}"`;
}

function sqlStringList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

function sqlText(field: string): string {
  return `lower(trim(CAST(${sqlQuoteIdentifier(field)} AS VARCHAR)))`;
}

function sqlInteger(field: string): string {
  return `try_cast(trim(CAST(${sqlQuoteIdentifier(field)} AS VARCHAR)) AS BIGINT)`;
}

function sqlInList(expr: string, values: readonly (string | number)[]): string {
  if (values.length === 0) return "false";
  const list = values.map((v) => (typeof v === "number" ? String(v) : sqlStringList([v])));
  return `${expr} IN (${list.join(", ")})`;
}

function tier1NumberLevels(field: string): Array<{ n: number; level: KnownLogSeverityLevel }> {
  const out: Array<{ n: number; level: KnownLogSeverityLevel }> = [];
  const syslog = SYSLOG_SEVERITY_FIELDS.has(field);
  for (let n = syslog ? 0 : 1; n <= 7; n++) out.push({ n, level: SYSLOG_LEVELS[n] });
  if (!syslog) {
    for (const [n, level] of Object.entries(PINO_LEVELS)) out.push({ n: Number(n), level });
  }
  return out;
}

function tier1SqlBranches(field: string, levels: readonly LogSeverityLevel[]): string[] {
  const numbers = tier1NumberLevels(field);
  const num = sqlInteger(field);
  const text = sqlText(field);
  const wantedNumbers = numbers.filter((x) => levels.includes(x.level)).map((x) => x.n);
  const allStrings = sqlStringList(severityStringValues(ALL_KNOWN_LEVELS));
  return [
    `WHEN ${sqlInList(
      num,
      numbers.map((x) => x.n),
    )} THEN ${sqlInList(num, wantedNumbers)}`,
    `WHEN ${num} IS NULL AND ${text} IN (${allStrings}) THEN ${sqlInList(text, severityStringValues(levels))}`,
  ];
}

function bandSqlBranch(
  field: string,
  bands: ReadonlyArray<{ min: number; max: number; level: KnownLogSeverityLevel }>,
  levels: readonly LogSeverityLevel[],
): string {
  const num = sqlInteger(field);
  const lo = Math.min(...bands.map((b) => b.min));
  const hi = Math.max(...bands.map((b) => b.max));
  return `WHEN ${num} BETWEEN ${lo} AND ${hi} THEN ${bandsInLevels(num, bands, levels)}`;
}

function bandsInLevels(
  num: string,
  bands: ReadonlyArray<{ min: number; max: number; level: KnownLogSeverityLevel }>,
  levels: readonly LogSeverityLevel[],
): string {
  const wanted = bands.filter((b) => levels.includes(b.level));
  if (wanted.length === 0) return "false";
  return `(${wanted.map((b) => `${num} BETWEEN ${b.min} AND ${b.max}`).join(" OR ")})`;
}

function statusStringSqlBranch(levels: readonly LogSeverityLevel[]): string {
  const text = sqlText("status");
  const all = sqlStringList(severityStringValues(ALL_KNOWN_LEVELS));
  return `WHEN ${sqlInteger("status")} IS NULL AND ${text} IN (${all}) THEN ${sqlInList(text, severityStringValues(levels))}`;
}

function httpSqlBranches(field: string, levels: readonly LogSeverityLevel[]): string[] {
  const branches = [bandSqlBranch(field, HTTP_STATUS_BANDS, levels)];
  if (field !== "status") return branches;
  const num = sqlInteger(field);
  const wanted = SYSLOG_LEVELS.map((level, n) => ({ n, level })).filter(
    (x) => x.n >= 1 && levels.includes(x.level),
  );
  branches.push(
    `WHEN ${num} BETWEEN 1 AND 7 THEN ${sqlInList(
      num,
      wanted.map((x) => x.n),
    )}`,
  );
  return branches;
}
