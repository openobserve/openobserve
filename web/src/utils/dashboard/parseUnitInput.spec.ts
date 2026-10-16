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

import { describe, expect, it } from "vitest";
import {
  formatUnitInput,
  parsePercentInput,
  parseUnitInput,
  unitInputHints,
} from "./parseUnitInput";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

const value = (text: string, unit?: string | null, custom?: string | null) => {
  const result = parseUnitInput(text, unit, custom);
  if (!result.ok) throw new Error(`"${text}" on ${unit}: ${result.reason}`);
  return result.value;
};

const reason = (text: string, unit?: string | null, custom?: string | null) => {
  const result = parseUnitInput(text, unit, custom);
  return result.ok ? "ok" : result.reason;
};

const ALL_UNITS = [
  "default",
  "numbers",
  "locale",
  "locale:de-DE",
  "locale:fr-FR",
  "locale:en-IN",
  "bytes",
  "kilobytes",
  "megabytes",
  "bytes-si",
  "kilobytes-si",
  "megabytes-si",
  "bits",
  "bps",
  "bps-si",
  "bits-per-sec",
  "req-per-sec",
  "ops-per-sec",
  "events-per-sec",
  "req-per-min",
  "ops-per-min",
  "events-per-min",
  "per-sec",
  "per-min",
  "seconds",
  "milliseconds",
  "microseconds",
  "nanoseconds",
  "minutes",
  "hours",
  "days",
  "percent",
  "percent-1",
  "currency-dollar",
  "currency-euro",
  "currency-pound",
  "currency-yen",
  "currency-rupee",
  "custom",
];

describe("parseUnitInput", () => {
  describe("empty and invalid text", () => {
    it("reports empty text", () => {
      expect(reason("", "milliseconds")).toBe("empty");
      expect(reason("   ", "bytes")).toBe("empty");
    });

    it("reports text that is not a number", () => {
      expect(reason("abc", "milliseconds")).toBe("not-a-number");
      expect(reason("ms", "milliseconds")).toBe("not-a-number");
      expect(reason("1,5", "default")).toBe("not-a-number");
    });

    it("reports a suffix from another unit family", () => {
      const result = parseUnitInput("4 GB", "milliseconds");
      expect(result).toEqual({ ok: false, reason: "unknown-suffix", suffix: "GB" });
      expect(reason("500 ms", "bytes")).toBe("unknown-suffix");
      expect(reason("2K ops/s", "req-per-sec")).toBe("unknown-suffix");
    });
  });

  describe("a bare number is the raw value", () => {
    it.each(ALL_UNITS)("%s", (unit) => {
      expect(value("42", unit)).toBe(42);
      expect(value("0.5", unit)).toBe(0.5);
    });

    it("keeps raw on percent-1, so 0.9 stays 0.9", () => {
      expect(value("0.9", "percent-1")).toBe(0.9);
    });

    it("treats a missing unit as default", () => {
      expect(value("80", null)).toBe(80);
      expect(value("80", undefined)).toBe(80);
      expect(value("80", "")).toBe(80);
    });
  });

  describe("number syntax", () => {
    it("reads signs, decimals, exponents and grouping", () => {
      expect(value("-500 ms", "milliseconds")).toBe(-500);
      expect(value("−5", "default")).toBe(-5);
      expect(value("+7", "default")).toBe(7);
      expect(value(".5", "default")).toBe(0.5);
      expect(value("1e3", "default")).toBe(1000);
      expect(value("1,234,567.5", "default")).toBe(1234567.5);
    });

    it("tolerates spaces and case", () => {
      expect(value("  500   ms  ", "milliseconds")).toBe(500);
      expect(value("500MS", "milliseconds")).toBe(500);
      expect(value("2 k req / s", "req-per-sec")).toBe(2000);
      expect(value("4 gb", "bytes")).toBe(4294967296);
    });
  });

  describe("time", () => {
    it("reads the brief's examples", () => {
      expect(value("500 ms", "milliseconds")).toBe(500);
      expect(value("1 s", "milliseconds")).toBe(1000);
      expect(value("1.5h", "milliseconds")).toBe(5400000);
    });

    it("converts into the panel's own time unit", () => {
      expect(value("1.5h", "seconds")).toBe(5400);
      expect(value("90 min", "seconds")).toBe(5400);
      expect(value("90m", "seconds")).toBe(5400);
      expect(value("1.5h", "minutes")).toBe(90);
      expect(value("1 d", "hours")).toBe(24);
      expect(value("2 days", "minutes")).toBe(2880);
      expect(value("1 D", "days")).toBe(1);
      expect(value("2 s", "microseconds")).toBe(2000000);
      expect(value("1 ms", "nanoseconds")).toBe(1000000);
    });

    it("tells minutes from months by case", () => {
      expect(value("2m", "seconds")).toBe(120);
      expect(value("2M", "seconds")).toBe(5184000);
      expect(value("1 mo", "seconds")).toBe(2592000);
      expect(value("1 Y", "seconds")).toBe(31536000);
    });

    it("accepts micro in every spelling", () => {
      expect(value("250 us", "milliseconds")).toBe(0.25);
      expect(value("250 µs", "milliseconds")).toBe(0.25);
      expect(value("250 μs", "milliseconds")).toBe(0.25);
      expect(value("5 ns", "microseconds")).toBe(0.005);
    });

    it("accepts word spellings", () => {
      expect(value("3 sec", "milliseconds")).toBe(3000);
      expect(value("3 seconds", "milliseconds")).toBe(3000);
      expect(value("2 hours", "minutes")).toBe(120);
      expect(value("20 msec", "seconds")).toBe(0.02);
    });
  });

  describe("data", () => {
    it("reads binary bytes", () => {
      expect(value("4 GB", "bytes")).toBe(4294967296);
      expect(value("1.5 KB", "bytes")).toBe(1536);
      expect(value("4 GiB", "bytes")).toBe(4294967296);
      expect(value("4K", "bytes")).toBe(4096);
      expect(value("4 GB", "kilobytes")).toBe(4194304);
      expect(value("512 B", "kilobytes")).toBe(0.5);
      expect(value("1 GB", "megabytes")).toBe(1024);
    });

    it("reads SI bytes", () => {
      expect(value("4 GB", "bytes-si")).toBe(4e9);
      expect(value("1 kB", "bytes-si")).toBe(1000);
      expect(value("1 MB", "kilobytes-si")).toBe(1000);
      expect(value("2 GB", "megabytes-si")).toBe(2000);
    });

    it("reads bits and keeps upper-case B as bytes", () => {
      expect(value("100 Mbit", "bits")).toBe(1e8);
      expect(value("100 Mb", "bits")).toBe(1e8);
      expect(value("5 kbit", "bits")).toBe(5000);
      expect(reason("100 MB", "bits")).toBe("unknown-suffix");
    });

    it("reads data rates with or without the per-second part", () => {
      expect(value("10 MB/s", "bps")).toBe(10485760);
      expect(value("10 MBps", "bps")).toBe(10485760);
      expect(value("10 MB", "bps")).toBe(10485760);
      expect(value("10 MB/s", "bps-si")).toBe(1e7);
      expect(value("100 Mbps", "bits-per-sec")).toBe(1e8);
      expect(value("100 Mbit/s", "bits-per-sec")).toBe(1e8);
    });
  });

  describe("throughput", () => {
    it("reads named rates with or without the rate suffix", () => {
      expect(value("2K req/s", "req-per-sec")).toBe(2000);
      expect(value("2k", "req-per-sec")).toBe(2000);
      expect(value("2000 req/s", "req-per-sec")).toBe(2000);
      expect(value("1.5 M req/s", "req-per-sec")).toBe(1500000);
      expect(value("3K ops/s", "ops-per-sec")).toBe(3000);
      expect(value("2 events/s", "events-per-sec")).toBe(2);
      expect(value("2K req/min", "req-per-min")).toBe(2000);
      expect(value("4 ops/min", "ops-per-min")).toBe(4);
      expect(value("1K events/min", "events-per-min")).toBe(1000);
    });

    it("reads the generic rates", () => {
      expect(value("2K/s", "per-sec")).toBe(2000);
      expect(value("2K", "per-sec")).toBe(2000);
      expect(value("5/min", "per-min")).toBe(5);
    });
  });

  describe("numbers", () => {
    it("reads scale letters", () => {
      expect(value("2K", "numbers")).toBe(2000);
      expect(value("1.5M", "default")).toBe(1500000);
      expect(value("3B", "numbers")).toBe(3e9);
      expect(value("2 t", "numbers")).toBe(2e12);
    });
  });

  describe("percent", () => {
    it("reads 90% as 90 on percent and 0.9 on percent-1", () => {
      expect(value("90%", "percent")).toBe(90);
      expect(value("90 %", "percent")).toBe(90);
      expect(value("90%", "percent-1")).toBe(0.9);
      expect(value("12.5%", "percent-1")).toBe(0.125);
    });

    it("refuses other suffixes", () => {
      expect(reason("90 ms", "percent")).toBe("unknown-suffix");
    });
  });

  describe("currency", () => {
    it("reads the symbol before or after the number", () => {
      expect(value("$100", "currency-dollar")).toBe(100);
      expect(value("100 $", "currency-dollar")).toBe(100);
      expect(value("$1,234.50", "currency-dollar")).toBe(1234.5);
      expect(value("$-5", "currency-dollar")).toBe(-5);
      expect(value("£20", "currency-pound")).toBe(20);
      expect(value("¥1,000", "currency-yen")).toBe(1000);
      expect(value("₹500", "currency-rupee")).toBe(500);
      expect(value("$2K", "currency-dollar")).toBe(2000);
    });

    it("reads the euro in its German format", () => {
      expect(value("€1.234,50", "currency-euro")).toBe(1234.5);
      expect(value("€1.5", "currency-euro")).toBe(1.5);
    });

    it("refuses another currency's symbol", () => {
      expect(reason("€100", "currency-dollar")).toBe("unknown-suffix");
      expect(reason("$100", "milliseconds")).toBe("unknown-suffix");
    });
  });

  describe("custom", () => {
    it("reads the number, and the custom unit when typed", () => {
      expect(value("5", "custom", "widgets")).toBe(5);
      expect(value("5 widgets", "custom", "widgets")).toBe(5);
      expect(value("5 Widgets", "custom", "widgets")).toBe(5);
    });

    it("does not scale and refuses other words", () => {
      expect(reason("5K", "custom", "widgets")).toBe("unknown-suffix");
      expect(reason("5 gadgets", "custom", "widgets")).toBe("unknown-suffix");
      expect(reason("5 x", "custom", "")).toBe("unknown-suffix");
    });
  });

  describe("pinned locales", () => {
    it("reads each locale's own separators", () => {
      expect(value("1.234,5", "locale:de-DE")).toBe(1234.5);
      expect(value("1.5", "locale:de-DE")).toBe(1.5);
      const french = new Intl.NumberFormat("fr-FR").format(1234.5);
      expect(value(french, "locale:fr-FR")).toBe(1234.5);
    });
  });

  describe("round trip: parse(format(x)) is close to x", () => {
    const SAMPLES = [0, 1, 7.5, 999, 1500, 123456, 98765432, -1500];
    it.each(ALL_UNITS)("%s", (unit) => {
      const custom = unit === "custom" ? "widgets" : "";
      for (const sample of SAMPLES) {
        const text = String(formatUnitValue(getUnitValue(sample, unit, custom, 2)));
        const parsed = value(text, unit, custom);
        expect(Math.abs(parsed - sample)).toBeLessThanOrEqual(
          Math.max(0.006 * Math.abs(sample), 0.006),
        );
      }
    });
  });
});

describe("parsePercentInput", () => {
  it("reads 0 to 100 with or without %", () => {
    expect(parsePercentInput("80")).toEqual({ ok: true, value: 80 });
    expect(parsePercentInput("80%")).toEqual({ ok: true, value: 80 });
    expect(parsePercentInput(" 12.5 % ")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercentInput("0")).toEqual({ ok: true, value: 0 });
    expect(parsePercentInput("100")).toEqual({ ok: true, value: 100 });
  });

  it("refuses values outside the range and other text", () => {
    expect(parsePercentInput("101")).toEqual({ ok: false, reason: "out-of-range" });
    expect(parsePercentInput("-1")).toEqual({ ok: false, reason: "out-of-range" });
    expect(parsePercentInput("80 ms")).toEqual({ ok: false, reason: "not-a-number" });
    expect(parsePercentInput("")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("formatUnitInput", () => {
  it("shows the shortest text that reads back exactly", () => {
    expect(formatUnitInput(500, "milliseconds")).toBe("500ms");
    expect(formatUnitInput(1500, "milliseconds")).toBe("1.5s");
    expect(formatUnitInput(4294967296, "bytes")).toBe("4GB");
    expect(formatUnitInput(1234, "req-per-sec")).toBe("1.234K req/s");
    expect(formatUnitInput(0.9, "percent-1")).toBe("90%");
    expect(formatUnitInput(80, null)).toBe("80");
  });

  it("falls back to the raw number when no rounding reads back", () => {
    expect(formatUnitInput(1 / 3, "default")).toBe(String(1 / 3));
  });

  it.each(ALL_UNITS)("reads back exactly on %s", (unit) => {
    const custom = unit === "custom" ? "widgets" : "";
    for (const sample of [0, 1, 7.5, 1500, 123456, 98765432, -1500, 0.25]) {
      expect(value(formatUnitInput(sample, unit, custom), unit, custom)).toBe(sample);
    }
  });
});

describe("unitInputHints", () => {
  it("gives an example and suffixes per family", () => {
    expect(unitInputHints("milliseconds").example).toBe("500 ms");
    expect(unitInputHints("bytes")).toEqual({ example: "4 GB", suffixes: ["KB", "MB", "GB"] });
    expect(unitInputHints("bps-si").suffixes).toEqual(["kB/s", "MB/s", "GB/s"]);
    expect(unitInputHints("req-per-sec")).toEqual({
      example: "2K req/s",
      suffixes: ["K", "M", "req/s"],
    });
    expect(unitInputHints("per-sec").example).toBe("2K/s");
    expect(unitInputHints("percent-1").example).toBe("90%");
    expect(unitInputHints("currency-euro").example).toBe("€100");
    expect(unitInputHints("custom", "widgets").suffixes).toEqual(["widgets"]);
    expect(unitInputHints(null).example).toBe("500");
  });

  it("gives an example every family can parse", () => {
    for (const unit of ALL_UNITS) {
      const custom = unit === "custom" ? "widgets" : "";
      expect(reason(unitInputHints(unit, custom).example, unit, custom)).toBe("ok");
    }
  });
});
