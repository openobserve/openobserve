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
import { useI18n } from "vue-i18n";
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

// Partial: the overlaid synthetics service loads `@/stores`, which needs the real
// `createStore` — a wholesale vuex mock leaves it undefined at import time.
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
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

vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
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
  });
});

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

  /**
   * A flex item defaults to `min-width: auto`, so it refuses to shrink below its
   * content. Without the clamp, one long URL or the evidence table's own
   * content width pushes this column past the expansion and every card in it
   * overflows — and `truncate` and `overflow-x-auto` both go inert, because each
   * needs a bounded parent to act on.
   */
  it("clamps the expansion's content column so wide content scrolls instead of overflowing", async () => {
    const w = await mountWithRun({ ...mockFailedWithEvidence });
    const column = w.find('[data-test="synthetics-step-page-activity"]').element.parentElement;
    expect(column?.className).toContain("min-w-0");
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

  it("numbers evidence step options from the executed steps list, not recordedSteps position", async () => {
    // recordedSteps carries a step (s1) that never actually ran this attempt —
    // a journey typically has ~13 recorded steps and only a few execute. If the
    // select's numbering came from recordedSteps position, s19 here would read
    // "Step 2" (its position in recordedSteps) instead of "Step 1" (its
    // position among the steps that actually ran, which is what the Steps tab
    // and "Failed at Step N" both show).
    const w = await mountWithRun({
      ...mockFailedWithEvidence,
      recordedSteps: [
        { id: "s1", action: "click", name: "Go home", selector: null, url: "" },
        ...mockFailedWithEvidence.recordedSteps,
      ],
    });
    // EvidencePanel only mounts on the Evidence tab (v-if, not v-show).
    w.findComponent(StepPageActivity).vm.$emit("view-all", "s19");
    await flushPromises();
    const panel = w.findComponent(EvidencePanel);
    const stepOptions = panel.props("stepOptions") as {
      stepId: string;
      number: number;
      name: string;
    }[];
    expect(stepOptions).toEqual([{ stepId: "s19", number: 1, name: "Click Sign In" }]);
    w.unmount();
  });

  it("issues no bundle request when the attempt has no evidence", async () => {
    const w = await mountWithRun({ ...mockFailedWithEvidence, evidenceKey: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(w.find('[data-test="synthetics-step-page-activity"]').exists()).toBe(false);
    w.unmount();
  });
});

describe("RunDetail — id-less error override (quota / reaper rows)", () => {
  let w: VueWrapper;

  const overrideError = {
    errorSource: "quota",
    message: "the organization's included synthetics steps are exhausted, so this run was skipped",
    timestamp: 1_700_000_000_000,
    location: "aws-us-east-1",
    browser: "chromium",
    device: "desktop",
  };

  afterEach(() => {
    w?.unmount();
    vi.clearAllMocks();
    mockLoading.value = false;
  });

  it("renders the error banner from the row and issues NO per-execution query", async () => {
    mockRunDetailRef.value = null; // nothing fetched — the row has no ids
    mockFetchRun.mockClear();
    w = mountComponent({ drawerMode: true, overrideMonitorType: "browser", overrideError });
    await flushPromises();

    expect(w.find('[data-test="synthetics-run-detail-steps-error-banner"]').exists()).toBe(true);
    expect(mockFetchRun).not.toHaveBeenCalled();
  });

  it("shows the quota source label and its FE explanation", async () => {
    mockRunDetailRef.value = null;
    w = mountComponent({ drawerMode: true, overrideMonitorType: "browser", overrideError });
    await flushPromises();

    expect(w.find('[data-test="synthetics-run-detail-error-source"]').text()).toBe(
      "synthetics.runDetail.errorSourceQuota",
    );
    expect(w.find('[data-test="synthetics-run-detail-error-desc"]').text()).toBe(
      "synthetics.runDetail.errorSourceQuotaDesc",
    );
  });

  it("shows a source label but no explanation for a non-quota source", async () => {
    mockRunDetailRef.value = null;
    w = mountComponent({
      drawerMode: true,
      overrideMonitorType: "browser",
      overrideError: { ...overrideError, errorSource: "dispatch" },
    });
    await flushPromises();

    expect(w.find('[data-test="synthetics-run-detail-error-source"]').text()).toBe(
      "synthetics.runDetail.errorSourceDispatch",
    );
    expect(w.find('[data-test="synthetics-run-detail-error-desc"]').exists()).toBe(false);
  });

  it("renders the error view even for a protocol monitor type (skips ProtocolRunSummary)", async () => {
    mockRunDetailRef.value = null;
    w = mountComponent({ drawerMode: true, overrideMonitorType: "http", overrideError });
    await flushPromises();

    expect(w.find('[data-test="protocol-run-summary-stub"]').exists()).toBe(false);
    expect(w.find('[data-test="synthetics-run-detail-steps-error-banner"]').exists()).toBe(true);
  });
});

// `startLoad` is a sibling of the steps array: row 0 has no number and no place in any count.
describe("RunDetail — start load (row 0)", () => {
  const startLoad = (overrides: Record<string, unknown> = {}) => ({
    step_id: "_start",
    status: "ok",
    duration_ms: 420,
    error: "",
    screenshot_key: null,
    url: "https://app.test/",
    ...overrides,
  });

  const withStartLoad = (overrides: Record<string, unknown> = {}) => ({
    ...mockRunDetail,
    recordedSteps: [
      { id: "s1", action: "click", name: "Click Sign In", selector: "[data-test=signin]", url: "" },
    ],
    lastAttemptSteps: [
      { step_id: "s1", status: "ok", duration_ms: 300, error: "", screenshot_key: null },
    ],
    startLoad: startLoad(),
    ...overrides,
  });

  beforeEach(() => {
    // The label interpolates the URL; a `t` that only echoes the key would hide it.
    vi.mocked(useI18n).mockImplementation(
      () =>
        ({
          t: (key: string, params?: Record<string, unknown>) =>
            params && typeof params.url === "string" ? `${key} ${params.url}` : key,
        }) as any,
    );
  });

  afterEach(() => {
    vi.mocked(useI18n).mockImplementation(() => ({ t: (key: string) => key }) as any);
    mockRunDetailRef.value = { ...mockRunDetail };
  });

  async function mountWithRun(detail: Record<string, unknown>) {
    mockRunDetailRef.value = null;
    const w = mountComponent();
    await flushPromises();
    mockRunDetailRef.value = detail;
    await flushPromises();
    return w;
  }

  /** Whether `a` comes before `b` in document order. */
  function precedes(a: Element, b: Element): boolean {
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  it("renders row 0 above Step 1 with the Open label and its timing, and no step number", async () => {
    const w = await mountWithRun(withStartLoad());

    const row0 = w.find('[data-test="synthetics-journey-start-row"]');
    expect(row0.exists(), "no start row rendered").toBe(true);
    const step1 = w.find('[data-test="o2-table-row-0"]');
    expect(step1.exists()).toBe(true);
    expect(precedes(row0.element, step1.element)).toBe(true);
    expect(row0.text()).toContain("synthetics.runDetail.startLoadLabel https://app.test/");
    expect(row0.text()).toContain("420ms");
    expect(row0.text()).not.toMatch(/^\s*\d/);
    // Step 1 keeps its number: row 0 shifted nothing.
    expect(step1.text()).toContain("1");
    expect(step1.text()).toContain("Click Sign In");
    w.unmount();
  });

  it("excludes row 0 from the Steps badge", async () => {
    const w = await mountWithRun(withStartLoad());

    const tab = w.find('[data-test="synthetics-run-detail-tab-steps"]');
    expect(tab.find(".obadge-stub").text()).toBe("1");
    expect(
      w
        .findAll("[data-test]")
        .filter((el) => /^o2-table-row-\d+$/.test(el.attributes("data-test")!)),
    ).toHaveLength(1);
    w.unmount();
  });

  it("names the start load, not a Step, when the run failed opening the Starting URL", async () => {
    const w = await mountWithRun(
      withStartLoad({
        status: "failed",
        failedStep: "_start",
        error: "net::ERR_NAME_NOT_RESOLVED",
        startLoad: startLoad({ status: "fail", error: "net::ERR_NAME_NOT_RESOLVED" }),
        failureDetail: {
          stepId: "_start",
          stepName: "",
          stepIndex: 0,
          error: "net::ERR_NAME_NOT_RESOLVED",
          candidatesTried: [],
          settleSignals: [],
          settleMs: null,
          cls: 0,
          ttfbMs: 0,
        },
      }),
    );

    const infoBar = w.find('[data-test="synthetics-run-detail-info-bar"]');
    expect(infoBar.text()).toContain("synthetics.runDetail.failedAtStartLoad");
    expect(infoBar.text()).not.toContain("synthetics.runDetail.failedAtStep");
    expect(w.text()).not.toContain("_start");
    w.unmount();
  });

  it("shows the start load's error and screenshot on row 0", async () => {
    const w = await mountWithRun(
      withStartLoad({
        status: "failed",
        failedStep: "_start",
        startLoad: startLoad({
          status: "fail",
          error: "net::ERR_NAME_NOT_RESOLVED",
          screenshot_key: "shots/_start.png",
        }),
      }),
    );

    const row0 = w.find('[data-test="synthetics-journey-start-row"]');
    expect(row0.exists(), "no start row rendered").toBe(true);
    expect(row0.text()).toContain("net::ERR_NAME_NOT_RESOLVED");
    expect(row0.find("img").exists()).toBe(true);
    w.unmount();
  });

  it("renders a run with no start load exactly as before", async () => {
    const w = await mountWithRun(withStartLoad({ startLoad: null }));

    expect(w.find('[data-test="synthetics-journey-start-row"]').exists()).toBe(false);
    expect(
      w.find('[data-test="synthetics-run-detail-tab-steps"]').find(".obadge-stub").text(),
    ).toBe("1");
    expect(w.find('[data-test="o2-table-row-0"]').text()).toContain("Click Sign In");
    w.unmount();
  });
});
