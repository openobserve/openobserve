// Copyright 2026 OpenObserve Inc.
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

import { describe, expect, it } from "vitest";
import { extractSeverity, normalizeSeverity } from "./sourceEventSeverity";

describe("extractSeverity — correlation adapter over the severity resolver", () => {
  it.each([
    [{ level: "emergency" }, "FATAL"],
    [{ level: "alert" }, "FATAL"],
    [{ level: "critical" }, "FATAL"],
    [{ level: "fatal" }, "FATAL"],
    [{ level: "error" }, "ERROR"],
    [{ level: "warning" }, "WARN"],
    [{ level: "notice" }, "WARN"],
    [{ level: "info" }, "INFO"],
    [{ level: "ok" }, "INFO"],
    [{ level: "debug" }, "DEBUG"],
    [{ level: "trace" }, "TRACE"],
  ])("maps %j to %s", (row, expected) => {
    expect(extractSeverity(row)).toBe(expected);
  });

  it("keeps today's field order: severity_text beats severity", () => {
    expect(extractSeverity({ severity_text: "ERROR", severity: "INFO" })).toBe("ERROR");
    expect(extractSeverity({ severity: "WARN", level: "error" })).toBe("WARN");
  });

  it("keeps the camel-case aliases", () => {
    expect(extractSeverity({ severityText: "warn2" })).toBe("WARN");
    expect(extractSeverity({ severityNumber: 18 })).toBe("ERROR");
    expect(extractSeverity({ severityNumber: "9" })).toBe("INFO");
  });

  it("reads OTel numbers on severity_number only (J-A3)", () => {
    expect(extractSeverity({ severity: "WARN2", severity_number: 14 })).toBe("WARN");
    expect(extractSeverity({ severity_number: 18 })).toBe("ERROR");
    expect(extractSeverity({ severity_number: 0 })).toBeNull();
  });

  it("falls through an unrecognised value to the next field", () => {
    expect(extractSeverity({ severity: "W", level: "error" })).toBe("ERROR");
    expect(extractSeverity({ level: "", log_level: "debug" })).toBe("DEBUG");
  });

  it("does not read status, HTTP codes or the message (tiers 1-2 only)", () => {
    expect(extractSeverity({ status: "failure" })).toBeNull();
    expect(extractSeverity({ status: 500 })).toBeNull();
    expect(extractSeverity({ message: "[ERROR] x" })).toBeNull();
    expect(extractSeverity(null)).toBeNull();
    expect(extractSeverity({})).toBeNull();
  });

  describe("listed behaviour changes", () => {
    it("numeric level 1-7 now uses syslog: level 3 is ERROR (was TRACE)", () => {
      expect(extractSeverity({ level: 3 })).toBe("ERROR");
      expect(extractSeverity({ severity: 7 })).toBe("DEBUG");
    });

    it("pino numbers on level resolve (level 50 is ERROR)", () => {
      expect(extractSeverity({ level: 50 })).toBe("ERROR");
    });

    it("a substring no longer matches", () => {
      expect(extractSeverity({ level: "MyERRORCode" })).toBeNull();
    });

    it("OTel bands on level/severity no longer apply (severity 9 falls through)", () => {
      expect(extractSeverity({ severity: 9 })).toBeNull();
      expect(extractSeverity({ severity: 9, severity_number: 9 })).toBe("INFO");
    });

    it("syslog severity fields are not part of the adapter", () => {
      expect(extractSeverity({ syslog_severity: 3 })).toBeNull();
    });
  });

  it.each([
    [2, "TRACE"],
    [6, "DEBUG"],
    [10, "INFO"],
    [14, "WARN"],
    [18, "ERROR"],
    [22, "FATAL"],
    [30, null],
    ["9", "INFO"],
    ["  ", null],
    ["", null],
    [null, null],
    ["nothing", null],
  ])("normalizeSeverity(%j) stays %s for traces", (raw, expected) => {
    expect(normalizeSeverity(raw as any)).toBe(expected);
  });

  it("leaves normalizeSeverity (traces) unchanged", () => {
    expect(normalizeSeverity(3)).toBe("TRACE");
    expect(normalizeSeverity("MyERRORCode")).toBe("ERROR");
    expect(normalizeSeverity(0)).toBeNull();
  });
});
