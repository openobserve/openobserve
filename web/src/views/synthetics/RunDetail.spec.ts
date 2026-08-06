// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { ref, shallowRef } from "vue";
import RunDetail from "./RunDetail.vue";
import StepPageActivity from "@/components/synthetics/results/StepPageActivity.vue";
import EvidencePanel from "@/components/synthetics/results/EvidencePanel.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    currentRoute: { value: { query: {} } },
  }),
  useRoute: () => ({
    params: { id: "mon-1", runId: "4821", executionId: "exec-1" },
    query: {},
  }),
  RouterLink: {
    name: "RouterLinkStub",
    template: "<a><slot /></a>",
  },
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      timezone: "UTC",
      selectedOrganization: { identifier: "org-1" },
    },
  }),
}));

// A real ref, not a plain object: the run arrives AFTER mount in production,
// and only a reactive source lets a test reproduce that ordering — which is
// what drives the auto-expand watcher and, through it, the bundle fetch.
const mockRunDetailRef = shallowRef<any>(null);

const mockRunDetail = {
  timestamp: Date.now() / 1000,
  scheduledTs: Date.now() / 1000,
  status: "passed",
  durationMs: 3240,
  location: "us-west-1",
  device: "laptop_large",
  browserEngine: "chromium",
  triggerType: "schedule",
  error: "",
  jobId: "job-1",
  runId: "4821",
  executionId: "exec-1",
  monitorName: "Test Monitor",
  attempts: 1,
  failedStep: null,
  recordedSteps: [],
  lastAttemptSteps: [],
  retryHistory: [],
  network: null,
  webVitals: null,
  traceKey: null,
  // Fields the tab bar, attempt selector and evidence panel read. The fixture
  // predated all of them, so it could not have caught a panel that never
  // rendered.
  initMs: 0,
  startedTs: 0,
  queueDelayMs: null,
  statusReason: "",
  errorSource: "",
  failureDetail: null,
  evidenceByStep: [],
  evidenceKey: null,
  evidenceTruncated: false,
};

/** A retried execution: two attempts, the second deciding. */
const mockRetriedDetail = {
  ...mockRunDetail,
  status: "failed",
  attempts: 2,
  failedStep: "fa1",
  evidenceKey: "synthetics/org/mon/2026/07/29/RUN/EXEC/attempt-1-evidence.ndjson",
  retryHistory: [
    {
      attempt: 0,
      status: "failed",
      durationMs: 57795,
      failedStep: "fa1",
      steps: [],
      failureDetail: null,
      screenshotKeys: new Map(),
      traceKey: null,
      evidenceKey: "…/evidence.ndjson",
    },
    {
      attempt: 1,
      status: "failed",
      durationMs: 58341,
      failedStep: "fa1",
      steps: [],
      failureDetail: null,
      screenshotKeys: new Map(),
      traceKey: null,
      evidenceKey: "…/attempt-1-evidence.ndjson",
    },
  ],
};

// ── Controllable `loading` ref shared with the mocked composable, so
// RunDetail's direct `synthetics.loading.value = true` write (the defensive
// loading fix) is observable in the rendered template. `fetchRun` mirrors the
// real composable's contract by flipping it back to false once "done".
const mockLoading = ref(false);
const mockFetchRun = vi.fn(async () => {
  mockLoading.value = false;
});

vi.mock("@/composables/useSyntheticResults", () => ({
  default: () => ({
    kpi: {
      value: {
        uptimePct: 0,
        p95Ms: 0,
        failedRuns: 0,
        totalRuns: 0,
        retriedRuns: 0,
        lastRunStatus: null,
        lastRunAt: null,
      },
    },
    buckets: { value: [] },
    runs: { value: [] },
    runDetail: mockRunDetailRef,
    loading: mockLoading,
    error: { value: null },
    hasLoadedOnce: { value: true },
    fetchAll: vi.fn(),
    fetchRun: mockFetchRun,
    cancelAll: vi.fn(),
  }),
}));

// ── Controllable mock for the monitor-type lookup (resolveMonitorType) and
// the locations prefetch, so tests can assert whether the API was hit and
// control the timing of its resolution.
const mockGetSynthetics = vi.fn().mockResolvedValue({ data: { type: "browser" } });
const mockGetLocations = vi.fn().mockResolvedValue({ data: { locations: [] } });

vi.mock("@/services/synthetics", () => ({
  default: {
    get: (...args: any[]) => mockGetSynthetics(...args),
    getLocations: (...args: any[]) => mockGetLocations(...args),
    presignArtifacts: vi.fn().mockResolvedValue({ data: { urls: [] } }),
    artifactUrl: vi.fn(() => ""),
    // useSyntheticEvidence asks this before fetching, to decide whether the URL
    // is our cookie-authed proxy or a presigned object URL. Omitting it threw
    // inside the load path, so no fetch was ever issued.
    isProxyArtifactUrl: vi.fn(() => false),
  },
}));

const stubs = {
  OCard: {
    template: '<div class="ocard-stub"><slot /></div>',
  },
  OCardSection: {
    template: '<div class="ocardsection-stub"><slot /></div>',
    props: ["role"],
  },
  OSeparator: {
    template: '<div class="oseparator-stub" />',
  },
  OButton: {
    template:
      '<button class="obutton-stub" @click="$emit(\'click\')"><slot /><slot name="prefix" /><slot name="suffix" /></button>',
    props: ["disabled", "iconLeft"],
  },
  OIcon: {
    template: '<span class="oicon-stub" />',
    props: ["name"],
  },
  OBadge: {
    template: '<span class="obadge-stub"><slot /></span>',
    props: ["variant", "size", "icon"],
  },
  BetaBadge: {
    template: '<span data-test="beta-badge">BETA</span>',
  },
  // Protocol (non-browser) runs delegate entirely to ProtocolRunSummary —
  // stub it so branch-selection tests don't need to satisfy its own
  // composable/service dependencies.
  ProtocolRunSummary: {
    name: "ProtocolRunSummary",
    props: ["monitorId", "runId", "executionId", "drawerMode", "locationNames"],
    template: '<div data-test="protocol-run-summary-stub" />',
  },
};

function mountComponent(props: Record<string, unknown> = {}) {
  return mount(RunDetail, {
    props,
    global: { stubs },
  });
}

describe("RunDetail", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    mockRunDetailRef.value = { ...mockRunDetail };
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    mockLoading.value = false;
    mockGetSynthetics.mockResolvedValue({ data: { type: "browser" } });
    mockGetLocations.mockResolvedValue({ data: { locations: [] } });
  });

  it("should render the run detail page shell", () => {
    expect(wrapper.find('[data-test="synthetics-run-detail"]').exists()).toBe(true);
  });

  it("should render the page title", () => {
    const title = wrapper.find('[data-test="synthetics-run-detail-title"]');
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("Test Monitor");
  });

  it("should render the status badge", () => {
    expect(wrapper.find('[data-test="synthetics-run-detail-status-badge"]').exists()).toBe(true);
  });

  it("should render the info bar with 5 chips", () => {
    const infoBar = wrapper.find('[data-test="synthetics-run-detail-info-bar"]');
    expect(infoBar.exists()).toBe(true);
    const chips = infoBar.findAll(":scope > div");
    expect(chips.length).toBe(5);
  });

  it("should render prev/next navigation buttons", () => {
    expect(wrapper.find('[data-test="synthetics-run-detail-prev-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="synthetics-run-detail-next-btn"]').exists()).toBe(true);
  });

  it("should render action buttons", () => {
    expect(wrapper.find('[data-test="synthetics-run-detail-trace-btn"]').exists()).toBe(true);
  });

  it("should render the back button", () => {
    expect(wrapper.find('[data-test="synthetics-run-detail-back-btn"]').exists()).toBe(true);
  });

  it("should render the Beta badge in the page title", () => {
    expect(wrapper.find('[data-test="beta-badge"]').exists()).toBe(true);
  });

  describe("monitor type resolution (drawer mode override)", () => {
    it("skips the resolveMonitorType fetch and delegates to ProtocolRunSummary when overrideMonitorType is already known", async () => {
      // The outer beforeEach already mounted the default (non-drawer) wrapper,
      // which calls syntheticsService.get once — clear that call so this
      // assertion only reflects the wrapper mounted below.
      mockGetSynthetics.mockClear();
      const w = mountComponent({
        drawerMode: true,
        overrideMonitorId: "mon-2",
        overrideRunId: "run-2",
        overrideExecutionId: "exec-2",
        overrideMonitorType: "http",
      });
      await flushPromises();

      expect(mockGetSynthetics).not.toHaveBeenCalled();
      expect(w.find('[data-test="protocol-run-summary-stub"]').exists()).toBe(true);
      expect(w.find('[data-test="synthetics-run-detail"]').exists()).toBe(false);

      w.unmount();
    });

    it("falls back to resolveMonitorType via syntheticsService.get when overrideMonitorType is empty", async () => {
      mockGetSynthetics.mockClear();
      const w = mountComponent({
        drawerMode: true,
        overrideMonitorId: "mon-2",
        overrideRunId: "run-2",
        overrideExecutionId: "exec-2",
        overrideMonitorType: "",
      });
      await flushPromises();

      expect(mockGetSynthetics).toHaveBeenCalledWith("org-1", "mon-2", "");

      w.unmount();
    });
  });

  describe("defensive loading state", () => {
    it("sets loading synchronously once loadRun starts, before monitor type resolution settles", async () => {
      // Keep resolveMonitorType's underlying fetch pending so monitorType is
      // still unresolved (null) at assertion time.
      let resolveGet!: (value: unknown) => void;
      mockGetSynthetics.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );

      const w = mountComponent();

      // No flushPromises yet — assert immediately after mount, while
      // resolveMonitorType() is still pending.
      expect(w.find('[data-test="synthetics-run-detail-info-skeleton"]').exists()).toBe(true);
      expect(w.find('[data-test="synthetics-run-detail-info-bar"]').exists()).toBe(false);

      // Settle the pending fetch so the component doesn't leak a dangling
      // promise across tests.
      resolveGet({ data: { type: "browser" } });
      await flushPromises();

      w.unmount();
    });
  });
});

// ── Tabs and the attempt selector ───────────────────────────────────────────
//
// Both were previously "verified" from a screenshot, and both were wrong twice.
// These assert the DOM.

describe("RunDetail — steps / evidence tabs", () => {
  beforeEach(() => {
    mockRunDetailRef.value = { ...mockRunDetail };
  });

  afterEach(() => {
    mockRunDetailRef.value = { ...mockRunDetail };
  });

  it("renders both tabs, with Steps selected first", async () => {
    const w = mountComponent();
    await flushPromises();
    expect(w.find('[data-test="synthetics-run-detail-tab-steps"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-run-detail-tab-evidence"]').exists()).toBe(true);
    w.unmount();
  });

  it("hides the attempt selector on a run that never retried", async () => {
    const w = mountComponent();
    await flushPromises();
    // One attempt means nothing to select; a control with a single option is
    // noise in an already-dense drawer.
    expect(w.find('[data-test="synthetics-run-detail-attempt-select"]').exists()).toBe(false);
    w.unmount();
  });

  it("shows the attempt selector on a retried run", async () => {
    mockRunDetailRef.value = { ...mockRetriedDetail } as any;
    const w = mountComponent();
    await flushPromises();
    expect(w.find('[data-test="synthetics-run-detail-attempt-select"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-run-detail-attempt-dropdown"]').exists()).toBe(true);
    w.unmount();
  });
});

// ── Per-step page activity ─────────────────────────────────────────────────
//
// The shared fixture carries no steps, so this suite brings its own: a failed
// run whose one step owns bundle events. Extending the shared fixture instead
// would put a steps table into all fourteen tests above.
const NDJSON_S19 = [
  '{"ts":100,"kind":"response","method":"GET","url":"https://app.dev/a","status":200,"initiated_ts":90,"duration_ms":10,"first_party":true,"step_id":"s19"}',
  '{"ts":200,"kind":"console","level":"error","text":"boom","step_id":"s19"}',
].join("\n");

const mockFailedWithEvidence = {
  ...mockRunDetail,
  status: "failed",
  failedStep: "s19",
  evidenceKey: "synthetics/org/mon/RUN/EXEC/evidence.ndjson",
  recordedSteps: [
    { id: "s19", action: "click", name: "Click Sign In", selector: "[data-test=signin]", url: "" },
  ],
  lastAttemptSteps: [
    {
      step_id: "s19",
      status: "fail",
      duration_ms: 30000,
      error: "locator.click: Timeout 30000ms exceeded",
      screenshot_key: null,
    },
  ],
};

describe("RunDetail — per-step page activity", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => NDJSON_S19,
    })) as any;
  });

  /**
   * Mount empty, then deliver the run — the real sequence.
   *
   * Seeding the mocked ref before mount would leave `steps` unchanged after
   * setup, so the auto-expand watcher never fires and the whole trigger path
   * this suite exists to cover would be skipped.
   */
  async function mountWithRun(detail: Record<string, unknown>) {
    mockRunDetailRef.value = null;
    const w = mountComponent();
    await flushPromises();
    mockRunDetailRef.value = detail;
    await flushPromises();
    return w;
  }

  it("fetches the bundle once when a failed step auto-expands", async () => {
    // Failed steps auto-expand, so this is load-time on a failed run — 256 KB at
    // the cap, paid on exactly the run someone is triaging.
    const w = await mountWithRun({ ...mockFailedWithEvidence });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    w.unmount();
  });

  it("renders the activity block on a step that owns events", async () => {
    const w = await mountWithRun({ ...mockFailedWithEvidence });
    expect(w.find('[data-test="synthetics-step-page-activity"]').exists()).toBe(true);
    w.unmount();
  });

  it("sends view-all to the Evidence tab filtered to that step", async () => {
    const w = await mountWithRun({ ...mockFailedWithEvidence });
    w.findComponent(StepPageActivity).vm.$emit("view-all", "s19");
    await flushPromises();
    const panel = w.findComponent(EvidencePanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props("stepFilter")).toBe("s19");
    w.unmount();
  });

  it("issues no bundle request when the attempt has no evidence", async () => {
    const w = await mountWithRun({ ...mockFailedWithEvidence, evidenceKey: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(w.find('[data-test="synthetics-step-page-activity"]').exists()).toBe(false);
    w.unmount();
  });
});
