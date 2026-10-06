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
import { labelFiltersToSql } from "./labelFilterSql";

describe("labelFiltersToSql", () => {
  it("is a complete statement even with no filters — the server rejects a bare WHERE", () => {
    expect(labelFiltersToSql("http_requests_total", [])).toBe(
      'SELECT * FROM "http_requests_total"',
    );
  });

  it("translates = and !=", () => {
    expect(
      labelFiltersToSql("http_requests_total", [
        { label: "status", value: "500" },
        { label: "method", operator: "!=", value: "GET" },
      ]),
    ).toBe(`SELECT * FROM "http_requests_total" WHERE "status" = '500' AND "method" != 'GET'`);
  });

  it("translates =~ and !~ to the regexp UDFs, fully anchored like PromQL", () => {
    expect(
      labelFiltersToSql("http_requests_total", [
        { label: "code", operator: "=~", value: "5.." },
        { label: "route", operator: "!~", value: "/health.*" },
      ]),
    ).toBe(
      `SELECT * FROM "http_requests_total" WHERE re_match("code", '^(?:5..)$') AND re_not_match("route", '^(?:/health.*)$')`,
    );
  });

  // re_match finds, PromQL fully matches: "prod" must not match "preprod".
  it("anchors a regex so it matches the whole value, as PromQL does", () => {
    expect(labelFiltersToSql("m", [{ label: "env", operator: "=~", value: "prod" }])).toBe(
      `SELECT * FROM "m" WHERE re_match("env", '^(?:prod)$')`,
    );
  });

  it("escapes a single quote inside an anchored regex", () => {
    expect(labelFiltersToSql("m", [{ label: "user", operator: "=~", value: "o'b.*" }])).toBe(
      `SELECT * FROM "m" WHERE re_match("user", '^(?:o''b.*)$')`,
    );
  });

  it("escapes a single quote in a value by doubling it", () => {
    expect(labelFiltersToSql("m", [{ label: "user", value: "o'brien" }])).toBe(
      `SELECT * FROM "m" WHERE "user" = 'o''brien'`,
    );
  });
});
