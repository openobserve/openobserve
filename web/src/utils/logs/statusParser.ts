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
