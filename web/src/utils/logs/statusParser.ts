//  Copyright 2023 OpenObserve Inc.

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
 * - extractStatusFromLog({ "severity": 0 }) → { level: "info", color: "#84a8f6ff", priority: 6 }
 * - extractStatusFromLog({ "level": "ERROR" }) → { level: "error", color: "#dc2626", priority: 3 }
 * - extractStatusFromLog({ "syslog.severity": 4 }) → { level: "warning", color: "#eab308", priority: 4 }
 * - extractStatusFromLog({ "status": "ok" }) → { level: "ok", color: "#059669", priority: 8 }
 */

export interface StatusInfo {
  level: string;
  color: string;
  priority: number;
}

/**
 * Color mapping for different log levels
 * Uses Tailwind CSS color palette for consistent theming
 */
export const STATUS_COLORS = {
  emergency: '#dc2626', // red-600
  alert: '#ea580c', // orange-600
  critical: '#d97706', // amber-600
  error: '#dc2626', // red-600
  warning: '#eab308', // yellow-500
  notice: '#16a34a', // green-600
  info: '#84a8f6ff', // blue-600
  debug: '#6b7280', // gray-500
  ok: '#059669', // emerald-600
} as const;

/**
 * Standard field names to search for status information
 * Ordered by preference - first match will be used
 */
const STATUS_FIELDS = ['status', 'severity', 'level', 'syslog.severity'] as const;

/**
 * Extracts status information from a log entry object
 * Searches through common status field names and parses the value
 * 
 * @param logEntry - The log entry object to analyze
 * @returns StatusInfo with level, color, and priority
 */
export function extractStatusFromLog(logEntry: any): StatusInfo {
  // Handle null, undefined, or non-object inputs
  //this is a fallback for when the log entry is not an object 
  //we simply return info level and info color
  // Example: extractStatusFromLog(null) → { level: 'info', color: '#84a8f6ff', priority: 6 }
  if (!logEntry || typeof logEntry !== 'object') {
    return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
  }

  // Search through predefined status fields in order of preference
  // Example: { "status": "error", "level": "info" } → uses "error" from status field
  //if we dont find a status field, we return info level and info color
  for (const field of STATUS_FIELDS) {
    let statusValue = logEntry[field];
    
    // Found a valid status value - parse and return it
    // Example: logEntry["level"] = "WARNING" → parseStatusValue("WARNING")
    // Also handles numeric strings: "200", "404", "500"
    if (statusValue !== undefined && statusValue !== null) {
      // Skip empty or whitespace-only strings to avoid incorrect conversion to 0
      // Example: "" → skip (would become 0/emergency), "   " → skip
      if (typeof statusValue === 'string' && statusValue.trim() === '') {
        continue;
      }

      // Convert numeric strings to numbers before parsing
      // Example: "0" → 0, "1" → 1, "error" → "error"
      statusValue = isNaN(Number(statusValue)) ? statusValue : Number(statusValue);
      return parseStatusValue(statusValue);
    }
  }

  // No status field found - default to info level
  // Example: { "message": "Hello world" } → { level: 'info', color: '#84a8f6ff', priority: 6 }
  return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
}

/**
 * Routes status value parsing based on data type
 * Handles both numeric (syslog) and string formats
 * 
 * @param value - The status value to parse (number or string)
 * @returns StatusInfo object
 */
function parseStatusValue(value: any): StatusInfo {
  // Handle numeric syslog severity levels (0-7)
  // Example: parseStatusValue(3) → { level: 'error', color: '#dc2626', priority: 3 }
  if (typeof value === 'number') {
    return mapNumericStatus(value);
  }

  // Handle string status levels (case-insensitive)
  // Example: parseStatusValue("ERROR") → { level: 'error', color: '#dc2626', priority: 3 }
  if (typeof value === 'string') {
    return mapStringStatus(value);
  }

  // Handle unexpected data types (boolean, object, etc.)
  // Example: parseStatusValue(true) → { level: 'info', color: '#84a8f6ff', priority: 6 }
  return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
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
    // OTEL UNSPECIFIED level (0) - treat as info
    // Example: mapNumericStatus(0) → { level: 'info', color: '#84a8f6ff', priority: 6 }
    case 0:
      return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
    
    // Action must be taken immediately
    // Example: mapNumericStatus(1) → { level: 'alert', color: '#ea580c', priority: 1 }
    case 1:
      return { level: 'alert', color: STATUS_COLORS.alert, priority: 1 };
    
    // Critical conditions
    // Example: mapNumericStatus(2) → { level: 'critical', color: '#d97706', priority: 2 }
    case 2:
      return { level: 'critical', color: STATUS_COLORS.critical, priority: 2 };
    
    // Error conditions
    // Example: mapNumericStatus(3) → { level: 'error', color: '#dc2626', priority: 3 }
    case 3:
      return { level: 'error', color: STATUS_COLORS.error, priority: 3 };
    
    // Warning conditions
    // Example: mapNumericStatus(4) → { level: 'warning', color: '#eab308', priority: 4 }
    case 4:
      return { level: 'warning', color: STATUS_COLORS.warning, priority: 4 };
    
    // Normal but significant condition
    // Example: mapNumericStatus(5) → { level: 'notice', color: '#16a34a', priority: 5 }
    case 5:
      return { level: 'notice', color: STATUS_COLORS.notice, priority: 5 };
    
    // Informational messages
    // Example: mapNumericStatus(6) → { level: 'info', color: '#84a8f6ff', priority: 6 }
    case 6:
      return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
    
    // Debug-level messages
    // Example: mapNumericStatus(7) → { level: 'debug', color: '#6b7280', priority: 7 }
    case 7:
      return { level: 'debug', color: STATUS_COLORS.debug, priority: 7 };
    
    // Handle unexpected numeric values (negative, >7, etc.)
    // Example: mapNumericStatus(99) → { level: 'info', color: '#84a8f6ff', priority: 6 }
    default:
      return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
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

  // Emergency/Fatal levels - system unusable
  // Examples: "emergency", "emerg", "fatal" → emergency
  if (lowerValue === 'emergency' || lowerValue === 'emerg' || lowerValue === 'fatal') {
    return { level: 'emergency', color: STATUS_COLORS.emergency, priority: 0 };
  }

  // Alert levels - immediate action required
  // Examples: "alert" → alert
  if (lowerValue === 'alert') {
    return { level: 'alert', color: STATUS_COLORS.alert, priority: 1 };
  }

  // Critical levels - critical conditions
  // Examples: "critical", "crit" → critical
  if (lowerValue === 'critical' || lowerValue === 'crit') {
    return { level: 'critical', color: STATUS_COLORS.critical, priority: 2 };
  }

  // Error levels - error conditions
  // Examples: "error", "err" → error
  if (lowerValue === 'error' || lowerValue === 'err') {
    return { level: 'error', color: STATUS_COLORS.error, priority: 3 };
  }

  // Warning levels - warning conditions
  // Examples: "warning", "warn" → warning
  if (lowerValue === 'warning' || lowerValue === 'warn') {
    return { level: 'warning', color: STATUS_COLORS.warning, priority: 4 };
  }

  // Notice levels - significant but normal condition
  // Examples: "notice" → notice
  if (lowerValue === 'notice') {
    return { level: 'notice', color: STATUS_COLORS.notice, priority: 5 };
  }

  // Info levels - informational messages
  // Examples: "info", "information" → info
  if (lowerValue === 'info' || lowerValue === 'information') {
    return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
  }

  // Debug levels - debug messages and detailed logging
  // Examples: "debug", "trace", "verbose" → debug
  if (lowerValue === 'debug' || lowerValue === 'trace' || lowerValue === 'verbose') {
    return { level: 'debug', color: STATUS_COLORS.debug, priority: 7 };
  }

  // Success/OK levels - positive status indicators
  // Examples: "ok", "success" → ok
  if (lowerValue === 'ok' || lowerValue === 'success') {
    return { level: 'ok', color: STATUS_COLORS.ok, priority: 8 };
  }

  // Fallback for unrecognized string values
  // Examples: "unknown", "xyz", "" → info
  return { level: 'info', color: STATUS_COLORS.info, priority: 6 };
}