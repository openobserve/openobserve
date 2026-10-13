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
import { funnelParam, parseFunnelDef, parseFunnelFilter } from "@/utils/rum/productAnalyticsModel";

const S = [
  ["p", "/a"],
  ["p", "/b"],
];
const FILTER = { field: "geo_info_country", op: "in", values: ["India"] };
const PARAM = { t: "param", key: "utm_source", op: "eq", values: ["ads"] };
const REF = { t: "ref", op: "eq", values: ["google.com"] };

describe("Filter all steps (f) in the link", () => {
  it("round-trips filters and view conditions through funnelParam", () => {
    const raw = {
      s: [
        ["p", "/a", { min: 1000, vc: [PARAM, REF] }],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
      f: [FILTER, { field: "usr_email", op: "suffix", values: ["@acme.com", "@x.io"] }],
    };
    const def = parseFunnelDef(raw);
    expect(def?.f).toEqual(raw.f);
    expect(def?.steps[0].f).toEqual({ minMs: 1000, vc: [PARAM, REF] });
    expect(funnelParam(def!)).toEqual(raw);
    expect(parseFunnelDef(funnelParam(def!))).toEqual(def);
  });

  it("leaves f out of a definition without filters", () => {
    const def = parseFunnelDef({ s: S });
    expect(def && "f" in def).toBe(false);
    expect(funnelParam(def!)).not.toHaveProperty("f");
    expect(funnelParam({ ...def!, f: [] })).not.toHaveProperty("f");
  });

  it.each([
    ["an unknown key", { ...FILTER, x: 1 }],
    ["env, which stays page-wide", { field: "env", op: "in", values: ["prod"] }],
    ["version, which stays page-wide", { field: "version", op: "in", values: ["1"] }],
    ["an internal column", { field: "_all", op: "in", values: ["x"] }],
    ["an unknown op", { field: "geo_info_city", op: "like", values: ["x"] }],
    ["no values", { field: "geo_info_city", op: "in", values: [] }],
    [
      "21 values",
      { field: "geo_info_city", op: "in", values: Array.from({ length: 21 }, (_, i) => `v${i}`) },
    ],
    ["an empty value", { field: "geo_info_city", op: "in", values: [""] }],
    ["a pattern the engine cannot compile", { field: "usr_email", op: "regex", values: ["(a"] }],
    ["a name with a dash", { field: "user-agent", op: "in", values: ["x"] }],
    ["an attribute name ingest never writes", { field: "context_Plan", op: "in", values: ["x"] }],
    ["a quote in an attribute name", { field: 'context_a"b', op: "in", values: ["x"] }],
    ["a non-boolean not", { ...FILTER, not: "yes" }],
  ])("refuses a filter with %s, and the whole funnel with it", (_why, filter) => {
    expect(parseFunnelFilter(filter)).toBeNull();
    expect(parseFunnelDef({ s: S, f: [filter] })).toBeNull();
  });

  it("takes the app's attribute columns and a negated condition, and keeps not through the link", () => {
    const f = [
      { field: "context_promo_variant", op: "in", values: ["B"] },
      { field: "usr_name", op: "contains", values: ["bot"], not: true },
      { field: "resource_url", op: "prefix", values: ["https://api."] },
    ];
    const def = parseFunnelDef({ s: S, f });
    expect(def?.f).toEqual(f);
    expect(funnelParam(def!).f).toEqual(f);
    expect(parseFunnelFilter({ ...FILTER, not: false })).toEqual(FILTER);
  });

  it("holds at most ten filters", () => {
    expect(parseFunnelDef({ s: S, f: Array(10).fill(FILTER) })?.f).toHaveLength(10);
    expect(parseFunnelDef({ s: S, f: Array(11).fill(FILTER) })).toBeNull();
    expect(parseFunnelDef({ s: S, f: FILTER })).toBeNull();
  });
});

describe("view conditions (vc) in the link", () => {
  const withVc = (vc: unknown, kind = "p") =>
    parseFunnelDef({
      s: [
        [kind, "/a", { vc }],
        ["p", "/b"],
      ],
    });

  it.each([
    ["an unknown kind", [{ t: "load", values: ["x"] }]],
    ["an unknown key", [{ ...PARAM, x: 1 }]],
    ["a key on a referrer", [{ ...REF, key: "a" }]],
    ["an op other than eq", [{ ...PARAM, op: "prefix" }]],
    ["a credential parameter", [{ ...PARAM, key: "id_token" }]],
    ["a bad parameter name", [{ ...PARAM, key: "utm source" }]],
    ["an uppercase host", [{ ...REF, values: ["Google.com"] }]],
    ["no values", [{ ...PARAM, values: [] }]],
    ["no conditions", []],
    ["six conditions", Array(6).fill(PARAM)],
  ])("refuses %s", (_why, vc) => {
    expect(withVc(vc)).toBeNull();
  });

  it("takes up to five conditions, on page steps only", () => {
    expect(withVc(Array(5).fill(PARAM))?.steps[0].f?.vc).toHaveLength(5);
    expect(withVc([PARAM], "c")).toBeNull();
  });
});
