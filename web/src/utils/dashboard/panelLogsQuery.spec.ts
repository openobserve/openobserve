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
import { buildPanelLogsQuery } from "@/utils/dashboard/panelLogsQuery";

const noWhere = { baseWhere: "", whereByStream: {} };

describe("buildPanelLogsQuery", () => {
  it("turns an aggregate panel into a SELECT * with the panel WHERE", async () => {
    const sql =
      'SELECT slo_id as "x_axis_1", count(*) as "y_axis_1" FROM "slo_slices" WHERE rev = 1793591100 GROUP BY x_axis_1';
    expect(
      await buildPanelLogsQuery(sql, "slo_slices", {
        baseWhere: "rev = 1793591100",
        whereByStream: {},
      }),
    ).toBe('SELECT * FROM "slo_slices" WHERE rev = 1793591100 ORDER BY _timestamp DESC');
  });

  it("omits WHERE when the panel has none", async () => {
    const sql = 'SELECT count(*) as "y" FROM "default" GROUP BY k8s_namespace_name';
    expect(await buildPanelLogsQuery(sql, "default", noWhere)).toBe(
      'SELECT * FROM "default" ORDER BY _timestamp DESC',
    );
  });

  it("uses only the main stream's own WHERE for a JOIN", async () => {
    const sql =
      "SELECT a.svc, count(*) FROM stream_a a JOIN stream_b b ON a.id = b.id WHERE a.env = 'prod' AND b.tier = 'gold' GROUP BY a.svc";
    expect(
      await buildPanelLogsQuery(sql, "stream_a", {
        baseWhere: "a.env = 'prod' AND b.tier = 'gold'",
        whereByStream: { stream_a: "env = 'prod'", stream_b: "tier = 'gold'" },
      }),
    ).toBe("SELECT * FROM \"stream_a\" WHERE env = 'prod' ORDER BY _timestamp DESC");
  });

  it("drops the WHERE for a JOIN whose filters all belong to the other stream", async () => {
    const sql = "SELECT a.svc FROM stream_a a JOIN stream_b b ON a.id = b.id WHERE b.tier = 'gold'";
    expect(
      await buildPanelLogsQuery(sql, "stream_a", {
        baseWhere: "b.tier = 'gold'",
        whereByStream: { stream_b: "tier = 'gold'" },
      }),
    ).toBe('SELECT * FROM "stream_a" ORDER BY _timestamp DESC');
  });

  it("returns null for a JOIN whose WHERE the backend could not split", async () => {
    const sql = "SELECT a.svc FROM stream_a a JOIN stream_b b ON a.id = b.id WHERE a.x = b.y";
    expect(
      await buildPanelLogsQuery(sql, "stream_a", { baseWhere: "a.x = b.y", whereByStream: {} }),
    ).toBeNull();
  });

  it.each([
    ["WITH", "WITH t AS (SELECT * FROM x) SELECT count(*) FROM s WHERE a = 1"],
    ["UNION", "SELECT count(*) FROM s WHERE a = 1 UNION SELECT count(*) FROM s WHERE a = 2"],
    ["INTERSECT", "SELECT k FROM s INTERSECT SELECT k FROM s WHERE a = 2"],
    ["EXCEPT", "SELECT k FROM s EXCEPT SELECT k FROM s WHERE a = 2"],
    ["FROM subquery", "SELECT count(*) FROM (SELECT * FROM s WHERE a = 1) t"],
    ["HAVING", "SELECT k, count(*) AS c FROM s GROUP BY k HAVING count(*) > 5"],
  ])("returns null for %s", async (_label, sql) => {
    expect(await buildPanelLogsQuery(sql, "s", { baseWhere: "a = 1", whereByStream: {} })).toBe(
      null,
    );
  });

  it("returns null when the SQL has a WHERE but none was read", async () => {
    const sql = "SELECT count(*) FROM s WHERE a = 1";
    expect(await buildPanelLogsQuery(sql, "s", noWhere)).toBeNull();
  });

  it("returns null when the stream is not the one the SQL reads", async () => {
    expect(await buildPanelLogsQuery("SELECT count(*) FROM other", "s", noWhere)).toBeNull();
  });

  it("returns null for SQL the parser cannot read", async () => {
    expect(await buildPanelLogsQuery("SELEC count( FROM s", "s", noWhere)).toBeNull();
  });

  it("ignores set-operation and CTE keywords inside string literals", async () => {
    const sql = "SELECT count(*) FROM s WHERE msg = 'union with x' AND m2 = '(select 1)'";
    expect(
      await buildPanelLogsQuery(sql, "s", {
        baseWhere: "msg = 'union with x' AND m2 = '(select 1)'",
        whereByStream: {},
      }),
    ).toBe(
      "SELECT * FROM \"s\" WHERE msg = 'union with x' AND m2 = '(select 1)' ORDER BY _timestamp DESC",
    );
  });

  it("keeps a subquery that sits inside the WHERE", async () => {
    const where = "a IN (SELECT a FROM s2 WHERE b = 1)";
    expect(
      await buildPanelLogsQuery(`SELECT count(*) FROM s WHERE ${where}`, "s", {
        baseWhere: where,
        whereByStream: {},
      }),
    ).toBe(`SELECT * FROM "s" WHERE ${where} ORDER BY _timestamp DESC`);
  });

  it("quotes a stream name that is not a bare identifier", async () => {
    expect(
      await buildPanelLogsQuery('SELECT count(*) FROM "my-stream"', "my-stream", noWhere),
    ).toBe('SELECT * FROM "my-stream" ORDER BY _timestamp DESC');
  });

  it("returns null when the SQL holds more than one statement", async () => {
    expect(
      await buildPanelLogsQuery("SELECT count(*) FROM s; SELECT count(*) FROM s", "s", noWhere),
    ).toBeNull();
  });
});
