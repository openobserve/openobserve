// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";

import {
  FIELD_TOKEN_REGEX,
  buildSloPreviewQuery,
  replaceTrailingFieldToken,
} from "./previewQuery";

describe("buildSloPreviewQuery", () => {
  it("counts matching rows for the good series", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "good")!;
    expect(sql).toContain("SUM(CASE WHEN (status_code < 500) THEN 1 ELSE 0 END) AS zo_sql_num");
  });

  // The complement, not a separate predicate: bad is "everything in scope that
  // is not good", so the two always sum to the denominator.
  it("counts the complement for the bad series", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "bad")!;
    expect(sql).toContain("SUM(CASE WHEN (status_code < 500) THEN 0 ELSE 1 END) AS zo_sql_num");
  });

  // Both charts share one panel shape; only label and colour differ.
  it("projects the same aliases for both series", () => {
    for (const series of ["good", "bad"] as const) {
      const sql = buildSloPreviewQuery("requests", undefined, "ok", series)!;
      expect(sql).toContain("histogram(_timestamp) AS zo_sql_key");
      expect(sql).toContain("AS zo_sql_num");
      expect(sql).toContain("GROUP BY zo_sql_key");
    }
  });

  it("applies the scope as the denominator filter, to both series", () => {
    for (const series of ["good", "bad"] as const) {
      const sql = buildSloPreviewQuery("requests", "service = 'checkout'", "ok", series)!;
      expect(sql).toContain("WHERE (service = 'checkout')");
    }
  });

  // A filtered COUNT would drop empty buckets, making "all bad" look like
  // "no traffic" — the good predicate must never become a WHERE filter.
  it("never turns the good predicate into a filter", () => {
    const sql = buildSloPreviewQuery("requests", undefined, "status_code < 500", "good")!;
    expect(sql).not.toContain("WHERE (status_code < 500)");
  });

  // `a = 1 OR b = 2` unparenthesised next to anything appended re-associates.
  it("parenthesises the user fragments", () => {
    const sql = buildSloPreviewQuery("requests", "a = 1 OR b = 2", "c = 3 OR d = 4", "good")!;
    expect(sql).toContain("WHERE (a = 1 OR b = 2)");
    expect(sql).toContain("(c = 3 OR d = 4) THEN 1");
  });

  it("quotes the stream and doubles embedded quotes", () => {
    const sql = buildSloPreviewQuery('we"ird', undefined, "ok", "good")!;
    expect(sql).toContain('FROM "we""ird"');
  });

  it("returns null with nothing drawable, not a broken query", () => {
    expect(buildSloPreviewQuery("", undefined, "ok", "good")).toBeNull();
    expect(buildSloPreviewQuery("requests", undefined, "", "good")).toBeNull();
    expect(buildSloPreviewQuery("requests", undefined, "   ", "bad")).toBeNull();
    expect(buildSloPreviewQuery(undefined, undefined, undefined, "good")).toBeNull();
  });

  it("ignores a blank scope rather than emitting an empty WHERE", () => {
    for (const scope of ["", "   ", undefined]) {
      expect(buildSloPreviewQuery("requests", scope, "ok", "good")).not.toContain("WHERE");
    }
  });
});

describe("replaceTrailingFieldToken", () => {
  it("replaces the identifier being typed", () => {
    expect(replaceTrailingFieldToken("status_c", "status_code")).toBe("status_code");
  });

  it("keeps everything before the token", () => {
    expect(replaceTrailingFieldToken("service = 'x' AND stat", "status_code")).toBe(
      "service = 'x' AND status_code",
    );
  });

  it("appends when the text ends mid-expression rather than mid-token", () => {
    expect(replaceTrailingFieldToken("status_code < ", "duration_ms")).toBe(
      "status_code < duration_ms",
    );
    expect(replaceTrailingFieldToken("", "duration_ms")).toBe("duration_ms");
    expect(replaceTrailingFieldToken(undefined, "duration_ms")).toBe("duration_ms");
  });

  it("treats dotted names as one token", () => {
    expect(replaceTrailingFieldToken("k8s.po", "k8s.pod.name")).toBe("k8s.pod.name");
  });

  // The regex and the replacer must agree on what a token is, or the
  // suggestion filters on one word and the splice replaces another.
  it("the needle regex and the replacer agree on token shape", () => {
    const needle = new RegExp(FIELD_TOKEN_REGEX);
    for (const text of ["abc", "a.b.c", "x = 1 AND foo_b"]) {
      const m = text.match(needle);
      expect(m, text).not.toBeNull();
      const replaced = replaceTrailingFieldToken(text, "FIELD");
      expect(replaced.endsWith("FIELD"), replaced).toBe(true);
      expect(replaced).toBe(text.slice(0, text.length - m![1].length) + "FIELD");
    }
  });
});
