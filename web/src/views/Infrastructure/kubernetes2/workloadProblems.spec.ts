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
import type { QueryId } from "./kubernetesQueries";
import { buildInventory, type Series } from "./kubernetesModel";
import { workloadProblems } from "./workloadProblems";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const build = (results: Partial<Record<QueryId, Series[]>>) =>
  buildInventory(new Map(Object.entries(results) as [QueryId, Series[]][]));

describe("workloadProblems", () => {
  it("lists a deployment with a not-ready pod as pending, with that pod for logs", () => {
    const inv = build({
      P1: [ksm({ namespace: "shop", pod: "web-1", uid: "u1", phase: "Running" })],
      P11: [ksm({ namespace: "shop", pod: "web-1", uid: "u1", condition: "false" })],
      P4: [
        ksm({
          namespace: "shop",
          pod: "web-1",
          uid: "u1",
          owner_kind: "ReplicaSet",
          owner_name: "web-abc",
          owner_is_controller: "true",
        }),
      ],
      P5: [
        ksm({
          namespace: "shop",
          replicaset: "web-abc",
          owner_kind: "Deployment",
          owner_name: "web",
          owner_is_controller: "true",
        }),
      ],
      D1: [ksm({ namespace: "shop", deployment: "web" }, 1)],
    });
    const [p] = workloadProblems(inv, inv.pods).rows;
    expect(p).toMatchObject({ kind: "deployment", name: "web", severity: "pending" });
    expect(p.pod?.name).toBe("web-1");
  });

  it("is empty when every workload is healthy", () => {
    const inv = build({ D1: [ksm({ namespace: "shop", deployment: "idle" }, 0)] });
    expect(workloadProblems(inv, inv.pods)).toEqual({ rows: [], total: 0 });
  });

  it("caps the rows at 50 and reports the full total", () => {
    const names = Array.from({ length: 55 }, (_, i) => `job-${i}`);
    const inv = build({
      J3: names.map((job_name) => ksm({ namespace: "shop", job_name, reason: "BackoffLimit" })),
    });
    const { rows, total } = workloadProblems(inv, inv.pods);
    expect(rows).toHaveLength(50);
    expect(total).toBe(55);
  });
});
