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

import { describe, it, expect } from "vitest";
import {
  STATUS_COLORS,
  STATUS_COLORS_DARK,
  extractStatusFromLog,
  extractStatusFromTemplate,
  type StatusInfo,
} from "./statusParser";

describe("statusParser.ts", () => {
  // ---------------------------------------------------------------------------
  // COLOR CONSTANTS
  // ---------------------------------------------------------------------------
  describe("STATUS_COLORS", () => {
    it("contains all expected log level keys", () => {
      const keys = ["emergency", "alert", "critical", "error", "warning", "notice", "info", "debug", "ok"];
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
      ["emerg",     "emergency", 0],
      ["fatal",     "emergency", 0],
      ["FATAL",     "emergency", 0],
      ["alert",     "alert",     1],
      ["ALERT",     "alert",     1],
      ["critical",  "critical",  2],
      ["crit",      "critical",  2],
      ["error",     "error",     3],
      ["ERROR",     "error",     3],
      ["err",       "error",     3],
      ["warning",   "warning",   4],
      ["WARNING",   "warning",   4],
      ["warn",      "warning",   4],
      ["WARN",      "warning",   4],
      ["notice",    "notice",    5],
      ["info",      "info",      6],
      ["INFO",      "info",      6],
      ["information","info",     6],
      ["debug",     "debug",     7],
      ["DEBUG",     "debug",     7],
      ["trace",     "debug",     7],
      ["verbose",   "debug",     7],
      ["ok",        "ok",        8],
      ["success",   "ok",        8],
      ["SUCCESS",   "ok",        8],
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
      [0, "info",      6], // OTEL UNSPECIFIED → info
      [1, "alert",     1],
      [2, "critical",  2],
      [3, "error",     3],
      [4, "warning",   4],
      [5, "notice",    5],
      [6, "info",      6],
      [7, "debug",     7],
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
      const levelsWithDark = ["error", "warning", "info", "debug", "ok", "critical", "emergency"] as const;
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
      const dark  = extractStatusFromLog({ level: "error" }, true);
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
