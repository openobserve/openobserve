import { describe, expect, it } from "vitest";
import {
  extractStatusFromLog,
  STATUS_COLORS,
  type StatusInfo,
} from "./statusParser";

describe("statusParser", () => {
  describe("STATUS_COLORS", () => {
    it("should have all required color mappings", () => {
      expect(STATUS_COLORS).toHaveProperty("emergency");
      expect(STATUS_COLORS).toHaveProperty("alert");
      expect(STATUS_COLORS).toHaveProperty("critical");
      expect(STATUS_COLORS).toHaveProperty("error");
      expect(STATUS_COLORS).toHaveProperty("warning");
      expect(STATUS_COLORS).toHaveProperty("notice");
      expect(STATUS_COLORS).toHaveProperty("info");
      expect(STATUS_COLORS).toHaveProperty("debug");
      expect(STATUS_COLORS).toHaveProperty("ok");
    });

    it("should have valid hex color codes", () => {
      Object.values(STATUS_COLORS).forEach((color) => {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
      });
    });
  });

  describe("extractStatusFromLog", () => {
    describe("invalid inputs", () => {
      it("should return info level for null input", () => {
        const result = extractStatusFromLog(null);
        expect(result).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should return info level for undefined input", () => {
        const result = extractStatusFromLog(undefined);
        expect(result).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should return info level for non-object input", () => {
        expect(extractStatusFromLog("string")).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
        expect(extractStatusFromLog(123)).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
        expect(extractStatusFromLog(true)).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should return info level when no status fields are present", () => {
        const result = extractStatusFromLog({ message: "Hello world" });
        expect(result).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });
    });

    describe("status field extraction priority", () => {
      it("should prioritize 'status' field over others", () => {
        const logEntry = {
          status: "error",
          severity: "warning",
          level: "info",
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("error");
        expect(result.priority).toBe(3);
      });

      it("should use 'severity' field when 'status' is not present", () => {
        const logEntry = {
          severity: "warning",
          level: "info",
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("warning");
        expect(result.priority).toBe(4);
      });

      it("should use 'level' field when 'status' and 'severity' are not present", () => {
        const logEntry = {
          level: "debug",
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("debug");
        expect(result.priority).toBe(7);
      });

      it("should use 'syslog.severity' field when other fields are not present", () => {
        const logEntry = {
          "syslog.severity": 3,
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("error");
        expect(result.priority).toBe(3);
      });
    });

    describe("numeric syslog severity levels", () => {
      it("should parse level 0 as emergency", () => {
        const result = extractStatusFromLog({ "syslog.severity": 0 });
        expect(result).toEqual({
          level: "emergency",
          color: STATUS_COLORS.emergency,
          priority: 0,
        });
      });

      it("should parse level 1 as alert", () => {
        const result = extractStatusFromLog({ "syslog.severity": 1 });
        expect(result).toEqual({
          level: "alert",
          color: STATUS_COLORS.alert,
          priority: 1,
        });
      });

      it("should parse level 2 as critical", () => {
        const result = extractStatusFromLog({ "syslog.severity": 2 });
        expect(result).toEqual({
          level: "critical",
          color: STATUS_COLORS.critical,
          priority: 2,
        });
      });

      it("should parse level 3 as error", () => {
        const result = extractStatusFromLog({ "syslog.severity": 3 });
        expect(result).toEqual({
          level: "error",
          color: STATUS_COLORS.error,
          priority: 3,
        });
      });

      it("should parse level 4 as warning", () => {
        const result = extractStatusFromLog({ "syslog.severity": 4 });
        expect(result).toEqual({
          level: "warning",
          color: STATUS_COLORS.warning,
          priority: 4,
        });
      });

      it("should parse level 5 as notice", () => {
        const result = extractStatusFromLog({ "syslog.severity": 5 });
        expect(result).toEqual({
          level: "notice",
          color: STATUS_COLORS.notice,
          priority: 5,
        });
      });

      it("should parse level 6 as info", () => {
        const result = extractStatusFromLog({ "syslog.severity": 6 });
        expect(result).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should parse level 7 as debug", () => {
        const result = extractStatusFromLog({ "syslog.severity": 7 });
        expect(result).toEqual({
          level: "debug",
          color: STATUS_COLORS.debug,
          priority: 7,
        });
      });

      it("should default to info for invalid numeric levels", () => {
        expect(extractStatusFromLog({ "syslog.severity": 99 })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
        expect(extractStatusFromLog({ "syslog.severity": -1 })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });
    });

    describe("string status levels", () => {
      describe("emergency/fatal levels", () => {
        it("should parse 'emergency' as emergency", () => {
          const result = extractStatusFromLog({ level: "emergency" });
          expect(result.level).toBe("emergency");
          expect(result.priority).toBe(0);
        });

        it("should parse 'emerg' as emergency", () => {
          const result = extractStatusFromLog({ level: "emerg" });
          expect(result.level).toBe("emergency");
          expect(result.priority).toBe(0);
        });

        it("should parse 'fatal' as emergency", () => {
          const result = extractStatusFromLog({ level: "fatal" });
          expect(result.level).toBe("emergency");
          expect(result.priority).toBe(0);
        });

        it("should parse 'f' as emergency", () => {
          const result = extractStatusFromLog({ level: "f" });
          expect(result.level).toBe("emergency");
          expect(result.priority).toBe(0);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "EMERGENCY" }).level).toBe("emergency");
          expect(extractStatusFromLog({ level: "EmErGeNcY" }).level).toBe("emergency");
          expect(extractStatusFromLog({ level: "FATAL" }).level).toBe("emergency");
        });
      });

      describe("alert levels", () => {
        it("should parse 'alert' as alert", () => {
          const result = extractStatusFromLog({ level: "alert" });
          expect(result.level).toBe("alert");
          expect(result.priority).toBe(1);
        });

        it("should parse 'a' as alert", () => {
          const result = extractStatusFromLog({ level: "a" });
          expect(result.level).toBe("alert");
          expect(result.priority).toBe(1);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "ALERT" }).level).toBe("alert");
        });
      });

      describe("critical levels", () => {
        it("should parse 'critical' as critical", () => {
          const result = extractStatusFromLog({ level: "critical" });
          expect(result.level).toBe("critical");
          expect(result.priority).toBe(2);
        });

        it("should parse 'crit' as critical", () => {
          const result = extractStatusFromLog({ level: "crit" });
          expect(result.level).toBe("critical");
          expect(result.priority).toBe(2);
        });

        it("should parse 'c' as critical", () => {
          const result = extractStatusFromLog({ level: "c" });
          expect(result.level).toBe("critical");
          expect(result.priority).toBe(2);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "CRITICAL" }).level).toBe("critical");
        });
      });

      describe("error levels", () => {
        it("should parse 'error' as error", () => {
          const result = extractStatusFromLog({ level: "error" });
          expect(result.level).toBe("error");
          expect(result.priority).toBe(3);
        });

        it("should parse 'err' as error", () => {
          const result = extractStatusFromLog({ level: "err" });
          expect(result.level).toBe("error");
          expect(result.priority).toBe(3);
        });

        it("should parse 'e' as error", () => {
          const result = extractStatusFromLog({ level: "e" });
          expect(result.level).toBe("error");
          expect(result.priority).toBe(3);
        });

        it("should not confuse 'emergency' with error", () => {
          const result = extractStatusFromLog({ level: "emergency" });
          expect(result.level).toBe("emergency");
          expect(result.priority).toBe(0);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "ERROR" }).level).toBe("error");
        });
      });

      describe("warning levels", () => {
        it("should parse 'warning' as warning", () => {
          const result = extractStatusFromLog({ level: "warning" });
          expect(result.level).toBe("warning");
          expect(result.priority).toBe(4);
        });

        it("should parse 'warn' as warning", () => {
          const result = extractStatusFromLog({ level: "warn" });
          expect(result.level).toBe("warning");
          expect(result.priority).toBe(4);
        });

        it("should parse 'w' as warning", () => {
          const result = extractStatusFromLog({ level: "w" });
          expect(result.level).toBe("warning");
          expect(result.priority).toBe(4);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "WARNING" }).level).toBe("warning");
        });
      });

      describe("notice levels", () => {
        it("should parse 'notice' as notice", () => {
          const result = extractStatusFromLog({ level: "notice" });
          expect(result.level).toBe("notice");
          expect(result.priority).toBe(5);
        });

        it("should parse 'n' as notice", () => {
          const result = extractStatusFromLog({ level: "n" });
          expect(result.level).toBe("notice");
          expect(result.priority).toBe(5);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "NOTICE" }).level).toBe("notice");
        });
      });

      describe("info levels", () => {
        it("should parse 'info' as info", () => {
          const result = extractStatusFromLog({ level: "info" });
          expect(result.level).toBe("info");
          expect(result.priority).toBe(6);
        });

        it("should parse 'information' as info", () => {
          const result = extractStatusFromLog({ level: "information" });
          expect(result.level).toBe("info");
          expect(result.priority).toBe(6);
        });

        it("should parse 'i' as info", () => {
          const result = extractStatusFromLog({ level: "i" });
          expect(result.level).toBe("info");
          expect(result.priority).toBe(6);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "INFO" }).level).toBe("info");
        });
      });

      describe("debug levels", () => {
        it("should parse 'debug' as debug", () => {
          const result = extractStatusFromLog({ level: "debug" });
          expect(result.level).toBe("debug");
          expect(result.priority).toBe(7);
        });

        it("should parse 'd' as debug", () => {
          const result = extractStatusFromLog({ level: "d" });
          expect(result.level).toBe("debug");
          expect(result.priority).toBe(7);
        });

        it("should parse 'trace' as debug", () => {
          const result = extractStatusFromLog({ level: "trace" });
          expect(result.level).toBe("debug");
          expect(result.priority).toBe(7);
        });

        it("should parse 'verbose' as debug", () => {
          const result = extractStatusFromLog({ level: "verbose" });
          expect(result.level).toBe("debug");
          expect(result.priority).toBe(7);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "DEBUG" }).level).toBe("debug");
          expect(extractStatusFromLog({ level: "TRACE" }).level).toBe("debug");
        });
      });

      describe("ok/success levels", () => {
        it("should parse 'ok' as ok", () => {
          const result = extractStatusFromLog({ level: "ok" });
          expect(result.level).toBe("ok");
          expect(result.priority).toBe(8);
        });

        it("should parse 'success' as ok", () => {
          const result = extractStatusFromLog({ level: "success" });
          expect(result.level).toBe("ok");
          expect(result.priority).toBe(8);
        });

        it("should parse 'o' as ok", () => {
          const result = extractStatusFromLog({ level: "o" });
          expect(result.level).toBe("ok");
          expect(result.priority).toBe(8);
        });

        it("should parse 's' as ok", () => {
          const result = extractStatusFromLog({ level: "s" });
          expect(result.level).toBe("ok");
          expect(result.priority).toBe(8);
        });

        it("should be case insensitive", () => {
          expect(extractStatusFromLog({ level: "OK" }).level).toBe("ok");
          expect(extractStatusFromLog({ level: "SUCCESS" }).level).toBe("ok");
        });
      });

      describe("unrecognized string values", () => {
        it("should default to info for unknown strings", () => {
          expect(extractStatusFromLog({ level: "unknown" })).toEqual({
            level: "info",
            color: STATUS_COLORS.info,
            priority: 6,
          });
          expect(extractStatusFromLog({ level: "xyz" })).toEqual({
            level: "info",
            color: STATUS_COLORS.info,
            priority: 6,
          });
        });

        it("should handle empty strings", () => {
          const result = extractStatusFromLog({ level: "" });
          expect(result).toEqual({
            level: "info",
            color: STATUS_COLORS.info,
            priority: 6,
          });
        });
      });

      describe("whitespace handling", () => {
        it("should trim whitespace from status values", () => {
          expect(extractStatusFromLog({ level: "  error  " }).level).toBe("error");
          expect(extractStatusFromLog({ level: "\terror\t" }).level).toBe("error");
          expect(extractStatusFromLog({ level: "\nwarning\n" }).level).toBe("warning");
        });
      });
    });

    describe("mixed type handling", () => {
      it("should handle boolean status values as info", () => {
        expect(extractStatusFromLog({ status: true })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
        expect(extractStatusFromLog({ status: false })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should handle object status values as info", () => {
        expect(extractStatusFromLog({ status: { level: "error" } })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });

      it("should handle array status values as info", () => {
        expect(extractStatusFromLog({ status: ["error"] })).toEqual({
          level: "info",
          color: STATUS_COLORS.info,
          priority: 6,
        });
      });
    });

    describe("real-world log entry examples", () => {
      it("should parse Apache-style log", () => {
        const logEntry = {
          level: "ERROR",
          message: "Database connection failed",
          timestamp: "2023-01-01T10:00:00Z",
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("error");
        expect(result.priority).toBe(3);
      });

      it("should parse syslog-style log", () => {
        const logEntry = {
          "syslog.severity": 4,
          message: "Disk space running low",
          facility: "system",
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("warning");
        expect(result.priority).toBe(4);
      });

      it("should parse custom application log", () => {
        const logEntry = {
          status: "ok",
          message: "Request completed successfully",
          duration_ms: 123,
        };
        const result = extractStatusFromLog(logEntry);
        expect(result.level).toBe("ok");
        expect(result.priority).toBe(8);
      });
    });

    describe("StatusInfo structure", () => {
      it("should always return an object with level, color, and priority", () => {
        const result = extractStatusFromLog({ level: "error" });
        expect(result).toHaveProperty("level");
        expect(result).toHaveProperty("color");
        expect(result).toHaveProperty("priority");
        expect(typeof result.level).toBe("string");
        expect(typeof result.color).toBe("string");
        expect(typeof result.priority).toBe("number");
      });

      it("should have consistent priority values", () => {
        expect(extractStatusFromLog({ level: "emergency" }).priority).toBe(0);
        expect(extractStatusFromLog({ level: "alert" }).priority).toBe(1);
        expect(extractStatusFromLog({ level: "critical" }).priority).toBe(2);
        expect(extractStatusFromLog({ level: "error" }).priority).toBe(3);
        expect(extractStatusFromLog({ level: "warning" }).priority).toBe(4);
        expect(extractStatusFromLog({ level: "notice" }).priority).toBe(5);
        expect(extractStatusFromLog({ level: "info" }).priority).toBe(6);
        expect(extractStatusFromLog({ level: "debug" }).priority).toBe(7);
        expect(extractStatusFromLog({ level: "ok" }).priority).toBe(8);
      });
    });
  });
});
