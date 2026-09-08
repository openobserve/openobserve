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
  normalizeTraceId,
  traceIdLookupVariants,
  rumFieldEqualsAnySql,
  rumFieldEqualsSql,
  TRACE_ID_HEX_LENGTH,
} from "@/utils/rum/fields";

describe("normalizeTraceId", () => {
  it("pads a 31-char legacy id to 32 chars", () => {
    expect(normalizeTraceId("1a034c1aabc72f78880daf6c9755cff")).toBe(
      "01a034c1aabc72f78880daf6c9755cff",
    );
  });

  it("returns a 32-char id unchanged", () => {
    expect(normalizeTraceId("01a034c1aabc72f78880daf6c9755cff")).toBe(
      "01a034c1aabc72f78880daf6c9755cff",
    );
  });

  it("pads shorter legacy forms (multiple stripped zeros)", () => {
    // BigInt.toString(16) strips ALL leading zeros, not just one
    expect(normalizeTraceId("1234567890abcdef")).toBe("00000000000000001234567890abcdef");
  });

  it("lowercases", () => {
    expect(normalizeTraceId("ABC")).toBe("0".repeat(29) + "abc");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeTraceId("  1a034c1aabc72f78880daf6c9755cff ")).toBe(
      "01a034c1aabc72f78880daf6c9755cff",
    );
  });

  it("rejects non-hex, empty, too-long and non-string junk", () => {
    expect(normalizeTraceId("xyz")).toBe("");
    expect(normalizeTraceId("")).toBe("");
    expect(normalizeTraceId("a".repeat(TRACE_ID_HEX_LENGTH + 1))).toBe("");
    expect(normalizeTraceId(null)).toBe("");
    expect(normalizeTraceId(undefined)).toBe("");
  });
});

describe("traceIdLookupVariants", () => {
  it("returns canonical + zero-stripped legacy variant", () => {
    expect(traceIdLookupVariants("01a034c1aabc72f78880daf6c9755cff")).toEqual([
      "01a034c1aabc72f78880daf6c9755cff",
      "1a034c1aabc72f78880daf6c9755cff",
    ]);
  });

  it("accepts a legacy short id and still produces both forms", () => {
    expect(traceIdLookupVariants("1a034c1aabc72f78880daf6c9755cff")).toEqual([
      "01a034c1aabc72f78880daf6c9755cff",
      "1a034c1aabc72f78880daf6c9755cff",
    ]);
  });

  it("strips all leading zeros for the legacy variant", () => {
    expect(traceIdLookupVariants("00000000000000001234567890abcdef")).toEqual([
      "00000000000000001234567890abcdef",
      "1234567890abcdef",
    ]);
  });

  it("dedupes when the id has no leading zero", () => {
    const id = "f".repeat(32);
    expect(traceIdLookupVariants(id)).toEqual([id]);
  });

  it("returns [] for invalid input", () => {
    expect(traceIdLookupVariants("not-hex")).toEqual([]);
    expect(traceIdLookupVariants(null)).toEqual([]);
  });
});

describe("rumFieldEqualsAnySql", () => {
  const schema = [{ name: "_oo_trace_id" }, { name: "_o2_trace_id" }];

  it("crosses spellings with values", () => {
    expect(rumFieldEqualsAnySql(schema, "trace_id", ["a", "b"])).toBe(
      "(_o2_trace_id = 'a' OR _o2_trace_id = 'b' OR _oo_trace_id = 'a' OR _oo_trace_id = 'b')",
    );
  });

  it("uses only the spelling the stream has", () => {
    expect(rumFieldEqualsAnySql([{ name: "_oo_trace_id" }], "trace_id", ["a"])).toBe(
      "(_oo_trace_id = 'a')",
    );
  });

  it("matches rumFieldEqualsSql for a single value", () => {
    expect(rumFieldEqualsAnySql(schema, "trace_id", ["a"])).toBe(
      rumFieldEqualsSql(schema, "trace_id", "a"),
    );
  });

  it("returns null when the stream has neither spelling", () => {
    expect(rumFieldEqualsAnySql([{ name: "other" }], "trace_id", ["a"])).toBeNull();
  });

  it("returns null for an empty value list", () => {
    expect(rumFieldEqualsAnySql(schema, "trace_id", [])).toBeNull();
  });
});
