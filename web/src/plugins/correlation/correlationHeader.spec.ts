import { describe, expect, it } from "vitest";
import type { FieldAlias, StreamInfo } from "@/services/service_streams";
import {
  candidateMenu,
  correlatedByKeys,
  correlatedByLabel,
  headerVersion,
  locationDimensions,
} from "./correlationHeader";

const groups: FieldAlias[] = [
  { id: "service", display: "Service", fields: ["service_name", "service"] },
  { id: "k8s-cluster", display: "K8s Cluster", fields: ["k8s_cluster", "k8s_cluster_name"] },
  { id: "k8s-namespace", display: "K8s Namespace", fields: ["k8s_namespace_name"] },
  { id: "k8s-pod-name", display: "K8s Pod", fields: ["k8s_pod_name", "service_k8s_pod_name"] },
];
const k8sLocation = ["k8s-cluster", "k8s-namespace"];
const stream = (filters: Record<string, string>, dropped?: string[]): StreamInfo => ({
  stream_name: "s",
  stream_type: "logs",
  filters,
  dropped_dimensions: dropped,
});

interface CorrelatedByRow {
  name: string;
  location?: string[];
  keys: string[];
  streams: StreamInfo[];
  shown: string[];
}

describe("correlated by", () => {
  it.each<CorrelatedByRow>([
    {
      name: "orders the identity location first and the pod after it, and leaves out the service",
      location: k8sLocation,
      keys: ["k8s_pod_name", "service_name", "k8s_namespace_name", "k8s_cluster"],
      streams: [
        stream({
          k8s_pod_name: "q-0",
          service_name: "querier",
          k8s_namespace_name: "obs",
          k8s_cluster: "alpha",
        }),
      ],
      shown: ["k8s_cluster", "k8s_namespace_name", "k8s_pod_name"],
    },
    {
      name: "leaves out a dimension the streams dropped",
      keys: ["k8s_cluster", "k8s-pod-name"],
      streams: [stream({ k8s_cluster: "alpha" }, ["k8s-pod-name"])],
      shown: ["k8s_cluster"],
    },
    {
      name: "keeps a dimension applied on one stream under another alias of its group",
      keys: ["k8s_pod_name"],
      streams: [stream({ k8s_cluster: "alpha" }), stream({ service_k8s_pod_name: "q-0" })],
      shown: ["k8s_pod_name"],
    },
    {
      name: "leaves out a dimension whose filter is the all-values pick",
      keys: ["k8s_cluster", "k8s_namespace_name"],
      streams: [stream({ k8s_cluster: "alpha", k8s_namespace_name: "_o2_all_" })],
      shown: ["k8s_cluster"],
    },
    {
      name: "is empty when only the service matched",
      keys: ["service"],
      streams: [stream({ service_name: "ledger-sync" })],
      shown: [],
    },
    {
      name: "orders a custom set's location before a made-up dimension without any groups",
      location: ["zone"],
      keys: ["rack", "zone"],
      streams: [stream({ rack: "r12", zone: "z1" })],
      shown: ["zone", "rack"],
    },
    {
      name: "keeps the chip order with no identity config",
      keys: ["rack", "zone"],
      streams: [stream({ rack: "r12", zone: "z1" })],
      shown: ["rack", "zone"],
    },
  ])("$name", ({ keys, streams, shown, location }) => {
    expect(correlatedByKeys(keys, streams, groups, location)).toEqual(shown);
  });

  it("reads the location from every identity set in config order, without the service", () => {
    expect(
      locationDimensions({
        sets: [
          { id: "a", label: "A", distinguish_by: ["zone", "service", "rack"] },
          { id: "b", label: "B", distinguish_by: ["rack", "shard"] },
        ],
        tracked_alias_ids: [],
      }),
    ).toEqual(["zone", "rack", "shard"]);
    expect(locationDimensions(undefined)).toEqual([]);
  });

  it("names a chip by its semantic group, whichever alias the stream used", () => {
    expect(correlatedByLabel("k8s_namespace_name", groups)).toBe("K8s Namespace");
    expect(correlatedByLabel("service_k8s_pod_name", groups)).toBe("K8s Pod");
    expect(correlatedByLabel("rack", groups)).toBe(null);
  });
});

describe("ambiguous name menu", () => {
  it.each([
    { candidates: ["b", "a"], shown: ["a", "b"], more: 0 },
    { candidates: ["d", "c", "b", "a"], shown: ["a", "b", "c", "d"], more: 0 },
    {
      candidates: ["querier", "ingester", "alertmanager", "router", "compactor", "flusher"],
      shown: ["alertmanager", "compactor", "flusher", "ingester"],
      more: 2,
    },
  ])("lists $shown and $more more", ({ candidates, shown, more }) => {
    expect(candidateMenu(candidates)).toEqual({ shown, more });
  });
});

describe("header version", () => {
  it.each([
    { ambiguous: false, instanceVersion: "1.2.0", serviceVersion: "1.3.0", shown: "1.2.0" },
    { ambiguous: false, instanceVersion: null, serviceVersion: "1.3.0", shown: "1.3.0" },
    { ambiguous: false, instanceVersion: null, serviceVersion: "", shown: "" },
    { ambiguous: true, instanceVersion: "1.2.0", serviceVersion: "1.3.0", shown: "" },
  ])("shows $shown", ({ shown, ...input }) => {
    expect(headerVersion(input)).toBe(shown);
  });
});
