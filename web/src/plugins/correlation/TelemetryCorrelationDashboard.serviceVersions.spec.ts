// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import store from "@/test/unit/helpers/store";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import TelemetryCorrelationDashboard from "./TelemetryCorrelationDashboard.vue";
import { correlationFixtures } from "./correlationVersions.fixtures";
import { serviceKeySql } from "@/utils/serviceCount";

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
const search = vi.hoisted(() => vi.fn());
const stream = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/services/http", () => ({ default: () => transport }));
vi.mock("vue-router", async (original) => ({
  ...(await original<object>()),
  useRoute: () => route,
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), resolve: () => ({ href: "" }) }),
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { search, get_traces: vi.fn(async () => ({ data: { hits: [] } })) },
  });
});
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useServiceCorrelation", async () => {
  const { correlationFixtures } = await import("./correlationVersions.fixtures");
  return {
    useServiceCorrelation: () => ({
      semanticGroups: { value: correlationFixtures.groups },
      loadSemanticGroups: vi.fn(),
    }),
  };
});
vi.mock("@/plugins/traces/TraceDetails.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/plugins/traces/components/TracesSearchResultList.vue", () => ({
  default: {
    name: "TracesSearchResultList",
    props: ["versionColumn"],
    template: "<div data-test='traces-search-result-list' />",
  },
}));
vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: { template: "<div />" },
}));

const versionRows = [
  { version: "v1.1.0-rc2", pod: "c1-openobserve-ingester-7", last_seen: 30 },
  { version: "v1.1.0-rc2", pod: "c1-openobserve-ingester-3", last_seen: 20 },
  { version: "v1.0.0", pod: "c1-openobserve-ingester-1", last_seen: 10 },
];
const props = {
  serviceName: "c1-openobserve-ingester",
  displayServiceName: "ingester",
  serviceDisplay: { display_source: "trace" as const },
  matchedDimensions: {
    service_name: "c1-openobserve-ingester",
    k8s_cluster_name: "c1",
    k8s_namespace_name: "c1",
  },
  availableDimensions: { k8s_pod_name: "c1-openobserve-ingester-7" },
  metricStreams: [],
  logStreams: [],
  traceStreams: [
    { stream_name: "default", stream_type: "traces", filters: { service_name: "ingester" } },
  ],
  sourceEvent: { timestamp: 1_500_000 },
  timeRange: { startTime: 1_000_000, endTime: 2_000_000 },
  mode: "dialog" as const,
};
let wrapper: VueWrapper | undefined;
const stampedFields = [...correlationFixtures.traceFields.k8s, "o2_service_where"];
let schemaFields: string[] = stampedFields;
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

function serve(services: () => Promise<unknown>) {
  transport.get.mockImplementation(async (url: string) => {
    if (url.endsWith("/service_versions/_services")) return services();
    if (url.endsWith("/service_streams/config/identity"))
      return { data: correlationFixtures.identityConfig };
    if (url.startsWith("/api/default/streams/default/schema"))
      return correlationFixtures.traceSchema(schemaFields);
    return { data: {} };
  });
}
async function render(overrides: Record<string, unknown> = {}) {
  wrapper = mount(TelemetryCorrelationDashboard, {
    props: { ...props, ...overrides },
    attachTo: document.body,
    global: {
      plugins: [store],
      stubs: {
        ODrawer: { template: "<div><slot name='header' /><slot /></div>" },
        CorrelationEventHeader: {
          template: "<div><slot name='chip-actions' /></div>",
        },
      },
    },
  });
  await flushPromises();
  await flushPromises();
  return wrapper;
}

type StreamRequest = { queryReq: { query?: { sql?: string }; filter?: string } };
type StreamHandlers = { data: (a: unknown, r: unknown) => void; complete: () => void };
let versionHits: Record<string, unknown>[] = versionRows;
let traceHits: Record<string, unknown>[] = [];
const traceHit = {
  trace_id: "t1",
  start_time: 1_500_000_000,
  end_time: 1_500_100_000,
  duration: 100,
  spans: [1, 0],
  first_event: { service_name: "ingester", operation_name: "GET /" },
  service_name: [{ service_name: "ingester", count: 1, duration: 100 }],
};
const versionSearches = () =>
  stream.mock.calls
    .map(([request]: [StreamRequest]) => request.queryReq.query?.sql ?? "")
    .filter((sql) => sql.includes("AS version"));
const versionSelectOf = (w: VueWrapper) =>
  w
    .findAllComponents(OSelect)
    .find((node) =>
      (node.props("options") as { value: string }[]).some((o) => o.value === "v1.0.0"),
    );
const lastTraceFilter = () =>
  stream.mock.calls
    .map(([request]: [StreamRequest]) => request.queryReq.filter)
    .filter((filter) => filter !== undefined)
    .at(-1);

beforeEach(() => {
  schemaFields = stampedFields;
  Object.assign(route, reactive({ query: {} }));
  serve(async () => ({ data: { services: correlationFixtures.scopes, envs: [] } }));
  versionHits = versionRows;
  traceHits = [];
  search.mockImplementation(async () => ({ data: { hits: [] } }));
  stream.mockImplementation(async (request: StreamRequest, handlers: StreamHandlers) => {
    if (request.queryReq.query?.sql?.includes("AS version"))
      handlers.data(request, {
        type: "search_response_hits",
        content: { results: { hits: versionHits } },
      });
    else if (traceHits.length)
      handlers.data(request, { content: { results: { hits: traceHits } } });
    handlers.complete();
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  queryClient.clear();
  vi.clearAllMocks();
});

describe("correlation drawer service versions", () => {
  it("titles the drawer with the trace name and keeps the detected key muted", async () => {
    await render();
    expect($("svcver-service-name")?.textContent).toContain("Correlated Streams - ingester");
    expect($("svcver-service-name-detected")?.textContent).toBe(
      "detected as c1-openobserve-ingester",
    );
  });

  it("labels the service filter with the display name but keeps the key as its value", async () => {
    const w = await render();
    const select = w
      .findAllComponents(OSelect)
      .find((node) => node.props("modelValue") === "c1-openobserve-ingester");
    expect(select).toBeDefined();
    const options = select!.props("options") as { label: string; value: string }[];
    expect(options).toContainEqual({ label: "ingester", value: "c1-openobserve-ingester" });
    expect($("svcver-correlation-service-note")?.textContent).toBe(
      "trace name · detected as c1-openobserve-ingester",
    );
  });

  it("reads the scope by display name and picks it by cluster and namespace", async () => {
    await render();
    expect(transport.get).toHaveBeenCalledWith(
      "/api/default/service_versions/_services",
      expect.objectContaining({
        params: expect.objectContaining({ signal: "traces", service: "ingester" }),
      }),
    );
    expect($("svcver-correlation-env-chip")).not.toBe(null);
  });

  it("closes the correlation drawer before the verdict chip opens the compare drawer", async () => {
    const w = await render();
    $("svcver-correlation-rollout-verdict")!.click();
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
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

  it.each([
    ["a 403", () => Promise.reject({ isAxiosError: true, response: { status: 403 } })],
    ["no matching scope", async () => ({ data: { services: [], envs: [] } })],
  ])("hides the chips on %s and keeps the drawer", async (_name, services) => {
    serve(services);
    await render();
    expect($("svcver-correlation-env-chip")).toBe(null);
    expect($("svcver-correlation-rollout-verdict")).toBe(null);
    expect($("svcver-service-name")?.textContent).toContain("ingester");
  });

  it("keeps one header in the dialog and none in embedded tabs, whose host draws it", async () => {
    await render();
    expect(document.body.querySelectorAll('[data-test="svcver-correlation-header"]')).toHaveLength(
      1,
    );
    wrapper?.unmount();
    queryClient.clear();
    transport.get.mockClear();
    await render({ mode: "embedded-tabs" });
    expect($("svcver-correlation-header")).toBe(null);
    expect(transport.get).not.toHaveBeenCalledWith(
      "/api/default/service_versions/_services",
      expect.anything(),
    );
  });

  // The same pod name runs a newer version in another place, which must not reach this log's header.
  it.each(["ingester", "Ingester"])(
    "shows the version the spans of this log's applied dimensions run in its own place, titled %s",
    async (display) => {
      const pod = "c1-openobserve-ingester-7";
      const applied = { stream_name: "default", stream_type: "traces", filters: { rack_id: pod } };
      const podRows = [
        { version: "v1.1.0-rc2", pod, last_seen: 30, where: "k8s:c1/c1" },
        { version: "v9.0.0", pod, last_seen: 90, where: "k8s:c2/c1" },
      ];
      stream.mockImplementation(async (request: StreamRequest, handlers: StreamHandlers) => {
        const sql = request.queryReq.query?.sql ?? "";
        const pinned = (row: { where: string }) =>
          !sql.includes("o2_service_where =") || sql.includes(`o2_service_where = '${row.where}'`);
        const hits = sql.includes("o2_service_where =") ? podRows.filter(pinned) : versionRows;
        if (sql.includes("AS version"))
          handlers.data(request, { type: "search_response_hits", content: { results: { hits } } });
        handlers.complete();
      });
      await render({ displayServiceName: display, traceStreams: [applied] });
      expect($("svcver-correlation-version")?.textContent).toContain("v1.1.0-rc2");
      expect($("svcver-correlation-version")?.textContent).not.toContain("0.0.2");
      const instanceRead = versionSearches().find((sql) => sql.includes("o2_service_where ="));
      expect(instanceRead).toContain(`"rack_id" = '${pod}'`);
      expect(instanceRead).toContain(`${serviceKeySql("service_name")} = 'ingester'`);
    },
  );

  it("filters the traces tab on o2_service_version and keeps the service key in the query", async () => {
    traceHits = [traceHit];
    const w = await render();
    await w.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "traces");
    await flushPromises();
    const versionSelect = w
      .findAllComponents(OSelect)
      .find((node) =>
        (node.props("options") as { value: string }[]).some((o) => o.value === "v1.0.0"),
      );
    await versionSelect!.vm.$emit("update:modelValue", "v1.0.0");
    await flushPromises();
    const filters = stream.mock.calls.map(
      ([request]: [{ queryReq: { filter: string } }]) => request.queryReq.filter,
    );
    expect(filters.at(-1)).toBe(`"service_name" = 'ingester' AND o2_service_version = 'v1.0.0'`);
  });

  it("reads the versions over the streaming search, never the one-shot search", async () => {
    await render();
    // The versions list and the version of the log's own instance, each read once.
    expect(versionSearches()).toHaveLength(2);
    expect(search).not.toHaveBeenCalled();
  });

  it("falls back to the service's version and offers no filter when the streamed read comes back partial", async () => {
    stream.mockImplementation(async (request: StreamRequest, handlers: StreamHandlers) => {
      if (request.queryReq.query?.sql?.includes("AS version")) {
        handlers.data(request, {
          type: "search_response_metadata",
          content: { results: { is_partial: true } },
        });
        handlers.data(request, {
          type: "search_response_hits",
          content: { results: { hits: versionRows } },
        });
      }
      handlers.complete();
    });
    const w = await render();
    await w.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "traces");
    await flushPromises();
    expect($("svcver-correlation-version")?.textContent).toContain("0.0.2");
    expect(versionSelectOf(w)).toBeUndefined();
  });

  it("reads versions without a pod column when the trace stream has no Kubernetes attributes", async () => {
    schemaFields = correlationFixtures.traceFields.plain;
    versionHits = versionRows.map(({ version, last_seen }) => ({ version, last_seen }));
    traceHits = [traceHit];
    const w = await render();
    expect(versionSearches()).toHaveLength(1);
    expect(versionSearches()[0]).not.toContain("pod");
    await w.findComponent({ name: "OTabs" }).vm.$emit("update:modelValue", "traces");
    await flushPromises();
    expect(versionSelectOf(w)).toBeDefined();
  });
});

describe("correlation tabs in Source Details", () => {
  const embedded = { mode: "embedded-tabs" as const, externalActiveTab: "traces" };

  it("lists the correlated traces with a Version column", async () => {
    traceHits = [traceHit];
    const w = await render(embedded);
    const lists = w.findAllComponents({ name: "TracesSearchResultList" });
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.map((list) => list.props("versionColumn"))).toEqual(lists.map(() => true));
  });

  it("filters the traces on o2_service_version from the list header and keeps the key", async () => {
    traceHits = [traceHit];
    const w = await render(embedded);
    expect($("svcver-correlation-version-filter")).not.toBe(null);
    await versionSelectOf(w)!.vm.$emit("update:modelValue", "v1.0.0");
    await flushPromises();
    expect(lastTraceFilter()).toBe(`"service_name" = 'ingester' AND o2_service_version = 'v1.0.0'`);
  });
});
