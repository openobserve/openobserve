// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { AxiosError } from "axios";
import type { CompareResponse } from "@/services/service_versions";
import Drawer from "./VersionCompareDrawer.vue";
import Banner from "./VersionVerdictBanner.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import { overlayStep } from "@/services/service_versions.overlay";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import { formatWindow } from "./VersionSummaryTiles.format";
const t = (key: string, values?: Record<string, unknown>) =>
  `${key} ${JSON.stringify(values || {})}`;
const mocks = vi.hoisted(() => ({
  queries: [] as unknown[],
  options: [] as unknown[],
  org: {} as unknown,
  state: {} as unknown,
  incident: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  known: (() => []) as () => readonly string[],
  copy: vi.fn(async () => true),
}));
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => mocks.copy(...(args as [])),
}));
vi.mock("vuex", async (original) => ({
  ...(await original<object>()),
  useStore: () => ({ state: mocks.org }),
}));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options: { value: unknown }) => {
    mocks.options.push(options);
    const next = mocks.queries.shift();
    return typeof next === "function" ? next(options.value) : next;
  },
  useQueryClient: () => ({ removeQueries: mocks.remove }),
  queryOptions: <T>(value: T) => value,
}));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", () => ({
  useVersionCompareDrawer: (known: () => readonly string[]) => {
    mocks.known = known;
    known();
    return {
      state: mocks.state,
      isOpen: computed(() => true),
      update: mocks.update,
      close: vi.fn(),
    };
  },
}));
vi.mock("@/services/service_versions", () => ({
  default: { openIncident: (...args: unknown[]) => mocks.incident(...args) },
}));
vi.mock("../AIObservability/VersionOverlayChart.vue", () => ({
  default: { name: "VersionOverlayChart", template: "<div />" },
}));
vi.mock("@/services/service_versions.queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/service_versions.queries")>()),
  versionsQuery: vi.fn(),
  servicesQuery: vi.fn(),
  compareQuery: vi.fn(),
}));
vi.mock("@/services/service_versions.overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/service_versions.overlay")>()),
  readCompareOverlay: vi.fn(),
}));
vi.mock("@/types/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18nTyped: () => ({
    t: (key: string, values?: Record<string, unknown>) => `${key} ${JSON.stringify(values || {})}`,
  }),
}));
function query(data?: unknown) {
  return {
    data: ref(data),
    isPending: ref(false),
    isError: ref(false),
    isFetching: ref(false),
    error: ref<unknown>(),
    errorUpdatedAt: ref(0),
    refetch: vi.fn(),
  };
}
function result(): CompareResponse {
  return {
    service: "svc",
    where_key: "env:prod",
    env: "prod",
    mode: "concurrent",
    aliases_applied: [],
    arms: {
      a: { version: "v2", start_time: 1, end_time: 2 },
      b: { version: "v1", start_time: 1, end_time: 2 },
    },
    baseline_rule: "canary",
    notes: [],
    stored_verdict: {
      verdict_key: "key",
      version_key: "v",
      service: "svc",
      where_key: "env:prod",
      version: "v2",
      verdict: "insufficient",
      needs: { metric: "requests", have: 61, need: 100 },
    },
  };
}
// A version row as /versions lists it; only the fields the drawer reads.
function row(version: string, key: string, extra: Record<string, unknown> = {}) {
  return {
    version,
    version_key: key,
    scope_key: "s",
    service_name: "svc",
    first_seen: 0,
    last_seen: 1,
    active: true,
    status: "active",
    version_source: "attr",
    signals: { traces: { first_seen: 0, last_seen: 1 } },
    ...extra,
  };
}
const shell = { template: '<div><slot name="header"/><slot/><slot name="actions"/></div>' };
const button = { emits: ["click"], template: "<button @click=\"$emit('click')\"><slot/></button>" };
const stubs = {
  ODrawer: shell,
  OPageHeader: shell,
  OButton: button,
  OSelect: shell,
  OSelectItem: true,
  OSlider: true,
  OSkeleton: true,
  OTabs: shell,
  OTab: true,
  OTag: true,
  OTooltip: shell,
  ODimensionChip: true,
  OBanner: {
    name: "OBanner",
    props: ["variant", "role"],
    template: '<div><slot/><slot name="actions"/></div>',
  },
  ServiceEnvChip: true,
  VersionWhatChanged: true,
  VersionVerdictBanner: true,
  VersionDeltaStrip: true,
  VersionOverlayChart: true,
  RumDrillSections: {
    props: { pages: Boolean, all: Boolean, metric: String },
    template:
      '<div :data-test="pages ? \'drill-pages-stub\' : \'drill-stub\'" :data-all="String(all)" :data-metric="metric" />',
  },
  VersionNotServingPods: { props: ["pods", "total"], template: "<div data-test='pods-stub'/>" },
};
let comparison: ReturnType<typeof query>;
let overlay: ReturnType<typeof query>;
let org: ReturnType<typeof ref>;
let lastGoodScopes: unknown[] = [];
function render(
  data?: CompareResponse,
  versions: unknown[] = [],
  verdicts: unknown[] | ((options: { queryKey: unknown[] }) => unknown[]) = [],
  listed: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  comparison = query(data);
  overlay = query({ a: [], b: [] });
  mocks.queries = [
    query({ versions, ...listed }),
    query({ services: [] }),
    comparison,
    overlay,
    query({ services: lastGoodScopes }),
    query({ versions: [] }),
    typeof verdicts === "function"
      ? (options: { queryKey: unknown[] }) => query({ verdicts: verdicts(options) })
      : query({ verdicts }),
  ];
  return mount(Drawer, { global: { stubs: { ...stubs, ...overrides } } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options = [];
  lastGoodScopes = [];
  org = ref({ selectedOrganization: { identifier: "org" }, userInfo: { email: "user" } });
  mocks.org = org.value;
  mocks.state = ref({
    service: "svc",
    where: "env:prod",
    a: "v2",
    b: undefined,
    baseline: "",
    ambiguous: false,
  });
});
describe("compare drawer states", () => {
  it("shows empty when a required identity is missing", () => {
    mocks.state = ref({ service: "svc", where: "", a: "v2" });
    expect(render().find('[data-test="svcver-empty"]').exists()).toBe(true);
  });
  it("feeds the arm parser the loaded versions without reading them before setup", async () => {
    comparison = query();
    overlay = query({ a: [], b: [] });
    mocks.queries = [
      query({ versions: [{ version: "v1" }, { version: "v2" }] }),
      query({ services: [] }),
      comparison,
      overlay,
      query({ services: [] }),
      query({ versions: [] }),
      query({ verdicts: [] }),
    ];
    mount(Drawer, { global: { stubs } });
    await flushPromises();
    expect(mocks.known()).toEqual(["v1", "v2"]);
  });
  it("shows loading without fabricated values", async () => {
    const wrapper = render();
    comparison.isPending.value = true;
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-loading"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "VersionDeltaStrip" }).exists()).toBe(false);
  });
  it("keeps the verdict and surviving signal on partial errors", async () => {
    const data = result();
    data.traces = { status: "error" };
    data.rum = { status: "ok", views: { a: 0, b: 0 } };
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-section-error"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "VersionVerdictBanner" }).exists()).toBe(true);
    await wrapper.find('[data-test="svcver-signal-rum"]').trigger("click");
    expect(wrapper.find('[data-test="svcver-section-error"]').exists()).toBe(false);
  });
  it("shows denial for 403 and offers retry", async () => {
    const wrapper = render();
    comparison.isError.value = true;
    comparison.error.value = new AxiosError("denied", "403", undefined, undefined, {
      status: 403,
    } as never);
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-denied"]').exists()).toBe(true);
    await wrapper.find('[data-test="svcver-retry"]').trigger("click");
    expect(comparison.refetch).toHaveBeenCalledOnce();
  });
  it("says why Open incident is off on a compare with no stored verdict", () => {
    const data = result();
    data.stored_verdict = undefined;
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-open-incident"]').attributes("disabled")).toBeDefined();
    // A disabled button gets no hover, so a focusable wrapper carries the reason's tooltip.
    const reason = wrapper.get('[data-test="svcver-open-incident-reason"]');
    expect(reason.attributes("tabindex")).toBe("0");
    // OTooltip is a plain shell here, so its props land on the wrapping element.
    const tip = reason.element.parentElement!;
    expect(tip.getAttribute("content")).toMatch(/^serviceVersions.actions.incidentNoVerdict/);
  });
  it("withholds evidence and numbers for restricted results", () => {
    const data = result();
    data.stored_verdict!.restricted = true;
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-restricted"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-overlay"]').exists()).toBe(false);
  });
  it("shows overlay errors and empty states explicitly", async () => {
    const data = result();
    data.traces = { status: "complete", requests: { a: 1, b: 1, rate_a: 1, rate_b: 1 } };
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-overlay-empty"]').exists()).toBe(true);
    overlay.isError.value = true;
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-overlay-error"]').exists()).toBe(true);
  });
  it("reports failed incident mutation", async () => {
    mocks.incident.mockRejectedValueOnce(new Error("failed"));
    const wrapper = render(result());
    await wrapper.find('[data-test="svcver-open-incident"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-incident-status"]').text()).toContain(
      "incident.failed",
    );
  });
  it("ignores incident completion after organization changes", async () => {
    let resolve!: (value: unknown) => void;
    mocks.incident.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = render(result());
    await wrapper.find('[data-test="svcver-open-incident"]').trigger("click");
    org.value.selectedOrganization.identifier = "other";
    await flushPromises();
    resolve({ data: { created: true } });
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-incident-status"]').exists()).toBe(false);
    expect(mocks.remove).toHaveBeenCalled();
  });
  it("keeps the incident status when the same scope is recomputed, and clears it for another version", async () => {
    let resolve!: (value: unknown) => void;
    mocks.incident.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const state = mocks.state as { value: Record<string, unknown> };
    const wrapper = render(result());
    await wrapper.find('[data-test="svcver-open-incident"]').trigger("click");
    state.value = { ...state.value };
    await flushPromises();
    resolve({ data: { created: false } });
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-incident-status"]').text()).toContain(
      "incident.attached",
    );
    state.value = { ...state.value, a: "v3" };
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-incident-status"]').exists()).toBe(false);
  });
});
describe("verdict details", () => {
  it("renders binding sample progress and concurrent fallback source", () => {
    const data = result();
    data.baseline_rule = "env_fallback";
    data.arms.b.where_key = "k8s:remote";
    const wrapper = mount(Banner, {
      props: { result: data },
      global: { stubs: { VerdictChip: true, OProgressBar: true } },
    });
    expect(
      wrapper.find('[data-test="svcver-progress"] o-progress-bar-stub').attributes("value"),
    ).toBe("0.61");
    expect(wrapper.find('[data-test="svcver-baseline-detail"]').text()).toContain("remote");
    expect(wrapper.find('[data-test="svcver-baseline-detail"]').text()).not.toContain("k8s:");
    expect(wrapper.text()).toContain("compare.modeConcurrent");
  });
  it("never shows a waiting count on a decided verdict", () => {
    const data = result();
    data.stored_verdict!.verdict = "regressed";
    data.stored_verdict!.needs = { metric: null, have: null, need: null };
    const wrapper = mount(Banner, {
      props: { result: data },
      global: { stubs: { VerdictChip: true, OProgressBar: true } },
    });
    expect(wrapper.find('[data-test="svcver-progress"]').exists()).toBe(false);
  });
  it("shows readable region chips, never raw JSON", () => {
    const data = result();
    data.stored_verdict!.regions = [
      { cluster: "c1", verdict: "regressed" },
      { cluster: "c2", verdict: "ok" },
    ];
    const wrapper = mount(Banner, {
      props: { result: data },
      global: { stubs: { VerdictChip: true, OProgressBar: true } },
    });
    expect(wrapper.find('[data-test="svcver-region-c1"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain(JSON.stringify(data.stored_verdict!.regions![0]));
  });
  it("renders rollback and Not-serving without fabricating pod evidence", () => {
    const data = result();
    data.stored_verdict!.verdict = "not_serving";
    data.stored_verdict!.deploy = { kind: "rollback", at: 1, from_version: "v3" };
    data.traces = { status: "complete", requests: { a: 0, b: 900, rate_a: 0, rate_b: 3 } };
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-rollback"]').text()).toContain("v3");
    const title = wrapper.find('[data-test="svcver-title"]').text();
    expect(title.indexOf("v1")).toBeLessThan(title.indexOf("v2"));
    expect(title).toContain("compare.rollbackSuffix");
    expect(wrapper.find('[data-test="svcver-not-serving-requests"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-summary-tiles"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-tabs"]').exists()).toBe(false);
    const banner = mount(Banner, {
      props: { result: data },
      global: { stubs: { VerdictChip: true, OProgressBar: true } },
    });
    // The sentence says not serving; with no pod evidence there is no second line saying it again.
    expect(banner.find('[data-test="svcver-not-serving"]').exists()).toBe(false);
  });
});
describe("not-serving pods table", () => {
  function notServing() {
    const data = result();
    data.stored_verdict!.verdict = "not_serving";
    data.stored_verdict!.reason_code = "seen_in_k8s_no_requests";
    data.stored_verdict!.restricted = false;
    data.traces = { status: "complete", requests: { a: 0, b: 900, rate_a: 0, rate_b: 3 } };
    return data;
  }
  const pod = {
    k8s_cluster: "c1",
    k8s_namespace: "otel-demo",
    k8s_pod: "checkout-6c9d7-x2k4p",
    k8s_workload: "checkout",
    k8s_container: "checkout",
    since: 1,
  };
  it("passes the stored verdict's pods and pods_total to the table", () => {
    const data = notServing();
    data.stored_verdict!.pods = [pod];
    data.stored_verdict!.pods_total = 3;
    const wrapper = render(data);
    expect(wrapper.find('[data-test="pods-stub"]').exists()).toBe(true);
    const table = wrapper.findComponent(stubs.VersionNotServingPods);
    expect(table.props("pods")).toEqual([pod]);
    expect(table.props("total")).toBe(3);
  });
  it("shows no table when pods are absent or the source is restricted", () => {
    expect(render(notServing()).find('[data-test="pods-stub"]').exists()).toBe(false);
    const restricted = notServing();
    restricted.stored_verdict!.pods = [pod];
    restricted.stored_verdict!.restricted = true;
    expect(render(restricted).find('[data-test="pods-stub"]').exists()).toBe(false);
  });
});
describe("drawer header and layout", () => {
  it("reads before → after and hides a where chip that repeats the env", () => {
    const wrapper = render(result());
    const title = wrapper.find('[data-test="svcver-title"]').text();
    expect(title.indexOf("v1")).toBeLessThan(title.indexOf("v2"));
    expect(title).toContain("→");
    expect(wrapper.find('[data-test="svcver-where-chip"]').exists()).toBe(true);
  });
  it("names a remote baseline and explains a canary that may drain", () => {
    const data = result();
    expect(render(data).find('[data-test="svcver-canary-fallback"]').exists()).toBe(true);
    data.baseline_rule = "env_fallback";
    data.arms.b.where_key = "k8s:c2/web";
    const wrapper = render(data);
    expect(wrapper.find('[data-test="svcver-baseline-from"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-canary-fallback"]').exists()).toBe(false);
  });
  it("states the fallback window from arm A when the baseline served then", () => {
    const data = result();
    data.arms.a = { version: "v2", start_time: 1_000_030_000_000, end_time: 1_000_060_000_000 };
    comparison = query(data);
    overlay = query({ a: [], b: [] });
    mocks.queries = [
      query({ versions: [{ version: "v1", first_seen: 0 }] }),
      query({ services: [] }),
      comparison,
      overlay,
      query({ services: [] }),
      query({ versions: [] }),
    ];
    const text = mount(Drawer, { global: { stubs } })
      .find('[data-test="svcver-canary-fallback"]')
      .text();
    expect(text).toContain("serviceVersions.compare.canaryFallback {");
    expect(text).toContain('"span":"30s"');
    const late = render(data).find('[data-test="svcver-canary-fallback"]').text();
    expect(late).toContain("serviceVersions.compare.canaryFallbackRule");
  });
  it("adds the last good version to the Why line of a regression only", () => {
    const data = result();
    data.stored_verdict = { ...data.stored_verdict!, verdict: "regressed", needs: null };
    const lastGood = { version: "0.49.2", ran: 9 * 86400 * 1e6 };
    const mountBanner = (value: CompareResponse) =>
      mount(Banner, {
        props: { result: value, lastGood },
        global: { stubs: { VerdictChip: true, OProgressBar: true } },
      });
    const line = mountBanner(data).find('[data-test="svcver-last-good"]');
    expect(line.text()).toContain("0.49.2");
    expect(line.text()).toContain("9 days");
    expect(mountBanner(result()).find('[data-test="svcver-last-good"]').exists()).toBe(false);
  });
  it("names the last good build's image when it shares the compared version text", () => {
    const data = result();
    data.stored_verdict = { ...data.stored_verdict!, verdict: "regressed", needs: null };
    data.arms.a = { ...data.arms.a, image: "9c1e4b7" };
    const line = (lastGood: { version: string; image: string | null }) =>
      mount(Banner, {
        props: { result: data, lastGood },
        global: { stubs: { VerdictChip: true, OProgressBar: true } },
      })
        .get('[data-test="svcver-last-good"]')
        .text();
    expect(line({ version: "v2", image: "3f9c2ab" })).toContain(
      'v2 · serviceVersions.image.short {"image":"3f9c2ab"}',
    );
    expect(line({ version: "v1", image: "3f9c2ab" })).not.toContain("serviceVersions.image.short");
  });
});
describe("RUM-only drawer", () => {
  const e2 = () => structuredClone(golden.compare_e2) as unknown as CompareResponse;
  it("stays RUM-only on the compare the drawer asks for, which also carries an empty traces section", async () => {
    const web = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
    expect(web.traces?.requests).toMatchObject({ a: 0, b: 0 });
    const wrapper = render(web);
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-open-service"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-tab-all-pages"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-tab-all-endpoints"]').exists()).toBe(false);
    const shown = wrapper.findComponent({ name: "VersionWhatChanged" }).props("result");
    expect(shown.traces).toBeUndefined();
    expect(shown.rum).toEqual(web.rum);
  });
  it("keeps Open service when the version also sends traces, even with none in these windows", async () => {
    const web = structuredClone(golden.compare_e2_web) as unknown as CompareResponse;
    const row = { version: "v2", signals: { traces: { first_seen: 1, last_seen: 2 }, rum: null } };
    const wrapper = render(web, [row]);
    await flushPromises();
    expect(wrapper.find('[data-test="svcver-open-service"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-tab-all-pages"]').exists()).toBe(false);
  });
  it("hides drill evidence from a restricted reader", () => {
    const value = e2();
    value.stored_verdict = { ...value.stored_verdict!, restricted: true };
    const wrapper = render(value);
    expect(wrapper.find('[data-test="drill-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="drill-pages-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-rum-chart"]').exists()).toBe(false);
  });
  it("draws the RUM before/after chart between the tiles and the drill sections", async () => {
    const wrapper = render(e2());
    await flushPromises();
    const html = wrapper.html();
    const chart = wrapper.find('[data-test="svcver-rum-chart"]');
    expect(chart.exists()).toBe(true);
    expect(html.indexOf('data-test="svcver-summary-tiles"')).toBeLessThan(
      html.indexOf('data-test="svcver-rum-chart"'),
    );
    expect(html.indexOf('data-test="svcver-rum-chart"')).toBeLessThan(
      html.indexOf('data-test="drill-stub"'),
    );
    expect(chart.attributes("data-metric")).toBe("inp_p75");
    expect(wrapper.find('[data-test="svcver-overlay"]').exists()).toBe(false);
    await wrapper.find('[data-test="svcver-metric-cls_p75"]').trigger("click");
    expect(wrapper.find('[data-test="svcver-rum-chart"]').attributes("data-metric")).toBe(
      "cls_p75",
    );
    expect(wrapper.find('[data-test="drill-stub"]').attributes("data-metric")).toBe("cls_p75");
  });
  it("retries the compare from a failed RUM series read", async () => {
    const value = e2();
    value.rum_series = {
      ...value.rum_series!,
      status: "timeout",
      reason: "timeout",
      a: null,
      b: null,
    };
    const wrapper = render(value);
    await flushPromises();
    await wrapper.find('[data-test="svcver-rum-chart-retry"]').trigger("click");
    expect(comparison.refetch).toHaveBeenCalledTimes(1);
  });
  it("keeps the traces overlay and no RUM chart for a service with traces", () => {
    const wrapper = render(result());
    expect(wrapper.find('[data-test="svcver-rum-chart"]').exists()).toBe(false);
  });
});
describe("first version drawer", () => {
  // A real producer's first-version compare, plus a known and an unknown note.
  function first(): CompareResponse {
    const produced = structuredClone(producer.first_version) as unknown as CompareResponse;
    return {
      ...result(),
      ...produced,
      notes: [...produced.notes, "baseline_unavailable", "an_unknown_note"],
    };
  }
  it("maps notes to copy and never prints a raw note", () => {
    const wrapper = render(first());
    expect(wrapper.find('[data-test="svcver-note-0"]').text()).toContain(
      "serviceVersions.compare.notes.baselineUnavailable",
    );
    expect(wrapper.find('[data-test="svcver-note-1"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("no_previous_version");
    expect(wrapper.text()).not.toContain("an_unknown_note");
  });
  it("draws no before series or legend and asks for a baseline instead of a verdict", async () => {
    const wrapper = render(first());
    overlay.data.value = { a: [{ x: 2, y: 1 }], b: [{ x: 1, y: 1 }] };
    await flushPromises();
    const chart = wrapper.findComponent({ name: "VersionOverlayChart" });
    const attrs = chart.vm.$attrs as Record<string, unknown>;
    expect(attrs["series-b"] ?? attrs.seriesB).toEqual([]);
    expect(wrapper.find('[data-test="svcver-overlay-legend-before"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-overlay-hint"]').text()).toContain(
      "serviceVersions.compare.chartHintFirst",
    );
  });
  it("labels the missing baseline instead of leaving an empty version", () => {
    const auto = render(first())
      .findAllComponents({ name: "OSelectItem" })
      .find((item) => item.props("value") === "auto");
    expect(String(auto?.props("label"))).toContain("serviceVersions.compare.baselineAutoNone");
  });
});
describe("requests overlay", () => {
  // Five-minute arms: requests per bucket must read per minute on the axis.
  function fiveMinutes() {
    const data = result();
    data.mode = "sequential";
    data.arms.b = { version: "v1", start_time: 0, end_time: 300e6 };
    data.arms.a = { version: "v2", start_time: 300e6, end_time: 600e6 };
    data.traces = { status: "complete", requests: { a: 3480, b: 3600, rate_a: 11.6, rate_b: 12 } };
    return data;
  }
  it("labels the axis in requests per minute from the bucket width", async () => {
    const data = fiveMinutes();
    data.stored_verdict!.verdict = "not_serving";
    const wrapper = render(data);
    overlay.data.value = { a: [{ x: 300000, y: 58 }], b: [{ x: 0, y: 60 }] };
    await flushPromises();
    const attrs = wrapper.findComponent({ name: "VersionOverlayChart" }).vm.$attrs as Record<
      string,
      unknown
    >;
    const formatY = (attrs["format-y"] ?? attrs.formatY) as (value: number) => string;
    const perBucket = 3480 / (300 / overlayStep(data));
    expect(formatY(perBucket)).toBe("696");
  });
  it("draws a version that served nothing as a line at zero across its window", async () => {
    const data = fiveMinutes();
    data.stored_verdict!.verdict = "not_serving";
    const wrapper = render(data);
    overlay.data.value = { a: [], b: [{ x: 0, y: 12 }] };
    await flushPromises();
    const attrs = wrapper.findComponent({ name: "VersionOverlayChart" }).vm.$attrs as Record<
      string,
      unknown
    >;
    expect(attrs["series-a"] ?? attrs.seriesA).toEqual([
      { x: 300000, y: 0 },
      { x: 600000, y: 0 },
    ]);
  });
});
describe("drawer baseline, failure and canary notices", () => {
  it("names a picked baseline as picked by you, never by the stored rule", () => {
    const data = result();
    data.baseline_rule = "manual";
    data.stored_verdict!.baseline = { version: "v1", rule: "none" };
    const items = render(data, [row("v1", "k1"), row("v2", "k2")]).findAllComponents({
      name: "OSelectItem",
    });
    const picked = items.find((item) => item.props("value") === "k1");
    expect(String(picked?.props("label"))).toContain(
      '"rule":"serviceVersions.compare.baselineRule.manual',
    );
    const auto = items.find((item) => item.props("value") === "auto");
    expect(String(auto?.props("label"))).toBe("serviceVersions.compare.auto {}");
  });
  it("tells a draining canary in the neutral notice, not a blue banner", () => {
    const notice = render(result()).get('[data-test="svcver-canary-fallback"]');
    expect(notice.attributes("role")).toBe("status");
    expect(notice.classes()).toContain("border-border-default");
  });
});
// The real verdicts read for a deploy, reshaped per case, behind a compare that failed.
function storedVerdict() {
  return structuredClone(producer.stored_verdicts.verdicts[0]) as unknown as NonNullable<
    CompareResponse["stored_verdict"]
  >;
}
async function failed(
  shape: (stored: ReturnType<typeof storedVerdict>) => void = () => {},
  failedAt?: number,
) {
  const stored = storedVerdict();
  shape(stored);
  const deployKey = stored.deploy_key!;
  mocks.state = ref({ service: "svc", where: "env:prod", a: "1.5.0", deployKey });
  const deploy = {
    at: stored.deploy!.at,
    kind: "deploy",
    from_version: "1.4.0",
    deploy_key: deployKey,
  };
  const row = { version: "1.5.0", version_key: stored.version_key, deploys: [deploy] };
  const wrapper = render(undefined, [row], [stored]);
  comparison.isError.value = true;
  comparison.error.value = new Error("timeout");
  comparison.errorUpdatedAt.value = failedAt ?? stored.deploy!.at / 1000 + 600_000;
  await flushPromises();
  return wrapper;
}
describe("a failed compare keeps the exact transition's stored verdict", () => {
  it("reads the earlier of two deploys of one version by its deploy key", async () => {
    const earlier = storedVerdict();
    const later = {
      ...storedVerdict(),
      verdict_key: "later",
      deploy_key: "deploy-later",
      verdict: "ok" as const,
      reason_code: "below_min_effect",
      deploy: { ...earlier.deploy!, at: earlier.deploy!.at + 86400e6 },
    };
    expect(earlier.verdict).not.toBe("ok");
    mocks.state = ref({
      service: "svc",
      where: "env:prod",
      a: "1.5.0",
      deployKey: earlier.deploy_key,
    });
    const row = { version: "1.5.0", version_key: earlier.version_key };
    // The by-version read summarises the newest transition only, as signals/reads.rs groups it.
    const wrapper = render(undefined, [row], ({ queryKey }) =>
      queryKey.includes(earlier.deploy_key) ? [earlier] : [later],
    );
    comparison.isError.value = true;
    comparison.error.value = new Error("timeout");
    await flushPromises();
    const options = (mocks.options.at(-1) as { value: { queryKey: unknown[]; enabled: boolean } })
      .value;
    expect(options.queryKey).toContain(earlier.deploy_key);
    expect(options.enabled).toBe(true);
    expect(wrapper.get('[data-test="svcver-stored-sentence"]').text()).toContain(
      `serviceVersions.sentence.${earlier.verdict}`,
    );
  });
  it("reads the newest transition when the link pins no deploy", async () => {
    const stored = storedVerdict();
    const row = { version: "v2", version_key: stored.version_key };
    const wrapper = render(undefined, [row], [stored]);
    comparison.isError.value = true;
    comparison.error.value = new Error("timeout");
    await flushPromises();
    const options = (mocks.options.at(-1) as { value: { queryKey: unknown[] } }).value;
    expect(options.queryKey).toContainEqual([stored.version_key]);
    expect(wrapper.find('[data-test="svcver-stored-verdict"]').exists()).toBe(true);
  });
});
describe("a failed compare shows only the windows the verdict judged", () => {
  const minute = 60e6;
  it("names a canary's concurrent windows, not windows either side of the deploy", async () => {
    let at = 0;
    const wrapper = await failed((stored) => {
      at = stored.deploy!.at;
      stored.windows = {
        a: { start_time: at + minute, end_time: at + 31 * minute },
        b: { start_time: at + minute, end_time: at + 31 * minute },
      };
    });
    const window = JSON.stringify(formatWindow(at + minute, at + 31 * minute, t as never));
    const line = wrapper.get('[data-test="svcver-stored-windows"]').text();
    expect(line).toContain(`"beforeWindow":${window}`);
    expect(line).toContain(`"afterWindow":${window}`);
    expect(wrapper.get('[data-test="svcver-error"]').text()).toContain(`"window":${window}`);
  });
  it("keeps a frozen verdict's old windows, never stretched to the failure time", async () => {
    let at = 0;
    const wrapper = await failed((stored) => {
      at = stored.deploy!.at;
      stored.windows = {
        a: { start_time: at, end_time: at + 30 * minute },
        b: { start_time: at - 30 * minute, end_time: at },
      };
    }, 0);
    comparison.errorUpdatedAt.value = (at + 3 * 86400e6) / 1000;
    await flushPromises();
    const window = JSON.stringify(formatWindow(at - 30 * minute, at + 30 * minute, t as never));
    expect(wrapper.get('[data-test="svcver-error"]').text()).toContain(`"window":${window}`);
    expect(wrapper.get('[data-test="svcver-stored-windows"]').text()).toContain(
      JSON.stringify(formatWindow(at, at + 30 * minute, t as never)),
    );
  });
  it("names no window when the verdict stored none", async () => {
    const wrapper = await failed((stored) => {
      stored.windows = undefined;
    });
    expect(wrapper.find('[data-test="svcver-stored-sentence"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-stored-windows"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="svcver-error"]').text()).toContain(
      "serviceVersions.compare.detailsFailedBare",
    );
  });
});
describe("drawer header reads baseline → compared", () => {
  const title = (wrapper: ReturnType<typeof render>) =>
    wrapper.get('[data-test="svcver-title"]').text();
  it("keeps the stored baseline in the header when the compare fails", async () => {
    const wrapper = await failed();
    const text = title(wrapper);
    expect(text).toContain("1.4.0");
    expect(text.indexOf("1.4.0")).toBeLessThan(text.indexOf("1.5.0"));
    expect(text).toContain("→");
  });
});
describe("Open incident on a failed compare", () => {
  it("stays enabled on a stored Regressed and opens it from the stored verdict", async () => {
    mocks.incident.mockResolvedValueOnce({ data: { created: true } });
    const wrapper = await failed((stored) => {
      stored.verdict = "regressed";
      stored.env = "prod";
    });
    const button = wrapper.get('[data-test="svcver-open-incident"]');
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    await flushPromises();
    const body = mocks.incident.mock.calls[0][1];
    expect(body.verdict_key).toBe(producer.stored_verdicts.verdicts[0].verdict_key);
    expect(body).toMatchObject({ version: "1.5.0", baseline_version: "1.4.0", env: "prod" });
  });
});
describe("baseline from another where", () => {
  it("names the new where in the picker's rule, not the facet label", () => {
    const data = result();
    data.baseline_rule = "env_fallback";
    data.where_key = "k8s:stage6/new-web";
    data.arms.b.where_key = "k8s:stage6/web";
    const auto = render(data)
      .findAllComponents({ name: "OSelectItem" })
      .find((item) => item.props("value") === "auto");
    expect(String(auto?.props("label"))).toContain(
      'serviceVersions.compare.baselineRule.env_fallback {\\"where\\":\\"stage6 · new-web\\"}',
    );
  });
  it("uses the shared where scope chip, labelled baseline from", () => {
    const data = result();
    data.baseline_rule = "env_fallback";
    data.arms.b.where_key = "k8s:c2/web";
    const chip = render(data)
      .get('[data-test="svcver-baseline-from"]')
      .findComponent(ServiceScopeChip);
    expect(chip.props("facet")).toBe("where");
    expect(chip.props("value")).toBe("c2 · web");
    expect(chip.attributes("label") ?? chip.props("label")).toContain(
      "serviceVersions.compare.baselineFromChip",
    );
  });
});
describe("no-verdict states", () => {
  function firstLook(): CompareResponse {
    const data = result();
    data.stored_verdict = undefined;
    data.baseline_rule = "none";
    data.arms.b = { version: "", start_time: 1, end_time: 2 };
    data.live_verdict = {
      verdict_key: "live",
      version_key: "v",
      service: "svc",
      where_key: "env:prod",
      version: "v2",
      verdict: "insufficient",
      state: "evaluating",
      reason_code: "no_previous_version",
    };
    data.traces = { status: "complete", requests: { a: 900, b: 0, rate_a: 3, rate_b: 0 } };
    return data;
  }
  const tracking = { epoch: 1_793_586_540_000_000, warmup_ends_at: 1_793_587_020_000_000 };
  it("opens a pre-existing deploy as Pre-existing, never First version", () => {
    mocks.state = ref({ service: "svc", where: "env:prod", a: "v2", deployKey: "pre" });
    const deploys = [{ deploy_key: "pre", kind: "pre_existing", at: 1, from_version: null }];
    const wrapper = render(firstLook(), [row("v2", "k2", { deploys })], [], { tracking });
    const notice = wrapper.get('[data-test="svcver-no-verdict"]');
    expect(notice.text()).toContain("serviceVersions.sentence.preExistingSince");
    expect(notice.find("o-tag-stub").attributes("value")).toBe("pre_existing");
    expect(wrapper.findComponent({ name: "VersionVerdictBanner" }).exists()).toBe(false);
  });
  it("says warming up with no chip, counts or tables while the org has no tracking epoch", () => {
    const wrapper = render(firstLook(), [row("v2", "k2")], [], {
      tracking: { epoch: null, warmup_ends_at: null },
    });
    const notice = wrapper.get('[data-test="svcver-no-verdict"]');
    expect(notice.text()).toBe("serviceVersions.catalog.warmingUpNoEpoch {}");
    expect(notice.find("o-tag-stub").exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-summary-tiles"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-tabs"]').exists()).toBe(false);
  });
  it("says warming up until its end time for a scope the API reports as not tracked yet", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tracking.warmup_ends_at / 1000 - 60_000);
    const rows = [row("v2", "k2", { tracking_started: false })];
    const wrapper = render(firstLook(), rows, [], { tracking });
    vi.useRealTimers();
    const notice = wrapper.get('[data-test="svcver-no-verdict"]').text();
    expect(notice).toMatch(/^serviceVersions\.catalog\.warmingUp \{"time":"[^"]+"\}$/);
    expect(wrapper.text()).not.toContain("firstVersion");
  });
  it("drops the warm-up time once it has passed while the scope is still not tracked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(tracking.warmup_ends_at / 1000 + 90 * 60_000);
    const rows = [row("v2", "k2", { tracking_started: false })];
    const wrapper = render(firstLook(), rows, [], { tracking });
    vi.useRealTimers();
    expect(wrapper.get('[data-test="svcver-no-verdict"]').text()).toBe(
      "serviceVersions.catalog.warmingUpNoEpoch {}",
    );
  });
  it("shows a window with no rollup rows as missing data, never 0 and 0 requests", () => {
    const data = result();
    data.stored_verdict = undefined;
    data.baseline_rule = "manual";
    data.arms.a = { ...data.arms.a, has_rollup: false };
    data.arms.b = { ...data.arms.b, has_rollup: false };
    data.traces = { status: "insufficient", requests: { a: 0, b: 0, rate_a: 0, rate_b: 0 } };
    const wrapper = render(data, [row("v1", "k1"), row("v2", "k2")], [], { tracking });
    expect(wrapper.get('[data-test="svcver-no-verdict"]').text()).toContain("warmingUp");
    expect(wrapper.find('[data-test="svcver-summary-tiles"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("requestsPair");
  });
  it("keeps a real zero from rollup rows as a count", () => {
    const data = result();
    data.arms.a = { ...data.arms.a, has_rollup: true };
    data.traces = { status: "complete", requests: { a: 0, b: 0, rate_a: 0, rate_b: 0 } };
    const wrapper = render(data, [row("v1", "k1"), row("v2", "k2")], [], { tracking });
    expect(wrapper.find('[data-test="svcver-no-verdict"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-summary-tiles"]').exists()).toBe(true);
  });
});
describe("baseline picker", () => {
  it("lists each version once, never the compared one, and the auto label once", () => {
    const data = result();
    data.baseline_rule = "previous";
    const versions = [row("v1", "k1"), row("v1", "k1-other"), row("v2", "k2"), row("v0", "k0")];
    const items = render(data, versions).findAllComponents({ name: "OSelectItem" });
    const values = items.map((item) => item.props("value"));
    expect(values).toEqual(["auto", "canary", "previous", "k1", "k0"]);
    const labels = items.map((item) => String(item.props("label")));
    expect(labels.filter((label) => label === labels[0])).toHaveLength(1);
    expect(labels[3]).toBe("v1");
  });
});
describe("RUM tab without browser data", () => {
  it("shows one notice and no drill tables when no version sent RUM", async () => {
    const data = result();
    data.traces = { status: "complete", requests: { a: 10, b: 10, rate_a: 1, rate_b: 1 } };
    data.rum = { status: "insufficient", views: { a: 0, b: 0 } };
    data.rum_breakdown = { status: "ok", reason: null, error: null, dims: {} };
    data.pages = { status: "insufficient", reason: "detail_coarse", error: null };
    const wrapper = render(data, [row("v1", "k1"), row("v2", "k2")]);
    await wrapper.find('[data-test="svcver-signal-rum"]').trigger("click");
    expect(wrapper.findAll('[data-test="svcver-rum-not-collected"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="drill-stub"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="drill-pages-stub"]').exists()).toBe(false);
  });
});
describe("drawer accessibility and copy", () => {
  it("names the drawer from its title", () => {
    const wrapper = render(result());
    expect(wrapper.get('[data-test="svcver-drawer"]').attributes("title")).toBe("svc v1 → v2");
  });
  it("copies the link through the app's clipboard helper with its notify", async () => {
    const wrapper = render(result());
    await wrapper.get('[data-test="svcver-copy-link"]').trigger("click");
    await flushPromises();
    expect(mocks.copy).toHaveBeenCalledWith(window.location.href, expect.any(Function));
  });
});
describe("pickers never offer an unversioned row", () => {
  it("leaves the blank version out of the baseline picker", () => {
    const data = result();
    data.baseline_rule = "previous";
    const versions = [row("", "k-none"), row("v1", "k1"), row("v2", "k2")];
    const values = render(data, versions)
      .findAllComponents({ name: "OSelectItem" })
      .map((item) => item.props("value"));
    expect(values).toEqual(["auto", "canary", "previous", "k1"]);
  });
});
describe("a no-verdict drawer's picker uses the no-verdict wording", () => {
  const autoLabel = (wrapper: ReturnType<typeof render>) =>
    String(
      wrapper
        .findAllComponents({ name: "OSelectItem" })
        .find((item) => item.props("value") === "auto")!
        .props("label"),
    );
  const firstLook = () => {
    const data = result();
    data.stored_verdict = undefined;
    data.baseline_rule = "none";
    data.arms.b = { version: "", start_time: 1, end_time: 2 };
    data.live_verdict = {
      verdict_key: "live",
      version_key: "v",
      service: "svc",
      where_key: "env:prod",
      version: "v2",
      verdict: "insufficient",
      state: "evaluating",
      reason_code: "no_previous_version",
    };
    return data;
  };
  const tracking = { epoch: 1_000_000, warmup_ends_at: 2_000_000 };
  it("names a warming scope as warming up", () => {
    const rows = [row("v2", "k2", { tracking_started: false })];
    const label = autoLabel(render(firstLook(), rows, [], { tracking }));
    expect(label).toContain("baselineRule.warming_up");
    expect(label).not.toContain("baselineRule.none");
  });
  it("keeps first version for a real first version", () => {
    expect(autoLabel(render(firstLook(), [row("v2", "k2")], [], { tracking }))).toContain(
      "baselineRule.none",
    );
  });
});
describe("not-serving note", () => {
  function notServing(requests: number, reason: string) {
    const data = result();
    data.stored_verdict = {
      ...data.stored_verdict!,
      verdict: "not_serving",
      reason_code: reason,
    };
    data.traces = { status: "complete", requests: { a: requests, b: 900, rate_a: 1, rate_b: 1 } };
    return render(data, [row("v1", "k1"), row("v2", "k2")]);
  }
  it("says nothing to compare only when the version has no requests", () => {
    expect(notServing(0, "seen_in_k8s_no_requests").text()).toContain("notServingNote");
    expect(notServing(1440, "traffic_drop").text()).not.toContain("notServingNote");
  });
});
describe("a compare section that timed out or failed", () => {
  // The producer's deadline and failure shapes (signals/api.rs section_result); RUM beside them is the recorded r2f shape.
  const TIMEOUT = { status: "timeout", insufficient: true, reason: "timeout" } as const;
  const ERROR = { status: "error", insufficient: true, reason: "query_failed" } as const;
  function failed(section: typeof TIMEOUT | typeof ERROR, verdict = "not_serving") {
    const data = result();
    data.stored_verdict = {
      ...data.stored_verdict!,
      verdict: verdict as "not_serving",
      reason_code: verdict === "not_serving" ? "traffic_drop" : "within_noise",
      sample: { n_new: 53400, n_base: 50100, since: 1 },
      signal: "traces",
    };
    data.traces = { ...section };
    data.rum = {
      status: "complete",
      insufficient: true,
      reason: "below_min_count",
      views: { a: 0, b: 0 },
      session_windows: { a: 0, b: 0 },
    };
    return render(
      data,
      [row("v1", "k1"), row("v2", "k2")],
      [],
      {},
      { VersionVerdictBanner: false },
    );
  }
  for (const [name, section] of [
    ["timeout", TIMEOUT],
    ["error", ERROR],
  ] as const) {
    it(`claims no traffic and shows only Comparison unavailable on the ${name} shape`, () => {
      const wrapper = failed(section);
      const text = wrapper.text();
      expect(wrapper.find('[data-test="svcver-section-error"]').text()).toContain(
        "serviceVersions.compare.error",
      );
      expect(wrapper.find('[data-test="svcver-section-retry"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="svcver-not-serving-requests"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="svcver-overlay"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="svcver-tabs"]').exists()).toBe(false);
      for (const claim of [
        "requestsOf",
        "notServingNote",
        "requestsPair",
        "viewsPair",
        "sessionsPair",
      ])
        expect(text).not.toContain(claim);
      expect(wrapper.get('[data-test="svcver-baseline-detail"]').text()).toContain(
        "serviceVersions.compare.windowLine",
      );
    });
    it(`keeps the stored headline without counts from the failed read on the ${name} shape`, () => {
      const wrapper = failed(section, "ok");
      expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toContain('"n":"53.4K"');
      expect(wrapper.get('[data-test="svcver-baseline-detail"]').text()).toMatch(
        /^serviceVersions\.compare\.windowLine(Unequal)?Bare /,
      );
      expect(wrapper.find('[data-test="svcver-section-error"]').exists()).toBe(true);
    });
  }
  it("still counts a measured zero from a section that loaded", () => {
    const data = result();
    data.stored_verdict = { ...data.stored_verdict!, verdict: "not_serving", reason_code: "x" };
    data.traces = { status: "complete", requests: { a: 0, b: 4560, rate_a: 0, rate_b: 1 } };
    const wrapper = render(data, [row("v1", "k1"), row("v2", "k2")]);
    expect(wrapper.find('[data-test="svcver-not-serving-requests"]').text()).toContain(
      "notServingNote",
    );
    expect(wrapper.find('[data-test="svcver-section-error"]').exists()).toBe(false);
  });
});

describe("image builds of one version", () => {
  const rebuild = (): CompareResponse => {
    const data = result();
    data.arms.a = { version: "2.4.0", image: "9c1e4b7", start_time: 1, end_time: 2 };
    data.arms.b = { version: "2.4.0", image: "3f9c2ab", start_time: 1, end_time: 2 };
    return data;
  };
  // Eight builds of 2.4.0 and one plain 2.3.9, as the versions list returns them.
  const builds = [
    ...["9c1e4b7", "3f9c2ab", "77de019", "a01c3f2", "5be2d90", "1111111", "2222222", "3333333"].map(
      (image, index) =>
        row("2.4.0", `k-${image}`, { image, version_images: 8, first_seen: 100 - index }),
    ),
    row("2.3.9", "k-239", { image: "abcdef0", version_images: 1, first_seen: 10 }),
  ];

  it("names both builds in the header with their image short", async () => {
    mocks.state = ref({ service: "svc", where: "env:prod", a: "2.4.0", aImage: "9c1e4b7" });
    const wrapper = render(rebuild(), builds);
    await flushPromises();
    const title = wrapper.get('[data-test="svcver-title"]');
    const images = title.findAll('[data-test="svcver-version-image"]').map((node) => node.text());
    expect(images).toHaveLength(2);
    expect(images[0]).toContain('"image":"3f9c2ab"');
    expect(images[1]).toContain('"image":"9c1e4b7"');
  });

  it("names each build in the chart legend and series as the tiles legend does", async () => {
    mocks.state = ref({ service: "svc", where: "env:prod", a: "2.4.0", aImage: "9c1e4b7" });
    const data = rebuild();
    data.traces = { status: "complete", requests: { a: 1, b: 1, rate_a: 1, rate_b: 1 } };
    const wrapper = render(data, builds);
    overlay.data.value = { a: [{ x: 2, y: 1 }], b: [{ x: 1, y: 1 }] };
    await flushPromises();
    const before = wrapper.get('[data-test="svcver-overlay-legend-before"]').text();
    expect(before).toContain("3f9c2ab");
    expect(wrapper.get('[data-test="svcver-overlay-legend"]').text()).toContain("9c1e4b7");
    const chart = wrapper.findComponent({ name: "VersionOverlayChart" });
    const attrs = chart.vm.$attrs as Record<string, unknown>;
    expect(String(attrs["version-b"] ?? attrs.versionB)).toContain('"image":"3f9c2ab"');
    expect(String(attrs["version-a"] ?? attrs.versionA)).toContain('"image":"9c1e4b7"');
  });

  it("keeps the last good build that only shares the compared version text, never the compared build", async () => {
    mocks.state = ref({ service: "svc", where: "env:prod", a: "2.4.0", aImage: "9c1e4b7" });
    const lastGood = async (image: string) => {
      lastGoodScopes = [
        {
          service: "svc",
          where_key: "env:prod",
          last_good_version: "2.4.0",
          last_good_image: image,
        },
      ];
      const wrapper = render(rebuild(), builds);
      await flushPromises();
      return wrapper.findComponent({ name: "VersionVerdictBanner" }).props("lastGood");
    };
    expect(await lastGood("3f9c2ab")).toEqual({
      version: "2.4.0",
      image: "3f9c2ab",
      ran: undefined,
    });
    expect(await lastGood("9c1e4b7")).toBeUndefined();
  });

  it("lists at most five builds per version, never the compared one, then one more line", async () => {
    mocks.state = ref({ service: "svc", where: "env:prod", a: "2.4.0", aImage: "9c1e4b7" });
    const wrapper = render(rebuild(), builds);
    await flushPromises();
    const options = wrapper
      .findAll('[data-test^="svcver-baseline-option-k-"]')
      .map((node) => node.attributes("data-test"));
    expect(options).toEqual([
      "svcver-baseline-option-k-3f9c2ab",
      "svcver-baseline-option-k-77de019",
      "svcver-baseline-option-k-a01c3f2",
      "svcver-baseline-option-k-5be2d90",
      "svcver-baseline-option-k-1111111",
      "svcver-baseline-option-k-239",
    ]);
    const more = wrapper.get('[data-test="svcver-baseline-more"]');
    expect(more.attributes("label")).toContain('"count":2');
    expect(more.attributes("label")).toContain('"version":"2.4.0"');
    expect(wrapper.get('[data-test="svcver-baseline-option-k-239"]').attributes("label")).toBe(
      "2.3.9",
    );
  });

  it("names a picked build with its image short in the baseline label", async () => {
    mocks.state = ref({
      service: "svc",
      where: "env:prod",
      a: "2.4.0",
      aImage: "9c1e4b7",
      b: "2.4.0",
      bImage: "3f9c2ab",
    });
    const data = rebuild();
    data.baseline_rule = "manual";
    const wrapper = render(data, builds);
    await flushPromises();
    const label = wrapper.get('[data-test="svcver-baseline-option-k-3f9c2ab"]').attributes("label");
    expect(label).toContain("serviceVersions.compare.baselineRule.manual");
    expect(label).toContain("3f9c2ab");
  });

  it("asks the server for the picked builds and keeps the picked image in the URL", async () => {
    const { compareQuery } = await import("@/services/service_versions.queries");
    mocks.state = ref({
      service: "svc",
      where: "env:prod",
      a: "2.4.0",
      aImage: "9c1e4b7",
      b: "2.4.0",
      bImage: "3f9c2ab",
    });
    const wrapper = render(rebuild(), builds);
    await flushPromises();
    for (const options of mocks.options) void (options as { value: unknown }).value;
    const body = vi.mocked(compareQuery).mock.calls.at(-1)?.[2];
    expect(body?.a).toEqual(expect.objectContaining({ version: "2.4.0", image: "9c1e4b7" }));
    expect(body?.b).toEqual({ version: "2.4.0", image: "3f9c2ab" });
    (wrapper.vm as unknown as { baseline: (value: string) => void }).baseline("k-77de019");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ cmp: "2.4.0..2.4.0", cmpImgB: "77de019" }),
    );
  });
});
describe("a scope outside Kubernetes", () => {
  it("labels the where chip with the shared Outside Kubernetes label, never default", () => {
    mocks.state = ref({ service: "svc", where: "default", a: "v2", baseline: "" });
    const data = result();
    data.where_key = "default";
    const chip = render(data).getComponent(ServiceScopeChip);
    expect(chip.props("whereKey")).toBe("default");
    const value = chip.getComponent(ODimensionChip).props("value");
    expect(value).toContain("serviceVersions.where.outside");
    expect(value).not.toMatch(/default/i);
  });
});
