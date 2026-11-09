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
  panelHash,
  pickReplacement,
  repointDashboard,
  startedSince,
  type StreamStat,
} from "./repairLater";

const MIN = 60 * 1_000_000;
const NOW = 1_000 * MIN;
const checks = { sql: async () => {}, promql: async () => ({}) };

const stat = (name: string, firstUs: number, lastUs: number): StreamStat => ({
  name,
  type: "logs",
  firstUs,
  lastUs,
});

const panel = (id: string, stream: string) => ({
  id,
  type: "line",
  queryType: "sql",
  queries: [{ query: `SELECT count(*) FROM "${stream}"`, fields: { stream } }],
});

describe("renamed stream detection", () => {
  const quiet = stat("nginx_logs", 0, NOW - 40 * MIN);

  it("finds the one live stream with the same fields that started after", () => {
    const started = startedSince(
      quiet,
      [quiet, stat("edge", NOW - 38 * MIN, NOW - MIN), stat("old", MIN, NOW - MIN)],
      NOW,
    );
    expect(started.map(({ name }) => name)).toEqual(["edge"]);
    const columns = new Set(["_timestamp", "status", "path"]);
    const picked = pickReplacement(new Set(["_timestamp", "status", "path"]), [
      { stat: started[0], columns },
    ]);
    expect(picked?.name).toBe("edge");
  });

  it("asks nothing when two streams fit or the fields differ", () => {
    const fields = new Set(["status"]);
    const one = { stat: stat("a", 1, 1), columns: new Set(["status"]) };
    const two = { stat: stat("b", 1, 1), columns: new Set(["status"]) };
    expect(pickReplacement(fields, [one, two])).toBeNull();
    expect(pickReplacement(new Set(["path"]), [one])).toBeNull();
  });
});

describe("repointDashboard", () => {
  it("repairs a renamed stream on the dashboard and keeps the panel the user changed", async () => {
    const ours = panel("p1", "nginx_logs");
    const theirs = { ...panel("p2", "nginx_logs"), title: "Mine" };
    const other = panel("p3", "k8s");
    const recorded = { p1: panelHash(ours), p2: panelHash(panel("p2", "nginx_logs")) };
    const doc = { title: "Nginx", tabs: [{ tabId: "t", panels: [ours, theirs, other] }] };
    const result = await repointDashboard(
      doc,
      { from: "nginx_logs", to: "edge" },
      (candidate) => recorded[candidate.id as "p1" | "p2"] === panelHash(candidate),
      checks,
    );
    expect(result.moved).toEqual(["p1"]);
    expect(result.kept).toEqual(["p2"]);
    const [moved, kept, untouched] = result.doc.tabs[0].panels;
    expect(moved.queries[0].fields.stream).toBe("edge");
    expect(moved.queries[0].query).toContain("edge");
    expect(kept).toEqual(theirs);
    expect(untouched).toEqual(other);
  });
});
