// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

import i18n from "@/locales";

// ── Reactive mocks for useLLMStreamQuery ────────────────────────────────────
const mockExecuteQuery = vi.fn();
const mockCancelAll = vi.fn();

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    cancelAll: mockCancelAll,
  }),
}));

// ── Synthetic results schema mocks ──────────────────────────────────────────
vi.mock("@/composables/synthetics/syntheticResultsSchema", () => ({
  buildRunDetailSql: vi.fn(() => "MOCK_SQL"),
  mapRunLocationResult: vi.fn((row: any) => row),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    artifactUrl: vi.fn((org: string, key: string) => `/api/${org}/artifact?key=${encodeURIComponent(key)}`),
  },
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: () => store,
  };
});

// ── Stubs ───────────────────────────────────────────────────────────────────
vi.mock("./ExecutionDetailDrawer.vue", () => ({
  default: {
    name: "ExecutionDetailDrawer",
    props: { execution: { type: Object, default: null }, artifactUrlFn: { type: Function } },
    emits: ["close"],
    template: '<div v-if="$props.execution" data-test="execution-detail-drawer"></div>',
  },
}));

import RunRowExpansion from "./RunRowExpansion.vue";

// ── Fixtures matching RunLocationResult shape ───────────────────────────────
function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    timestampMs: 1_700_000_000_000,
    status: "passed" as const,
    durationMs: 1240,
    location: "us-east-1",
    device: "laptop_large",
    browserEngine: "chromium",
    error: "",
    jobId: "job-001",
    executionId: "exec-001",
    traceKey: null,
    steps: [],
    recordedSteps: [],
    retryHistory: [],
    ...overrides,
  };
}

function makeFailedExecution(overrides: Record<string, unknown> = {}) {
  return makeExecution({
    status: "failed" as const,
    error: "TimeoutError: page.waitForSelector timed out",
    executionId: "exec-002",
    steps: [
      {
        stepId: "step-1",
        status: "ok" as const,
        durationMs: 1200,
        error: "",
        screenshotKey: null,
      },
      {
        stepId: "step-2",
        status: "fail" as const,
        durationMs: 28140,
        error: "Timeout",
        screenshotKey: null,
      },
    ],
    ...overrides,
  });
}

const mockExecutions = [
  makeExecution(),
  makeExecution({ location: "eu-west-1", device: "tablet", browserEngine: "firefox" }),
];

const mockFailedExecutions = [
  makeFailedExecution(),
  makeExecution({ location: "eu-west-1", status: "warning" as const }),
];

describe("RunRowExpansion", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(RunRowExpansion, {
      global: {
        plugins: [i18n, store],
      },
      props: {
        runId: "run-001",
        monitorId: "mon-http-1",
        scheduledTs: 1_700_000_000_000_000,
        ...props,
      },
    });
  }

  describe("loading state", () => {
    it("should show skeleton while data is loading", async () => {
      // Hold the promise unresolved so loading stays true
      let resolvePromise: (value: any) => void;
      mockExecuteQuery.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      wrapper = mountComponent();
      await flushPromises();

      // Skeleton divs should be present while loading (use animate-pulse class)
      const skelElements = wrapper.findAll(".animate-pulse");
      expect(skelElements.length).toBeGreaterThan(0);

      // Resolve to allow unmount
      resolvePromise!(mockExecutions);
      await flushPromises();
    });
  });

  describe("query error", () => {
    it("should show error message when query fails", async () => {
      mockExecuteQuery.mockRejectedValueOnce(new Error("Query failed"));

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Query failed");
    });

    it("should suppress ignorable stream-not-found errors", async () => {
      mockExecuteQuery.mockRejectedValueOnce(
        new Error("stream synthetics_results not found"),
      );

      wrapper = mountComponent();
      await flushPromises();

      // Should show "no data" not the error
      expect(wrapper.text()).not.toContain("stream synthetics_results not found");
      expect(wrapper.text()).toContain("No execution data found for this run.");
    });
  });

  describe("no data state", () => {
    it("should show no-data message when executions are empty", async () => {
      mockExecuteQuery.mockResolvedValueOnce([]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("No execution data found for this run.");
    });

    it("should show probe infrastructure error message when runStatus is error", async () => {
      mockExecuteQuery.mockResolvedValueOnce([]);

      wrapper = mountComponent({ runStatus: "error" });
      await flushPromises();

      expect(wrapper.text()).toContain("Probe infrastructure error");
    });
  });

  describe("location groups", () => {
    beforeEach(() => {
      mockExecuteQuery.mockResolvedValue(mockExecutions);
    });

    it("should render location groups when executions are loaded", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("us-east-1");
      expect(wrapper.text()).toContain("eu-west-1");
    });

    it("should show Passed status label for passed executions", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Passed");
    });
  });

  describe("location expansion", () => {
    it("should expand and show execution table when location header is clicked", async () => {
      mockExecuteQuery.mockResolvedValue(mockExecutions);

      wrapper = mountComponent();
      await flushPromises();

      // Initially, execution table rows should not be visible
      const beforeClick = wrapper.findAll("td");
      expect(beforeClick.length).toBe(0);

      // Find and click the first location header button
      const locationBtn = wrapper.find("button");
      expect(locationBtn.exists()).toBe(true);
      await locationBtn.trigger("click");

      // Now table cells should be visible
      const afterClick = wrapper.findAll("td");
      expect(afterClick.length).toBeGreaterThan(0);
    });

    it("should show execution details including browser, device, and duration", async () => {
      mockExecuteQuery.mockResolvedValue(mockExecutions);

      wrapper = mountComponent();
      await flushPromises();

      // Expand the first location
      const locationBtn = wrapper.find("button");
      await locationBtn.trigger("click");

      const tableText = wrapper.text();
      expect(tableText).toContain("chromium");
      expect(tableText).toContain("laptop_large");
    });
  });

  describe("failed executions", () => {
    it("should show failed status and failed-at step", async () => {
      mockExecuteQuery.mockResolvedValue(mockFailedExecutions);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Failed");

      // Expand the first location
      const locationBtn = wrapper.find("button");
      await locationBtn.trigger("click");

      expect(wrapper.text()).toContain("step-2");
    });
  });

  describe("execution drawer", () => {
    it("should open execution detail drawer when an execution row is clicked", async () => {
      mockExecuteQuery.mockResolvedValue(mockExecutions);

      wrapper = mountComponent();
      await flushPromises();

      // Expand the first location
      const locationBtn = wrapper.find("button");
      await locationBtn.trigger("click");

      // Drawer should not be visible initially
      expect(wrapper.find('[data-test="execution-detail-drawer"]').exists()).toBe(false);

      // Click the first execution row (first td in tbody)
      const execRows = wrapper.findAll("tbody tr");
      expect(execRows.length).toBeGreaterThan(0);
      await execRows[0].trigger("click");

      expect(wrapper.find('[data-test="execution-detail-drawer"]').exists()).toBe(true);
    });
  });
});
