import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import type { StarterPack } from "./types";
import { packById } from "./usePackCatalog";
import {
  MATCH_PARTIAL_AFTER_MS,
  MATCH_POLL_MS,
  useStarterPackMatcher,
} from "./useStarterPackMatcher";

const fake = vi.hoisted(() => ({
  metrics: [] as string[],
  logs: [] as string[],
  traces: [] as string[],
  columns: {} as Record<string, string[]>,
  fail: false,
  clusters: ["staging-eu-1"],
  sql: [] as string[],
  cancel: vi.fn(),
}));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: false }));
vi.mock("@/composables/query/readQuery", () => ({
  readQuery: async (options: { queryKey: unknown[] }) => {
    if (fake.fail) throw new Error("down");
    const key = JSON.stringify(options.queryKey);
    if ((options.queryKey as string[]).length === 2 && key.includes("metrics")) {
      return fake.metrics.map((name) => ({ name }));
    }
    if ((options.queryKey as string[]).length === 2 && key.includes("traces")) {
      return fake.traces.map((name) => ({ name }));
    }
    if ((options.queryKey as string[]).length === 2) return fake.logs.map((name) => ({ name }));
    const stream = Object.keys(fake.columns).find((name) => key.includes(name));
    return { schema: (stream ? fake.columns[stream] : []).map((name) => ({ name })) };
  },
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: async (request: any, handlers: any) => {
      fake.sql.push(request.queryReq.query.sql);
      handlers.data(request, {
        type: "search_response_hits",
        content: { results: { hits: fake.clusters.map((c) => ({ c })) } },
      });
      handlers.complete(request, {});
    },
    cancelStreamQueryBasedOnRequestId: fake.cancel,
  }),
}));
vi.mock("@/services/stream.queries", () => ({
  streamNameListQuery: (org: string, type: string) => ({ queryKey: [org, type] }),
  streamSchemaQuery: (org: string, name: string, type: string) => ({
    queryKey: [org, type, name],
  }),
}));

const setup = (poll = false, pack?: StarterPack) => {
  let api!: ReturnType<typeof useStarterPackMatcher>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useStarterPackMatcher("org", { poll, pack });
        return () => null;
      },
    }),
  );
  return { api, wrapper };
};

describe("useStarterPackMatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(fake, { metrics: [], logs: [], traces: [], columns: {}, fail: false, sql: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("matches only when a detection stream has a schema, and reads its clusters by streaming", async () => {
    fake.metrics = ["kube_pod_status_phase"];
    fake.columns = { kube_pod_status_phase: ["k8s_cluster", "value"] };
    const { api } = setup();
    await api.check();
    expect(api.state.value).toBe("matched");
    expect(api.clusters.value).toEqual(["staging-eu-1"]);
    expect(fake.sql).toEqual(['SELECT DISTINCT k8s_cluster AS c FROM "kube_pod_status_phase"']);
  });

  it("waits while a detection stream exists without a schema", async () => {
    fake.metrics = ["kube_pod_status_phase"];
    const { api } = setup();
    await api.check();
    expect(api.state.value).toBe("waiting");
  });

  it("waits on logs alone and reports none without any Kubernetes stream", async () => {
    fake.logs = ["k8s_events"];
    const first = setup();
    await first.api.check();
    expect(first.api.state.value).toBe("waiting");
    fake.logs = ["web"];
    const second = setup();
    await second.api.check();
    expect(second.api.state.value).toBe("none");
  });

  it("reports an error and recovers on retry", async () => {
    fake.fail = true;
    const { api } = setup();
    await api.check();
    expect(api.state.value).toBe("error");
    fake.fail = false;
    await api.retry();
    expect(api.state.value).toBe("none");
  });

  it("re-runs while polling, offers the partial setup after 3 minutes, and stops on a match", async () => {
    fake.logs = ["k8s_events"];
    const { api } = setup(true);
    await api.check();
    expect(api.waitedLong.value).toBe(false);
    await vi.advanceTimersByTimeAsync(MATCH_PARTIAL_AFTER_MS + MATCH_POLL_MS);
    expect(api.state.value).toBe("waiting");
    expect(api.waitedLong.value).toBe(true);

    fake.metrics = ["k8s_pod_cpu_usage"];
    fake.columns = { k8s_pod_cpu_usage: ["value"] };
    await vi.advanceTimersByTimeAsync(MATCH_POLL_MS);
    expect(api.state.value).toBe("matched");
    expect(api.waitedLong.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a late answer and stops polling once unmounted", async () => {
    fake.logs = ["web"];
    const { api, wrapper } = setup(true);
    const running = api.check();
    wrapper.unmount();
    await running;
    await flushPromises();
    expect(api.state.value).toBe("checking");
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("hosts pack", () => {
    const HOSTS_PACK = packById("hosts")!;

    it.each([
      ["OpenTelemetry hostmetrics", "system_cpu_time"],
      ["node-exporter", "node_cpu_seconds_total"],
    ])("matches %s data without reading clusters", async (_shape, stream) => {
      fake.metrics = [stream];
      fake.columns = { [stream]: ["host_name", "value"] };
      const { api } = setup(false, HOSTS_PACK);
      await api.check();
      expect(api.state.value).toBe("matched");
      expect(api.clusters.value).toEqual([]);
      expect(fake.sql).toEqual([]);
    });

    it("waits on a host stream without a schema and ignores Kubernetes data", async () => {
      fake.metrics = ["system_memory_usage"];
      const first = setup(false, HOSTS_PACK);
      await first.api.check();
      expect(first.api.state.value).toBe("waiting");
      fake.metrics = ["kube_pod_status_phase"];
      fake.columns = { kube_pod_status_phase: ["k8s_cluster"] };
      const second = setup(false, HOSTS_PACK);
      await second.api.check();
      expect(second.api.state.value).toBe("none");
    });
  });

  describe("packs found by stream", () => {
    it("finds Traces in an org with only a traces stream", async () => {
      fake.traces = ["default"];
      fake.columns = { default: ["trace_id", "duration"] };
      const { api } = setup(false, packById("traces")!);
      await api.check();
      expect(api.state.value).toBe("matched");
      expect(api.streams.value).toEqual(["default"]);
      expect(fake.sql).toEqual([]);
    });

    it("ignores sample and internal traces streams", async () => {
      fake.traces = ["o2_demo_traces", "traces_service_graph_edges"];
      fake.columns = { o2_demo_traces: ["trace_id"], traces_service_graph_edges: ["trace_id"] };
      const { api } = setup(false, packById("traces")!);
      await api.check();
      expect(api.state.value).toBe("none");
    });

    it("finds AWS CloudWatch by its cloudwatch_metrics logs stream", async () => {
      fake.logs = ["cloudwatch_metrics"];
      fake.columns = { cloudwatch_metrics: ["metric_name", "value"] };
      const { api } = setup(false, packById("aws-cloudwatch")!);
      await api.check();
      expect(api.state.value).toBe("matched");
      expect(api.streams.value).toEqual(["cloudwatch_metrics"]);
    });

    it("reports none for AWS CloudWatch without its logs stream", async () => {
      fake.logs = ["web"];
      fake.columns = { web: ["message"] };
      const { api } = setup(false, packById("aws-cloudwatch")!);
      await api.check();
      expect(api.state.value).toBe("none");
    });
  });
});
