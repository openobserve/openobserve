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

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  STATUS_COLORS,
  STATUS_COLORS_DARK,
  extractStatusFromLog,
  extractStatusFromTemplate,
  SEVERITY_TIER1_FIELDS,
  SEVERITY_MESSAGE_REGEXES,
  buildSeverityProjection,
  bumpSeveritySchemaGeneration,
  inferSeverityFromMessage,
  resolveLogSeverity,
  resolveSeverityFieldValue,
  setSeverityInferenceEnabled,
  severityIndicatorColor,
  severityRowClass,
  severitySqlPredicate,
  severityStringValues,
  sqlSelectOutputNames,
  type SeverityProjectionInput,
} from "./statusParser";

describe("statusParser.ts", () => {
  // ---------------------------------------------------------------------------
  // COLOR CONSTANTS
  // ---------------------------------------------------------------------------
  describe("STATUS_COLORS", () => {
    it("contains all expected log level keys", () => {
      const keys = [
        "emergency",
        "alert",
        "critical",
        "error",
        "warning",
        "notice",
        "info",
        "debug",
        "ok",
      ];
      keys.forEach((k) => expect(STATUS_COLORS).toHaveProperty(k));
    });

    it("is aligned with convertLogData SEMANTIC_COLORS_LIGHT for shared levels", () => {
      expect(STATUS_COLORS.error).toBe("#EF5350");
      expect(STATUS_COLORS.warning).toBe("#FB8C00");
      expect(STATUS_COLORS.info).toBe("#1E88E5");
      expect(STATUS_COLORS.debug).toBe("#00ACC1");
      expect(STATUS_COLORS.ok).toBe("#43A047");
      expect(STATUS_COLORS.critical).toBe("#F4511E");
      expect(STATUS_COLORS.emergency).toBe("#E53935");
    });
  });

  describe("STATUS_COLORS_DARK", () => {
    it("overrides the common levels with darker variants", () => {
      expect(STATUS_COLORS_DARK.error).toBe("#D95C5C");
      expect(STATUS_COLORS_DARK.warning).toBe("#D4944A");
      expect(STATUS_COLORS_DARK.info).toBe("#4D8FD4");
      expect(STATUS_COLORS_DARK.debug).toBe("#3DAAB8");
      expect(STATUS_COLORS_DARK.ok).toBe("#4DAD55");
      expect(STATUS_COLORS_DARK.critical).toBe("#DC6030");
      expect(STATUS_COLORS_DARK.emergency).toBe("#E07070");
    });

    it("does not define dark overrides for alert and notice (intentional fallback)", () => {
      // These two have no convertLogData dark equivalent — they fall back to STATUS_COLORS
      expect(STATUS_COLORS_DARK).not.toHaveProperty("alert");
      expect(STATUS_COLORS_DARK).not.toHaveProperty("notice");
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — invalid / non-object input
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — invalid input", () => {
    it("returns info for null input (light mode)", () => {
      const result = extractStatusFromLog(null);
      expect(result).toEqual({ level: "info", color: STATUS_COLORS.info, priority: 6 });
    });

    it("returns info with dark color for null input in dark mode", () => {
      const result = extractStatusFromLog(null, true);
      expect(result.level).toBe("info");
      expect(result.color).toBe(STATUS_COLORS_DARK.info);
    });

    it("returns info for undefined input", () => {
      const result = extractStatusFromLog(undefined);
      expect(result.level).toBe("info");
    });

    it("returns info for string input", () => {
      expect(extractStatusFromLog("error").level).toBe("info");
    });

    it("returns info for numeric input", () => {
      expect(extractStatusFromLog(42).level).toBe("info");
    });

    it("returns info for boolean input", () => {
      expect(extractStatusFromLog(true).level).toBe("info");
    });

    it("returns info for array input", () => {
      expect(extractStatusFromLog([]).level).toBe("info");
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — STATUS_FIELDS priority order
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — field priority", () => {
    it("picks severity over level when both present", () => {
      // severity is index 0 in STATUS_FIELDS, level is index 1
      const result = extractStatusFromLog({ severity: "error", level: "info" });
      expect(result.level).toBe("error");
    });

    it("picks severity over status when both present", () => {
      const result = extractStatusFromLog({ status: "ok", severity: "error" });
      expect(result.level).toBe("error");
    });

    it("picks level over log_level when both present", () => {
      // level is index 1, log_level is index 2
      const result = extractStatusFromLog({ log_level: "error", level: "info" });
      expect(result.level).toBe("info");
    });

    it("picks level over status when both present", () => {
      const result = extractStatusFromLog({ status: "ok", level: "warning" });
      expect(result.level).toBe("warning");
    });

    it("picks log_level when level is absent", () => {
      const result = extractStatusFromLog({ log_level: "warn" });
      expect(result.level).toBe("warning");
    });

    it("picks log_level over syslog.severity", () => {
      // log_level is index 2, syslog.severity is index 3
      const result = extractStatusFromLog({ "syslog.severity": 3, log_level: "info" });
      expect(result.level).toBe("info");
    });

    it("picks syslog.severity over status", () => {
      const result = extractStatusFromLog({ status: "ok", "syslog.severity": 3 });
      expect(result.level).toBe("error"); // numeric 3 → error
    });

    it("falls back to status when no higher-priority field exists", () => {
      const result = extractStatusFromLog({ status: "ok" });
      expect(result.level).toBe("ok");
    });

    it("returns info when no known status field is present", () => {
      const result = extractStatusFromLog({ message: "hello", timestamp: 123 });
      expect(result.level).toBe("info");
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — field value edge cases
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — value edge cases", () => {
    it("skips empty-string field values and tries next field", () => {
      // severity is "" → skipped → level is "error" → used
      const result = extractStatusFromLog({ severity: "", level: "error" });
      expect(result.level).toBe("error");
    });

    it("skips whitespace-only string field values", () => {
      const result = extractStatusFromLog({ severity: "   ", level: "debug" });
      expect(result.level).toBe("debug");
    });

    it("skips null field values and tries next field", () => {
      const result = extractStatusFromLog({ severity: null, level: "warning" });
      expect(result.level).toBe("warning");
    });

    it("skips undefined field values and tries next field", () => {
      const result = extractStatusFromLog({ severity: undefined, level: "notice" });
      expect(result.level).toBe("notice");
    });

    it("converts numeric string '3' to number 3 (error)", () => {
      const result = extractStatusFromLog({ severity: "3" });
      expect(result.level).toBe("error");
    });

    it("converts numeric string '0' to number 0 (info)", () => {
      const result = extractStatusFromLog({ severity: "0" });
      expect(result.level).toBe("info");
    });

    it("treats non-numeric string as string status", () => {
      const result = extractStatusFromLog({ level: "CRITICAL" });
      expect(result.level).toBe("critical");
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — string level parsing (case-insensitive)
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — string levels", () => {
    const cases: [string, string, number][] = [
      ["emergency", "emergency", 0],
      ["EMERGENCY", "emergency", 0],
      ["emerg", "emergency", 0],
      ["fatal", "emergency", 0],
      ["FATAL", "emergency", 0],
      ["alert", "alert", 1],
      ["ALERT", "alert", 1],
      ["critical", "critical", 2],
      ["crit", "critical", 2],
      ["error", "error", 3],
      ["ERROR", "error", 3],
      ["err", "error", 3],
      ["warning", "warning", 4],
      ["WARNING", "warning", 4],
      ["warn", "warning", 4],
      ["WARN", "warning", 4],
      ["notice", "notice", 5],
      ["info", "info", 6],
      ["INFO", "info", 6],
      ["information", "info", 6],
      ["debug", "debug", 7],
      ["DEBUG", "debug", 7],
      ["trace", "debug", 7],
      ["verbose", "debug", 7],
      ["ok", "ok", 8],
      ["success", "ok", 8],
      ["SUCCESS", "ok", 8],
    ];

    cases.forEach(([input, expectedLevel, expectedPriority]) => {
      it(`"${input}" → level="${expectedLevel}", priority=${expectedPriority}`, () => {
        const result = extractStatusFromLog({ level: input });
        expect(result.level).toBe(expectedLevel);
        expect(result.priority).toBe(expectedPriority);
      });
    });

    it("returns info for completely unrecognized string", () => {
      const result = extractStatusFromLog({ level: "xyzunknown" });
      expect(result.level).toBe("info");
      expect(result.priority).toBe(6);
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — numeric severity parsing (syslog 0-7)
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — numeric severity levels", () => {
    const cases: [number, string, number][] = [
      [0, "info", 6], // OTEL UNSPECIFIED → info
      [1, "alert", 1],
      [2, "critical", 2],
      [3, "error", 3],
      [4, "warning", 4],
      [5, "notice", 5],
      [6, "info", 6],
      [7, "debug", 7],
    ];

    cases.forEach(([input, expectedLevel, expectedPriority]) => {
      it(`severity=${input} → level="${expectedLevel}", priority=${expectedPriority}`, () => {
        const result = extractStatusFromLog({ severity: input });
        expect(result.level).toBe(expectedLevel);
        expect(result.priority).toBe(expectedPriority);
      });
    });

    it("returns info for out-of-range numeric severity (8)", () => {
      const result = extractStatusFromLog({ severity: 8 });
      expect(result.level).toBe("info");
    });

    it("returns info for negative numeric severity (-1)", () => {
      const result = extractStatusFromLog({ severity: -1 });
      expect(result.level).toBe("info");
    });

    it("returns info for large numeric severity (99)", () => {
      const result = extractStatusFromLog({ severity: 99 });
      expect(result.level).toBe("info");
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromLog — isDark parameter (applyDarkColor)
  // ---------------------------------------------------------------------------
  describe("extractStatusFromLog — isDark theme", () => {
    it("uses light colors when isDark=false (default)", () => {
      const result = extractStatusFromLog({ level: "error" }, false);
      expect(result.color).toBe(STATUS_COLORS.error);
    });

    it("uses dark colors when isDark=true for levels with dark overrides", () => {
      const levelsWithDark = [
        "error",
        "warning",
        "info",
        "debug",
        "ok",
        "critical",
        "emergency",
      ] as const;
      levelsWithDark.forEach((lvl) => {
        const input = lvl === "ok" ? "success" : lvl === "warning" ? "warn" : lvl;
        const result = extractStatusFromLog({ level: input }, true);
        expect(result.color).toBe(STATUS_COLORS_DARK[lvl]);
      });
    });

    it("falls back to light color for alert (no dark override)", () => {
      const result = extractStatusFromLog({ level: "alert" }, true);
      // alert is not in STATUS_COLORS_DARK → applyDarkColor returns unchanged info
      expect(result.color).toBe(STATUS_COLORS.alert);
    });

    it("falls back to light color for notice (no dark override)", () => {
      const result = extractStatusFromLog({ level: "notice" }, true);
      expect(result.color).toBe(STATUS_COLORS.notice);
    });

    it("applies dark color to the no-match fallback (info)", () => {
      const result = extractStatusFromLog({ message: "hello" }, true);
      expect(result.level).toBe("info");
      expect(result.color).toBe(STATUS_COLORS_DARK.info);
    });

    it("does not mutate the original StatusInfo object", () => {
      // applyDarkColor must return a new object, not mutate
      const result1 = extractStatusFromLog({ level: "error" }, false);
      const result2 = extractStatusFromLog({ level: "error" }, true);
      expect(result1.color).not.toBe(result2.color);
    });

    it("dark numeric severity also applies dark color", () => {
      const result = extractStatusFromLog({ severity: 3 }, true); // 3 → error
      expect(result.level).toBe("error");
      expect(result.color).toBe(STATUS_COLORS_DARK.error);
    });

    it("priority is unchanged regardless of isDark", () => {
      const light = extractStatusFromLog({ level: "error" }, false);
      const dark = extractStatusFromLog({ level: "error" }, true);
      expect(light.priority).toBe(dark.priority);
    });
  });

  // ---------------------------------------------------------------------------
  // extractStatusFromTemplate — template/example text parsing
  // ---------------------------------------------------------------------------
  describe("extractStatusFromTemplate", () => {
    it("returns info for null/empty input (light mode)", () => {
      const result = extractStatusFromTemplate("");
      expect(result.level).toBe("info");
    });

    it("detects ERROR in a template string", () => {
      const result = extractStatusFromTemplate("ERROR something went wrong <*>");
      expect(result.level).toBe("error");
      expect(result.color).toBe(STATUS_COLORS.error);
    });

    it("detects WARN in a template string", () => {
      const result = extractStatusFromTemplate("WARN: low memory <:NUM>");
      expect(result.level).toBe("warning");
    });

    it("detects INFO in a template string", () => {
      const result = extractStatusFromTemplate("[INFO] User <*> logged in");
      expect(result.level).toBe("info");
      expect(result.color).toBe(STATUS_COLORS.info);
    });

    it("detects DEBUG in a template string", () => {
      const result = extractStatusFromTemplate("DEBUG <:METHOD> <:URL>");
      expect(result.level).toBe("debug");
    });

    it("returns info when no level keyword is found in template", () => {
      const result = extractStatusFromTemplate("User <*> accessed <:URL>");
      expect(result.level).toBe("info");
    });

    it("uses dark color when isDark=true", () => {
      const result = extractStatusFromTemplate("ERROR disk full", true);
      expect(result.level).toBe("error");
      expect(result.color).toBe(STATUS_COLORS_DARK.error);
    });

    it("handles non-string input gracefully", () => {
      const result = extractStatusFromTemplate(null as any);
      expect(result.level).toBe("info");
    });
  });
});

// Fresh object per call, so the per-row memo never hides a case.
const sev = (row: Record<string, unknown>) => resolveLogSeverity({ ...row });
const levelOf = (row: Record<string, unknown>) => sev(row).level;

describe("resolveLogSeverity — tier 1 strings", () => {
  it.each([
    [{ level: "ERROR" }, "error", "level"],
    [{ level: "Error" }, "error", "level"],
    [{ level: " WARNING " }, "warning", "level"],
    [{ severity: "WARN2" }, "warning", "severity"],
    [{ severity: "ERROR3" }, "error", "severity"],
    [{ severity: "FATAL4" }, "emergency", "severity"],
    [{ severity: "TRACE2" }, "trace", "severity"],
    [{ severity: "INFO4" }, "info", "severity"],
    [{ severity: "DEBUG3" }, "debug", "severity"],
    [{ level: "trace" }, "trace", "level"],
    [{ level: "verbose" }, "debug", "level"],
    [{ level: "panic" }, "emergency", "level"],
    [{ level: "emerg" }, "emergency", "level"],
    [{ level: "crit" }, "critical", "level"],
    [{ level: "err" }, "error", "level"],
    [{ level: "failure" }, "error", "level"],
    [{ level: "failed" }, "error", "level"],
    [{ level: "informational" }, "info", "level"],
    [{ level: "information" }, "info", "level"],
    [{ level: "notice" }, "notice", "level"],
    [{ level: "alert" }, "alert", "level"],
    [{ level: "success" }, "ok", "level"],
    [{ log_level: "warn" }, "warning", "log_level"],
    [{ loglevel: "debug" }, "debug", "loglevel"],
    [{ severity_text: "ERROR" }, "error", "severity_text"],
  ])("%j → %s from %s", (row, level, field) => {
    expect(sev(row)).toEqual({ level, source: "field", field, notFetched: false });
  });

  it.each([[{ level: "ERR2" }], [{ level: "warn5" }], [{ level: "ok2" }], [{ level: "W" }]])(
    "unrecognised %j resolves unknown",
    (row) => {
      expect(levelOf(row)).toBe("unknown");
    },
  );
});

describe("resolveLogSeverity — inherited property names (F2)", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])(
    "%s is not a level and falls through",
    (value) => {
      expect(sev({ severity: value, level: "error" })).toMatchObject({
        level: "error",
        field: "level",
      });
      expect(sev({ level: value, status: 503 })).toMatchObject({ level: "error", source: "http" });
      expect(sev({ status: value, response_code: 404 })).toMatchObject({ level: "warning" });
      expect(resolveSeverityFieldValue("level", value)).toBeNull();
      expect(sev({ message: `level=${value} [ERROR] x` })).toMatchObject({
        level: "error",
        source: "message",
      });
      expect(severityIndicatorColor(sev({ level: value }))).toBe("transparent");
    },
  );
});

describe("resolveLogSeverity — tier 1 numbers", () => {
  it.each([
    [10, "trace"],
    [20, "debug"],
    [30, "info"],
    [40, "warning"],
    [50, "error"],
    [60, "emergency"],
    [15, "unknown"],
    [70, "unknown"],
    [1, "alert"],
    [2, "critical"],
    [3, "error"],
    [4, "warning"],
    [5, "notice"],
    [6, "info"],
    [7, "debug"],
    [8, "unknown"],
    [-1, "unknown"],
    [3.5, "unknown"],
  ])("level %s → %s", (value, level) => {
    expect(levelOf({ level: value })).toBe(level);
  });

  it.each([
    [0, "emergency"],
    [1, "alert"],
    [3, "error"],
    [7, "debug"],
    [8, "unknown"],
    [50, "unknown"],
    ["0", "emergency"],
  ])("syslog_severity %s → %s", (value, level) => {
    expect(levelOf({ syslog_severity: value })).toBe(level);
  });

  it("keeps the dotted key for a SQL alias", () => {
    expect(sev({ "syslog.severity": 0 })).toMatchObject({
      level: "emergency",
      field: "syslog.severity",
    });
  });

  it.each(["severity", "level", "log_level", "loglevel", "severity_text"])(
    "0 on %s is not recognised and falls through",
    (field) => {
      expect(levelOf({ [field]: 0 })).toBe("unknown");
      expect(sev({ [field]: 0, status: 503 })).toMatchObject({ level: "error", source: "http" });
    },
  );

  it.each([
    [{ level: "50" }, "error"],
    [{ level: " 30 " }, "info"],
    [{ severity: "3" }, "error"],
    [{ severity: "0", level: "emergency" }, "emergency"],
  ])("numeric string %j → %s", (row, level) => {
    expect(levelOf(row)).toBe(level);
  });
});

describe("resolveLogSeverity — tier 2 OTel severity_number", () => {
  const expected = (n: number) => {
    if (n >= 1 && n <= 4) return "trace";
    if (n >= 5 && n <= 8) return "debug";
    if (n >= 9 && n <= 12) return "info";
    if (n >= 13 && n <= 16) return "warning";
    if (n >= 17 && n <= 20) return "error";
    if (n >= 21 && n <= 24) return "emergency";
    return "unknown";
  };
  it.each(Array.from({ length: 26 }, (_, n) => n))("severity_number %s", (n) => {
    expect(levelOf({ severity_number: n })).toBe(expected(n));
    expect(levelOf({ severitynumber: String(n) })).toBe(expected(n));
  });
});

describe("resolveLogSeverity — tiers 3 and 4", () => {
  it.each([
    [99, "unknown"],
    [100, "ok"],
    [199, "ok"],
    [200, "ok"],
    [399, "notice"],
    [404, "warning"],
    [499, "warning"],
    [500, "error"],
    [503, "error"],
    [599, "error"],
    [600, "unknown"],
  ])("HTTP %s → %s on every HTTP field", (code, level) => {
    for (const field of [
      "status",
      "status_code",
      "statuscode",
      "http_status",
      "http_status_code",
      "http_response_status_code",
      "response_status",
      "response_code",
    ]) {
      const result = sev({ [field]: code });
      expect(result.level).toBe(level);
      if (level !== "unknown") expect(result).toMatchObject({ source: "http", field });
    }
  });

  it("keeps status: 3 → error through the syslog fallback (regression)", () => {
    expect(sev({ status: 3 })).toMatchObject({ level: "error", source: "http", field: "status" });
    expect(levelOf({ status: "3" })).toBe("error");
  });

  it("never reads pino or syslog on status or the other HTTP fields", () => {
    expect(levelOf({ status: 50 })).toBe("unknown");
    expect(levelOf({ status: 0 })).toBe("unknown");
    expect(levelOf({ response_code: 3 })).toBe("unknown");
  });

  it.each([
    [{ status: "ok" }, "ok"],
    [{ status: "failure" }, "error"],
    [{ status: "warning" }, "warning"],
  ])("non-numeric status %j → %s from field", (row, level) => {
    expect(sev(row)).toMatchObject({ level, source: "field", field: "status" });
  });

  it("numeric string status is HTTP", () => {
    expect(sev({ status: "503" })).toMatchObject({ level: "error", source: "http" });
  });

  it("text status beats an HTTP field (tier 3 before tier 4)", () => {
    expect(sev({ status: "ok", response_code: 500 })).toMatchObject({
      level: "ok",
      field: "status",
    });
  });
});

describe("resolveLogSeverity — precedence and fall-through (J-A3, J-A5)", () => {
  it.each([
    [{ severity: "W", level: "error" }, "error", "level"],
    [{ severity: "", level: "warn" }, "warning", "level"],
    [{ severity: "   ", log_level: "debug" }, "debug", "log_level"],
    [{ level: "info", message: "[ERROR] x" }, "info", "level"],
    [{ level: 50 }, "error", "level"],
    [{ severity: "WARN2", severity_number: 14 }, "warning", "severity"],
    [{ severity_number: 18 }, "error", "severity_number"],
    [{ severity: 30, level: "error" }, "info", "severity"],
    [{ severity: "30", level: "error" }, "info", "severity"],
    [{ level: true, log_level: "warn" }, "warning", "log_level"],
    [{ level: { a: 1 }, status: 404 }, "warning", "status"],
    [{ level: "nonsense", severity_number: 9 }, "info", "severity_number"],
    [{ severity_number: 0, status: 200 }, "ok", "status"],
  ])("%j → %s from %s", (row, level, field) => {
    expect(sev(row)).toMatchObject({ level, field });
  });

  it("does not treat an error field as evidence", () => {
    expect(levelOf({ error: "boom", message: "user logged in" })).toBe("unknown");
  });

  it("resolves unknown with no evidence and for non-objects", () => {
    expect(sev({ host: "a" })).toEqual({
      level: "unknown",
      source: "none",
      field: null,
      notFetched: false,
    });
    expect(resolveLogSeverity(null).level).toBe("unknown");
    expect(resolveLogSeverity("x").level).toBe("unknown");
  });
});

describe("resolveLogSeverity — tier 5 message inference", () => {
  const POSITIVE: Array<[string, string]> = [
    ["2026-10-06 12:00:01 ERROR payment failed", "error"],
    ["ts=1 level=error msg=x", "error"],
    ["level=warn retry", "warning"],
    ['level="info" started', "info"],
    ["lvl=debug cache", "debug"],
    ["severity: critical disk", "critical"],
    ["loglevel=TRACE enter", "trace"],
    ["LEVEL = Notice x", "notice"],
    ["level=WARN2 x", "warning"],
    ["[ERROR] db down", "error"],
    ["[error] db down", "error"],
    ["<warn> slow", "warning"],
    ["(INFO) started", "info"],
    ["[ WARN ] spaced", "warning"],
    ["[ERR] x", "error"],
    ["[CRIT] x", "critical"],
    ["[CRITICAL] x", "critical"],
    ["[EMERG] x", "emergency"],
    ["[EMERGENCY] x", "emergency"],
    ["[FATAL] x", "emergency"],
    ["[PANIC] x", "emergency"],
    ["[NOTICE] x", "notice"],
    ["[ALERT] x", "alert"],
    ["[DEBUG] x", "debug"],
    ["[TRACE] x", "trace"],
    ["[WARNING] x", "warning"],
    ["WARNING: low disk", "warning"],
    ["x CRITICAL y", "critical"],
    ["EMERGENCY shutdown", "emergency"],
    ["NOTICE something", "notice"],
    ["INFO ok", "info"],
    ["DEBUG cache", "debug"],
    ["TRACE enter", "trace"],
    ["FATAL boom", "emergency"],
    ["ALERT now", "alert"],
    ["PANIC now", "emergency"],
    ["E1006 12:00:01.123 1 main.go:10] failed", "error"],
    ["W1006 12:00:02.311 reconciler.go:88] slow sync", "warning"],
    ["I1006 12:00:02.311 x", "info"],
    ["F1006 12:00:02.311 x", "emergency"],
    ["Traceback (most recent call last):\n  File x", "error"],
    ["panic: runtime error: index out of range", "error"],
    ['Exception in thread "main" java.lang.Error', "error"],
    ["java.lang.NullPointerException: x", "error"],
    ["ValueError: bad value", "error"],
    ["level=ok [ERROR] x", "error"],
    ["level=W then ERROR", "error"],
    ['{"level":"info","msg":"grpc_req_complete"}', "info"],
    ['{"severity": "warning", "x": 1}', "warning"],
  ];
  const NEGATIVE: string[] = [
    "user logged in",
    "no error found",
    "error: none",
    "ERRORS: 0",
    "error_rate=0.1",
    "errors happened",
    "level=ok",
    "level=W",
    "status=success",
    "INFORMATIONAL notes",
    "Debugging session",
    "warned the user",
    "the ERR code",
    "WARN2 something",
    "MyERRORCode",
    "e1006 12:00:01 lower glog",
    "Traceback without parens",
    "some text panic: x",
    "exception in thread main",
    "SUCCESS",
    "OK",
    "info about the warning we sent",
  ];

  it("covers at least 50 strings", () => {
    expect(POSITIVE.length + NEGATIVE.length).toBeGreaterThanOrEqual(50);
  });

  it.each(POSITIVE)("%j → %s, source message", (message, level) => {
    expect(sev({ message })).toEqual({
      level,
      source: "message",
      field: "message",
      notFetched: false,
    });
  });

  it.each(NEGATIVE)("%j → unknown", (message) => {
    expect(sev({ message })).toMatchObject({ level: "unknown", source: "none" });
  });

  it("scans the first present non-empty string field only", () => {
    expect(sev({ message: { a: 1 }, msg: "[ERROR] x" })).toMatchObject({
      level: "error",
      field: "msg",
    });
    expect(sev({ message: "", body: "[WARN] x" })).toMatchObject({
      level: "warning",
      field: "body",
    });
    expect(sev({ log: "[DEBUG] x" })).toMatchObject({ level: "debug", field: "log" });
    expect(sev({ content: "[INFO] x" })).toMatchObject({ level: "info", field: "content" });
    expect(levelOf({ message: "user logged in", msg: "[ERROR] x" })).toBe("unknown");
    expect(levelOf({ message: ["ERROR"] })).toBe("unknown");
  });

  it("is switched off by the inference flag, tiers 1-4 unaffected", () => {
    setSeverityInferenceEnabled(false);
    try {
      expect(levelOf({ message: "[ERROR] x" })).toBe("unknown");
      expect(levelOf({ status: 500, message: "[INFO] x" })).toBe("error");
    } finally {
      setSeverityInferenceEnabled(true);
    }
    expect(levelOf({ message: "[ERROR] x" })).toBe("error");
  });
});

describe("tier 5 — ReDoS and truncation", () => {
  const ADVERSARIAL = [
    "level" + " ".repeat(507),
    "level" + "=".repeat(1) + " ".repeat(506),
    "[".repeat(512),
    "[" + " ".repeat(511),
    "<" + " ".repeat(510) + "x",
    "a".repeat(512),
    "E".repeat(512),
    "E" + "1".repeat(511),
    "x".repeat(511) + ":",
    "ValueErrorValueError".repeat(25) + "Error",
    "Exception".repeat(56) + "x",
    "level=level=level=".repeat(28),
    "WARNWARN".repeat(64),
    " \t".repeat(256),
  ];

  it.each(SEVERITY_MESSAGE_REGEXES.map((re, i) => [i, re] as const))(
    "regex %i stays fast on 512-character adversarial inputs",
    (_, re) => {
      const started = performance.now();
      for (const input of ADVERSARIAL) {
        expect(input.length).toBeLessThanOrEqual(512);
        re.exec(input);
      }
      expect(performance.now() - started).toBeLessThan(50);
    },
    50,
  );

  it("truncates a 1 MB message to its first 512 characters", () => {
    expect(inferSeverityFromMessage("a".repeat(1_000_000) + " ERROR")).toBeNull();
    expect(inferSeverityFromMessage(" ".repeat(507) + "ERROR")).toBe("error");
    expect(inferSeverityFromMessage(" ".repeat(508) + "ERROR")).toBeNull();
    const started = performance.now();
    expect(sev({ message: "x ".repeat(500_000) + "[ERROR]" }).level).toBe("unknown");
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("projection guard (A4)", () => {
  const stream = (name: string, fields: string[], uds?: string[]) => ({
    name,
    schema: fields.map((f) => ({ name: f })),
    settings: { defined_schema_fields: uds ?? [] },
  });
  const projection = (overrides: Partial<SeverityProjectionInput> = {}) =>
    buildSeverityProjection({
      sqlMode: false,
      quickMode: false,
      interestingFields: [],
      sqlColumns: "all",
      streams: [stream("app", ["_timestamp", "level", "message"])],
      selectedStreams: ["app"],
      streamNameField: "_stream_name",
      quickModeNumFields: 500,
      quickModeForceEnabled: true,
      ...overrides,
    });
  const guarded = (row: Record<string, unknown>, p = projection()) =>
    resolveLogSeverity({ ...row }, p);
  const parser = new Parser();
  const selectList = (sql: string) => sqlSelectOutputNames((parser.astify(sql) as any).columns);

  it("J-A6: quick mode without the level field resolves unknown, flagged not fetched", () => {
    const p = projection({ quickMode: true, interestingFields: ["_timestamp", "message"] });
    expect(guarded({ message: "INFO ok" }, p)).toEqual({
      level: "unknown",
      source: "none",
      field: null,
      notFetched: true,
    });
  });

  it("J-A6: the same row under SELECT * on a small stream is inferred", () => {
    expect(guarded({ message: "INFO ok" })).toMatchObject({ level: "info", source: "message" });
  });

  it("quick mode that projects the level field still infers", () => {
    const p = projection({ quickMode: true, interestingFields: ["level", "message"] });
    expect(guarded({ message: "INFO ok" }, p).level).toBe("info");
  });

  it("SQL projection without the level field resolves unknown", () => {
    const p = projection({ sqlMode: true, sqlColumns: selectList('SELECT message FROM "app"') });
    expect(guarded({ message: "[ERROR] x" }, p)).toMatchObject({
      level: "unknown",
      notFetched: true,
    });
  });

  it("SQL wildcard and an explicit level column both infer", () => {
    for (const sql of ['SELECT * FROM "app"', 'SELECT level, message FROM "app"']) {
      const p = projection({ sqlMode: true, sqlColumns: selectList(sql) });
      expect(guarded({ message: "[ERROR] x" }, p).level).toBe("error");
    }
  });

  it("an alias producing the level key counts as fetched", () => {
    const p = projection({
      sqlMode: true,
      sqlColumns: selectList('SELECT lvl AS level, message FROM "app"'),
    });
    expect(guarded({ message: "[ERROR] x" }, p).level).toBe("error");
  });

  it("unparseable SQL is treated as projecting nothing", () => {
    const p = projection({ sqlMode: true, sqlColumns: null });
    expect(guarded({ message: "[ERROR] x" }, p).notFetched).toBe(true);
  });

  it("wide stream with forced quick mode resolves unknown; without forcing it infers", () => {
    const wide = ["level", "message", ...Array.from({ length: 499 }, (_, i) => `f${i}`)];
    const streams = [stream("app", wide)];
    expect(guarded({ message: "[ERROR] x" }, projection({ streams })).notFetched).toBe(true);
    const notForced = projection({ streams, quickModeForceEnabled: false });
    expect(guarded({ message: "[ERROR] x" }, notForced).level).toBe("error");
    const atLimit = projection({ streams: [stream("app", wide.slice(0, 500))] });
    expect(guarded({ message: "[ERROR] x" }, atLimit).level).toBe("error");
  });

  it("J-A9: UDS without the level field resolves unknown", () => {
    const streams = [stream("app", ["_timestamp", "level", "message"], ["message"])];
    expect(guarded({ message: "[ERROR] x" }, projection({ streams }))).toMatchObject({
      level: "unknown",
      notFetched: true,
    });
  });

  it("UDS that lists the level field, or is longer than the field limit, does not guard", () => {
    const listed = [stream("app", ["level", "message"], ["message", "level"])];
    expect(guarded({ message: "[ERROR] x" }, projection({ streams: listed })).level).toBe("error");
    const tooLong = [stream("app", ["level", "message"], ["message", "a", "b"])];
    const p = projection({ streams: tooLong, quickModeNumFields: 2 });
    expect(guarded({ message: "[ERROR] x" }, p).level).toBe("error");
  });

  it("J-A7: a mixed stream under SELECT * infers its message-only rows", () => {
    const p = projection();
    expect(guarded({ level: "info", message: "[ERROR] x" }, p)).toMatchObject({
      level: "info",
      source: "field",
    });
    expect(guarded({ message: "2026-10-06 ERROR payment" }, p)).toMatchObject({
      level: "error",
      source: "message",
    });
  });

  it("a row that carries the level field is never guarded", () => {
    const p = projection({ quickMode: true, interestingFields: ["message"] });
    expect(guarded({ level: "W", message: "[ERROR] x" }, p).level).toBe("error");
  });

  it("multi-stream rows use their own stream's schema", () => {
    const p = projection({
      streams: [stream("a", ["level", "message"], ["message"]), stream("b", ["message"])],
      selectedStreams: ["a", "b"],
    });
    expect(guarded({ _stream_name: "a", message: "[ERROR] x" }, p).notFetched).toBe(true);
    expect(guarded({ _stream_name: "b", message: "[ERROR] x" }, p).level).toBe("error");
  });

  it("an embedded caller with no projection always infers", () => {
    expect(resolveLogSeverity({ message: "[ERROR] x" }).level).toBe("error");
  });

  it("a stream whose schema is not loaded does not guard", () => {
    const p = projection({ streams: [{ name: "app" }] });
    expect(guarded({ message: "[ERROR] x" }, p).level).toBe("error");
  });
});

describe("memo and schema generation (A5)", () => {
  afterEach(() => bumpSeveritySchemaGeneration());

  const countingRow = () => {
    const reads = { count: 0 };
    const row: Record<string, unknown> = {};
    Object.defineProperty(row, "message", {
      enumerable: true,
      get() {
        reads.count += 1;
        return "[ERROR] x";
      },
    });
    return { row, reads };
  };

  it("runs the resolver body once across the colour and class calls", () => {
    const { row, reads } = countingRow();
    const colour = severityIndicatorColor(resolveLogSeverity(row));
    const after = reads.count;
    const cls = severityRowClass(resolveLogSeverity(row));
    expect(reads.count).toBe(after);
    expect(after).toBeGreaterThan(0);
    expect(colour).toBe("var(--color-log-severity-error-indicator)");
    expect(cls).toBe("o2-log-level-error o2-log-level-src-message");
  });

  it("recomputes after a schema generation bump", () => {
    const { row, reads } = countingRow();
    resolveLogSeverity(row);
    const after = reads.count;
    bumpSeveritySchemaGeneration();
    resolveLogSeverity(row);
    expect(reads.count).toBeGreaterThan(after);
  });

  it("recomputes a projection-guarded row once its stream schema is replaced", () => {
    const fields = new Set(["level", "message"]);
    const p = {
      projectedFields: new Set(["message"]) as ReadonlySet<string>,
      schemaFor: () => ({ fields, udsFields: null, serverMayTruncate: false }),
    };
    const row = { message: "[ERROR] x" };
    expect(resolveLogSeverity(row, p).level).toBe("unknown");
    fields.delete("level");
    expect(resolveLogSeverity(row, p).level).toBe("unknown");
    bumpSeveritySchemaGeneration();
    expect(resolveLogSeverity(row, p).level).toBe("error");
  });

  it("recomputes when the projection object changes", () => {
    const row = { message: "[ERROR] x" };
    const guardAll = {
      projectedFields: new Set<string>() as ReadonlySet<string>,
      schemaFor: () => ({ fields: new Set(["level"]), udsFields: null, serverMayTruncate: false }),
    };
    expect(resolveLogSeverity(row).level).toBe("error");
    expect(resolveLogSeverity(row, guardAll).level).toBe("unknown");
  });
});

describe("indicator colours and row classes (A7)", () => {
  it("returns token var() strings, never hex", () => {
    expect(severityIndicatorColor(sev({ level: "error" }))).toBe(
      "var(--color-log-severity-error-indicator)",
    );
    expect(severityIndicatorColor(sev({ status: 200 }))).toBe(
      "var(--color-log-severity-ok-indicator)",
    );
    expect(severityIndicatorColor(sev({ level: "trace" }))).toBe(
      "var(--color-log-severity-trace-indicator)",
    );
  });

  it("draws inferred rows with the same solid token as a field-sourced row", () => {
    const inferred = severityIndicatorColor(sev({ message: "[WARN] x" }));
    expect(inferred).toBe("var(--color-log-severity-warning-indicator)");
    expect(inferred).toBe(severityIndicatorColor(sev({ level: "warn" })));
  });

  it("draws nothing for unknown rows", () => {
    expect(severityIndicatorColor(sev({ message: "user logged in" }))).toBe("transparent");
    expect(severityRowClass(sev({}))).toBe("o2-log-level-unknown o2-log-level-src-none");
    expect(severityRowClass(sev({ status: 503 }))).toBe("o2-log-level-error o2-log-level-src-http");
  });

  it("defines every indicator token in light and dark", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const tokens = join(here, "../../lib/styles/tokens");
    const base = readFileSync(join(tokens, "base.css"), "utf8");
    const dark = readFileSync(join(tokens, "dark.css"), "utf8");
    const levels = [
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
    for (const level of levels) {
      const token = `--color-log-severity-${level}-indicator:`;
      expect(base).toContain(token);
      expect(dark).toContain(token);
    }
    expect(base).toContain("--color-log-severity-warning-indicator: #dd7b00;");
    expect(base).toContain("--color-log-severity-debug-indicator: #00a3b7;");
    expect(base).toContain("--color-log-severity-trace-indicator: #8497a0;");
  });
});

describe("legacy colours stay byte-identical (Patterns)", () => {
  it("STATUS_COLORS and STATUS_COLORS_DARK are unchanged", () => {
    expect(STATUS_COLORS).toMatchInlineSnapshot(`
      {
        "alert": "#ea580c",
        "critical": "#F4511E",
        "debug": "#00ACC1",
        "emergency": "#E53935",
        "error": "#EF5350",
        "info": "#1E88E5",
        "notice": "#16a34a",
        "ok": "#43A047",
        "warning": "#FB8C00",
      }
    `);
    expect(STATUS_COLORS_DARK).toMatchInlineSnapshot(`
      {
        "critical": "#DC6030",
        "debug": "#3DAAB8",
        "emergency": "#E07070",
        "error": "#D95C5C",
        "info": "#4D8FD4",
        "ok": "#4DAD55",
        "warning": "#D4944A",
      }
    `);
  });

  it("PatternDetailsDialog warning/debug colours are unchanged in light and dark", () => {
    expect(extractStatusFromTemplate("WARN disk").color).toBe("#FB8C00");
    expect(extractStatusFromTemplate("DEBUG x").color).toBe("#00ACC1");
    expect(extractStatusFromTemplate("WARN disk", true).color).toBe("#D4944A");
    expect(extractStatusFromTemplate("DEBUG x", true).color).toBe("#3DAAB8");
    expect(extractStatusFromLog({ level: "trace" }).level).toBe("debug");
  });
});

describe("exported level tables (A4, for item 4b)", () => {
  it("lists the tier-1 fields in order", () => {
    expect(SEVERITY_TIER1_FIELDS).toEqual([
      "severity",
      "level",
      "log_level",
      "loglevel",
      "severity_text",
      "syslog_severity",
      "syslog.severity",
    ]);
  });

  it("spells out aliases and OTel digit variants", () => {
    const errors = severityStringValues(["error"]);
    expect(errors).toEqual(
      expect.arrayContaining(["error", "err", "error2", "error3", "error4", "failure", "failed"]),
    );
    expect(errors).not.toContain("err2");
    expect(errors).not.toContain("warn");
    expect(severityStringValues(["emergency"])).toEqual(
      expect.arrayContaining(["emergency", "emerg", "fatal", "fatal2", "fatal4", "panic"]),
    );
  });

  it("every listed string resolves to its level through the row resolver", () => {
    for (const level of [
      "emergency",
      "error",
      "warning",
      "info",
      "debug",
      "trace",
      "ok",
    ] as const) {
      for (const value of severityStringValues([level])) {
        expect(levelOf({ level: value })).toBe(level);
      }
    }
  });

  it("single-field resolution matches the row resolver", () => {
    expect(resolveSeverityFieldValue("syslog_severity", "0")).toEqual({
      level: "emergency",
      source: "field",
    });
    expect(resolveSeverityFieldValue("status", "500")).toEqual({ level: "error", source: "http" });
    expect(resolveSeverityFieldValue("status", "3")).toEqual({ level: "error", source: "http" });
    expect(resolveSeverityFieldValue("Level", "50")).toEqual({ level: "error", source: "field" });
    expect(resolveSeverityFieldValue("host", "error")).toBeNull();
  });
});

describe("severitySqlPredicate (A4)", () => {
  const branchOrder = (sql: string, fields: string[]) => fields.map((f) => sql.indexOf(`"${f}"`));

  it("walks the present tier-1 fields in tier-1 order", () => {
    const sql = severitySqlPredicate(["level", "severity", "host"], ["error"]);
    expect(sql.startsWith("(CASE WHEN")).toBe(true);
    const [severity, level] = branchOrder(sql, ["severity", "level"]);
    expect(severity).toBeGreaterThan(0);
    expect(level).toBeGreaterThan(severity);
    expect(sql).not.toContain('"host"');
    expect(sql).toContain("'error3'");
    expect(sql).toContain("'failure'");
    expect(sql.endsWith("ELSE false END)")).toBe(true);
  });

  it("falls through numeric values outside the field's table", () => {
    const sql = severitySqlPredicate(["severity"], ["error"]);
    expect(sql).toContain("IN (1, 2, 3, 4, 5, 6, 7, 10, 20, 30, 40, 50, 60) THEN");
    expect(sql).toContain("IN (3, 50)");
    const syslog = severitySqlPredicate(["syslog_severity"], ["emergency"]);
    expect(syslog).toContain("IN (0, 1, 2, 3, 4, 5, 6, 7) THEN");
    expect(syslog).toContain("IN (0)");
  });

  it("returns false when no tier-1 field is present", () => {
    expect(severitySqlPredicate(["host"], ["error"])).toBe("false");
    expect(severitySqlPredicate(["status", "severity_number"], ["error"])).toBe("false");
  });

  it("appends tiers 2, 3 and 4 after tier 1 in on-screen order", () => {
    const sql = severitySqlPredicate(
      ["status", "severity_number", "level", "response_code"],
      ["error"],
      { includeTiers: [1, 2, 3, 4] },
    );
    const level = sql.indexOf('"level"');
    const number = sql.indexOf('"severity_number"');
    const statusText = sql.indexOf('"status"');
    const response = sql.indexOf('"response_code"');
    expect(level).toBeLessThan(number);
    expect(number).toBeLessThan(statusText);
    expect(statusText).toBeLessThan(response);
    expect(sql).toContain("BETWEEN 17 AND 20");
    expect(sql).toContain("BETWEEN 500 AND 599");
    expect(sql).toContain("BETWEEN 1 AND 7 THEN");
  });

  it("quotes identifiers", () => {
    expect(severitySqlPredicate(["syslog.severity"], ["error"])).toContain('"syslog.severity"');
  });
});
