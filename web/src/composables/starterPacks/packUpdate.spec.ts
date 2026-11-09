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

import { mergeUpdate, pickFields, revertUpdate } from "./packUpdate";

const alert = (threshold: number, sql: string, description = "Pods restarting") => ({
  name: "pod_restarts",
  description,
  stream_name: "k8s",
  query_condition: { type: "sql", sql },
  trigger_condition: { threshold, period: 5, frequency: 5, operator: ">=" },
});

describe("mergeUpdate", () => {
  const installed = alert(3, "SELECT count(*) FROM k8s");
  const next = alert(5, "SELECT count(*) AS n FROM k8s", "Pods restart often");

  it("keeps a user-edited threshold and takes the new version of unchanged fields", () => {
    const yours = alert(10, "SELECT count(*) FROM k8s");
    const { doc, rows } = mergeUpdate(yours, pickFields(installed), next);
    expect(doc.trigger_condition.threshold).toBe(10);
    expect(doc.query_condition.sql).toBe("SELECT count(*) AS n FROM k8s");
    expect(doc.description).toBe("Pods restart often");
    expect(rows.find((row) => row.field === "trigger_condition.threshold")).toEqual({
      field: "trigger_condition.threshold",
      installed: 3,
      yours: 10,
      library: 5,
      outcome: "kept",
    });
    expect(rows.find((row) => row.field === "query_condition.sql")?.outcome).toBe("updated");
  });

  it("keeps every differing field when the installed version is unknown", () => {
    const { doc, rows } = mergeUpdate(installed, null, next);
    expect(doc).toEqual(installed);
    expect(rows.every(({ outcome }) => outcome === "kept")).toBe(true);
  });

  it("lists nothing for a field already at the new value", () => {
    const { rows } = mergeUpdate(next, pickFields(installed), next);
    expect(rows).toEqual([]);
  });
});

describe("query kind changes", () => {
  const sql = { query_condition: { type: "sql", sql: "SELECT 1 FROM k8s" }, description: "a" };
  const promql = { query_condition: { type: "promql", promql: "up == 0" }, description: "a" };

  it("moves the query type and its body together when the user left the query alone", () => {
    const { doc } = mergeUpdate(sql, pickFields(sql), promql);
    expect(doc.query_condition).toEqual({ type: "promql", promql: "up == 0" });
  });

  it("keeps the whole query when the user changed any part of it", () => {
    const yours = { ...sql, query_condition: { type: "sql", sql: "SELECT 2 FROM k8s" } };
    const { doc, rows } = mergeUpdate(yours, pickFields(sql), promql);
    expect(doc.query_condition).toEqual(yours.query_condition);
    expect(rows.every(({ outcome }) => outcome === "kept")).toBe(true);
  });
});

describe("revertUpdate", () => {
  it("restores the installed version and leaves the user's threshold alone", () => {
    const installed = alert(3, "SELECT count(*) FROM k8s");
    const yours = alert(10, "SELECT count(*) FROM k8s");
    const next = alert(5, "SELECT count(*) AS n FROM k8s");
    const { doc, rows } = mergeUpdate(yours, pickFields(installed), next);
    expect(revertUpdate(doc, rows)).toEqual(yours);
  });

  it("does not undo a field the user edited after the update", () => {
    const installed = alert(3, "SELECT count(*) FROM k8s");
    const next = alert(3, "SELECT count(*) AS n FROM k8s");
    const { doc, rows } = mergeUpdate(installed, pickFields(installed), next);
    doc.query_condition.sql = "SELECT 1 FROM k8s";
    expect(revertUpdate(doc, rows).query_condition.sql).toBe("SELECT 1 FROM k8s");
  });
});
