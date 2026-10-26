// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { raw } from "@/types/i18n";
import {
  buildPaletteItems,
  mergePaletteItems,
  searchPalette,
  type PaletteItem,
} from "./k8sPalette";
import { VIEW_ICON } from "./k8sTree";
import type { Inventory } from "./kubernetesModel";

const base = (kind: string, cluster: string, namespace: string, name: string) => ({
  key: `${kind}/${cluster}/${namespace}/${name}`,
  kind,
  cluster,
  namespace,
  name,
});

const pod = (cluster: string, namespace: string, name: string, phase: string, ready = "true") =>
  ({
    ...base("pod", cluster, namespace, name),
    phase,
    ready,
    statusReason: null,
    object: null,
  }) as any;

const inventory = (patch: Partial<Inventory>): Inventory =>
  ({
    pods: [],
    nodes: [],
    deployments: [],
    daemonsets: [],
    statefulsets: [],
    replicasets: [],
    jobs: [],
    cronjobs: [],
    pvcs: [],
    hpas: [],
    namespaces: [],
    unlabelledFamilies: [],
    ...patch,
  }) as Inventory;

const t = ((key: string) => raw(key)) as any;

const build = (patch: Partial<Inventory>, activeCluster: string | null = null) =>
  buildPaletteItems({
    inventory: inventory(patch),
    clusters: ["prod", "stage"],
    activeCluster,
    t,
  });

describe("buildPaletteItems", () => {
  it("flags failing and pending pods as needing attention and leaves healthy ones as pods", () => {
    const items = build({
      pods: [
        pod("prod", "web", "api-1", "Running"),
        pod("prod", "web", "api-2", "Failed"),
        pod("prod", "web", "api-3", "Pending"),
      ],
    });
    const group = (name: string) => items.find((i) => i.search.startsWith(name))?.group;
    expect(group("api-1")).toBe("pods");
    expect(group("api-2")).toBe("attention");
    expect(group("api-3")).toBe("attention");
  });

  it("restricts resources to the active cluster but keeps every cluster switchable", () => {
    const items = build(
      { pods: [pod("prod", "web", "a", "Running"), pod("stage", "web", "b", "Running")] },
      "prod",
    );
    expect(items.filter((i) => i.group === "pods").map((i) => i.id)).toEqual(["pod/prod/web/a"]);
    expect(items.filter((i) => i.group === "clusters")).toHaveLength(2);
  });

  it("gives each Go to view its own icon from the tree", () => {
    const views = build({}).filter((i) => i.group === "goTo");
    for (const item of views) {
      expect(item.icon).toBe(VIEW_ICON[(item.target as any).view as keyof typeof VIEW_ICON]);
    }
    expect(new Set(views.map((i) => i.icon)).size).toBeGreaterThan(1);
  });

  it("targets the details drawer for a pod", () => {
    const [item] = build({ pods: [pod("prod", "web", "a", "Running")] }).filter(
      (i) => i.group === "pods",
    );
    expect(item.target).toEqual({
      type: "details",
      details: { kind: "pod", cluster: "prod", namespace: "web", name: "a" },
    });
  });
});

describe("searchPalette", () => {
  const items = build({
    pods: [
      pod("prod", "payments", "checkout-1", "Running"),
      pod("prod", "payments", "checkout-2", "Failed"),
      pod("prod", "web", "frontend-1", "Running"),
    ],
    nodes: [{ ...base("node", "prod", "", "node-checkout") } as any],
  });

  it("shows problems first, then a few views, for an empty query", () => {
    const result = searchPalette(items, "  ").items;
    expect(result[0].id).toBe("pod/prod/payments/checkout-2");
    expect(result.filter((i) => i.group === "goTo")).toHaveLength(6);
    expect(result.some((i) => i.group === "pods")).toBe(false);
  });

  it("requires every token to match, in any order", () => {
    const result = searchPalette(items, "payments checkout").items;
    expect(result.map((i) => i.id)).toEqual([
      "pod/prod/payments/checkout-2",
      "pod/prod/payments/checkout-1",
    ]);
  });

  it("orders groups: views, attention, workloads, pods, nodes, clusters", () => {
    const groups = searchPalette(items, "checkout").items.map((i) => i.group);
    expect(groups).toEqual(["attention", "pods", "nodes"]);
  });

  it("matches clusters by name", () => {
    expect(searchPalette(items, "stage").items.map((i) => i.id)).toEqual(["cluster:stage"]);
  });

  it("returns nothing when no item matches", () => {
    expect(searchPalette(items, "zzz-nope").items).toEqual([]);
  });

  const many: PaletteItem[] = Array.from({ length: 30 }, (_, i) => ({
    ...build({})[0],
    id: `x${i}`,
    search: `pod-${i}`,
  }));

  it("caps at 12 by default and reports the full match count", () => {
    expect(searchPalette(many, "pod").items).toHaveLength(12);
    const result = searchPalette(many, "pod", 12);
    expect(result.items).toHaveLength(12);
    expect(result.total).toBe(30);
  });

  it("reports the total of an empty query before the cap", () => {
    const result = searchPalette(build({}), "", 3);
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(6);
  });
});

describe("mergePaletteItems", () => {
  const detail = (id: string, name: string, hot = false): PaletteItem => ({
    ...build({})[0],
    id,
    group: "pods",
    hot,
    target: {
      type: "details",
      details: { kind: "pod", cluster: "c", namespace: "ns", name },
    },
  });

  it("keeps the primary item when both describe the same resource", () => {
    const merged = mergePaletteItems([detail("a", "web", true)], [detail("idx:a", "web")]);
    expect(merged.map((i) => i.id)).toEqual(["a"]);
    expect(merged[0].hot).toBe(true);
  });

  it("appends extras the primary list does not have", () => {
    const merged = mergePaletteItems(
      [detail("a", "web")],
      [detail("idx:a", "web"), detail("idx:b", "db")],
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "idx:b"]);
  });

  it("drops duplicate extras and returns primary untouched when there are none", () => {
    const primary = [detail("a", "web")];
    expect(mergePaletteItems(primary, [])).toBe(primary);
    expect(mergePaletteItems([], [detail("x", "db"), detail("y", "db")])).toHaveLength(1);
  });

  it("dedupes non-resource items by id", () => {
    const view = build({})[0];
    expect(mergePaletteItems([view], [{ ...view }])).toHaveLength(1);
  });
});
