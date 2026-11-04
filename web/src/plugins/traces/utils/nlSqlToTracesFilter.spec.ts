// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeAll } from "vitest";
import useParser from "@/composables/useParser";
import { nlSqlToTracesFilter } from "./nlSqlToTracesFilter";

let parser: unknown;

beforeAll(async () => {
  parser = await useParser().sqlParser();
});

describe("nlSqlToTracesFilter", () => {
  it("keeps only the WHERE part of a plain span query", () => {
    const sql =
      "SELECT _timestamp, trace_id, span_id, service_name, operation_name, duration, span_status, status_message\n" +
      "FROM default\n" +
      "WHERE service_name = 'querier' AND span_status = 'ERROR' AND duration > 500000\n" +
      "ORDER BY duration DESC LIMIT 100";
    expect(nlSqlToTracesFilter(sql, parser)).toBe(
      "service_name = 'querier' AND span_status = 'ERROR' AND duration > 500000",
    );
  });

  it("keeps functions and nested boolean groups", () => {
    const sql = "SELECT * FROM \"default\" WHERE match_all('timeout') OR (a = 1 AND b LIKE '%x%')";
    expect(nlSqlToTracesFilter(sql, parser)).toBe(
      "match_all('timeout') OR (a = 1 AND b LIKE '%x%')",
    );
  });

  it("refuses a query with no WHERE", () => {
    expect(nlSqlToTracesFilter("SELECT * FROM default LIMIT 10", parser)).toBeNull();
  });

  it("refuses GROUP BY with count", () => {
    const sql =
      "SELECT service_name, count(*) AS errors FROM default WHERE span_status = 'ERROR' GROUP BY service_name";
    expect(nlSqlToTracesFilter(sql, parser)).toBeNull();
  });

  it("refuses an aggregate without GROUP BY", () => {
    expect(nlSqlToTracesFilter("SELECT count(*) FROM default WHERE a = 1", parser)).toBeNull();
  });

  it("refuses approximate aggregates the parser types as plain functions", () => {
    const sql = "SELECT approx_percentile_cont(duration, 0.95) FROM default WHERE a = 1";
    expect(nlSqlToTracesFilter(sql, parser)).toBeNull();
    expect(
      nlSqlToTracesFilter("SELECT approx_distinct(trace_id) FROM default WHERE a = 1", parser),
    ).toBeNull();
  });

  it("refuses a window function", () => {
    const sql = "SELECT row_number() OVER (ORDER BY a) FROM default WHERE a = 1";
    expect(nlSqlToTracesFilter(sql, parser)).toBeNull();
  });

  it("keeps backticks inside string values", () => {
    const sql = "SELECT * FROM default WHERE status_message LIKE '%x`y%' AND `service_name` = 'a'";
    expect(nlSqlToTracesFilter(sql, parser)).toBe(
      `status_message LIKE '%x\`y%' AND "service_name" = 'a'`,
    );
  });

  it("refuses DISTINCT", () => {
    expect(
      nlSqlToTracesFilter("SELECT DISTINCT service_name FROM default WHERE a = 1", parser),
    ).toBeNull();
  });

  it("refuses HAVING", () => {
    const sql =
      "SELECT service_name FROM default WHERE a = 1 GROUP BY service_name HAVING count(*) > 5";
    expect(nlSqlToTracesFilter(sql, parser)).toBeNull();
  });

  it("refuses a JOIN", () => {
    expect(
      nlSqlToTracesFilter("SELECT * FROM a JOIN b ON a.x = b.x WHERE a.y = 1", parser),
    ).toBeNull();
  });

  it("refuses a subquery inside the WHERE", () => {
    const sql =
      "SELECT * FROM default WHERE trace_id IN (SELECT trace_id FROM default WHERE span_status = 'ERROR')";
    expect(nlSqlToTracesFilter(sql, parser)).toBeNull();
  });

  it("refuses text that does not parse", () => {
    expect(nlSqlToTracesFilter("I could not find a matching stream.", parser)).toBeNull();
  });

  it("refuses when the parser is not loaded", () => {
    expect(nlSqlToTracesFilter("SELECT * FROM default WHERE a = 1", null)).toBeNull();
  });
});
