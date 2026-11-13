// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { ref } from "vue";
import Card from "./ServicePanelVerdictCard.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
const mocks = vi.hoisted(() => ({
  query: {} as any,
  lastGood: undefined as { version: string } | undefined,
  options: [] as any[],
  incident: vi.fn(),
  open: vi.fn(),
  copy: vi.fn(async () => true),
}));
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => mocks.copy(...(args as [])),
}));
vi.mock("@tanstack/vue-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: unknown) => {
    mocks.options.push(options);
    return mocks.query;
  },
}));
vi.mock("@/services/service_versions", () => ({ default: { openIncident: mocks.incident } }));
vi.mock("./useLastGood", async () => {
  const { computed } = await import("vue");
  return { useLastGood: () => computed(() => mocks.lastGood) };
});
vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: ref({ query: {} }),
    resolve: () => ({ href: "/web/traces?cmp=v2" }),
  }),
}));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", async (original) => ({
  ...(await original<object>()),
  useVersionCompareDrawer: () => ({ open: mocks.open }),
}));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({
    t: (key: string, params?: object) => (params ? `${key} ${JSON.stringify(params)}` : key),
  }),
}));
const props = {
  org: "org",
  user: "reader",
  service: "cart",
  where: "env:prod",
  version: "v2",
  deployKey: "d2",
};
function render(extra: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return mount(Card, {
    props: { ...props, ...extra },
    global: {
      stubs: {
        OButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click')\"><slot/></button>",
        },
        OSkeleton: true,
        VersionVerdictBanner: true,
        VersionSummaryTiles: true,
        ServiceEnvChip: true,
        ODimensionChip: true,
        OTag: true,
        ...overrides,
      },
    },
  });
}
// Warm-up copy reads the clock, so each warm-up test pins it against the producer's warm-up end.
function at(us: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(us / 1000);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options = [];
  mocks.query = {
    data: ref({
      stored_verdict: { verdict_key: "v", version: "v2", verdict: "regressed" },
      env: "prod",
      arms: { a: { version: "v2" }, b: { version: "v1" } },
      traces: { status: "error" },
    }),
    isPending: ref(false),
    isError: ref(false),
    error: ref(null),
    refetch: vi.fn(),
  };
});
it("keeps stored verdict with partial signal error and opens the exact transition", async () => {
  const wrapper = render();
  expect(wrapper.find("version-verdict-banner-stub").exists()).toBe(true);
  await wrapper.find('[data-test="svcver-panel-open-compare"]').trigger("click");
  expect(mocks.open).toHaveBeenCalledWith(
    expect.objectContaining({ deployKey: "d2", fromPanel: true }),
  );
});
it("says why Share is off until the compare loads", async () => {
  mocks.query.data.value = undefined as never;
  const wrapper = render();
  await flushPromises();
  const tip = wrapper
    .findAllComponents(OTooltip)
    .find((c) => c.props("content") === "serviceVersions.actions.shareWaiting");
  expect(tip?.props("disabled")).toBe(false);
});
it("shows loading, error retry and denied states", async () => {
  const wrapper = render();
  mocks.query.isPending.value = true;
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-card-loading"]').exists()).toBe(true);
  mocks.query.isPending.value = false;
  mocks.query.isError.value = true;
  await flushPromises();
  await wrapper.find('[data-test="svcver-card-retry"]').trigger("click");
  expect(mocks.query.refetch).toHaveBeenCalled();
  mocks.query.error.value = { response: { status: 403 } };
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-card-denied"]').exists()).toBe(true);
  expect(wrapper.find("version-verdict-banner-stub").exists()).toBe(false);
});
it("withholds numeric evidence and incidents for restricted sources", () => {
  mocks.query.data.value.stored_verdict.restricted = true;
  const wrapper = render();
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(false);
  expect(wrapper.find('[data-test="svcver-card-new-error"]').exists()).toBe(false);
  expect(wrapper.find('[data-test="svcver-panel-incident"]').exists()).toBe(false);
});
it.each([true, false])("reports incident creation/attachment: %s", async (created) => {
  mocks.incident.mockResolvedValueOnce({ data: { created } });
  const wrapper = render();
  await wrapper.find('[data-test="svcver-panel-incident"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-panel-incident-message"]').text()).toContain(
    created ? "incident.created" : "incident.attached",
  );
});
it("reports failed incident and ignores stale org completions", async () => {
  mocks.incident.mockRejectedValueOnce(new Error("failed"));
  const wrapper = render();
  await wrapper.find('[data-test="svcver-panel-incident"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("incident.failed");
  let resolve!: (value: unknown) => void;
  mocks.incident.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await wrapper.find('[data-test="svcver-panel-incident"]').trigger("click");
  await wrapper.setProps({ org: "other" });
  resolve({ data: { created: true } });
  await flushPromises();
  expect(wrapper.find('[data-test="svcver-panel-incident-message"]').exists()).toBe(false);
});
it("titles the card baseline to new, marks a regression border and reports the baseline", () => {
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-card-title"]').text().replace(/\s+/g, " ")).toBe(
    "cart v1 → v2",
  );
  expect(wrapper.find('[data-test="svcver-panel-card"]').classes()).toContain(
    "border-banner-error-soft-border",
  );
  expect(wrapper.emitted("baseline")?.[0]).toEqual([
    { version: "v1", image: null, source: "automatic" },
  ]);
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(true);
});
it("summarises the top introduced error type and hides tiles while not serving", () => {
  mocks.query.data.value.rum = {
    status: "ok",
    error_types: {
      introduced: [{ fingerprint: "f", error_message: "TypeError: x", count: 214 }],
      fixed: [],
      shared: [],
    },
  };
  mocks.query.data.value.stored_verdict.verdict = "not_serving";
  const wrapper = render();
  expect(wrapper.find('[data-test="svcver-card-new-error"]').text()).toBe("TypeError: x");
  expect(wrapper.text()).toContain("serviceVersions.panel.errorCounts");
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(false);
});
function introduced(early: boolean, views = { a: 5000, b: 5000 }) {
  mocks.query.data.value.rum = {
    status: "ok",
    views,
    error_types: {
      introduced: [{ fingerprint: "f", error_message: "TypeError: x", count: 7 }],
      fixed: [],
      shared: [],
      early,
    },
  };
  return mount(Card, {
    props,
    global: {
      stubs: {
        OButton: true,
        OSkeleton: true,
        VersionVerdictBanner: true,
        VersionSummaryTiles: true,
        ServiceEnvChip: true,
        ODimensionChip: true,
        OTag: { props: ["variant", "label"], template: '<span :data-variant="variant" />' },
      },
    },
  });
}
it("reads the backend count field for the introduced error", () => {
  const wrapper = introduced(false);
  expect(mocks.query.data.value.rum.error_types.introduced[0]).not.toHaveProperty("count_a");
  expect(wrapper.text()).toContain('serviceVersions.panel.errorCounts {"b":"0","a":"7"}');
});
it("gives a pre-existing version the tracking template instead of a comparison", () => {
  const wrapper = render({ preExisting: true, tracking: producer.versions_tracking });
  // The compare read is the card's first query.
  expect(mocks.options[0].value.enabled).toBe(false);
  expect(wrapper.find('[data-test="svcver-card-pre-existing"]').text()).toContain(
    "serviceVersions.sentence.preExistingSince",
  );
  expect(wrapper.find("version-verdict-banner-stub").exists()).toBe(false);
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(false);
});
it("says tracking is warming up, never running before tracking started, during the warm-up", () => {
  const warming = {
    ...producer.versions_tracking,
    warmup_ends_at: Date.now() * 1000 + 3_600_000_000,
  };
  const text = render({ preExisting: true, tracking: warming })
    .get('[data-test="svcver-verdict-sentence"]')
    .text();
  expect(text).toContain("serviceVersions.catalog.warmingUp");
  expect(text).not.toContain("preExisting");
});

it("reads the same compare the drawer opens, so both show one set of numbers", async () => {
  const { compareQuery, compareRequest } = await vi.importActual<
    typeof import("@/services/service_versions.queries")
  >("@/services/service_versions.queries");
  render({ org: "org", user: "user" });
  const drawerKey = compareQuery(
    "org",
    "user",
    compareRequest({ service: "cart", where: "env:prod", version: "v2", deployKey: "d2" }),
  ).queryKey;
  const keys = mocks.options.map((option) => JSON.stringify(option.value?.queryKey));
  expect(keys).toContain(JSON.stringify(drawerKey));
});
it("shows the warming-up no-verdict state and reads no compare while tracking has no epoch", () => {
  const wrapper = render({ tracking: { epoch: null, warmup_ends_at: null } });
  expect(mocks.options[0].value.enabled).toBe(false);
  const notice = wrapper.get('[data-test="svcver-card-no-verdict"]');
  expect(notice.text()).toBe("serviceVersions.catalog.warmingUpNoEpoch");
  expect(notice.find("o-tag-stub").exists()).toBe(false);
  expect(wrapper.find("version-verdict-banner-stub").exists()).toBe(false);
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(false);
});
it("reads a window the rollup has not reached as missing data, not zero requests", () => {
  mocks.query.data.value = {
    stored_verdict: null,
    live_verdict: { verdict: "insufficient", reason_code: "not_enough_samples" },
    env: "prod",
    arms: { a: { version: "v2", has_rollup: false }, b: { version: "v1", has_rollup: false } },
    traces: { status: "insufficient", requests: { a: 0, b: 0, rate_a: 0, rate_b: 0 } },
  };
  at(producer.versions_tracking.warmup_ends_at - 60_000_000);
  const wrapper = render({ tracking: producer.versions_tracking });
  vi.useRealTimers();
  expect(wrapper.get('[data-test="svcver-card-no-verdict"]').text()).toMatch(
    /^serviceVersions\.catalog\.warmingUp \{"time":"[^"]+"\}$/,
  );
  expect(wrapper.find("version-verdict-banner-stub").exists()).toBe(false);
  expect(wrapper.find("version-summary-tiles-stub").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("requestsPair");
});
it("titles a rollback with the shared compare header", () => {
  mocks.query.data.value = {
    stored_verdict: {
      verdict_key: "v",
      version: "1.0",
      verdict: "ok",
      rollback_outcome: "recovered",
      deploy: { kind: "rollback", at: 1, from_version: "2.0" },
    },
    env: "prod",
    arms: { a: { version: "1.0" }, b: { version: "2.0" } },
  };
  const wrapper = render({ service: "rollback-api", version: "1.0" });
  expect(wrapper.get('[data-test="svcver-card-title"]').text().replace(/\s+/g, " ")).toBe(
    "rollback-api 2.0 → 1.0 serviceVersions.compare.rollbackSuffix",
  );
});
it("names the org's warm-up end for a scope not tracked yet", () => {
  at(producer.versions_tracking.warmup_ends_at - 60_000_000);
  const wrapper = render({
    tracking: producer.versions_tracking,
    identity: { env: "prod", tracking_started: false },
  });
  vi.useRealTimers();
  expect(mocks.options[0].value.enabled).toBe(false);
  expect(wrapper.get('[data-test="svcver-card-no-verdict"]').text()).toMatch(
    /^serviceVersions\.catalog\.warmingUp \{"time":"[^"]+"\}$/,
  );
});
it("shares through the app's clipboard helper, so a refused write notifies instead of rejecting", async () => {
  const wrapper = render();
  await wrapper.get('[data-test="svcver-panel-share"]').trigger("click");
  await flushPromises();
  expect(mocks.copy).toHaveBeenCalledWith(
    expect.stringContaining("/web/traces?cmp=v2"),
    expect.any(Function),
  );
});
// The producer's deadline and failure shapes (signals/api.rs section_result) beside the recorded r2f RUM zeros.
for (const section of [
  { status: "timeout", insufficient: true, reason: "timeout" },
  { status: "error", insufficient: true, reason: "query_failed" },
]) {
  it(`shows Comparison unavailable and no traffic claim for a ${section.status} section`, async () => {
    mocks.query.data.value = {
      ...structuredClone(producer.regressed.compare),
      stored_verdict: {
        ...structuredClone(producer.regressed.stored_verdict),
        verdict: "not_serving",
        reason_code: "traffic_drop",
      },
      live_verdict: null,
      traces: section,
      rum: {
        status: "complete",
        insufficient: true,
        reason: "below_min_count",
        views: { a: 0, b: 0 },
        session_windows: { a: 0, b: 0 },
      },
    };
    const wrapper = render({}, { VersionVerdictBanner: false });
    expect(wrapper.get('[data-test="svcver-card-error"]').text()).toContain(
      "serviceVersions.compare.error",
    );
    await wrapper.get('[data-test="svcver-card-retry"]').trigger("click");
    expect(mocks.query.refetch).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-test="svcver-verdict-sentence"]').text()).toContain(
      "serviceVersions.sentence.notServingDrop",
    );
    const detail = wrapper.get('[data-test="svcver-baseline-detail"]').text();
    expect(detail).toMatch(/^serviceVersions\.compare\.windowLine(Unequal)?Bare /);
    for (const claim of ["requestsPair", "viewsPair", "sessionsPair", "notServingNote"])
      expect(wrapper.text()).not.toContain(claim);
  });
}
it("labels a verdict card outside Kubernetes by the shared where label, never default", async () => {
  const wrapper = render({ where: "default" });
  await flushPromises();
  const where = wrapper
    .findAllComponents(ODimensionChip)
    .find((chip) => chip.props("dimKey") === "where");
  expect(where?.props("value")).toBe("serviceVersions.where.outside");
  expect(where?.props("muted")).toBe(true);
});
describe("the baseline the card reports", () => {
  it("reports the compared build and names a picked or last good baseline", () => {
    mocks.query.data.value.arms.b.image = "1f08369";
    mocks.lastGood = { version: "v1", image: "1f08369" };
    expect(render().emitted("baseline")?.[0]).toEqual([
      { version: "v1", image: "1f08369", source: "last_good" },
    ]);
    mocks.query.data.value.baseline_rule = "manual";
    expect(render().emitted("baseline")?.[0]).toEqual([
      { version: "v1", image: "1f08369", source: "picked" },
    ]);
    mocks.lastGood = undefined;
  });
  it("calls a bad baseline automatic when only another build of its version text was last good", () => {
    mocks.query.data.value.arms.b.image = "1f08369";
    mocks.lastGood = { version: "v1", image: "8ebf1f7" };
    expect(render().emitted("baseline")?.[0]).toEqual([
      { version: "v1", image: "1f08369", source: "automatic" },
    ]);
    mocks.lastGood = undefined;
  });
});
