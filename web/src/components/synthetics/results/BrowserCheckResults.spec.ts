// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: () => store,
  };
});

const mockResults = vi.fn().mockResolvedValue({ data: { results: [] } });

vi.mock("@/services/synthetics", () => ({
  default: { results: (...args: any[]) => mockResults(...args) },
}));

vi.mock("./RunDetailDrawer.vue", () => ({
  default: {
    name: "RunDetailDrawer",
    props: ["run", "checkId", "open"],
    emits: ["close"],
    template: '<div data-test="run-detail-drawer"></div>',
  },
}));

import BrowserCheckResults from "./BrowserCheckResults.vue";

// Fixtures matching the component's RunResult interface (snake_case fields)
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-001",
    synthetics_id: "mon-http-1",
    location: "us-east-1",
    pool: "default",
    status: "up" as const,
    response_time_ms: 1240,
    error: "",
    browser_engine: "chromium",
    device: "laptop_large",
    checked_at: 1_700_000_000_000_000,
    screenshot_refs: [],
    trace_ref: undefined,
    ...overrides,
  };
}

const mockRunPassed = makeRun();
const mockRunWarning = makeRun({ status: "warning" as const });
const mockRunError = makeRun({
  status: "error" as const,
  error: "Something went wrong",
});
const mockRunDown = makeRun({ status: "down" as const });
const mockRunList = [mockRunPassed, mockRunWarning, mockRunError, mockRunDown];

describe("BrowserCheckResults", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(BrowserCheckResults, {
      global: {
        plugins: [store],
      },
      props: { checkId: "mon-http-1", ...props },
    });
  }

  describe("loading state", () => {
    it("should not show empty state while isLoading is true", async () => {
      // Hold the promise so isLoading stays true
      let resolvePromise: (value: unknown) => void;
      mockResults.mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-results-empty-state"]').exists()).toBe(false);

      // Resolve so cleanup can proceed
      resolvePromise!({ data: { results: mockRunList } });
      await flushPromises();
    });
  });

  describe("empty state", () => {
    it("should show empty state when runs array is empty", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [] } });

      wrapper = mountComponent();
      await flushPromises();

      const emptyState = wrapper.find('[data-test="synthetics-results-empty-state"]');
      expect(emptyState.exists()).toBe(true);
    });

    it("should show empty state when results key is missing", async () => {
      mockResults.mockResolvedValueOnce({ data: {} });

      wrapper = mountComponent();
      await flushPromises();

      const emptyState = wrapper.find('[data-test="synthetics-results-empty-state"]');
      expect(emptyState.exists()).toBe(true);
    });
  });

  describe("runs table", () => {
    it("should render result rows when runs are loaded", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: mockRunList } });

      wrapper = mountComponent();
      await flushPromises();

      const rows = wrapper.findAll('[data-test="synthetics-result-row"]');
      expect(rows).toHaveLength(mockRunList.length);
    });

    it("should display Passed status badge for up status", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [mockRunPassed] } });

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="synthetics-result-row"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("Passed");
    });

    it("should display Warning status badge for warning status", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [mockRunWarning] } });

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="synthetics-result-row"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("Warning");
    });

    it("should display Error status badge for error status", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [mockRunError] } });

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="synthetics-result-row"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("Error");
    });

    it("should display Failed status for down status", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [mockRunDown] } });

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="synthetics-result-row"]');
      expect(row.exists()).toBe(true);
      expect(row.text()).toContain("Failed");
    });

    it("should display duration, location, and device in each row", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: [mockRunPassed] } });

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="synthetics-result-row"]');
      const text = row.text();
      expect(text).toContain("ms");
      expect(text).toContain(mockRunPassed.location);
      expect(text).toContain(mockRunPassed.device);
    });
  });

  describe("row click opens drawer", () => {
    it("should open RunDetailDrawer when a row is clicked", async () => {
      mockResults.mockResolvedValueOnce({ data: { results: mockRunList } });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="run-detail-drawer"]').exists()).toBe(false);

      const firstRow = wrapper.findAll('[data-test="synthetics-result-row"]')[0];
      expect(firstRow).toBeDefined();
      await firstRow.trigger("click");

      expect(wrapper.find('[data-test="run-detail-drawer"]').exists()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should show empty state when service call fails", async () => {
      mockResults.mockRejectedValueOnce(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      const emptyState = wrapper.find('[data-test="synthetics-results-empty-state"]');
      expect(emptyState.exists()).toBe(true);
    });
  });
});
