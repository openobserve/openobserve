// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import {
  indexItemsFromSeries,
  paletteIndexQuery,
  usePaletteIndex,
  MAX_INDEX_ITEMS,
} from "./usePaletteIndex";

let failNext = false;
const fetchQuery = vi.fn();
vi.mock("@/composables/query/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/query/queryClient")>()),
  queryClient: {
    fetchQuery: (...args: unknown[]) =>
      failNext ? Promise.reject(new Error("boom")) : fetchQuery(...args),
  },
}));

const s = (metric: Record<string, string>) => ({ metric, value: 1 });

const SERIES = [
  s({ kind: "pod", k8s_cluster: "a", namespace: "web", pod: "api-1", phase: "Running" }),
  s({ kind: "pod", k8s_cluster: "a", namespace: "web", pod: "api-2", phase: "Failed" }),
  s({ kind: "pod", k8s_cluster_name: "b", namespace: "web", pod: "api-9", phase: "Running" }),
  s({ kind: "node", k8s_cluster: "a", node: "n1" }),
  s({ kind: "deployment", k8s_cluster: "a", namespace: "web", deployment: "api" }),
  s({ kind: "daemonset", k8s_cluster: "a", namespace: "kube", daemonset: "agent" }),
  s({ kind: "statefulset", k8s_cluster: "a", namespace: "db", statefulset: "pg" }),
  s({ kind: "pod", k8s_cluster: "a", namespace: "web", phase: "Running" }),
];

const setup = (has: (stream: string) => boolean = () => true) => {
  const open = ref(false);
  const cluster = ref<string | null>("a");
  const orgId = ref("default");
  const refreshNonce = ref(0);
  const index = usePaletteIndex({ open, cluster, orgId, refreshNonce, has });
  return { open, cluster, orgId, refreshNonce, ...index };
};

beforeEach(() => {
  failNext = false;
  fetchQuery.mockReset();
});

describe("paletteIndexQuery", () => {
  it("joins one label_replace term per kind with or", () => {
    const q = paletteIndexQuery(() => true)!;
    expect(q.match(/label_replace\(/g)).toHaveLength(5);
    expect(q).toContain('"kind", "pod"');
    expect(q).toContain("last_over_time(kube_pod_status_phase[10m]) == 1");
    expect(q).not.toContain("k8s_cluster=");
  });

  it("drops kinds whose stream is missing, and returns null when none exist", () => {
    const q = paletteIndexQuery((stream) => stream === "kube_node_info")!;
    expect(q.match(/label_replace\(/g)).toHaveLength(1);
    expect(paletteIndexQuery(() => false)).toBeNull();
  });
});

describe("indexItemsFromSeries", () => {
  it("builds palette items for the active cluster only, skipping nameless series", () => {
    const { items, truncated } = indexItemsFromSeries(SERIES, "a");
    expect(truncated).toBe(false);
    expect(items.map((i) => i.label)).toHaveLength(6);
    const failed = items.find((i) => i.search.startsWith("api-2"))!;
    expect(failed.group).toBe("attention");
    expect(failed.hot).toBe(true);
    expect(failed.target).toEqual({
      type: "details",
      details: { kind: "pod", cluster: "a", namespace: "web", name: "api-2" },
    });
    const node = items.find((i) => i.group === "nodes")!;
    expect(node.target).toEqual({
      type: "details",
      details: { kind: "node", cluster: "a", namespace: "", name: "n1" },
    });
    expect(items.filter((i) => i.group === "workloads")).toHaveLength(3);
  });

  it("reads the alternate cluster label and includes every cluster when none is active", () => {
    expect(indexItemsFromSeries(SERIES, "b").items).toHaveLength(1);
    expect(indexItemsFromSeries(SERIES, null).items).toHaveLength(7);
  });

  it("stops at the cap and flags it", () => {
    const many = Array.from({ length: MAX_INDEX_ITEMS + 5 }, (_, i) =>
      s({ kind: "node", k8s_cluster: "a", node: `n${i}` }),
    );
    const out = indexItemsFromSeries(many, "a");
    expect(out.items).toHaveLength(MAX_INDEX_ITEMS);
    expect(out.truncated).toBe(true);
  });
});

describe("usePaletteIndex", () => {
  it("does nothing while the palette is closed", async () => {
    setup();
    await flushPromises();
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("loads on open, exposes items, and refilters when the cluster changes", async () => {
    let resolve!: (v: unknown) => void;
    fetchQuery.mockReturnValue(new Promise((r) => (resolve = r)));
    const idx = setup();
    idx.open.value = true;
    await nextTick();
    expect(idx.loading.value).toBe(true);
    resolve(SERIES);
    await flushPromises();
    expect(idx.loading.value).toBe(false);
    expect(idx.failed.value).toBe(false);
    expect(idx.items.value).toHaveLength(6);
    idx.cluster.value = "b";
    expect(idx.items.value).toHaveLength(1);
    expect(fetchQuery).toHaveBeenCalledTimes(1);
  });

  it("refetches after a refresh nonce change while open", async () => {
    fetchQuery.mockResolvedValue(SERIES);
    const idx = setup();
    idx.open.value = true;
    await flushPromises();
    idx.refreshNonce.value++;
    await flushPromises();
    expect(fetchQuery).toHaveBeenCalledTimes(2);
  });

  it("sets failed and keeps no items when the query rejects", async () => {
    failNext = true;
    const idx = setup();
    idx.open.value = true;
    await flushPromises();
    expect(idx.failed.value).toBe(true);
    expect(idx.loading.value).toBe(false);
    expect(idx.items.value).toEqual([]);
  });

  it("does not query when no relevant stream exists", async () => {
    const idx = setup(() => false);
    idx.open.value = true;
    await flushPromises();
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(idx.loading.value).toBe(false);
  });

  it("ignores a stale response after the org changes", async () => {
    let resolve!: (v: unknown) => void;
    fetchQuery.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fetchQuery.mockResolvedValueOnce([]);
    const idx = setup();
    idx.open.value = true;
    await nextTick();
    idx.orgId.value = "other";
    await flushPromises();
    resolve(SERIES);
    await flushPromises();
    expect(idx.items.value).toEqual([]);
  });
});
