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
  semanticGroups: correlationFixtures.groups,
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
  transport.get.mockImplementation(async (url: string) => {
    if (url.endsWith("/service_versions/_services")) return services();
    if (url.endsWith("/service_streams/config/identity"))
      return { data: correlationFixtures.identityConfig };
    return { data: {} };
  });
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

  it("opens the service panel from Versions & deploys", async () => {
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

describe("Source Details scope picked through the spans of the log's applied dimensions", () => {
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
    traceStreams: [
      {
        stream_name: "default",
        stream_type: "traces",
        filters: { service_k8s_pod_name: "c1-openobserve-ingester-7" },
      },
    ],
    sourceEvent: { timestamp: logTime },
  };
  type Handlers = {
    data: (a: unknown, r: unknown) => void;
    error: (a: unknown, e: unknown) => void;
    complete: (a: unknown, r: unknown) => void;
  };
  type Request = { queryReq: { query: { sql: string; start_time: number; end_time: number } } };
  const whereReads = () =>
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
  const hits = (...rows: object[]) => ({
    type: "search_response_hits",
    content: { results: { hits: rows } },
  });

  beforeEach(() => {
    transport.get.mockImplementation(async (url: string) => {
      if (url.endsWith("/service_versions/_services"))
        return { data: { services: correlationFixtures.scopes, envs: [] } };
      if (url.endsWith("/service_streams/config/identity"))
        return { data: correlationFixtures.identityConfig };
      if (url.includes("/streams/default/schema"))
        return correlationFixtures.traceSchema([
          ...correlationFixtures.traceFields.k8s,
          "o2_service_where",
        ]);
      return { data: {} };
    });
  });

  it("picks the scope from the record's spans and shows the version they run", async () => {
    const pod = "c1-openobserve-ingester-7";
    answer([hits({ where_key: "k8s:c1/c1", version: "v1.1.0-rc2", pod, last_seen: 30 })]);
    await render("correlated-traces", podContext);
    expect($("svcver-correlation-rollout-verdict")).not.toBe(null);
    expect($("svcver-correlation-version")?.textContent).toContain("v1.1.0-rc2");
    const versionRead = stream.mock.calls
      .map(([request]: [Request]) => request.queryReq.query)
      .find((query) => query.sql.includes("AS version"));
    expect(versionRead?.sql).toContain(`"service_k8s_pod_name" = '${pod}'`);
    expect(versionRead?.sql).toContain("o2_service_where = 'k8s:c1/c1'");
    expect(versionRead?.start_time).toBe(logTime - fiveMinutes);
    const [read] = whereReads();
    expect(read.queryReq.query.sql).toContain(`"service_k8s_pod_name" = '${pod}'`);
    expect(read.queryReq.query.sql).toContain("LIMIT 2");
    expect(read.queryReq.query.start_time).toBe(logTime - fiveMinutes);
    expect(read.queryReq.query.end_time).toBe(logTime + fiveMinutes);
    expect(stream.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "search", pageType: "traces" }),
    );
    expect(search).not.toHaveBeenCalled();
  });

  // A dimension shared across places (an HTTP method) names none, so the env decides as it would without spans.
  it("falls back to the env when the record's spans name two places", async () => {
    const pod = "c1-openobserve-ingester-7";
    answer([
      hits(
        { where_key: "k8s:c1/c1", version: "v1.1.0-rc2", pod, last_seen: 30 },
        { where_key: "env:dev", version: "v9.0.0", pod, last_seen: 90 },
      ),
    ]);
    await render("correlated-traces", podContext);
    const versionRead = stream.mock.calls
      .map(([request]: [Request]) => request.queryReq.query)
      .find((query) => query.sql.includes("AS version"));
    expect(versionRead?.sql).toContain("o2_service_where = 'env:dev'");
  });
});
