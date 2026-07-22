// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { ref, computed } from "vue";
import store from "@/test/unit/helpers/store";

// ── Reactive state we control from outside the component ────────────────────
const protocolRunDetail = ref<any>(null);
const loading = ref(false);
const mockFetchProtocolRun = vi.fn();

vi.mock("@/composables/useSyntheticResults", () => ({
  default: () => ({
    protocolRunDetail: computed(() => protocolRunDetail.value),
    loading: computed(() => loading.value),
    fetchProtocolRun: mockFetchProtocolRun,
  }),
}));

const mockGetSynthetics = vi.fn().mockResolvedValue({ data: {} });

vi.mock("@/services/synthetics", () => ({
  default: {
    get: (...args: any[]) => mockGetSynthetics(...args),
  },
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: () => store,
  };
});

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

// ── Stubs for O2 and layout components ──────────────────────────────────────
vi.mock("@/lib/core/PageHeader/OPageHeader.vue", () => ({
  default: {
    name: "OPageHeader",
    props: ["subtitle", "back", "drawerMode"],
    template:
      '<div data-test="app-page-header"><slot name="title"></slot><slot name="title-trail"></slot></div>',
  },
}));

vi.mock("@/lib/core/Badge/OBadge.vue", () => ({
  default: {
    name: "OBadge",
    props: ["variant", "size", "icon"],
    template: '<span data-test="obadge" :class="variant"><slot></slot></span>',
  },
}));

vi.mock("@/lib/feedback/Skeleton/OSkeleton.vue", () => ({
  default: {
    name: "OSkeleton",
    template: '<div data-test="oskeleton">Loading...</div>',
  },
}));

vi.mock("@/lib/core/EmptyState/OEmptyState.vue", () => ({
  default: {
    name: "OEmptyState",
    props: ["preset", "title"],
    template: '<div data-test="oempty-state">{{ title }}</div>',
  },
}));

import ProtocolRunSummary from "./ProtocolRunSummary.vue";

// ── Fixtures matching ProtocolRunDetail shape ───────────────────────────────
function makeProtocolRun(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: 1_700_000_000_000,
    scheduledTs: 1_700_000_000_000,
    startedTs: 1_700_000_001_000,
    completedTs: 1_700_000_002_000,
    status: "passed",
    error: "",
    errorClass: "",
    assertionsPassed: true,
    statusCode: 200,
    responseTimeMs: 245,
    responseBytes: 1234,
    timings: [
      { phase: "dns" as const, ms: 12 },
      { phase: "connect" as const, ms: 45 },
      { phase: "tls" as const, ms: 89 },
      { phase: "ttfb" as const, ms: 99 },
    ],
    totalMs: 245,
    tlsCertExpiry: null,
    initMs: null,
    location: "us-east-1",
    probeId: "probe-abc",
    runtime: "Go 1.21",
    triggerType: "schedule",
    target: "https://example.com",
    type: "http",
    monitorName: "Test Monitor",
    jobId: "job-001",
    runId: "run-001",
    executionId: "exec-001",
    ...overrides,
  };
}

describe("ProtocolRunSummary", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    // Reset reactive state
    protocolRunDetail.value = null;
    loading.value = false;
    mockFetchProtocolRun.mockReset();
    mockGetSynthetics.mockResolvedValue({ data: {} });
  });

  function mountComponent(props = {}) {
    return mount(ProtocolRunSummary, {
      global: {
        plugins: [store],
      },
      props: {
        monitorId: "mon-http-1",
        runId: "run-001",
        executionId: "exec-001",
        ...props,
      },
    });
  }

  describe("loading state", () => {
    it("should show skeleton when loading is true", async () => {
      loading.value = true;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="oskeleton"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="oempty-state"]').exists()).toBe(false);
    });
  });

  describe("empty state", () => {
    it("should show empty state when no run data is available", async () => {
      loading.value = false;
      protocolRunDetail.value = null;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="oempty-state"]').exists()).toBe(true);
    });
  });

  describe("result display", () => {
    beforeEach(() => {
      loading.value = false;
    });

    it("should display passed status badge when run has passed status", async () => {
      protocolRunDetail.value = makeProtocolRun({ status: "passed" });

      wrapper = mountComponent();
      await flushPromises();

      const badges = wrapper.findAll('[data-test="obadge"]');
      const passedBadge = badges.find((b) => b.text() === "synthetics.protocolRun.passed");
      expect(passedBadge).toBeDefined();
    });

    it("should display failed status badge when run has failed status", async () => {
      protocolRunDetail.value = makeProtocolRun({ status: "failed" });

      wrapper = mountComponent();
      await flushPromises();

      const badges = wrapper.findAll('[data-test="obadge"]');
      const failedBadge = badges.find((b) => b.text() === "synthetics.protocolRun.failed");
      expect(failedBadge).toBeDefined();
    });

    it("should display warning status badge when run has warning status", async () => {
      protocolRunDetail.value = makeProtocolRun({ status: "warning" });

      wrapper = mountComponent();
      await flushPromises();

      const badges = wrapper.findAll('[data-test="obadge"]');
      const warningBadge = badges.find((b) => b.text() === "synthetics.protocolRun.warning");
      expect(warningBadge).toBeDefined();
    });

    it("should display error status badge when run has error status", async () => {
      protocolRunDetail.value = makeProtocolRun({ status: "error" });

      wrapper = mountComponent();
      await flushPromises();

      const badges = wrapper.findAll('[data-test="obadge"]');
      const errorBadge = badges.find((b) => b.text() === "synthetics.protocolRun.error");
      expect(errorBadge).toBeDefined();
    });

    it("should display response time", async () => {
      protocolRunDetail.value = makeProtocolRun({ responseTimeMs: 245 });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("245 ms");
    });

    it("should format duration in seconds when >= 1000ms", async () => {
      protocolRunDetail.value = makeProtocolRun({ responseTimeMs: 2500 });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("2.50 s");
    });

    it("should display error message when run has error", async () => {
      protocolRunDetail.value = makeProtocolRun({
        status: "failed",
        error: "Connection refused",
        errorClass: "network",
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Connection refused");
      expect(wrapper.text()).toContain("network");
    });
  });

  describe("timing waterfall", () => {
    it("should render timing bars when timings exist", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({
        timings: [
          { phase: "dns" as const, ms: 12 },
          { phase: "connect" as const, ms: 45 },
        ],
        totalMs: 57,
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.protocolRun.phase.dns");
      expect(wrapper.text()).toContain("synthetics.protocolRun.phase.connect");
    });

    it("should not render timing section when no timings", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({ timings: [] });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).not.toContain("synthetics.protocolRun.timings");
    });
  });

  describe("assertions section", () => {
    it("should show assertion rows when http run has assertion defs", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({
        type: "http",
        assertionsPassed: true,
      });

      // Mock get to return assertion definitions
      mockGetSynthetics.mockResolvedValueOnce({
        data: {
          config: {
            assertions: [
              { field: "status_code", operator: "equals", value: "200" },
              { field: "response_time", operator: "less_than", value: "5000" },
            ],
          },
        },
      });

      wrapper = mountComponent();
      await flushPromises();
      // Wait for loadAssertionDefs to complete
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.protocolRun.assertions");
    });

    it("should mark assertion as failed when assertionsPassed is false", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({
        type: "http",
        assertionsPassed: false,
        error: "status_code 500 not equals 200",
        errorClass: "assertion",
      });

      mockGetSynthetics.mockResolvedValueOnce({
        data: {
          config: {
            assertions: [{ field: "status_code", operator: "equals", value: "200" }],
          },
        },
      });

      wrapper = mountComponent();
      await flushPromises();
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.protocolRun.assertionsFailed");
    });
  });

  describe("TLS certificate section", () => {
    it("should show TLS cert info when certExpiryDate exists", async () => {
      // Set expiry far in the future so daysRemaining > 30
      const futureExpiry = (Date.now() + 90 * 24 * 3600 * 1000) * 1000; // 90 days in µs
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({ tlsCertExpiry: futureExpiry });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("synthetics.protocolRun.tlsCert");
    });

    it("should not show TLS cert section when certExpiryDate is null", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({ tlsCertExpiry: null });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).not.toContain("synthetics.protocolRun.tlsCert");
    });
  });

  describe("probe section", () => {
    it("should always display probe info when run exists", async () => {
      loading.value = false;
      protocolRunDetail.value = makeProtocolRun({
        location: "eu-west-1",
        probeId: "probe-xyz",
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("eu-west-1");
      expect(wrapper.text()).toContain("probe-xyz");
      expect(wrapper.text()).toContain("synthetics.protocolRun.probe");
    });
  });
});
