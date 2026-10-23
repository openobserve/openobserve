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
import type { Inventory, NodeRow, PodRow } from "./kubernetesModel";
import { attentionItems, capacityScale, podBuckets } from "./overviewModel";

const container = (over: Record<string, unknown> = {}) => ({
  name: "app",
  init: false,
  image: null,
  ready: true,
  state: "ready",
  running: true,
  waitingReason: null,
  terminatedReason: null,
  lastTerminatedReason: null,
  restarts: 0,
  ...over,
});

const pod = (name: string, over: Record<string, unknown> = {}): PodRow =>
  ({
    key: `pod|${name}`,
    kind: "pod",
    cluster: "prod",
    namespace: "shop",
    name,
    createdAt: null,
    warnings: [],
    object: null,
    phase: "Running",
    ready: "true",
    status: { text: "Running", variant: "success" },
    statusReason: null,
    restarts: 0,
    containers: [container()],
    ...over,
  }) as unknown as PodRow;

const node = (name: string, ready: "true" | "false"): NodeRow =>
  ({ key: `node|${name}`, kind: "node", cluster: "prod", namespace: "", name, ready }) as NodeRow;

const inventory = (pods: PodRow[], nodes: NodeRow[] = []): Inventory =>
  ({ pods, nodes }) as unknown as Inventory;

describe("attentionItems", () => {
  it("ranks failing above pending above high restarts, and drops healthy pods", () => {
    const items = attentionItems(
      inventory([
        pod("healthy"),
        pod("restarty", { restarts: 12 }),
        pod("pending", { phase: "Pending", ready: null }),
        pod("crash", {
          ready: "false",
          restarts: 3,
          containers: [container({ ready: false, waitingReason: "CrashLoopBackOff" })],
        }),
        pod("evicted", { phase: "Failed", statusReason: "Evicted", ready: "false" }),
      ]),
      "prod",
    );
    expect(items.map((i) => i.name)).toEqual(["crash", "evicted", "pending", "restarty"]);
    expect(items.map((i) => i.severity)).toEqual(["error", "error", "warning", "warning"]);
  });

  it("lists CrashLoopBackOff and OOMKilled reasons in order", () => {
    const [item] = attentionItems(
      inventory([
        pod("crash", {
          ready: "false",
          containers: [
            container({
              ready: false,
              waitingReason: "CrashLoopBackOff",
              lastTerminatedReason: "OOMKilled",
            }),
          ],
        }),
      ]),
      "prod",
    );
    expect(item.reasons).toEqual(["CrashLoopBackOff", "OOMKilled"]);
    expect(item.ref).toEqual({ kind: "pod", cluster: "prod", namespace: "shop", name: "crash" });
  });

  it("breaks ties by restart count and includes a NotReady node as critical", () => {
    const items = attentionItems(
      inventory(
        [pod("a", { phase: "Failed", restarts: 1 }), pod("b", { phase: "Failed", restarts: 9 })],
        [node("n1", "false"), node("n2", "true")],
      ),
      "prod",
    );
    expect(items.map((i) => i.name)).toEqual(["b", "a", "n1"]);
    expect(items.find((i) => i.name === "n1")?.ref.kind).toBe("node");
  });

  it("scopes to the cluster", () => {
    const other = { ...pod("x", { phase: "Failed" }), cluster: "dev" } as PodRow;
    expect(attentionItems(inventory([other]), "prod")).toEqual([]);
    expect(attentionItems(inventory([other]), null)).toHaveLength(1);
  });

  it("does not offer Logs for a pending pod", () => {
    const [item] = attentionItems(inventory([pod("p", { phase: "Pending", ready: null })]), "prod");
    expect(item.canLogs).toBe(false);
  });
});

describe("podBuckets", () => {
  it("splits pods into ready, pending, failing and completed", () => {
    const buckets = podBuckets(
      inventory([
        pod("a"),
        pod("b", { phase: "Pending", ready: null }),
        pod("c", { phase: "Failed" }),
        pod("d", { phase: "Succeeded", ready: "false" }),
        pod("e", {
          ready: "false",
          containers: [container({ waitingReason: "ImagePullBackOff" })],
        }),
      ]),
      "prod",
    );
    expect(buckets).toEqual({
      ready: 1,
      pending: 1,
      failing: 2,
      completed: 1,
      unknown: 0,
      total: 5,
    });
  });
});

describe("capacityScale", () => {
  it("is null without allocatable", () => {
    expect(capacityScale(1, 1, 1, null)).toBeNull();
    expect(capacityScale(1, 1, 1, 0)).toBeNull();
  });

  it("keeps allocatable at the track end when nothing overcommits", () => {
    const scale = capacityScale(5, 10, 20, 100)!;
    expect(scale).toMatchObject({
      usagePct: 5,
      requestsPct: 10,
      limitsPct: 20,
      allocatablePct: 100,
    });
    expect(scale.overPct).toBeNull();
  });

  it("stretches the track and reports the overcommit percent when limits exceed allocatable", () => {
    const scale = capacityScale(8, 4, 20, 16)!;
    expect(scale.overPct).toBe(25);
    expect(scale.limitsPct).toBe(100);
    expect(scale.allocatablePct).toBeCloseTo(80);
  });
});
