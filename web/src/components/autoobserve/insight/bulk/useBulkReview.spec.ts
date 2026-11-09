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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import config from "@/aws-exports";
import { manyRows, m12Rows, sourceRows } from "./bulkFixtures";
import {
  applyRights,
  changeGroup,
  closeBulkReview,
  countByFolder,
  groupTick,
  openBulkReview,
  setGroupBy,
  toggleGroup,
  toggleRow,
  useBulkReview,
  NO_TEAM,
} from "./useBulkReview";

const IDS = { ingest: "f-ingest", payments: "f-pay", ops: "f-ops" };
const original = config.isEnterprise;
const review = useBulkReview();

const groupNamed = (name: string | null) => review.groups.value.find((g) => g.name === name)!;

beforeEach(() => {
  config.isEnterprise = "true";
});

afterEach(() => {
  closeBulkReview();
  config.isEnterprise = original;
});

describe("useBulkReview — grouping", () => {
  it("groups 12 rows from 3 teams into 3 groups, each with its folder and destinations", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    const groups = review.groups.value;
    expect(groups.map((g) => g.name)).toEqual(["ingest", null, "payments"]);
    expect(groupNamed("ingest").folders).toEqual([{ id: "f-ingest", name: "ingest" }]);
    expect(groupNamed("ingest").destinations).toEqual(["ingest-oncall"]);
    expect(groupNamed("payments").folders.map((f) => f.id)).toEqual(["f-pay"]);
    expect(groupNamed("payments").destinations).toEqual(["payments-oncall"]);
  });

  it("puts services with no team in the org default folder and says so", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    const none = review.groups.value.find((g) => g.key === NO_TEAM)!;
    expect(none.rows).toHaveLength(4);
    expect(none.usesDefault).toBe(true);
    expect(none.folders).toEqual([{ id: "default", name: "default" }]);
  });

  it("regroups by folder and by cluster without losing ticks", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    toggleRow("ingest-c", false);
    const before = [...review.state.ticked].sort();
    setGroupBy("folder");
    expect(review.groups.value.map((g) => g.name)).toEqual(["ingest", "default", "payments"]);
    setGroupBy("cluster");
    expect(review.groups.value.map((g) => g.name)).toContain("cluster-k");
    expect([...review.state.ticked].sort()).toEqual(before);
  });

  it("resolves the folder of every row, not of the first row in its group", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    setGroupBy("cluster");
    const unclustered = review.groups.value.find((g) => g.name === null)!;
    const folders = new Set(unclustered.rows.map((r) => r.folder.id));
    expect(folders).toEqual(new Set(["f-ingest", "default", "f-pay"]));
    expect(unclustered.folders).toHaveLength(3);
  });

  it("keeps a 400-row review open on its first two groups and every total intact", () => {
    openBulkReview({ kind: "no_data", rows: manyRows(IDS) });
    const groups = review.groups.value;
    expect(groups).toHaveLength(12);
    expect(groups.filter((g) => review.state.collapsed.has(g.key))).toHaveLength(10);
    expect(review.toCreate.value).toHaveLength(400);
    expect(countByFolder(review.toCreate.value).reduce((s, c) => s + c.count, 0)).toBe(400);
  });

  it("builds source rows with the source builder, firing after 60 minutes", () => {
    openBulkReview({ kind: "source", rows: sourceRows(3) });
    const rows = review.reviewRows.value;
    expect(rows.map((r) => r.service)).toEqual(["cluster-d", "host-c", "host-d"]);
    expect(rows.every((r) => r.prefill?.periodMinutes === 60)).toBe(true);
    expect(rows[0].prefill?.sql).toContain(`"k8s_cluster" = 'cluster-d'`);
  });
});

describe("useBulkReview — ticks", () => {
  it("unticking a group unticks its rows, and a mixed group is indeterminate", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    const ingest = groupNamed("ingest");
    expect(groupTick(ingest, review.state.ticked)).toBe(true);
    toggleRow("ingest-b", false);
    expect(groupTick(groupNamed("ingest"), review.state.ticked)).toBe("indeterminate");
    toggleGroup(groupNamed("ingest"), false);
    expect(groupTick(groupNamed("ingest"), review.state.ticked)).toBe(false);
    expect(ingest.rows.some((r) => review.state.ticked.has(r.key))).toBe(false);
  });

  it("starts a row the product is unsure about unticked, with its reason", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    const bursty = review.reviewRows.value.find((r) => r.key === "a-none")!;
    expect(bursty.row.unsure?.reason).toMatch(/Sends in bursts/);
    expect(review.state.ticked.has("a-none")).toBe(false);
    expect(review.state.ticked.has("a-b")).toBe(true);
  });

  it("creates exactly the ticked rows, and none the user unticked", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    toggleRow("ingest-c", false);
    toggleRow("a-none", true);
    const keys = review.toCreate.value.map((r) => r.key);
    expect(keys).not.toContain("ingest-c");
    expect(keys).toContain("a-none");
    expect(keys).toHaveLength(11);
  });

  it("counts the footer exactly by folder", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    applyRights({ "f-pay": false });
    expect(countByFolder(review.toCreate.value).map((c) => [c.folder.name, c.count])).toEqual([
      ["ingest", 5],
      ["default", 3],
    ]);
  });
});

describe("useBulkReview — folder rights", () => {
  it("locks and unticks every row in a folder the user can't write to", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    applyRights({ "f-pay": false });
    const pay = groupNamed("payments");
    expect(pay.locked).toBe(true);
    expect(pay.rows.every((r) => !review.state.ticked.has(r.key))).toBe(true);
    toggleRow("j", true);
    expect(review.state.ticked.has("j")).toBe(false);
    expect(review.groups.value.at(-1)?.name).toBe("payments");
  });

  it("locks nothing while the server serves no rights", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    applyRights(null);
    expect(review.reviewRows.value.some((r) => r.locked)).toBe(false);
    expect(review.toCreate.value).toHaveLength(11);
  });

  it("moving a locked group to a writable folder unlocks and ticks its rows", () => {
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    applyRights({ "f-pay": false });
    changeGroup(groupNamed("payments"), { id: "f-ops", name: "ops" }, ["ops-webhook"]);
    const moved = review.reviewRows.value.filter((r) => ["j", "e-b", "e-c"].includes(r.key));
    expect(moved.every((r) => !r.locked && r.folder.id === "f-ops")).toBe(true);
    expect(moved.every((r) => r.destinations[0] === "ops-webhook")).toBe(true);
    expect(moved.every((r) => review.state.ticked.has(r.key))).toBe(true);
  });
});

describe("useBulkReview — enterprise gate", () => {
  it("opens nothing on a build without enterprise", () => {
    config.isEnterprise = "false";
    openBulkReview({ kind: "no_data", rows: m12Rows(IDS) });
    expect(review.state.open).toBe(false);
  });
});
