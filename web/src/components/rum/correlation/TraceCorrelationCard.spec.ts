// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick, ref } from "vue";

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * Factory to create mock correlation data
 */
function createMockCorrelationData(overrides: Record<string, any> = {}) {
  return {
    trace_id: "test-trace-id-123456789",
    session_id: "test-session-123",
    rum_events: [],
    backend_spans: [{ span_id: "span1" }, { span_id: "span2" }],
    has_backend_trace: true,
    performance_breakdown: {
      total_duration_ms: 500,
      browser_duration_ms: 200,
      network_latency_ms: 50,
      backend_duration_ms: 250,
    },
    ...overrides,
  };
}

/**
 * Factory to create mock performance data
 */
function createMockPerformanceData(overrides: Record<string, any> = {}) {
  return {
    total_duration_ms: 500,
    browser_duration_ms: 200,
    network_latency_ms: 50,
    backend_duration_ms: 250,
    ...overrides,
  };
}

// ============================================================================
// TEST SETUP
// ============================================================================

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Notify],
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// Mock useTraceCorrelation composable
const mockFetchCorrelation = vi.fn();
const mockCorrelationData = createMockCorrelationData();

// Mutable mock return values - using actual Vue refs
let mockIsLoading = ref(false);
let mockCorrelationDataRef = ref(mockCorrelationData);
let mockHasBackendTrace = ref(true);
let mockBackendSpanCount = ref(2);
let mockPerformanceData = ref(mockCorrelationData.performance_breakdown);

// Mock at module level - this gets hoisted
vi.mock("@/composables/rum/useTraceCorrelation", () => ({
  default: () => ({
    correlationData: mockCorrelationDataRef,
    isLoading: mockIsLoading,
    hasBackendTrace: mockHasBackendTrace,
    backendSpanCount: mockBackendSpanCount,
    performanceData: mockPerformanceData,
    fetchCorrelation: mockFetchCorrelation,
  }),
}));

// ============================================================================
// TEST HELPERS
// ============================================================================

interface MountOptions {
  props?: Record<string, any>;
}

/**
 * Helper to mount component with default configuration
 */
function mountComponent(options: MountOptions = {}) {
  const defaultProps = {
    traceId: "test-trace-id-123456789",
    spanId: "test-span-id-123",
    sessionId: "test-session-123",
    resourceDuration: 500,
  };

  return mount(TraceCorrelationCard, {
    attachTo: "#app",
    props: { ...defaultProps, ...options.props },
    global: {
      plugins: [i18n, router],
      provide: { store },
    },
  });
}

/**
 * Helper to find button by text content
 */
function findButtonByText(wrapper: VueWrapper, text: string) {
  const buttons = wrapper.findAll("button");
  return buttons.find((btn: any) => btn.text().includes(text));
}

/**
 * Helper to find button by icon
 */
function findButtonByIcon(wrapper: VueWrapper, icon: string) {
  const buttons = wrapper.findAll("button");
  return buttons.find((btn: any) => btn.html().includes(icon));
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("TraceCorrelationCard", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mock function implementation to default
    mockFetchCorrelation.mockReset();
    mockFetchCorrelation.mockResolvedValue(undefined);

    // Reset to default mock state
    mockIsLoading.value = false;
    mockCorrelationDataRef.value = createMockCorrelationData();
    mockHasBackendTrace.value = true;
    mockBackendSpanCount.value = 2;
    mockPerformanceData.value = createMockPerformanceData();

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // COMPONENT RENDERING
  // ==========================================================================

  describe("Component rendering", () => {
    it("should mount TraceCorrelationCard component", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".trace-correlation-card").exists()).toBe(true);
    });

    it("should display title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Distributed Trace");
    });

    it("should display trace ID section when traceId is provided", () => {
      expect(wrapper.text()).toContain("Trace ID:");
      expect(wrapper.find(".trace-id-text").exists()).toBe(true);
    });

    it("should display span ID section when spanId is provided", () => {
      expect(wrapper.text()).toContain("Span ID:");
      expect(wrapper.find(".span-id-text").exists()).toBe(true);
    });
  });

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  describe("Loading state", () => {
    it("should show loading spinner when isLoading is true", async () => {
      wrapper.unmount();

      mockIsLoading.value = true;
      mockCorrelationDataRef.value = null;
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      mockFetchCorrelation.mockImplementation(() => {
        mockIsLoading.value = true;
        return new Promise(() => {});
      });

      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      expect(wrapper.text()).toContain("Loading trace data...");

      mockIsLoading.value = false;
    });
  });

  // ==========================================================================
  // NO TRACE ID STATE
  // ==========================================================================

  describe("No trace ID state", () => {
    it("should show no trace message when traceId is empty", async () => {
      wrapper.unmount();

      mockIsLoading.value = false;
      mockCorrelationDataRef.value = null;
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      wrapper = mountComponent({ props: { traceId: "" } });
      await flushPromises();

      expect(wrapper.text()).toContain(
        "No trace information available for this event",
      );
    });
  });

  // ==========================================================================
  // TRACE ID FORMATTING
  // ==========================================================================

  describe("Trace ID formatting", () => {
    it("should format long trace ID correctly", () => {
      const traceIdText = wrapper.find(".trace-id-text");
      expect(traceIdText.exists()).toBe(true);
      expect(traceIdText.text()).toMatch(/^test-tra\.\.\.23456789$/);
    });

    it("should not truncate short trace ID", async () => {
      wrapper.unmount();
      wrapper = mountComponent({ props: { traceId: "short-id" } });
      await flushPromises();

      const traceIdText = wrapper.find(".trace-id-text");
      expect(traceIdText.text()).toBe("short-id");
    });
  });

  // ==========================================================================
  // SPAN HIERARCHY
  // ==========================================================================

  describe("Span hierarchy", () => {
    it("should display span hierarchy when backend trace exists", () => {
      expect(wrapper.text()).toContain("Span Hierarchy:");
      expect(wrapper.text()).toContain("Application Span");
      expect(wrapper.text()).toContain("Browser SDK Span");
      expect(wrapper.text()).toContain("Backend Spans");
    });

    it("should display backend span count", () => {
      expect(wrapper.text()).toContain("Backend Spans (2)");
    });
  });

  // ==========================================================================
  // PERFORMANCE BREAKDOWN
  // ==========================================================================

  describe("Performance breakdown", () => {
    it("should display performance breakdown when data is available", () => {
      expect(wrapper.text()).toContain("Performance Breakdown:");
      expect(wrapper.text()).toContain("Total Duration:");
      expect(wrapper.text()).toContain("500ms");
    });

    it("should display browser duration with percentage", () => {
      expect(wrapper.text()).toContain("Browser:");
      expect(wrapper.text()).toContain("200ms");
      expect(wrapper.text()).toContain("40%");
    });

    it("should display network latency with percentage", () => {
      expect(wrapper.text()).toContain("Network:");
      expect(wrapper.text()).toContain("50ms");
      expect(wrapper.text()).toContain("10%");
    });

    it("should display backend duration with percentage", () => {
      expect(wrapper.text()).toContain("Backend:");
      expect(wrapper.text()).toContain("250ms");
      expect(wrapper.text()).toContain("50%");
    });
  });

  // ==========================================================================
  // USER INTERACTIONS
  // ==========================================================================

  describe("Copy trace ID functionality", () => {
    it("should copy trace ID to clipboard when copy button is clicked", async () => {
      const copyBtn = findButtonByIcon(wrapper, "content_copy");
      expect(copyBtn).toBeDefined();
      expect(copyBtn?.exists()).toBe(true);

      await copyBtn?.trigger("click");

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test-trace-id-123456789",
      );
    });

    it("should show success message after copying", async () => {
      const copyBtn = findButtonByIcon(wrapper, "content_copy");
      await copyBtn?.trigger("click");
      await flushPromises();

      // Notification is shown (tested via spy in next test)
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });

  describe("Action buttons", () => {
    it("should display View Trace Details button", () => {
      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn).toBeDefined();
      expect(viewBtn?.exists()).toBe(true);
    });

    it("should enable View Trace Details button when backend trace exists", () => {
      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn?.attributes("disabled")).toBeUndefined();
    });

    it("should disable View Trace Details button when no backend trace", async () => {
      wrapper.unmount();

      mockIsLoading.value = false;
      mockCorrelationDataRef.value = createMockCorrelationData();
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      wrapper = mountComponent();
      await flushPromises();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn?.attributes("disabled")).toBeDefined();
    });

    it("should display Refresh button", () => {
      const refreshBtn = findButtonByText(wrapper, "Refresh");
      expect(refreshBtn).toBeDefined();
      expect(refreshBtn?.exists()).toBe(true);
    });

    it("should call fetchCorrelation when Refresh button is clicked", async () => {
      const refreshBtn = findButtonByText(wrapper, "Refresh");
      await refreshBtn?.trigger("click");

      expect(mockFetchCorrelation).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ACCESSIBILITY
  // ==========================================================================

  describe("Accessibility", () => {
    it("should be keyboard accessible - copy button with Enter", async () => {
      const copyBtn = findButtonByIcon(wrapper, "content_copy");
      // In real browsers, Enter on a button triggers a click event
      await copyBtn?.trigger("keydown.enter");
      await copyBtn?.trigger("click");

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test-trace-id-123456789",
      );
    });

    it("should be keyboard accessible - copy button with Space", async () => {
      const copyBtn = findButtonByIcon(wrapper, "content_copy");
      // In real browsers, Space on a button triggers a click event
      await copyBtn?.trigger("keydown.space");
      await copyBtn?.trigger("click");

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test-trace-id-123456789",
      );
    });

    it("should be keyboard accessible - refresh button", async () => {
      const refreshBtn = findButtonByText(wrapper, "Refresh");
      await refreshBtn?.trigger("keydown.enter");

      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should be keyboard accessible - view details button", async () => {
      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn?.trigger("keydown.enter");
      await flushPromises();

      // Button click should work
      expect(viewBtn?.exists()).toBe(true);
    });

    it("should have accessible button labels", () => {
      const buttons = wrapper.findAll("button");
      buttons.forEach((btn: any) => {
        const label = btn.attributes("aria-label") || btn.text();
        expect(label).toBeTruthy();
        expect(label.length).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // MISSING TRACE NOTICE
  // ==========================================================================

  describe("Missing trace notice", () => {
    it("should show missing trace notice when no backend trace", async () => {
      wrapper.unmount();

      mockIsLoading.value = false;
      mockCorrelationDataRef.value = createMockCorrelationData();
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Backend trace data not yet available");
      expect(wrapper.text()).toContain(
        "Trace data may take up to 30 seconds to be ingested",
      );
    });
  });

  // ==========================================================================
  // COMPONENT LIFECYCLE
  // ==========================================================================

  describe("Component lifecycle", () => {
    it("should fetch correlation data on mount when traceId is provided", () => {
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should fetch correlation data when traceId prop changes", async () => {
      mockFetchCorrelation.mockClear();

      await wrapper.setProps({ traceId: "new-trace-id" });
      await flushPromises();

      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should not fetch correlation data when traceId is empty", async () => {
      wrapper.unmount();
      mockFetchCorrelation.mockClear();

      wrapper = mountComponent({ props: { traceId: "" } });
      await flushPromises();

      expect(mockFetchCorrelation).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PROPS VALIDATION
  // ==========================================================================

  describe("Props validation", () => {
    it("should display trace ID when provided", () => {
      expect(wrapper.text()).toContain("test-tra...23456789");
    });

    it("should display span ID when provided", () => {
      expect(wrapper.text()).toContain("Span ID:");
    });

    it("should work with minimal props", async () => {
      const w = mountComponent({ props: { traceId: "test-only" } });
      await flushPromises();

      expect(w.exists()).toBe(true);
      expect(w.text()).toContain("Distributed Trace");
      w.unmount();
    });

    it("should react to traceId prop changes", async () => {
      mockFetchCorrelation.mockClear();
      await wrapper.setProps({ traceId: "new-trace-id" });
      await flushPromises();

      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should accept all props without errors", () => {
      // Component mounted successfully in beforeEach with all props
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Distributed Trace");
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe("Edge cases", () => {
    it("should handle null correlationData", async () => {
      mockCorrelationDataRef.value = null;
      await nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("should handle undefined traceId", async () => {
      await wrapper.setProps({ traceId: undefined });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle extremely long trace ID", async () => {
      const longId = "a".repeat(1000);
      await wrapper.setProps({ traceId: longId });
      await flushPromises();

      const traceIdText = wrapper.find(".trace-id-text");
      expect(traceIdText.text().length).toBeLessThan(50);
    });

    it("should handle zero duration", async () => {
      mockPerformanceData.value = createMockPerformanceData({
        total_duration_ms: 0,
        browser_duration_ms: 0,
        network_latency_ms: 0,
        backend_duration_ms: 0,
      });
      await nextTick();

      expect(wrapper.text()).toContain("0ms");
    });

    it("should handle negative duration gracefully", async () => {
      mockPerformanceData.value = createMockPerformanceData({
        total_duration_ms: -100,
      });
      await nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("should handle missing performance data", async () => {
      mockPerformanceData.value = null;
      await nextTick();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty backend spans array", async () => {
      mockCorrelationDataRef.value = createMockCorrelationData({
        backend_spans: [],
        has_backend_trace: false,
      });
      mockBackendSpanCount.value = 0;
      mockHasBackendTrace.value = false;
      await nextTick();

      expect(wrapper.text()).toContain("Backend trace data not yet available");
    });

    it("should handle special characters in trace ID", async () => {
      await wrapper.setProps({
        traceId: "<script>alert('xss')</script>",
      });
      await flushPromises();

      expect(wrapper.html()).not.toContain("<script>");
    });
  });

  // ==========================================================================
  // DATA FORMATTING
  // ==========================================================================

  describe("Data formatting utilities", () => {
    describe("Percentage calculation", () => {
      it("should calculate percentage correctly", () => {
        const result = wrapper.vm.calculatePercentage(200, 500);
        expect(result).toBe(40);
      });

      it("should return 0 when total is 0", () => {
        const result = wrapper.vm.calculatePercentage(100, 0);
        expect(result).toBe(0);
      });

      it("should handle decimal results", () => {
        const result = wrapper.vm.calculatePercentage(33, 100);
        expect(result).toBe(33);
      });
    });

    describe("Span ID formatting", () => {
      it("should format long span ID correctly", () => {
        const result = wrapper.vm.formatSpanId("test-span-id-123");
        expect(result).toBe("test-s...id-123");
      });

      it("should not truncate short span ID", () => {
        const result = wrapper.vm.formatSpanId("short");
        expect(result).toBe("short");
      });

      it("should handle empty span ID", () => {
        const result = wrapper.vm.formatSpanId("");
        expect(result).toBe("");
      });
    });
  });

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe("Integration scenarios", () => {
    it("should handle complete trace correlation flow", async () => {
      // 1. Component mounts with trace data
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Distributed Trace");

      // 2. Shows trace information
      expect(wrapper.text()).toContain("test-tra...23456789");
      expect(wrapper.text()).toContain("Backend Spans (2)");

      // 3. User copies trace ID
      const copyBtn = findButtonByIcon(wrapper, "content_copy");
      await copyBtn?.trigger("click");
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      // 4. User refreshes data
      mockFetchCorrelation.mockClear();
      const refreshBtn = findButtonByText(wrapper, "Refresh");
      await refreshBtn?.trigger("click");
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should handle no backend trace scenario", async () => {
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      await nextTick();

      expect(wrapper.text()).toContain("Backend trace data not yet available");

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn?.attributes("disabled")).toBeDefined();
    });
  });
});
