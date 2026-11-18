import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

import { HOSTS_PACK } from "./hostsPack";
import type { StarterPack } from "./types";
import {
  MATCH_PARTIAL_AFTER_MS,
  MATCH_POLL_MS,
  useStarterPackMatcher,
} from "./useStarterPackMatcher";

const fake = vi.hoisted(() => ({
  metrics: [] as string[],
  logs: [] as string[],
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
    Object.assign(fake, { metrics: [], logs: [], columns: {}, fail: false, sql: [] });
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
});
