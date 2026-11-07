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

import { toStreamsByType } from "@/composables/alerts/useAlertLibrary";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

import { alertItem, dashboardItems, matchItem, schemaKey, type MatchFacts } from "./packMatch";

const NOW = 1_800_000_000_000;
const HOUR_US = 3_600_000_000;
const fresh = (NOW - 1000) * 1000;

const facts = (over: Partial<MatchFacts> = {}): MatchFacts => ({
  streams: toStreamsByType([
    { name: "Kube_Pod", stream_type: "metrics", stats: { doc_time_max: fresh } },
    { name: "old", stream_type: "metrics", stats: { doc_time_max: fresh - 25 * HOUR_US } },
    { name: "never", stream_type: "metrics" },
  ]),
  fields: new Map([
    [schemaKey("metrics", "Kube_Pod"), new Set(["k8s_cluster_name", "phase"])],
    [schemaKey("metrics", "old"), new Set(["phase"])],
  ]),
  aliases: [["k8s_cluster", "k8s_cluster_name"]],
  repairs: [],
  nowMs: NOW,
  ...over,
});

const entry = (required: string[]) =>
  ({ id: "a", stream_type: "metrics", required_streams: required }) as AlertLibraryEntry;
const promql = (query: string) => ({ query_condition: { type: "promql", promql: query } });

describe("matchItem", () => {
  it("is ready when stream, labels and 24 h data all hold, ignoring case", () => {
    const item = alertItem(entry(["kube_pod"]), promql('sum by (PHASE) (kube_pod{phase="x"})'));
    expect(matchItem(item, facts())).toBe(true);
  });

  it("checks a metric the query uses but the manifest does not declare", () => {
    const item = alertItem(entry(["kube_pod"]), promql("kube_pod / kube_other"));
    expect(item?.streams).toEqual(["kube_pod", "kube_other"]);
    expect(matchItem(item, facts())).toBe(false);
  });

  it("fails on a grouped label the schema lacks", () => {
    const item = alertItem(entry(["kube_pod"]), promql("sum by (verb) (kube_pod)"));
    expect(matchItem(item, facts())).toBe(false);
  });

  it("does not read vector matching labels as metrics", () => {
    const item = alertItem(
      entry(["kube_pod"]),
      promql("kube_pod * on(phase) group_left(k8s_cluster) kube_pod"),
    );
    expect(item?.streams).toEqual(["kube_pod"]);
    expect(item?.fields.sort()).toEqual(["k8s_cluster", "phase"]);
  });

  it("does not read a single-quoted string as a metric", () => {
    const item = alertItem(
      entry(["kube_pod"]),
      promql("label_replace(kube_pod, 'x', 'y', 'phase', '.*')"),
    );
    expect(item?.streams).toEqual(["kube_pod"]);
  });

  it("resolves a label through an alias list", () => {
    const item = alertItem(entry(["kube_pod"]), promql("sum by (k8s_cluster) (kube_pod)"));
    expect(matchItem(item, facts())).toBe(true);
    expect(matchItem(item, facts({ aliases: [] }))).toBe(false);
  });

  it("is not ready without data in the last 24 h or with no data at all", () => {
    expect(matchItem(alertItem(entry(["old"])), facts())).toBe(false);
    expect(matchItem(alertItem(entry(["never"])), facts())).toBe(false);
  });

  it("is not ready on a stream without a schema", () => {
    const empty = new Map([[schemaKey("metrics", "Kube_Pod"), new Set<string>()]]);
    expect(matchItem(alertItem(entry(["kube_pod"])), facts({ fields: empty }))).toBe(false);
  });

  it("answers from streams alone when the schema could not be read", () => {
    const item = alertItem(entry(["kube_pod"]), promql("sum by (verb) (kube_pod)"));
    expect(matchItem(item, facts({ fields: new Map() }))).toBe(true);
  });

  it("follows a repair to the stream it renames", () => {
    const repairs = [{ from: "kube.pod", to: "kube_pod" }];
    expect(matchItem(alertItem(entry(["kube.pod"])), facts())).toBe(false);
    expect(matchItem(alertItem(entry(["kube.pod"])), facts({ repairs }))).toBe(true);
  });

  it("reads SQL streams, columns and custom conditions", () => {
    const item = alertItem(entry(["kube_pod"]), {
      query_condition: {
        type: "sql",
        sql: "SELECT phase FROM \"kube_pod\" WHERE verb = 'x'",
        conditions: { conditions: [{ column: "reason" }] },
        aggregation: { group_by: ["node"] },
      },
    });
    expect(item?.fields.sort()).toEqual(["node", "phase", "reason", "verb"]);
  });

  it("treats a malformed entry as not ready and a stream-less one as ready", () => {
    const broken = { id: "a" } as AlertLibraryEntry;
    expect(matchItem(alertItem(broken), facts())).toBe(false);
    expect(matchItem(alertItem(entry([])), facts())).toBe(true);
  });

  it("uses every alias group that holds the field", () => {
    const aliases = [
      ["k8s_cluster", "cluster_id"],
      ["k8s_cluster", "k8s_cluster_name"],
    ];
    const item = alertItem(entry(["kube_pod"]), promql("sum by (k8s_cluster) (kube_pod)"));
    expect(matchItem(item, facts({ aliases }))).toBe(true);
  });

  it("leaves a text panel out of the dashboard items", () => {
    expect(dashboardItems({ tabs: [{ panels: [{ queries: [{ query: "" }] }] }] })).toEqual([]);
  });

  it("gives one item per dashboard panel", () => {
    const panel = { queryType: "promql", queries: [{ query: "sum by (phase) (kube_pod)" }] };
    const [item] = dashboardItems({ tabs: [{ panels: [panel] }] });
    expect(item).toEqual({ streams: ["kube_pod"], fields: ["phase"] });
    expect(matchItem(item, facts())).toBe(true);
  });
});
