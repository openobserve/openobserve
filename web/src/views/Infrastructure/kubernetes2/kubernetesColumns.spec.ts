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
import type { QueryId, View } from "./kubernetesQueries";
import { joinObjects, parseObjects } from "./kubernetesObjects";
import { parseEvents } from "./kubernetesEvents";
import { HIDDEN_BY_DEFAULT, columnsFor, defaultSort, type K8sColumn } from "./kubernetesColumns";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}${JSON.stringify(params)}` : key) as any;

const END = 1_700_000_000_000_000;
const ctx = { t, endUs: END, eventLinks: true, cluster: "prod" };

const ksm = (metric: Record<string, string>, value = 1): Series => ({
  metric: { k8s_cluster: "prod", ...metric },
  value,
});

const results = (entries: Partial<Record<QueryId, Series[]>>) =>
  new Map(Object.entries(entries) as [QueryId, Series[]][]);

const cols = (view: View) => columnsFor(view, ctx);
const colOf = (view: View, id: string) => cols(view).find((c) => c.id === id) as K8sColumn;
const value = (c: K8sColumn, row: unknown) => (c.accessorFn as (r: unknown) => unknown)(row);

describe("kubernetesColumns", () => {
  it.each([
    [
      "pods",
      [
        "name",
        "warnings",
        "namespace",
        "containers",
        "cpu",
        "memory",
        "restarts",
        "controller",
        "node",
        "qos",
        "age",
        "status",
        "ip",
        "cpuReq",
        "cpuLim",
        "memReq",
        "memLim",
      ],
    ],
    [
      "nodes",
      [
        "name",
        "warnings",
        "cpu",
        "memory",
        "disk",
        "taints",
        "roles",
        "version",
        "age",
        "conditions",
      ],
    ],
    ["deployments", ["name", "warnings", "namespace", "pods", "replicas", "age", "conditions"]],
    ["daemonsets", ["name", "namespace", "pods", "warnings", "nodeSelector", "age"]],
    ["statefulsets", ["name", "namespace", "pods", "replicas", "warnings", "age"]],
    ["replicasets", ["name", "warnings", "namespace", "desired", "current", "ready", "age"]],
    ["jobs", ["name", "namespace", "completions", "warnings", "age", "conditions"]],
    [
      "cronjobs",
      ["name", "warnings", "namespace", "schedule", "suspend", "active", "lastSchedule", "age"],
    ],
    ["pvcs", ["name", "warnings", "namespace", "storageClass", "size", "pods", "age", "status"]],
    ["hpas", ["name", "warnings", "namespace", "min", "max", "replicas", "age", "status"]],
    ["namespaces", ["name", "warnings", "labels", "age", "status"]],
    ["events", ["type", "message", "namespace", "involved", "source", "count", "age", "lastSeen"]],
  ] as const)("%s has exactly the §4 columns in order", (view, ids) => {
    expect(cols(view).map((c) => c.id)).toEqual(ids);
    for (const c of cols(view)) expect(c.meta.cellClass, c.id).toBe("text-compact");
  });

  it.each([
    ["pods", ["qos", "ip", "cpuReq", "cpuLim", "memReq", "memLim"]],
    ["nodes", ["taints"]],
    ["deployments", ["replicas"]],
    ["daemonsets", ["nodeSelector"]],
    ["statefulsets", ["replicas"]],
    ["replicasets", ["current"]],
    ["jobs", ["completions"]],
    ["cronjobs", ["lastSchedule"]],
    ["pvcs", ["storageClass"]],
    ["hpas", ["min"]],
    ["namespaces", ["labels"]],
    ["events", ["source"]],
  ] as const)("%s marks %j hideable", (view, ids) => {
    expect(
      cols(view)
        .filter((c) => c.hideable)
        .map((c) => c.id),
    ).toEqual(ids);
  });

  it("hides IP and the four % columns on Pods by default, and HPAs have no Metrics column", () => {
    expect(HIDDEN_BY_DEFAULT.pods).toEqual(["ip", "cpuReq", "cpuLim", "memReq", "memLim"]);
    expect(cols("hpas").some((c) => /metric/i.test(c.id))).toBe(false);
  });

  it("defaults to name ascending, and Last Seen descending for Events", () => {
    expect(defaultSort("pods")).toEqual({ sort: "name", desc: false });
    expect(defaultSort("events")).toEqual({ sort: "lastSeen", desc: true });
  });

  it("sorts nulls as undefined so they stay last, and the ⚠ column by its reason count", () => {
    for (const c of cols("pods")) if (c.sortable) expect(c.sortUndefined).toBe("last");
    const pod = buildInventory(
      results({ P1: [ksm({ namespace: "a", pod: "p", uid: "u", phase: "Pending" })] }),
    ).pods[0];
    expect(value(colOf("pods", "cpu"), pod)).toBeUndefined();
    expect(value(colOf("pods", "warnings"), pod)).toBe(1);
  });

  it("sorts Containers by container count", () => {
    const p = { namespace: "a", pod: "p", uid: "u" };
    const pod = buildInventory(
      results({
        P1: [ksm({ ...p, phase: "Running" })],
        P10: [ksm({ ...p, container: "a" }), ksm({ ...p, container: "b" })],
      }),
    ).pods[0];
    expect(value(colOf("pods", "containers"), pod)).toBe(2);
  });

  it("links Controlled By to the direct owner's drawer with the name in the tooltip", () => {
    const p = { namespace: "data", pod: "x", uid: "u" };
    const pod = buildInventory(
      results({
        P1: [ksm({ ...p, phase: "Running" })],
        P4: [ksm({ ...p, owner_kind: "ReplicaSet", owner_name: "x-rs" })],
        P5: [
          ksm({ namespace: "data", replicaset: "x-rs", owner_kind: "Deployment", owner_name: "x" }),
        ],
      }),
    ).pods[0];
    expect(colOf("pods", "controller").meta.links?.(pod)).toEqual([
      {
        label: "ReplicaSet",
        tip: "x-rs",
        target: { kind: "replicaset", cluster: "prod", namespace: "data", name: "x-rs" },
      },
    ]);
  });

  it("shows QoS plainly when observed and as an estimate otherwise", () => {
    const p = { namespace: "a", pod: "p", uid: "u" };
    const inv = buildInventory(
      results({
        P1: [ksm({ ...p, phase: "Running" })],
        P10: [ksm({ ...p, container: "c" })],
        P8: [],
        P9: [],
      }),
    );
    const qos = colOf("pods", "qos");
    expect(qos.meta.text?.(inv.pods[0])).toBe('infra.k8s2.qosEstimated{"cls":"BestEffort"}');
    expect(qos.meta.tip?.(inv.pods[0])).toBe("infra.k8s2.qosEstimatedTip");
    joinObjects(
      inv,
      "pod",
      "prod",
      parseObjects([
        { uid: "u", event_name: "p", k8s_namespace_name: "a", qos_class: "Burstable" },
      ]),
    );
    expect(qos.meta.text?.(inv.pods[0])).toBe("Burstable");
    expect(qos.meta.tip?.(inv.pods[0])).toBeNull();
  });

  it("renders a node's taints as a count with key=value:Effect lines", () => {
    const node = buildInventory(
      results({
        N1: [ksm({ node: "n1", condition: "Ready", status: "true" })],
        N4: [
          ksm({ node: "n1", key: "a", effect: "NoSchedule" }),
          ksm({ node: "n1", key: "b", value: "v", effect: "NoExecute" }),
        ],
      }),
    ).nodes[0];
    const taints = colOf("nodes", "taints");
    expect(taints.meta.text?.(node)).toBe("2");
    expect(taints.meta.tip?.(node)).toBe("a:NoSchedule\nb=v:NoExecute");
  });

  it("shows Deployment Pods as available/replicas and the derived-conditions tooltip", () => {
    const dep = buildInventory(
      results({
        D1: [ksm({ namespace: "a", deployment: "d" }, 2)],
        D2: [ksm({ namespace: "a", deployment: "d" }, 1)],
        D3: [ksm({ namespace: "a", deployment: "d" }, 2)],
      }),
    ).deployments[0];
    expect(colOf("deployments", "pods").meta.text?.(dep)).toBe("1/2");
    expect(colOf("deployments", "pods").sortable).toBe(false);
    expect(colOf("deployments", "conditions").meta.tip?.(dep)).toBe("infra.k8s2.derivedConditions");
  });

  it("words Job conditions and lists only positive failure reasons", () => {
    const jobs = buildInventory(
      results({
        J1: [ksm({ namespace: "a", job_name: "ok" }, 0)],
        J5: [ksm({ namespace: "a", job_name: "ok" }, 1)],
        J3: [
          ksm({ namespace: "a", job_name: "bad", reason: "BackoffLimitExceeded" }, 1),
          ksm({ namespace: "a", job_name: "bad", reason: "DeadlineExceeded" }, 0),
        ],
      }),
    ).jobs;
    const c = colOf("jobs", "conditions");
    const byName = Object.fromEntries(jobs.map((j) => [j.name, j]));
    expect(c.meta.words?.(byName.ok)).toEqual([{ text: "Complete", tone: "success" }]);
    expect(c.meta.words?.(byName.bad)).toEqual([{ text: "Failed", tone: "error" }]);
    expect(c.meta.tip?.(byName.bad)).toBe("BackoffLimitExceeded");
  });

  it("tones PVC and namespace status", () => {
    const inv = buildInventory(
      results({
        V1: [ksm({ namespace: "a", persistentvolumeclaim: "v", phase: "Pending" })],
        NS1: [ksm({ namespace: "x", phase: "Terminating" })],
      }),
    );
    expect(colOf("pvcs", "status").meta.tone?.(inv.pvcs[0])).toBe("warning");
    expect(colOf("namespaces", "status").meta.tone?.(inv.namespaces[0])).toBe("error");
  });

  describe("events", () => {
    const [pod, node, svc] = parseEvents([
      {
        event_name: "e1",
        body_object_type: "Warning",
        body_object_note: "Back-off",
        body_object_regarding: JSON.stringify({ kind: "Pod", name: "x", namespace: "data" }),
        body_object_series: JSON.stringify({ count: 4 }),
        _timestamp: END - 5_000_000,
      },
      {
        event_name: "e2",
        body_object_type: "Normal",
        body_object_regarding: JSON.stringify({ kind: "Node", name: "n1" }),
        _timestamp: END - 9_000_000,
      },
      {
        event_name: "e3",
        body_object_regarding: JSON.stringify({ kind: "Service", name: "s", namespace: "a" }),
      },
    ]);

    it("shows a Warning message in error text, the count and the involved namespace", () => {
      expect(colOf("events", "message").meta.tone?.(pod)).toBe("error");
      expect(colOf("events", "message").meta.tone?.(node)).toBeNull();
      expect(colOf("events", "count").meta.text?.(pod)).toBe("4");
      expect(value(colOf("events", "namespace"), node)).toBeUndefined();
    });

    it("links the involved object to its drawer, and leaves kinds without one as text", () => {
      const involved = colOf("events", "involved");
      expect(involved.meta.links?.(pod)[0]).toMatchObject({
        label: "Pod: x",
        target: { kind: "pod", cluster: "prod", namespace: "data", name: "x" },
      });
      expect(involved.meta.links?.(node)[0].target).toEqual({
        kind: "node",
        cluster: "prod",
        namespace: "",
        name: "n1",
      });
      expect(involved.meta.links?.(svc)[0].target).toBeNull();
    });

    it("disables involved-object links with a tooltip when the cluster is unknown", () => {
      const involved = columnsFor("events", { ...ctx, eventLinks: false }).find(
        (c) => c.id === "involved",
      )!;
      expect(involved.meta.links?.(pod)[0]).toMatchObject({
        target: null,
        tip: "infra.k8s2.eventClusterUnknown",
      });
    });

    it("sorts Last Seen on the time, so descending is newest first", () => {
      expect(value(colOf("events", "lastSeen"), pod)).toBe(END - 5_000_000);
    });
  });
});
