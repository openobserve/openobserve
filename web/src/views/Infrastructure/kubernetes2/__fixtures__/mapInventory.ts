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

import {
  buildInventory,
  type Inventory,
  type NodeRow,
  type PodRow,
  type QueryResults,
  type Series,
} from "../kubernetesModel";
import type { QueryId } from "../kubernetesQueries";
import type { MapRow } from "../mapFill";

export const GEN = "prod-us-east-1";
export const MI = 1024 ** 2;
export const NODES = [
  "ip-10-0-10-38.ec2.internal",
  "ip-10-0-13-37.ec2.internal",
  "ip-10-0-11-39.ec2.internal",
  "ip-10-0-12-36.ec2.internal",
];
export const ANSWERED: QueryId[] = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P15",
  "K1",
  "K2",
  "N1",
  "N2",
  "K3",
  "K4",
];

export const INVENTORY = "commerce/inventory-service-blkdl5tcm2-94jdl";
export const CRASH = "data/recommendation-service-9x58zgdb6z-sclvv";
export const HEALTHY = "gateway/api-gateway-5d8f7c9b4f-x2k9p";

interface PodOpts {
  phase?: string;
  ready?: string | null;
  rs?: string;
  deployment?: string;
  ds?: string;
  ss?: string;
  job?: string;
  node?: string;
  cpuRequest?: number;
  cpu?: number;
  memoryLimit?: number;
  memory?: number;
}

// Generator-shaped (traces_generator PR #5): KSM carries k8s_cluster, kubeletstats k8s_cluster_name.
export function generatorResults(): QueryResults {
  const results: QueryResults = new Map(ANSWERED.map((id) => [id, [] as Series[]]));
  const add = (id: QueryId, metric: Record<string, string>, value = 1) =>
    results.get(id)!.push({ metric: { k8s_cluster: GEN, ...metric }, value });
  const usage = (id: QueryId, metric: Record<string, string>, value: number) =>
    results.get(id)!.push({ metric: { k8s_cluster_name: GEN, ...metric }, value });
  let spread = 0;
  const pod = (namespace: string, name: string, opts: PodOpts = {}) => {
    const p = { namespace, pod: name, uid: name };
    add("P1", { ...p, phase: opts.phase ?? "Running" });
    if (opts.ready !== null) add("P11", { ...p, condition: opts.ready ?? "true" });
    if (opts.rs) {
      add("P4", { ...p, owner_kind: "ReplicaSet", owner_name: opts.rs });
      add("P5", {
        namespace,
        replicaset: opts.rs,
        owner_kind: "Deployment",
        owner_name: opts.deployment!,
      });
    }
    const direct = opts.ds
      ? ["DaemonSet", opts.ds]
      : opts.ss
        ? ["StatefulSet", opts.ss]
        : opts.job
          ? ["Job", opts.job]
          : null;
    if (direct) add("P4", { ...p, owner_kind: direct[0], owner_name: direct[1] });
    add("P6", { ...p, node: opts.node ?? NODES[spread++ % NODES.length] });
    add("P7", { ...p, container: "main" }, 0);
    add("P10", { ...p, container: "main" });
    if (opts.cpuRequest !== 0) {
      add("P8", { ...p, container: "main", resource: "cpu" }, opts.cpuRequest ?? 0.5);
      add("P9", { ...p, container: "main", resource: "memory" }, opts.memoryLimit ?? 256 * MI);
    }
    const k = { k8s_namespace_name: namespace, k8s_pod_name: name, k8s_pod_uid: name };
    if (opts.cpu !== 0) usage("K1", k, opts.cpu ?? 0.2);
    if (opts.memory !== 0) usage("K2", k, opts.memory ?? 100 * MI);
    return p;
  };
  const deployment = (namespace: string, name: string, hash: string, suffixes: string[]) => {
    for (const s of suffixes)
      pod(namespace, `${name}-${hash}-${s}`, { rs: `${name}-${hash}`, deployment: name });
  };
  pod("commerce", "order-service-6xphqm265w-nb2sq", {
    ready: "false",
    rs: "order-service-6xphqm265w",
    deployment: "order-service",
  });
  pod("commerce", "inventory-service-blkdl5tcm2-94jdl", {
    rs: "inventory-service-blkdl5tcm2",
    deployment: "inventory-service",
    cpu: 0.4,
    memoryLimit: 100 * MI,
    memory: 92 * MI,
  });
  deployment("commerce", "cart-service", "7c6d5b4a3z", ["a1", "a2"]);
  deployment("commerce", "payment-service", "6b5c4d3e2f", ["b1", "b2"]);
  deployment("commerce", "catalog-service", "5a4b3c2d1e", ["c1", "c2"]);
  deployment("commerce", "checkout-service", "4z3y2x1w0v", ["d1", "d2"]);
  const crash = pod("data", "recommendation-service-9x58zgdb6z-sclvv", {
    ready: "false",
    rs: "recommendation-service-9x58zgdb6z",
    deployment: "recommendation-service",
    cpu: 0.1,
    memory: 50 * MI,
  });
  add("P2", { ...crash, container: "main", reason: "CrashLoopBackOff" });
  deployment("data", "recommendation-service", "9x58zgdb6z", ["jwhzq"]);
  deployment("data", "analytics-service", "x6xv7pjxhb", ["zqcl4"]);
  pod("data", "analytics-backfill-hc9zb", {
    phase: "Failed",
    ready: null,
    job: "analytics-backfill",
    cpuRequest: 0,
    cpu: 0,
    memory: 0,
  });
  pod("data", "postgres-0", { ss: "postgres" });
  pod("data", "postgres-1", { ss: "postgres" });
  deployment("data", "etl-service", "3q2w1e0r9t", ["e1", "e2"]);
  pod("chat", "chat-service-8g7f88v79d-2hth6", {
    rs: "chat-service-8g7f88v79d",
    deployment: "chat-service",
    cpu: 0.025,
  });
  deployment("chat", "chat-service", "8g7f88v79d", ["k2j4m"]);
  pod("chat", "user-session-service-rm5b8ldqdv-l4phb", {
    rs: "user-session-service-rm5b8ldqdv",
    deployment: "user-session-service",
    cpu: 0.025,
  });
  deployment("chat", "user-session-service", "rm5b8ldqdv", ["p8x7c"]);
  deployment("chat", "notification-service", "2n3m4b5v6c", ["f1", "f2"]);
  pod("media", "transcoding-service-nkgbp5xp5l-vwvn2", {
    phase: "Pending",
    ready: null,
    rs: "transcoding-service-nkgbp5xp5l",
    deployment: "transcoding-service",
    node: "",
    cpu: 0,
    memory: 0,
  });
  deployment("media", "media-service", "1a2s3d4f5g", ["g1", "g2"]);
  deployment("media", "thumbnail-service", "6h7j8k9l0z", ["h1", "h2"]);
  for (const [i, node] of NODES.entries())
    pod("monitoring", `fluent-bit-${i}x7q`, { ds: "fluent-bit", node });
  pod("monitoring", "prometheus-0", { ss: "prometheus" });
  deployment("gateway", "api-gateway", "5d8f7c9b4f", ["x2k9p", "m3n7q"]);
  deployment("gateway", "auth-service", "8c7v6b5n4m", ["i1", "i2"]);
  pod("gateway", "debug-shell", { cpuRequest: 0, cpu: 0 });
  deployment("gateway", "nginx-test", "0p9o8i7u6y", ["j1", "j2"]);
  for (const node of NODES) {
    add("N1", { node, condition: "Ready", status: "true" });
    add("N2", { node, resource: "cpu" }, 4);
    add("N2", { node, resource: "memory" }, 16 * 1024 * MI);
    usage("K3", { k8s_node_name: node }, 1);
    usage("K4", { k8s_node_name: node }, 4 * 1024 * MI);
  }
  add("N1", { node: NODES[1], condition: "MemoryPressure", status: "true" });
  return results;
}

export const inventory = (results = generatorResults()): Inventory => buildInventory(results);

export const byName = (rows: MapRow[], ref: string) =>
  rows.find((r) => `${r.namespace}/${r.name}` === ref)!;

const ZONES = ["us-east-1a", "us-east-1a", "us-east-1b", "us-east-1c"];

const INSTANCE_TYPES = ["m5.2xlarge", "m5.2xlarge", "m5.xlarge", "m5.xlarge"];

// The two pods the generator has not re-posted, so their labels were never observed.
export const UNLABELLED = ["media/transcoding-service-nkgbp5xp5l-vwvn2", "gateway/debug-shell"];

export function podLabels(pod: PodRow): Record<string, string> {
  const owner = pod.controller;
  const name = pod.workload?.name ?? owner?.name ?? pod.name;
  const labels: Record<string, string> = { "app.kubernetes.io/name": name };
  if (owner?.kind === "ReplicaSet") labels["pod-template-hash"] = owner.name.split("-").pop()!;
  if (owner?.kind === "StatefulSet") {
    labels["controller-revision-hash"] = `${owner.name}-7d9f`;
    labels["statefulset.kubernetes.io/pod-name"] = pod.name;
  }
  if (owner?.kind === "DaemonSet") {
    labels["controller-revision-hash"] = `${owner.name}-5c8b`;
    labels["pod-template-generation"] = "1";
  }
  if (owner?.kind === "Job") {
    labels["batch.kubernetes.io/job-name"] = owner.name;
    labels["job-name"] = owner.name;
    labels["batch.kubernetes.io/controller-uid"] = `${owner.name}-uid`;
  }
  return labels;
}

export function nodeLabels(node: NodeRow): Record<string, string> {
  const i = NODES.indexOf(node.name);
  return {
    "kubernetes.io/hostname": node.name,
    "kubernetes.io/os": "linux",
    "kubernetes.io/arch": "amd64",
    "node.kubernetes.io/instance-type": INSTANCE_TYPES[i],
    "topology.kubernetes.io/region": "us-east-1",
    "topology.kubernetes.io/zone": ZONES[i],
    "eks.amazonaws.com/nodegroup": "default",
    "eks.amazonaws.com/capacityType": "ON_DEMAND",
  };
}

export const observed = (labels: Record<string, string>) => ({
  uid: null,
  metadata: { labels },
  spec: {},
  status: {},
});

// The AC 42 inventory with labels observed on 39 of 41 pods and on all 4 nodes.
export function labelledInventory(results = generatorResults()): Inventory {
  const inv = inventory(results);
  for (const pod of inv.pods) {
    if (!UNLABELLED.includes(`${pod.namespace}/${pod.name}`)) pod.object = observed(podLabels(pod));
  }
  for (const node of inv.nodes) node.object = observed(nodeLabels(node));
  return inv;
}
