// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";

import type { ClassifiedValue } from "@/services/securityIntel";
import {
  expiresSoon,
  indicatorCell,
  indicatorToRow,
  indicatorsFromCsv,
  indicatorsToCsv,
  intelTableName,
  isExpired,
  isIntelTable,
  parseCsv,
  removalCells,
  rowColumns,
  rowToIndicator,
  rowsToCsv,
  rowsWithout,
} from "./intel";

const found = (indicator: string, type: ClassifiedValue["type"], duplicate = false) => ({
  indicator,
  type,
  duplicate,
});

describe("tables", () => {
  it("names intel tables the way the backend stores them", () => {
    expect(intelTableName("My Feed")).toBe("ioc_my_feed");
    expect(intelTableName("ioc_abuse")).toBe("ioc_abuse");
    expect(intelTableName("threat_intel_x")).toBe("threat_intel_x");
    expect(isIntelTable("geoip")).toBe(false);
  });
});

describe("CSV", () => {
  it("round-trips quoting, commas and newlines", () => {
    const csv = indicatorsToCsv([
      {
        indicator: "evil.com",
        type: "domain",
        severity: "high",
        confidence: 80,
        source: 'Report "A", 2026',
        description: "line1\nline2",
        addedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "",
      },
    ]);
    const [header, row] = parseCsv(csv);
    expect(header[0]).toBe("indicator");
    expect(row[4]).toBe('Report "A", 2026');
    expect(row[5]).toBe("line1\nline2");
  });

  it("imports a foreign CSV with the server's reading of each indicator cell", async () => {
    const classify = vi.fn(async () => [
      found("1.2.3.4", "ip"),
      found("evil.com", "domain"),
      null,
      found("1.2.3.4", "ip", true),
    ]);
    const result = await indicatorsFromCsv(
      "IOC,Type,Severity\n1.2.3.4,,critical\nevil.com,ip,\njunk,,\n1.2.3.4,,low\n",
      { severity: "medium", source: "upload", confidence: 60 },
      "2026-01-01T00:00:00.000Z",
      classify,
    );
    expect(classify).toHaveBeenCalledWith(["1.2.3.4", "evil.com", "junk", "1.2.3.4"]);
    expect(result.missingColumn).toBe(false);
    expect(result.invalid).toBe(1);
    expect(result.indicators.map((i) => [i.indicator, i.type, i.severity, i.confidence])).toEqual([
      ["1.2.3.4", "ip", "critical", 60],
      ["evil.com", "domain", "medium", 60],
    ]);
    expect(result.indicators[0].source).toBe("upload");
  });

  it("says so when there is no indicator column, without asking the server", async () => {
    const classify = vi.fn();
    const result = await indicatorsFromCsv(
      "a,b\n1,2\n",
      { severity: "low", source: "", confidence: 1 },
      "",
      classify,
    );
    expect(result.missingColumn).toBe(true);
    expect(classify).not.toHaveBeenCalled();
  });

  it("drops stored rows the server did not read as indicators", () => {
    expect(rowToIndicator({ indicator: "???" }, "ioc_x", null)).toBeNull();
    const row = { indicator: "1.2.3.4", confidence: "250", severity: "nope" };
    expect(rowToIndicator(row, "ioc_x", found("1.2.3.4", "ip"))).toMatchObject({
      confidence: 100,
      severity: "medium",
      table: "ioc_x",
    });
    expect(indicatorCell({ ioc: "a", value: "b" })).toBe("a");
  });
});

describe("expiry", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");
  it("separates expired, expiring and open-ended", () => {
    expect(isExpired({ expiresAt: "2026-05-01T00:00:00Z" }, now)).toBe(true);
    expect(isExpired({ expiresAt: "" }, now)).toBe(false);
    expect(expiresSoon({ expiresAt: "2026-06-03T00:00:00Z" }, now)).toBe(true);
    expect(expiresSoon({ expiresAt: "2026-07-03T00:00:00Z" }, now)).toBe(false);
  });
});

describe("rewriting a list", () => {
  const stored = [
    { _timestamp: 1, indicator: "1.2.3.4", type: "ip", extra: "keep me", severity: "high" },
    { _timestamp: 1, indicator: "EVIL.com", type: "", extra: "", severity: "" },
    { _timestamp: 1, indicator: "not an ioc", type: "", extra: "odd", severity: "" },
    { _timestamp: 1, ioc: "2001:0DB8::1", extra: "x" },
    { _timestamp: 1, indicator: "", type: "", extra: "", severity: "" },
  ];
  const classified = [
    found("1.2.3.4", "ip"),
    found("evil.com", "domain"),
    null,
    found("2001:db8::1", "ip"),
    null,
  ];

  it("asks the server about each row's indicator cell", () => {
    expect(removalCells(stored)).toEqual(["1.2.3.4", "EVIL.com", "not an ioc", "2001:0DB8::1", ""]);
  });

  it("removes only the matching row and keeps every other value as stored", () => {
    const { kept, removed } = rowsWithout(
      stored,
      { type: "domain", indicator: "evil.com" },
      classified,
    );
    expect(removed).toBe(1);
    expect(kept).toEqual([
      { indicator: "1.2.3.4", type: "ip", extra: "keep me", severity: "high" },
      { indicator: "not an ioc", type: "", extra: "odd", severity: "" },
      { ioc: "2001:0DB8::1", extra: "x" },
    ]);
  });

  it("matches alternate columns by their canonical form", () => {
    expect(rowsWithout(stored, { type: "ip", indicator: "2001:db8::1" }, classified).removed).toBe(
      1,
    );
  });

  it("writes every column, including ones this page does not know", () => {
    const cols = rowColumns(stored);
    expect(cols).toEqual(["indicator", "type", "extra", "severity", "ioc"]);
    const csv = rowsToCsv(cols, [{ indicator: "a,b", extra: 'q"x' }]);
    expect(parseCsv(csv)).toEqual([cols, ["a,b", "", 'q"x', "", ""]]);
  });
});

describe("indicatorToRow", () => {
  const ind = {
    indicator: "1.2.3.4",
    type: "ip" as const,
    severity: "high" as const,
    confidence: 80,
    source: "s",
    description: "",
    addedAt: "2026-01-01",
    expiresAt: "",
  };
  it("fills exactly the table's own columns", () => {
    expect(indicatorToRow(ind, ["ioc", "analyst_note", "severity"])).toEqual({
      ioc: "1.2.3.4",
      analyst_note: "",
      severity: "high",
    });
  });
  it("refuses a table with nowhere to put the indicator", () => {
    expect(indicatorToRow(ind, ["name", "city"])).toBeNull();
  });
});
