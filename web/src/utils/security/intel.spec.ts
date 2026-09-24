// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import {
  batches,
  indicatorToRow,
  canonicalIpv6,
  rowColumns,
  rowsToCsv,
  rowsWithout,
  candidateColumns,
  detectIndicatorType,
  expiresSoon,
  foldMatches,
  indicatorsFromCsv,
  indicatorsToCsv,
  intelTableName,
  isExpired,
  isIntelTable,
  normalizeIndicator,
  parseCsv,
  parseIndicatorList,
  refang,
  rowToIndicator,
  sightingsSql,
  sweepSql,
  type Indicator,
} from "./intel";

describe("detectIndicatorType", () => {
  it.each([
    ["185.220.101.4", "ip"],
    ["2001:db8::1", "ip"],
    ["::1", "ip"],
    ["10.0.0.0/8", "cidr"],
    ["2001:db8::/32", "cidr"],
    ["evil.example.com", "domain"],
    ["https://evil.example.com/a?b=c", "url"],
    ["d41d8cd98f00b204e9800998ecf8427e", "hash"],
    ["da39a3ee5e6b4b0d3255bfef95601890afd80709", "hash"],
    ["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hash"],
    ["phish@bad.example", "email"],
  ])("recognises %s as %s", (value, type) => {
    expect(detectIndicatorType(value)).toBe(type);
  });

  it.each([
    "256.1.1.1",
    "1.2.3",
    "10.0.0.0/40",
    "not an ioc",
    "abc",
    "d41d8cd98f00b204e9800998ecf8427",
    "",
  ])("rejects %s", (value) => {
    expect(detectIndicatorType(value)).toBeNull();
  });

  it("reads defanged indicators", () => {
    expect(refang("hxxps://evil[.]com/x")).toBe("https://evil.com/x");
    expect(detectIndicatorType("1.2.3[.]4")).toBe("ip");
    expect(detectIndicatorType("bad[at]evil[.]com")).toBe("email");
  });
});

describe("normalizeIndicator", () => {
  it("lower-cases everything except a URL's path", () => {
    expect(normalizeIndicator("Evil.COM", "domain")).toBe("evil.com");
    expect(normalizeIndicator("HTTPS://Evil.COM/Path", "url")).toBe("https://evil.com/Path");
    expect(normalizeIndicator("D41D8CD98F00B204E9800998ECF8427E", "hash")).toBe(
      "d41d8cd98f00b204e9800998ecf8427e",
    );
  });
});

describe("parseIndicatorList", () => {
  it("splits on lines, commas and spaces, dedupes and reports bad lines", () => {
    const parsed = parseIndicatorList("1.2.3.4, evil.com\nnope\n1.2.3.4 EVIL.com");
    expect(parsed.valid).toEqual([
      { indicator: "1.2.3.4", type: "ip" },
      { indicator: "evil.com", type: "domain" },
    ]);
    expect(parsed.invalid).toEqual([{ line: 2, value: "nope" }]);
    expect(parsed.duplicates).toBe(2);
  });

  it("rejects other types when a type is forced", () => {
    const parsed = parseIndicatorList("1.2.3.4\nevil.com", "ip");
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.invalid).toEqual([{ line: 2, value: "evil.com" }]);
  });
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

  it("imports a foreign CSV, re-detecting types and dropping junk", () => {
    const result = indicatorsFromCsv(
      "IOC,Type,Severity\n1.2.3.4,,critical\nevil.com,ip,\njunk,,\n1.2.3.4,,low\n",
      { severity: "medium", source: "upload", confidence: 60 },
      "2026-01-01T00:00:00.000Z",
    );
    expect(result.missingColumn).toBe(false);
    expect(result.invalid).toBe(1);
    expect(result.indicators.map((i) => [i.indicator, i.type, i.severity])).toEqual([
      ["1.2.3.4", "ip", "critical"],
      // declared "ip" is wrong for a domain, so the detected type wins
      ["evil.com", "domain", "medium"],
    ]);
    expect(result.indicators[0].source).toBe("upload");
  });

  it("says so when there is no indicator column", () => {
    expect(
      indicatorsFromCsv("a,b\n1,2\n", { severity: "low", source: "", confidence: 1 }, "")
        .missingColumn,
    ).toBe(true);
  });

  it("drops stored rows that are not indicators", () => {
    expect(rowToIndicator({ indicator: "" }, "ioc_x")).toBeNull();
    expect(rowToIndicator({ indicator: "???" }, "ioc_x")).toBeNull();
    expect(rowToIndicator({ indicator: "1.2.3.4", confidence: "250" }, "ioc_x")?.confidence).toBe(
      100,
    );
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

describe("sweep", () => {
  it("picks mapped columns and columns named for the type", () => {
    const fields = ["_timestamp", "src_ip", "sourceipaddress", "user", "hostname", "message"];
    expect(candidateColumns("ip", fields, ["sourceipaddress", "gone"])).toEqual([
      "sourceipaddress",
      "src_ip",
    ]);
    expect(candidateColumns("domain", fields)).toEqual(["hostname"]);
    expect(candidateColumns("hash", fields)).toEqual([]);
  });

  it("casts the column, escapes values and folds case where the type does", () => {
    expect(sweepSql("s", "src_ip", "ip", ["1.2.3.4", "o'x"])).toBe(
      `SELECT LOWER(CAST("src_ip" AS VARCHAR)) AS zo_value, COUNT(*) AS zo_n, MIN(_timestamp) AS zo_first, ` +
        `MAX(_timestamp) AS zo_last, MIN(CAST("src_ip" AS VARCHAR)) AS zo_raw FROM "s" ` +
        `WHERE LOWER(CAST("src_ip" AS VARCHAR)) IN ('1.2.3.4', 'o''x') GROUP BY zo_value`,
    );
    expect(sweepSql("s", "host", "domain", ["a.com"])).toContain(
      `LOWER(CAST("host" AS VARCHAR)) IN ('a.com')`,
    );
    expect(sightingsSql("s", "u", "email", "a@b.co", "1 hour")).toContain(
      `LOWER(CAST("u" AS VARCHAR)) = 'a@b.co'`,
    );
  });

  it("batches long lists", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("folds sweep rows into matches per indicator", () => {
    const ind = (indicator: string, type: Indicator["type"]): Indicator => ({
      indicator,
      type,
      severity: "high",
      confidence: 80,
      source: "",
      description: "",
      addedAt: "",
      expiresAt: "",
      table: "ioc_x",
    });
    const matches = foldMatches(
      [ind("1.2.3.4", "ip"), ind("5.6.7.8", "ip"), ind("evil.com", "domain")],
      [
        {
          stream: "a",
          column: "src_ip",
          type: "ip",
          rows: [{ zo_value: "1.2.3.4", zo_n: 3, zo_first: 10, zo_last: 30 }],
        },
        {
          stream: "b",
          column: "ip",
          type: "ip",
          rows: [{ zo_value: "1.2.3.4", zo_n: 5, zo_first: 5, zo_last: 20 }],
        },
        // a domain column that happens to hold an IP string must not match the IP indicator
        {
          stream: "b",
          column: "host",
          type: "domain",
          rows: [{ zo_value: "1.2.3.4", zo_n: 9, zo_first: 1, zo_last: 2 }],
        },
      ],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ hits: 8, first: 5, last: 30 });
    expect(matches[0].sightings.map((s) => s.stream)).toEqual(["b", "a"]);
  });
});

describe("IPv6", () => {
  it.each([
    ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["2001:db8:0:0:1:0:0:1", "2001:db8::1:0:0:1"],
    ["::1", "::1"],
    ["::", "::"],
    ["fe80::", "fe80::"],
    ["::ffff:192.0.2.1", "::ffff:c000:201"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2:3:4:5:6"],
  ])("canonicalises %s to %s", (raw, canonical) => {
    expect(canonicalIpv6(raw)).toBe(canonical);
  });

  it.each([
    ":::",
    "1:::2",
    ":1::2",
    "1::2::3",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "12345::1",
    "g::1",
  ])("rejects %s", (raw) => {
    expect(canonicalIpv6(raw)).toBeNull();
    expect(detectIndicatorType(raw)).toBeNull();
  });

  it("stores two spellings of one address as one indicator", () => {
    const parsed = parseIndicatorList("2001:0DB8::0001\n2001:db8::1");
    expect(parsed.valid).toEqual([{ indicator: "2001:db8::1", type: "ip" }]);
    expect(parsed.duplicates).toBe(1);
    expect(normalizeIndicator("2001:DB8::/32", "cidr")).toBe("2001:db8::/32");
  });

  it("folds case for IPs in the sweep", () => {
    expect(sweepSql("s", "ip", "ip", ["2001:db8::1"])).toContain(`LOWER(CAST("ip" AS VARCHAR)) IN`);
  });
});

describe("parsing gaps", () => {
  it("does not read file names as domains", () => {
    expect(detectIndicatorType("cmd.exe")).toBeNull();
    expect(detectIndicatorType("invoice.pdf")).toBeNull();
    expect(detectIndicatorType("evil.example")).toBe("domain");
  });

  it("accepts SHA-512", () => {
    expect(detectIndicatorType("a".repeat(128))).toBe("hash");
  });

  it("refangs [dot], (dot) and hxxp[:]//", () => {
    expect(refang("evil[dot]com")).toBe("evil.com");
    expect(refang("evil(dot)com")).toBe("evil.com");
    expect(refang("hxxps[:]//evil[.]com/a")).toBe("https://evil.com/a");
  });

  it("keeps commas inside URLs when splitting a paste", () => {
    const parsed = parseIndicatorList("https://evil.com/a?x=1,2, 1.2.3.4");
    expect(parsed.valid.map((v) => v.indicator)).toEqual(["https://evil.com/a?x=1,2", "1.2.3.4"]);
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

  it("removes only the matching row and keeps every other value as stored", () => {
    const { kept, removed } = rowsWithout(stored, { type: "domain", indicator: "evil.com" });
    expect(removed).toBe(1);
    expect(kept).toEqual([
      { indicator: "1.2.3.4", type: "ip", extra: "keep me", severity: "high" },
      { indicator: "not an ioc", type: "", extra: "odd", severity: "" },
      { ioc: "2001:0DB8::1", extra: "x" },
    ]);
  });

  it("matches alternate columns and spellings", () => {
    expect(rowsWithout(stored, { type: "ip", indicator: "2001:db8::1" }).removed).toBe(1);
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
