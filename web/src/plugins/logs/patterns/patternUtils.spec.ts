// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it } from "vitest";
import {
  extractConstantsFromPattern,
  escapeForMatchAll,
  buildPatternSqlQuery,
  buildAlertNameFromPattern,
  buildPatternAlertData,
} from "./patternUtils";

describe("extractConstantsFromPattern", () => {
  it("returns segments longer than 10 chars split by <*>", () => {
    const result = extractConstantsFromPattern(
      "User authentication failed for <*> from host <*>",
    );
    expect(result).toEqual([
      "User authentication failed for",
      "from host",
    ].filter((s) => s.trim().length > 10));
  });

  it("returns only segments longer than 10 chars", () => {
    const result = extractConstantsFromPattern(
      "INFO action <*> at 14:47.1755283",
    );
    // "INFO action" = 11 chars > 10 — included; "at 14:47.1755283" = 16 chars > 10 — included
    expect(result).toContain("INFO action");
    expect(result).toContain("at 14:47.1755283");
  });

  it("excludes short segments (<= 10 chars)", () => {
    const result = extractConstantsFromPattern("GET <*> 200");
    // "GET" = 3, "200" = 3 — both excluded
    expect(result).toHaveLength(0);
  });

  it("handles <:NAMED> variable markers", () => {
    const result = extractConstantsFromPattern(
      "Connection established to <:HOST> on port <:PORT> successfully",
    );
    // "Connection established to" = 25 chars — included
    expect(result).toContain("Connection established to");
    // "on port" = 7 chars — excluded
    expect(result).not.toContain("on port");
    // "successfully" = 12 chars — included
    expect(result).toContain("successfully");
  });

  it("returns empty array when template has no long constant segments", () => {
    const result = extractConstantsFromPattern("<*> <*> <*>");
    expect(result).toHaveLength(0);
  });

  it("trims whitespace from segments before length check", () => {
    // Segment " short " trims to "short" (5 chars) — excluded
    const result = extractConstantsFromPattern("short <*> also short");
    expect(result).toHaveLength(0);
  });

  it("handles template with no variable markers", () => {
    const result = extractConstantsFromPattern(
      "This is a long constant string with no variables",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(
      "This is a long constant string with no variables",
    );
  });
});

describe("escapeForMatchAll", () => {
  it("escapes backslashes first", () => {
    expect(escapeForMatchAll("a\\b")).toBe("a\\\\b");
  });

  it("escapes single quotes", () => {
    expect(escapeForMatchAll("it's")).toBe("it\\'s");
  });

  it("escapes double quotes", () => {
    expect(escapeForMatchAll('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes newlines", () => {
    expect(escapeForMatchAll("line1\nline2")).toBe("line1\\nline2");
  });

  it("escapes carriage returns", () => {
    expect(escapeForMatchAll("line1\rline2")).toBe("line1\\rline2");
  });

  it("escapes tabs", () => {
    expect(escapeForMatchAll("col1\tcol2")).toBe("col1\\tcol2");
  });

  it("does not modify plain strings", () => {
    expect(escapeForMatchAll("hello world")).toBe("hello world");
  });

  it("handles backslash before quote correctly (order matters)", () => {
    // Input: \'  → after backslash escape: \\'  → after quote escape: \\\\'
    expect(escapeForMatchAll("\\'")).toBe("\\\\\\'");
  });
});

describe("buildPatternSqlQuery", () => {
  it("builds a SELECT with WHERE match_all clauses for long segments", () => {
    const sql = buildPatternSqlQuery(
      "User authentication failed for <*> from address <*>",
      "my_stream",
    );
    expect(sql).toBe(
      "SELECT * FROM 'my_stream' WHERE match_all('User authentication failed for') AND match_all('from address')",
    );
  });

  it("returns SELECT without WHERE when no segments are long enough", () => {
    const sql = buildPatternSqlQuery("GET <*> 200", "my_stream");
    expect(sql).toBe("SELECT * FROM 'my_stream'");
  });

  it("escapes special chars in constants", () => {
    const sql = buildPatternSqlQuery(
      "Error: it's a problem here <*> done",
      "my_stream",
    );
    expect(sql).toContain("match_all('Error: it\\'s a problem here')");
  });
});

describe("buildAlertNameFromPattern", () => {
  it("prefixes with Alert for normal patterns", () => {
    const name = buildAlertNameFromPattern(
      "User logged in from <*>",
      "mystream",
      false,
    );
    expect(name).toMatch(/^Alert_/);
  });

  it("prefixes with Anomaly for anomaly patterns", () => {
    const name = buildAlertNameFromPattern(
      "Unknown error occurred <*>",
      "mystream",
      true,
    );
    expect(name).toMatch(/^Anomaly_/);
  });

  it("includes stream name in alert name", () => {
    const name = buildAlertNameFromPattern(
      "User logged in <*>",
      "prod_logs",
      false,
    );
    expect(name).toContain("prod_logs");
  });

  it("truncates to 60 chars", () => {
    const name = buildAlertNameFromPattern(
      "VeryLongWordOne VeryLongWordTwo VeryLongWordThree VeryLongWordFour <*>",
      "very_long_stream_name",
      false,
    );
    expect(name.length).toBeLessThanOrEqual(60);
  });

  it("falls back to stream name when template has no alphabetic words", () => {
    const name = buildAlertNameFromPattern("123 <*> 456", "fallback_stream", false);
    expect(name).toContain("fallback_stream");
  });
});

describe("buildPatternAlertData", () => {
  const mockPattern = {
    pattern_id: "pid-1",
    template: "User authentication failed for <*> from address <*>",
    frequency: 500,
    percentage: 12.5,
    is_anomaly: false,
  };

  it("returns correct streamName and streamType", () => {
    const data = buildPatternAlertData(mockPattern, "my_stream", 15, 1000);
    expect(data.streamName).toBe("my_stream");
    expect(data.streamType).toBe("logs");
  });

  it("sets sqlQuery using buildPatternSqlQuery", () => {
    const data = buildPatternAlertData(mockPattern, "my_stream", 15, 1000);
    expect(data.sqlQuery).toContain("SELECT * FROM 'my_stream'");
    expect(data.sqlQuery).toContain("match_all(");
  });

  it("sets periodMinutes from argument", () => {
    const data = buildPatternAlertData(mockPattern, "my_stream", 30, 1000);
    expect(data.periodMinutes).toBe(30);
  });

  it("passes through pattern metadata", () => {
    const data = buildPatternAlertData(mockPattern, "my_stream", 15, 999);
    expect(data.patternId).toBe("pid-1");
    expect(data.patternFrequency).toBe(500);
    expect(data.patternPercentage).toBe(12.5);
    expect(data.isAnomaly).toBe(false);
    expect(data.totalLogsAnalyzed).toBe(999);
  });

  it("sets isAnomaly true when pattern.is_anomaly is truthy", () => {
    const data = buildPatternAlertData(
      { ...mockPattern, is_anomaly: true },
      "my_stream",
      15,
      0,
    );
    expect(data.isAnomaly).toBe(true);
  });

  it("defaults missing pattern fields to safe values", () => {
    const data = buildPatternAlertData(
      { template: "Something happened here <*> done" },
      "s",
      15,
      0,
    );
    expect(data.patternId).toBe("");
    expect(data.patternFrequency).toBe(0);
    expect(data.patternPercentage).toBe(0);
    expect(data.isAnomaly).toBe(false);
  });
});
