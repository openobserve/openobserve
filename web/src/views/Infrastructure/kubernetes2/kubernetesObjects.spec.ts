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
import { buildInventory, type Series } from "./kubernetesModel";
import type { QueryId } from "./kubernetesQueries";
import { joinObjects, objectDetailSql, objectListSql, parseObjects } from "./kubernetesObjects";

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const PARTITION =
  "ROW_NUMBER() OVER (PARTITION BY k8s_cluster, k8s_resource_name, COALESCE(k8s_namespace_name, ''), event_name ORDER BY _timestamp DESC)";

const record = (extra: Record<string, unknown>) => ({
  uid: "u",
  event_name: "x",
  k8s_namespace_name: "data",
  body_type: "MODIFIED",
  ...extra,
});

describe("object SQL", () => {
  it("keeps the latest record per identity and ends ORDER BY … DESC LIMIT n", () => {
    const sql = objectListSql("deployment", "prod", ["data", "o'b"]);
    expect(sql).toContain(PARTITION);
    expect(sql).toContain("WHERE k8s_resource_name = 'deployments' AND k8s_cluster = 'prod'");
    expect(sql).toContain("AND k8s_namespace_name IN ('data', 'o''b')");
    expect(sql).toContain("json_get_json(body_object_status,'conditions') AS conditions");
    expect(sql).toMatch(/WHERE rn = 1 ORDER BY _timestamp DESC LIMIT 5000$/);
  });

  it("uses replicasets as the ReplicaSet resource name", () => {
    expect(
      objectDetailSql("replicaset", "prod", { namespace: "a", name: "b", uid: null }),
    ).toContain("k8s_resource_name = 'replicasets'");
  });

  it("has no namespace term for nodes and namespaces", () => {
    expect(objectListSql("node", "prod", ["data"])).not.toContain("k8s_namespace_name IN");
    expect(objectListSql("namespace", "prod", ["data"])).not.toContain("k8s_namespace_name IN");
  });

  it("reads the full object for one drawer, matching a pod on its KSM uid", () => {
    const sql = objectDetailSql("pod", "prod", { namespace: "data", name: "x", uid: "u1" });
    expect(sql).toContain("body_object_metadata, body_object_spec, body_object_status");
    expect(sql).toContain("AND event_name = 'x' AND k8s_namespace_name = 'data'");
    expect(sql).toContain("AND json_get_str(body_object_metadata,'uid') = 'u1'");
    expect(sql).toMatch(/ORDER BY _timestamp DESC LIMIT 1$/);
  });
});

describe("object join", () => {
  it("joins a namespaced kind by cluster, namespace and name, with observed conditions", () => {
    const inventory = buildInventory(
      results({ D1: [ksm({ namespace: "data", deployment: "x" }, 1)] }),
    );
    joinObjects(
      inventory,
      "deployment",
      "prod",
      parseObjects([
        record({
          conditions: JSON.stringify([
            { type: "Progressing", status: "True" },
            { type: "Available", status: "True" },
          ]),
          created: "2026-10-01T00:00:00Z",
        }),
      ]),
    );
    const row = inventory.deployments[0];
    expect(row.conditionsDerived).toBe(false);
    expect(row.conditions.map((c) => c.text)).toEqual(["Available", "Progressing"]);
    expect(row.uid).toBe("u");
    expect(row.createdAt).toBe(Date.parse("2026-10-01T00:00:00Z") * 1000);
  });

  it("joins a cluster-scoped Namespace record (no k8s_namespace_name) by name", () => {
    const inventory = buildInventory(
      results({ NS1: [ksm({ namespace: "data", phase: "Active" })] }),
    );
    joinObjects(
      inventory,
      "namespace",
      "prod",
      parseObjects([
        record({
          k8s_namespace_name: null,
          event_name: "data",
          labels: JSON.stringify({ team: "core" }),
        }),
      ]),
    );
    expect(inventory.namespaces[0].object?.metadata.labels).toEqual({ team: "core" });
  });

  it("ignores a pod object whose uid is not the KSM current uid", () => {
    const pod = { namespace: "data", pod: "x", uid: "new" };
    const inventory = buildInventory(results({ P1: [ksm({ ...pod, phase: "Running" })] }));
    joinObjects(
      inventory,
      "pod",
      "prod",
      parseObjects([record({ uid: "old", qos_class: "Burstable" })]),
    );
    expect(inventory.pods[0].object).toBeNull();
    joinObjects(
      inventory,
      "pod",
      "prod",
      parseObjects([record({ uid: "new", qos_class: "Burstable" })]),
    );
    expect(inventory.pods[0].qos).toEqual({ cls: "Burstable", estimated: false });
  });

  it("prefers the observed QoS even when the metric estimate differs", () => {
    const pod = { namespace: "data", pod: "x", uid: "u" };
    const r = (resource: string, v: number) => ksm({ ...pod, container: "c", resource }, v);
    const inventory = buildInventory(
      results({
        P1: [ksm({ ...pod, phase: "Running" })],
        P10: [ksm({ ...pod, container: "c" })],
        P8: [r("cpu", 1), r("memory", 5)],
        P9: [r("cpu", 1), r("memory", 5)],
      }),
    );
    expect(inventory.pods[0].qos).toEqual({ cls: "Guaranteed", estimated: true });
    joinObjects(
      inventory,
      "pod",
      "prod",
      parseObjects([
        record({
          body_object_status: JSON.stringify({ qosClass: "Burstable" }),
          body_object_spec: JSON.stringify({
            initContainers: [{ name: "init-db", image: "busybox" }],
          }),
        }),
      ]),
    );
    expect(inventory.pods[0].qos).toEqual({ cls: "Burstable", estimated: false });
    expect(inventory.pods[0].containers.map((c) => [c.name, c.init])).toEqual([
      ["init-db", true],
      ["c", false],
    ]);
  });

  it("enriches with the newest generation only after a delete and recreate", () => {
    const inventory = buildInventory(
      results({ D1: [ksm({ namespace: "data", deployment: "x" }, 1)] }),
    );
    // The SQL keeps the latest record per identity; the new uid's ADDED is that record.
    joinObjects(
      inventory,
      "deployment",
      "prod",
      parseObjects([record({ uid: "new", body_type: "ADDED" })]),
    );
    expect(inventory.deployments[0].uid).toBe("new");
  });

  it("treats a latest record of DELETED as not observed", () => {
    const inventory = buildInventory(
      results({ D1: [ksm({ namespace: "data", deployment: "x" }, 1)] }),
    );
    joinObjects(inventory, "deployment", "prod", parseObjects([record({ body_type: "DELETED" })]));
    expect(inventory.deployments[0].object).toBeNull();
    expect(inventory.deployments[0].conditionsDerived).toBe(true);
  });

  it("treats malformed JSON as not observed without throwing", () => {
    expect(parseObjects([record({ body_object_spec: "{nope" })])).toEqual([]);
  });

  it("reads node roles and SchedulingDisabled from labels and spec", () => {
    const inventory = buildInventory(
      results({ N1: [ksm({ node: "n1", condition: "Ready", status: "true" })] }),
    );
    expect(inventory.nodes[0].roles).toBeNull();
    joinObjects(
      inventory,
      "node",
      "prod",
      parseObjects([
        record({
          k8s_namespace_name: null,
          event_name: "n1",
          labels: JSON.stringify({ "node-role.kubernetes.io/control-plane": "", zone: "a" }),
          unschedulable: true,
        }),
      ]),
    );
    expect(inventory.nodes[0].roles).toEqual(["control-plane"]);
    expect(inventory.nodes[0].unschedulable).toBe(true);
  });

  it("gives a node without role labels no roles", () => {
    const inventory = buildInventory(
      results({ N1: [ksm({ node: "n1", condition: "Ready", status: "true" })] }),
    );
    joinObjects(
      inventory,
      "node",
      "prod",
      parseObjects([record({ k8s_namespace_name: null, event_name: "n1", labels: "{}" })]),
    );
    expect(inventory.nodes[0].roles).toEqual([]);
  });

  it("reads a DaemonSet node selector and a CronJob's last schedule", () => {
    const inventory = buildInventory(
      results({
        DS1: [ksm({ namespace: "data", daemonset: "x" }, 1)],
        CJ1: [ksm({ namespace: "data", cronjob: "x", schedule: "*" })],
      }),
    );
    joinObjects(
      inventory,
      "daemonset",
      "prod",
      parseObjects([record({ node_selector: JSON.stringify({ disk: "ssd" }) })]),
    );
    joinObjects(
      inventory,
      "cronjob",
      "prod",
      parseObjects([record({ last_schedule: "2026-10-06T02:00:00Z" })]),
    );
    expect(inventory.daemonsets[0].nodeSelector).toEqual({ disk: "ssd" });
    expect(inventory.cronjobs[0].lastSchedule).toBe(Date.parse("2026-10-06T02:00:00Z") * 1000);
  });
});
