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

import { planAdaptation, type PlanInput } from "./packAdaptationPlan";

const NOW = 2_000_000_000_000;
const fresh = NOW * 1000;

const input = (over: Partial<PlanInput> & { columns?: Record<string, string[]> }): PlanInput => {
  const { columns = {}, ...rest } = over;
  return {
    pack: { id: "k" } as PlanInput["pack"],
    streams: { metrics: new Map(), logs: new Map() },
    alerts: [],
    panels: [],
    sources: { groups: [], aliases: [["k8s_cluster", "cluster_name"]] },
    nowMs: NOW,
    readers: {
      columns: async (_type, name) => new Set(columns[name] ?? []),
      values: async () => ({}),
    },
    ...rest,
  };
};
const alert = { streamType: "metrics", streams: ["kube_pod_info"], fields: ["k8s_cluster"] };

describe("planAdaptation", () => {
  it("repairs a strict rename and binds fields on the repaired stream", async () => {
    const plan = await planAdaptation(
      input({
        streams: { metrics: new Map([["otel_kube_pod_info", fresh]]) },
        alerts: [alert],
        columns: { otel_kube_pod_info: ["cluster_name"] },
      }),
    );
    expect(plan.repairs).toEqual([{ from: "kube_pod_info", to: "otel_kube_pod_info" }]);
    expect(plan.bindings).toEqual([
      expect.objectContaining({ stream: "otel_kube_pod_info", to: "cluster_name", tier: "alias" }),
    ]);
  });

  it("asks about an alert's metric but not a panel's", async () => {
    const streams = { metrics: new Map([["kube_pod_labels", fresh]]) };
    const columns = { kube_pod_labels: ["k8s_cluster"] };
    const asked = await planAdaptation(input({ streams, columns, alerts: [alert] }));
    const panel = await planAdaptation(input({ streams, columns, panels: [alert] }));
    expect(asked.questions).toHaveLength(1);
    expect(asked.repairs).toEqual([]);
    expect(panel.questions).toEqual([]);
  });

  it("applies the user's answer, including every stream of Use all", async () => {
    const plan = await planAdaptation(
      input({
        streams: {
          metrics: new Map([
            ["kube_pod_labels", fresh],
            ["kube_pod_other", fresh],
          ]),
        },
        columns: { kube_pod_labels: ["k8s_cluster"], kube_pod_other: ["k8s_cluster"] },
        alerts: [alert],
        choices: {
          streams: { kube_pod_info: { to: "kube_pod_labels", also: ["kube_pod_other"] } },
          fields: {},
        },
      }),
    );
    expect(plan.repairs).toEqual([
      { from: "kube_pod_info", to: "kube_pod_labels", also: ["kube_pod_other"] },
    ]);
  });
});
