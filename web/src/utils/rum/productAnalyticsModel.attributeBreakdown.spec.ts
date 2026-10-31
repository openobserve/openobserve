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
  decodeDef,
  encodeDef,
  foldBreakdown,
  funnelParam,
  parseFunnelDef,
  parseSavedFunnelDraft,
  parseStepRef,
  pinnedAfter,
  stepRefParam,
} from "@/utils/rum/productAnalyticsModel";
import { compareBreakdown } from "@/utils/rum/funnelCompare";

const S = [
  ["c", "product_viewed"],
  ["c", "payment_info_submitted"],
  ["c", "order_completed"],
];
const PAY = "context_payment_method";
const UPI = { field: PAY, op: "in", values: ["upi"] };

describe("attribute breakdown in the link", () => {
  it("round-trips an automatic and a pinned attribute breakdown", () => {
    const auto = parseFunnelDef({ s: S, b: PAY });
    expect(auto?.breakdown).toEqual({ f: PAY });
    expect(funnelParam(auto!)).toEqual({
      s: S,
      u: "sessions",
      w: "session",
      b: PAY,
    });
    const pinned = parseFunnelDef(decodeDef(encodeDef({ s: S, b: PAY, bs: 2 })));
    expect(pinned?.breakdown).toEqual({ f: PAY, s: 2 });
    expect(funnelParam(pinned!)).toEqual({ s: S, u: "sessions", w: "session", b: PAY, bs: 2 });
    expect(parseFunnelDef(funnelParam(pinned!))).toEqual(pinned);
  });

  it("keeps a built-in breakdown's wire form byte-identical", () => {
    const def = parseFunnelDef({ s: S, u: "users", w: "1d", b: "browser" });
    expect(def?.breakdown).toBe("browser");
    expect(JSON.stringify(funnelParam(def!))).toBe(
      '{"s":[["c","product_viewed"],["c","payment_info_submitted"],["c","order_completed"]],"u":"users","w":"1d","b":"browser"}',
    );
  });

  it.each([
    ["a session field", { b: "usr_email" }],
    ["a capitalised name", { b: "Payment" }],
    ["an internal column", { b: "_timestamp" }],
    ["a non-string", { b: 7 }],
    ["bs without b", { bs: 1 }],
    ["bs with a built-in", { b: "browser", bs: 1 }],
    ["bs of 0", { b: PAY, bs: 0 }],
    ["bs past the last step", { b: PAY, bs: 4 }],
    ["a fractional bs", { b: PAY, bs: 1.5 }],
    ["a text bs", { b: PAY, bs: "2" }],
  ])("rejects %s", (_label, patch) => {
    expect(parseFunnelDef({ s: S, ...patch })).toBeNull();
  });

  it("reads env and version as dimensions, not columns", () => {
    expect(parseFunnelDef({ s: S, b: "env" })?.breakdown).toBe("env");
    expect(parseFunnelDef({ s: S, b: "version" })?.breakdown).toBe("version");
  });
});

describe("step property conditions (pc) in the link", () => {
  it.each(["p", "c", "r"])("parses pc on a %s step and writes it back", (kind) => {
    const raw = [kind, "k", { pc: [UPI] }];
    const step = parseStepRef(raw);
    expect(step).toEqual({ kind, key: "k", f: { pc: [UPI] } });
    expect(stepRefParam(step!)).toEqual(raw);
  });

  it("parses pc on a named-event step and keeps not", () => {
    const id = "2kY9pF34Qy6nB3Wwd25rq4f5zr3";
    const rule = { field: "context_plan", op: "regex", values: ["^pro"], not: true };
    expect(parseStepRef(["e", id, { pc: [rule] }])).toEqual({
      kind: "e",
      key: id,
      f: { pc: [rule] },
    });
  });

  it("keeps pc beside the other options on a page step", () => {
    const raw = ["p", "/pay", { min: 1000, fr: 1, pc: [UPI] }];
    const step = parseStepRef(raw);
    expect(step?.f).toEqual({ minMs: 1000, frustrated: true, pc: [UPI] });
    expect(stepRefParam(step!)).toEqual(raw);
    const def = parseFunnelDef({ s: [S[0], raw] });
    expect(parseFunnelDef(funnelParam(def!))).toEqual(def);
  });

  it.each([
    ["other options on a click step", ["c", "k", { pc: [UPI], min: 1 }]],
    ["empty options on a click step", ["c", "k", {}]],
    ["an empty list", ["c", "k", { pc: [] }]],
    ["a non-list", ["c", "k", { pc: UPI }]],
    ["a session field", ["c", "k", { pc: [{ ...UPI, field: "geo_info_country" }] }]],
    ["env", ["p", "/a", { pc: [{ ...UPI, field: "env" }] }]],
    ["an unknown rule key", ["c", "k", { pc: [{ ...UPI, x: 1 }] }]],
    ["an unknown op", ["c", "k", { pc: [{ ...UPI, op: "like" }] }]],
    ["no values", ["c", "k", { pc: [{ ...UPI, values: [] }] }]],
    ["an empty value", ["c", "k", { pc: [{ ...UPI, values: [""] }] }]],
    ["a bad pattern", ["c", "k", { pc: [{ ...UPI, op: "regex", values: ["(a"] }] }]],
    ["11 rules", ["c", "k", { pc: Array(11).fill(UPI) }]],
  ])("rejects %s", (_label, raw) => {
    expect(parseStepRef(raw)).toBeNull();
    expect(parseFunnelDef({ s: [S[0], raw] })).toBeNull();
  });

  it("refuses pc on an exclusion step, which the exclusion SQL would ignore", () => {
    const x = (step: unknown[]) => ({ s: S, x: [{ s: step, a: 1, b: 3 }] });
    expect(parseFunnelDef(x(["c", "Buy", { pc: [UPI] }]))).toBeNull();
    expect(parseFunnelDef(x(["p", "/z", { min: 1, pc: [UPI] }]))).toBeNull();
    expect(parseFunnelDef(x(["p", "/z"]))?.x).toHaveLength(1);
  });

  it("maps a pinned step through a step change", () => {
    const b = { f: PAY, s: 2 };
    expect(pinnedAfter(b, (k) => k + 1)).toEqual({ f: PAY, s: 3 });
    expect(pinnedAfter(b, () => null)).toEqual({ f: PAY });
    expect(pinnedAfter({ f: PAY }, () => null)).toEqual({ f: PAY });
    expect(pinnedAfter("browser", () => null)).toBe("browser");
  });

  it("accepts ten rules", () => {
    expect(parseStepRef(["c", "k", { pc: Array(10).fill(UPI) }])?.f?.pc).toHaveLength(10);
  });
});

const HITS = [
  { dim: "card", c1: 10, c2: 8, c3: 6, dc1: 0, dc2: 8, dc3: 6, mt1: 3000, mt2: 1500 },
  { dim: "upi", c1: 5, c2: 4, c3: 1, dc1: 0, dc2: 4, dc3: 1, mt1: 2000, mt2: 900 },
  { dim: null, c1: 20, c2: 4, c3: 2, dc1: 0, dc2: 0, dc3: 0, mt1: null, mt2: 700 },
];

describe("foldBreakdown for an attribute", () => {
  it("starts at the first step where half the units carry a value", () => {
    const { rows, total, start } = foldBreakdown(HITS, 3, 5, { f: PAY });
    expect(start).toEqual({
      step: 2,
      pinned: false,
      anyStep: false,
      covered: 12,
      reached: 16,
      auto: 2,
    });
    expect(rows.map((r) => [r.value, r.counts, r.conversion, r.medianMs])).toEqual([
      ["card", [8, 8, 6], 0.75, 1500],
      ["upi", [4, 4, 1], 0.25, 900],
      [null, [4, 4, 2], 0.5, 700],
      [null, [19, 0, 0], 0, null],
    ]);
    expect(rows[2]).toMatchObject({ noValue: true, leftBefore: false, notSet: false });
    expect(rows[3]).toMatchObject({ noValue: false, leftBefore: true, notSet: false });
    expect(total).toEqual([35, 16, 9]);
  });

  it("falls back to step 1 from any step when no step reaches half", () => {
    const hits = [
      { dim: "card", c1: 10, c2: 5, c3: 2, dc1: 1, dc2: 1, dc3: 0 },
      { dim: null, c1: 30, c2: 10, c3: 3, dc1: 0, dc2: 0, dc3: 0 },
    ];
    const { rows, total, start } = foldBreakdown(hits, 3, 5, { f: PAY });
    expect(start).toEqual({
      step: 1,
      pinned: false,
      anyStep: true,
      covered: 10,
      reached: 40,
      auto: null,
    });
    expect(rows.map((r) => [r.value, r.counts])).toEqual([
      ["card", [10, 5, 2]],
      [null, [30, 10, 3]],
    ]);
    expect(rows[1]).toMatchObject({ notSet: true, noValue: false, leftBefore: false });
    expect(rows[0].medianMs).toBeNull();
    expect(total).toEqual([40, 15, 5]);
  });

  it("uses a pinned step even when few units carry the value there", () => {
    const { rows, total, start } = foldBreakdown(HITS, 3, 5, { f: PAY, s: 3 });
    expect(start).toEqual({
      step: 3,
      pinned: true,
      anyStep: false,
      covered: 7,
      reached: 9,
      auto: 2,
    });
    expect(rows.map((r) => [r.value, r.counts, r.medianMs])).toEqual([
      ["card", [6, 6, 6], null],
      ["upi", [1, 1, 1], null],
      [null, [2, 2, 2], null],
      [null, [26, 7, 0], null],
    ]);
    expect(total).toEqual([35, 16, 9]);
  });

  it("reads a pin past the last step as automatic, as the SQL does", () => {
    const { rows, total, start } = foldBreakdown(HITS, 3, 5, { f: PAY, s: 4 });
    expect(start).toMatchObject({ step: 2, pinned: false, anyStep: false, auto: 2 });
    expect(total).toEqual([35, 16, 9]);
    expect(rows.every((r) => r.counts.every((c) => Number.isFinite(c)))).toBe(true);
  });

  it("puts a value nobody carried to step k in Left before, not in its own row", () => {
    const hits = [...HITS, { dim: "cod", c1: 3, c2: 0, c3: 0, dc1: 0, dc2: 0, dc3: 0 }];
    const { rows, total } = foldBreakdown(hits, 3, 5, { f: PAY });
    expect(rows.map((r) => r.value)).toEqual(["card", "upi", null, null]);
    expect(rows[3].counts).toEqual([22, 0, 0]);
    expect(total).toEqual([38, 16, 9]);
  });

  it("ranks values at step k and folds the rest into Other apart from no value", () => {
    const named = ["a", "b", "c", "d", "e", "f"].map((dim, i) => ({
      dim,
      c1: 10 + i,
      c2: 10 - i,
      c3: 1,
      dc1: 0,
      dc2: 10 - i,
      dc3: 1,
    }));
    const { rows } = foldBreakdown([...named, HITS[2]], 3, 5, { f: PAY });
    expect(rows.map((r) => r.value)).toEqual(["a", "b", "c", "d", "e", null, null, null]);
    expect(rows[5]).toMatchObject({ other: true, counts: [5, 5, 1] });
    expect(rows[6]).toMatchObject({ noValue: true });
    expect(rows[7]).toMatchObject({ leftBefore: true });
  });

  it("leaves a built-in breakdown as before, with each value's median from step 1", () => {
    const { rows, start } = foldBreakdown(HITS, 3);
    expect(start).toBeNull();
    expect(rows.map((r) => [r.value, r.counts, r.notSet, r.medianMs])).toEqual([
      ["card", [10, 8, 6], false, 3000],
      ["upi", [5, 4, 1], false, 2000],
      [null, [20, 4, 2], true, null],
    ]);
  });

  it("compares from step k and gives Left before no previous side", () => {
    const cur = foldBreakdown(HITS, 3, 5, { f: PAY });
    const prev = [
      { dim: "card", c1: 20, c2: 10, c3: 5 },
      { dim: null, c1: 9, c2: 3, c3: 3 },
    ];
    const { rows, total } = compareBreakdown(cur, HITS, prev, 3);
    expect(rows[0].prev).toMatchObject({ first: 10, last: 5, conversion: 0.5 });
    expect(rows[1].prev).toBeNull();
    expect(rows[2].prev).toMatchObject({ first: 3, last: 3, conversion: 1 });
    expect(rows[3].prev).toBeNull();
    // The total compares conversion from step k too, as the table's Total row reads it.
    expect(total).toMatchObject({ first: 13, last: 8 });
    expect(total?.change?.pts).toBeCloseTo((9 / 16 - 8 / 13) * 100, 6);
  });

  it("decides attribute mode from the start step, so unset previous units never join Other", () => {
    const named = ["a", "b", "c", "d", "e", "f"].map((dim, i) => ({
      dim,
      c1: 10 - i,
      c2: 5,
      c3: 2,
      dc1: 10 - i,
      dc2: 5,
      dc3: 2,
    }));
    const cur = foldBreakdown(named, 3, 5, { f: PAY });
    expect(cur.start).toMatchObject({ step: 1, anyStep: false });
    expect(cur.rows.some((r) => r.noValue || r.leftBefore)).toBe(false);
    const prev = [
      { dim: "f", c1: 6, c2: 3, c3: 1 },
      { dim: null, c1: 8, c2: 4, c3: 4 },
    ];
    const { rows } = compareBreakdown(cur, named, prev, 3);
    const other = rows.find((r) => r.other && !r.prevOnly)!;
    expect(other.prev).toMatchObject({ first: 6, last: 1 });
    const unset = rows[rows.length - 1];
    expect(unset).toMatchObject({ prevOnly: true, notSet: true });
    expect(unset.prev).toMatchObject({ first: 8, last: 4 });
  });

  it("shows a previous value with no units at step k now as previous-only, read from step k", () => {
    const cod = { dim: "cod", c1: 3, c2: 0, c3: 0, dc1: 0, dc2: 0, dc3: 0 };
    const hits = [...HITS, cod];
    const cur = foldBreakdown(hits, 3, 5, { f: PAY });
    expect(cur.rows.some((r) => r.other)).toBe(false);
    const prev = [{ dim: "cod", c1: 9, c2: 4, c3: 2 }];
    const { rows } = compareBreakdown(cur, hits, prev, 3);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ value: "cod", prevOnly: true });
    expect(last.prev).toMatchObject({ first: 4, last: 2, conversion: 0.5 });
  });
});

describe("saving a funnel with an attribute breakdown or a step property condition", () => {
  it("keeps b, bs and pc in the saved definition", () => {
    const def = parseFunnelDef({
      s: [S[0], [...S[1], { pc: [{ field: PAY, op: "in", values: ["upi"] }] }], S[2]],
      b: PAY,
      bs: 2,
    })!;
    const body = parseSavedFunnelDraft({ name: "Pay", def, sql: "SELECT 1" });
    expect(body?.def).toMatchObject({
      b: PAY,
      bs: 2,
      s: [S[0], [...S[1], { pc: [{ field: PAY, op: "in", values: ["upi"] }] }], S[2]],
    });
    expect(parseFunnelDef(body!.def)).toEqual(def);
  });
});
