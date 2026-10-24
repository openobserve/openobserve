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
  getSeriesOverrides,
  isSeriesOverrideEntry,
  matchesSeriesOverride,
  parseSeriesOverrideEntry,
  resolveSeriesOverride,
  toSeriesOverrideEntry,
  type SeriesOverride,
} from "./seriesOverrides";

const byName = (value: string, rest: Partial<SeriesOverride> = {}): SeriesOverride => ({
  matchBy: "name",
  value,
  ...rest,
});
const byRegex = (value: string, rest: Partial<SeriesOverride> = {}): SeriesOverride => ({
  matchBy: "regex",
  value,
  ...rest,
});
const entry = (matchBy: string | undefined, value: string, config: unknown[]) => ({
  field: { matchBy, value },
  config,
});
const seriesEntries = (overrides: SeriesOverride[]) =>
  overrides.map((o) => toSeriesOverrideEntry(o)).filter((e) => e !== null);

describe("matchesSeriesOverride", () => {
  it("matches an exact name only", () => {
    expect(matchesSeriesOverride("checkout", byName("checkout"))).toBe(true);
    expect(matchesSeriesOverride("checkout-v2", byName("checkout"))).toBe(false);
    expect(matchesSeriesOverride("Checkout", byName("checkout"))).toBe(false);
  });

  it("treats regex metacharacters in an exact name literally", () => {
    expect(matchesSeriesOverride("a.b", byName("a.b"))).toBe(true);
    expect(matchesSeriesOverride("axb", byName("a.b"))).toBe(false);
  });

  it("matches a plain regex anywhere in the name", () => {
    expect(matchesSeriesOverride("checkout-api", byRegex("check"))).toBe(true);
    expect(matchesSeriesOverride("cart", byRegex("^check"))).toBe(false);
  });

  it("honours /pattern/flags", () => {
    expect(matchesSeriesOverride("CHECKOUT", byRegex("/checkout/i"))).toBe(true);
    expect(matchesSeriesOverride("CHECKOUT", byRegex("/checkout/"))).toBe(false);
    expect(matchesSeriesOverride("cart", byRegex("/^(cart|checkout)$/"))).toBe(true);
  });

  it("matches nothing and never throws on an invalid or unsupported regex", () => {
    expect(() => matchesSeriesOverride("abc", byRegex("("))).not.toThrow();
    expect(matchesSeriesOverride("abc", byRegex("("))).toBe(false);
    expect(matchesSeriesOverride("abc", byRegex("/a(?=b)/"))).toBe(false);
    expect(matchesSeriesOverride("", byRegex(""))).toBe(false);
  });

  it("matches nothing for a malformed override", () => {
    expect(matchesSeriesOverride("a", null as unknown as SeriesOverride)).toBe(false);
    expect(matchesSeriesOverride("a", { matchBy: "name" } as SeriesOverride)).toBe(false);
  });
});

describe("resolveSeriesOverride", () => {
  it("returns null without overrides or without a match", () => {
    expect(resolveSeriesOverride({}, "a")).toBeNull();
    expect(resolveSeriesOverride(null, "a")).toBeNull();
    expect(resolveSeriesOverride({ override_config: "x" }, "a")).toBeNull();
    expect(
      resolveSeriesOverride(
        { override_config: seriesEntries([byName("b", { color: "#f00" })]) },
        "a",
      ),
    ).toBeNull();
  });

  it("returns only the settings that are set", () => {
    const config = {
      override_config: [
        entry("series", "a", [
          { type: "display_name", value: "" },
          { type: "unit", value: { unit: "", customUnit: "" } },
          { type: "series_color", value: "#ef4444" },
          { type: "decimals", value: 0 },
        ]),
      ],
    };
    expect(resolveSeriesOverride(config, "a")).toEqual({ color: "#ef4444", decimals: 0 });
  });

  it("returns null when a matching override sets nothing", () => {
    expect(resolveSeriesOverride({ override_config: [entry("series", "a", [])] }, "a")).toBeNull();
  });

  it("merges every match in list order, later wins per setting", () => {
    const config = {
      override_config: seriesEntries([
        byRegex("/^api/", { color: "#111111", unit: "milliseconds", decimals: 1 }),
        byName("api-checkout", { color: "#222222", displayName: "Checkout" }),
        byRegex("cart", { color: "#333333" }),
      ]),
    };
    expect(resolveSeriesOverride(config, "api-checkout")).toEqual({
      color: "#222222",
      unit: "milliseconds",
      decimals: 1,
      displayName: "Checkout",
    });
    expect(resolveSeriesOverride(config, "api-cart")).toEqual({
      color: "#333333",
      unit: "milliseconds",
      decimals: 1,
    });
  });

  it("keeps override thresholds only when they have a usable step", () => {
    const steps = [{ value: 5, color: "#ef4444" }];
    const thresholds = (value: unknown) => ({ type: "thresholds", value });
    expect(
      resolveSeriesOverride(
        { override_config: [entry("series", "a", [thresholds({ mode: "absolute", steps: [] })])] },
        "a",
      ),
    ).toBeNull();
    const config = {
      override_config: [
        entry("series", "a", [thresholds({ steps })]),
        entry("series", "a", [thresholds({ steps: [] })]),
      ],
    };
    expect(resolveSeriesOverride(config, "a")?.thresholds).toEqual({ steps });
  });

  it("ignores a negative or non-numeric decimals value", () => {
    const config = {
      override_config: [
        entry("series", "a", [{ type: "decimals", value: -1 }]),
        entry("series", "a", [{ type: "decimals", value: "x" }]),
      ],
    };
    expect(resolveSeriesOverride(config, "a")).toBeNull();
  });
});

describe("override_config entries", () => {
  it("charts read only series entries; table entries in the same array are ignored", () => {
    const config = {
      override_config: [
        entry("name", "api", [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]),
        entry(undefined, "api", [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]),
        entry("series_regex", "/^ap/", [{ type: "series_color", value: "#111111" }]),
        null,
        1,
      ],
    };
    expect(getSeriesOverrides(config)).toEqual([byRegex("/^ap/", { color: "#111111" })]);
    expect(resolveSeriesOverride(config, "api")).toEqual({ color: "#111111" });
  });

  it("tells series entries from table entries", () => {
    expect(isSeriesOverrideEntry(entry("series", "a", []))).toBe(true);
    expect(isSeriesOverrideEntry(entry("series_regex", "a", []))).toBe(true);
    expect(isSeriesOverrideEntry(entry("name", "a", []))).toBe(false);
    expect(isSeriesOverrideEntry({ field: { value: "a" } })).toBe(false);
    expect(isSeriesOverrideEntry(null)).toBe(false);
  });

  it("parses every type, a later item of one type winning", () => {
    const thresholds = { mode: "absolute", steps: [{ value: 800, color: "#F59E0B" }] };
    const parsed = parseSeriesOverrideEntry(
      entry("series", "checkout", [
        { type: "unit", value: { unit: "milliseconds", customUnit: "" } },
        { type: "decimals", value: 2 },
        { type: "display_name", value: "Checkout API" },
        { type: "series_color", value: "#000000" },
        { type: "series_color", value: "#EF4444" },
        { type: "thresholds", value: thresholds },
        { type: "alignment", value: "left" },
      ]),
    );
    expect(parsed).toEqual({
      matchBy: "name",
      value: "checkout",
      unit: "milliseconds",
      unitCustom: "",
      decimals: 2,
      displayName: "Checkout API",
      color: "#EF4444",
      thresholds,
    });
    expect(parseSeriesOverrideEntry(entry("name", "checkout", []))).toBeNull();
  });

  it("writes only set settings and round-trips through the parser", () => {
    const override = byRegex("/^api/i", { displayName: "API", decimals: 1, color: "" });
    const stored = toSeriesOverrideEntry(override);
    expect(stored).toEqual({
      field: { matchBy: "series_regex", value: "/^api/i" },
      config: [
        { type: "decimals", value: 1 },
        { type: "display_name", value: "API" },
      ],
    });
    expect(parseSeriesOverrideEntry(stored)).toEqual(
      byRegex("/^api/i", { displayName: "API", decimals: 1 }),
    );
    expect(toSeriesOverrideEntry(byName("a"))).toBeNull();
  });
});
