import { describe, expect, it, vi } from "vitest";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { CompareResponse, NotServingPod, VerdictSummary } from "@/services/service_versions";
import { notServingPods, resolvePodEvents } from "./podLinks";
const pod = (name: string, namespace = "otel-demo", cluster = "c1"): NotServingPod => ({
  k8s_cluster: cluster,
  k8s_namespace: namespace,
  k8s_pod: name,
  k8s_workload: "checkout",
  k8s_container: "checkout",
  since: 1_000_000,
});
function api(streams: string[], fields: string[]) {
  return {
    getStreams: vi.fn(async () => ({ list: streams.map((name) => ({ name })) })),
    getStream: vi.fn(async () => ({ schema: fields.map((name) => ({ name })) })),
  };
}
const ctx = { orgId: "org", start: 1, end: 2 };
describe("pod events link", () => {
  it("filters k8s_events to the listed pods, escaped and grouped by namespace", async () => {
    const link = await resolvePodEvents(
      [pod("a'1"), pod("b"), pod("c", "other")],
      ctx,
      api(["k8s_events"], ["body_object_regarding", "k8s_cluster"]),
    );
    expect(link?.route.query.stream).toBe("k8s_events");
    const filter = b64DecodeUnicode(String(link?.route.query.query));
    expect(filter).toContain("json_get_str(body_object_regarding,'kind') = 'Pod'");
    expect(filter).toContain(
      "(json_get_str(body_object_regarding,'namespace') = 'otel-demo' AND json_get_str(body_object_regarding,'name') IN ('a''1', 'b') AND k8s_cluster = 'c1')",
    );
    expect(filter).toContain("= 'other'");
    expect(link?.route.query.from).toBe(1);
    expect(link?.route.query.to).toBe(2);
  });
  it("drops the cluster term when the events stream has no cluster field", async () => {
    const link = await resolvePodEvents(
      [pod("a")],
      ctx,
      api(["k8s_events"], ["body_object_regarding"]),
    );
    expect(b64DecodeUnicode(String(link?.route.query.query))).not.toContain("k8s_cluster");
  });
  it("returns null without a readable events stream or its regarding field", async () => {
    expect(await resolvePodEvents([pod("a")], ctx, api(["default"], []))).toBeNull();
    expect(await resolvePodEvents([pod("a")], ctx, api(["k8s_events"], ["body"]))).toBeNull();
    expect(
      await resolvePodEvents([], ctx, api(["k8s_events"], ["body_object_regarding"])),
    ).toBeNull();
  });
});
describe("not_serving pods source", () => {
  const stored = (value: Partial<VerdictSummary>) =>
    ({
      service: "checkout",
      where_key: "k8s:c1/otel-demo",
      arms: {
        a: { version: "2.5.0", start_time: 1, end_time: 2 },
        b: { version: "2.4.1", start_time: 0, end_time: 1 },
      },
      stored_verdict: { verdict: "not_serving", restricted: false, ...value },
      live_verdict: { verdict: "insufficient" },
    }) as unknown as CompareResponse;
  it("reads pods and pods_total from the stored verdict", () => {
    expect(notServingPods(stored({ pods: [pod("a")], pods_total: 70 }))).toEqual({
      pods: [pod("a")],
      total: 70,
    });
  });
  it("treats absent pods as no table and restricted as none", () => {
    expect(notServingPods(stored({})).pods).toEqual([]);
    expect(notServingPods(stored({ pods: [pod("a")], restricted: true })).pods).toEqual([]);
    expect(notServingPods(stored({ verdict: "ok", pods: [pod("a")] })).pods).toEqual([]);
  });
});
