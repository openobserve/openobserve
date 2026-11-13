// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";
import DetailTable from "./DetailTable.vue";
import { correlationFixtures } from "@/plugins/correlation/correlationVersions.fixtures";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());
const stream = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => vi.fn());
vi.mock("@/services/http", () => ({ default: () => transport }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search } });
});
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), resolve: () => ({ href: "" }) }),
}));
vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: {
      data: {
        stream: { selectedStreamFields: [], selectedStream: ["default"], selectedFields: [] },
      },
      meta: { selectedTraceStream: "" },
    },
  }),
}));
vi.mock("@/composables/useLogs/logsUtils", () => ({
  logsUtils: () => ({ fnParsedSQL: () => ({ columns: [] }), hasAggregation: () => false }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: vi.fn(async () => ({ list: [] })) }),
}));

// The Source Details drawer's correlation context as SearchResult builds it for a trace-named service.
const correlationProps = {
  serviceName: "c1-openobserve-ingester",
  displayServiceName: "ingester",
  serviceDisplay: { display_source: "trace" },
  matchedDimensions: {
    service_name: "c1-openobserve-ingester",
    k8s_cluster_name: "c1",
    k8s_namespace_name: "c1",
  },
  availableDimensions: { k8s_pod_name: "c1-openobserve-ingester-7" },
  semanticGroups: [{ id: "service", fields: ["service_name"] }],
  metricStreams: [],
  logStreams: [],
  traceStreams: [],
  timeRange: { startTime: 1_000_000, endTime: 2_000_000 },
};
const originalIsEnterprise = config.isEnterprise;
let wrapper: VueWrapper | undefined;
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const servicesCalls = () =>
  transport.get.mock.calls.filter(([url]: [string]) => url.endsWith("/service_versions/_services"));

function serve(services: () => Promise<unknown>) {
  transport.get.mockImplementation(async (url: string) =>
    url.endsWith("/service_versions/_services") ? services() : { data: {} },
  );
}
async function render(
  initialTab = "correlated-logs",
  context: object = correlationProps,
  extraStubs: Record<string, object> = {},
) {
  wrapper = mount(DetailTable, {
    props: {
      modelValue: { _timestamp: 1_500_000, message: "wal write failed: disk quota" },
      currentIndex: 0,
      totalLength: 1,
      correlationProps: context,
      initialTab,
    },
    attachTo: document.body,
    global: {
      plugins: [store],
      stubs: {
        ...extraStubs,
        JsonPreview: true,
        OTable: true,
        TelemetryCorrelationDashboard: { template: "<div data-test='tcd-stub' />" },
        CorrelatedLogsTable: { template: "<div data-test='correlated-logs-stub' />" },
      },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  (config as { isEnterprise: string }).isEnterprise = "true";
  store.state.zoConfig = { ...store.state.zoConfig, timestamp_column: "_timestamp" };
  serve(async () => ({ data: { services: correlationFixtures.scopes, envs: [] } }));
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  (config as { isEnterprise: string }).isEnterprise = originalIsEnterprise;
  queryClient.clear();
  vi.clearAllMocks();
});

describe("Source Details correlation header", () => {
  it.each(["correlated-logs", "correlated-metrics", "correlated-traces"])(
    "shows the trace-name title and the scope chips once on the %s tab",
    async (tab) => {
      await render(tab);
      expect(
        document.body.querySelectorAll('[data-test="svcver-correlation-header"]'),
      ).toHaveLength(1);
      expect($("svcver-service-name")?.textContent).toContain("Correlated Streams - ingester");
      expect($("svcver-service-name-detected")?.textContent).toBe(
        "detected as c1-openobserve-ingester",
      );
      expect($("svcver-correlation-env-chip")).not.toBe(null);
      expect($("svcver-correlation-where")?.textContent).toContain("c1 · c1");
      expect($("svcver-correlation-version")?.textContent).toContain("0.0.2");
      expect($("svcver-correlation-rollout-verdict")).not.toBe(null);
      expect($("svcver-correlation-rollout-verdict")!.textContent).toContain("Deploy verdict");
      expect($("svcver-correlation-rollout-verdict")!.textContent).not.toContain("Rollout");
      expect($("svcver-correlation-open-service")).not.toBe(null);
      expect(servicesCalls()[0]?.[1]).toEqual(
        expect.objectContaining({
          params: expect.objectContaining({ signal: "traces", service: "ingester" }),
        }),
      );
    },
  );

  it("stays off and reads no scope outside the correlation tabs", async () => {
    await render("json");
    expect($("svcver-correlation-header")).toBe(null);
    expect(servicesCalls()).toHaveLength(0);
  });

  it("closes the Source Details drawer before the verdict chip opens the compare drawer", async () => {
    const w = await render();
    $("svcver-correlation-rollout-verdict")!.click();
    await flushPromises();
    expect(w.emitted("closeTable")).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          cmp: "0.0.2",
          cmpSvc: "ingester",
          cmpWhere: "k8s:c1/c1",
          cmpDeploy: correlationFixtures.golden.newest_verdict?.deploy_key,
        }),
      }),
    );
  });

  it("opens the service panel from Open service", async () => {
    const w = await render();
    $("svcver-correlation-open-service")!.click();
    await flushPromises();
    expect(w.emitted("closeTable")).toHaveLength(1);
    expect(push).toHaveBeenCalledWith({
      name: "traces",
      query: expect.objectContaining({
        tab: "services-catalog",
        panel: "versions",
        panelSvc: "ingester",
        panelWhere: "k8s:c1/c1",
      }),
    });
  });

  it("keeps the title and hides the chips on a 403", async () => {
    serve(() => Promise.reject({ isAxiosError: true, response: { status: 403 } }));
    await render();
    expect($("svcver-service-name")?.textContent).toContain("Correlated Streams - ingester");
    expect($("svcver-correlation-env-chip")).toBe(null);
    expect($("svcver-correlation-rollout-verdict")).toBe(null);
  });
});

describe("Source Details scope picked through the log row's pod", () => {
  const logTime = 1_793_000_000_000_000;
  const fiveMinutes = 300_000_000;
  // The shipper stamps its own cluster on the log line, which no span scope reports; its env alone would pick env:dev.
  const podContext = {
    ...correlationProps,
    matchedDimensions: {
      service_name: "c1-openobserve-ingester",
      k8s_cluster_name: "logging-a",
      k8s_namespace_name: "c1",
      deployment_environment: "dev",
    },
    traceStreams: [{ stream_name: "default", stream_type: "traces", filters: {} }],
    sourceEvent: { timestamp: logTime },
  };
  const tip = { OTooltip: { template: "<div><slot /><slot name='content' /></div>" } };
  type Handlers = {
    data: (a: unknown, r: unknown) => void;
    error: (a: unknown, e: unknown) => void;
    complete: (a: unknown, r: unknown) => void;
  };
  type Request = { queryReq: { query: { sql: string; start_time: number; end_time: number } } };
  const podReads = () =>
    stream.mock.calls
      .map(([request]: [Request]) => request)
      .filter((request) => request.queryReq.query.sql.includes("o2_service_where"));
  function answer(events: object[], fail = false) {
    stream.mockImplementation(async (request: Request, handlers: Handlers) => {
      for (const event of events) handlers.data(request, event);
      if (fail) handlers.error(request, { message: "boom" });
      else handlers.complete(request, null);
    });
  }
  const hits = (...wheres: string[]) => ({
    type: "search_response_hits",
    content: { results: { hits: wheres.map((where_key) => ({ where_key })) } },
  });

  beforeEach(() => {
    transport.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/service_versions/_services"))
        return { data: { services: correlationFixtures.scopes, envs: [] } };
      if (url.includes("/streams/default/schema"))
        return correlationFixtures.traceSchema([
          ...correlationFixtures.traceFields.k8s,
          "o2_service_where",
        ]);
      return { data: {} };
    });
  });

  it("renders the chips when the pod's spans name one place, with the pod in the where tooltip", async () => {
    answer([hits("k8s:c1/c1")]);
    await render("correlated-traces", podContext, tip);
    expect($("svcver-correlation-where")?.textContent).toContain("c1 · c1");
    expect($("svcver-correlation-version")?.textContent).toContain("0.0.2");
    const tooltip = $("svcver-correlation-where-by-pod")?.textContent?.replace(/\s+/g, " ");
    expect(tooltip).toContain("c1 · c1 · picked from this log's pod");
    expect(tooltip).toContain(
      "Pod c1-openobserve-ingester-7 sent its spans from cluster c1, namespace c1.",
    );
    expect(tooltip).toContain("This log's own cluster field reads logging-a.");
    const [read] = podReads();
    expect(read.queryReq.query.sql).toContain("service_k8s_pod_name = 'c1-openobserve-ingester-7'");
    expect(read.queryReq.query.sql).toContain("LIMIT 2");
    expect(read.queryReq.query.start_time).toBe(logTime - fiveMinutes);
    expect(read.queryReq.query.end_time).toBe(logTime + fiveMinutes);
    expect(stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "search", pageType: "traces" }),
    );
    expect(search).not.toHaveBeenCalled();
  });
});
