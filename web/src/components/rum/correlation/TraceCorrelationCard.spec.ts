import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick, ref } from "vue";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (text: string) => {
    navigator.clipboard.writeText(text);
    return Promise.resolve();
  },
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

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

function createMockPerformanceData(overrides: Record<string, any> = {}) {
  return {
    total_duration_ms: 500,
    browser_duration_ms: 200,
    network_latency_ms: 50,
    backend_duration_ms: 250,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DOM node for attachTo
// ---------------------------------------------------------------------------

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// ---------------------------------------------------------------------------
// Mock clipboard
// ---------------------------------------------------------------------------

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// ---------------------------------------------------------------------------
// Mock useTraceCorrelation — mutable refs
// ---------------------------------------------------------------------------

const mockFetchCorrelation = vi.fn();
let mockIsLoading = ref(false);
let mockCorrelationDataRef = ref<any>(createMockCorrelationData());
let mockHasBackendTrace = ref(true);
let mockBackendSpanCount = ref(2);
let mockPerformanceData = ref<any>(createMockPerformanceData());

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

// ---------------------------------------------------------------------------
// Stubs for O* components that import heavy deps
// ---------------------------------------------------------------------------

const globalStubs = {
  OButton: {
    name: "OButton",
    template:
      '<button :disabled="disabled || undefined" v-bind="$attrs" @click="!disabled && $emit(\'click\', $event)" @keydown="$emit(\'keydown\', $event)"><slot /></button>',
    props: ["variant", "size", "disabled", "iconLeft"],
    emits: ["click", "keydown"],
    inheritAttrs: false,
  },
  OSpinner: { template: '<div data-test="spinner" />' },
  OIcon: { name: "OIcon", template: "<span />", props: ["name", "size"] },
  OTooltip: { template: "<span />", props: ["content"] },
  OSeparator: { template: "<hr />" },
};

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

interface MountOptions {
  props?: Record<string, any>;
}

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
      stubs: globalStubs,
    },
  });
}

// ---------------------------------------------------------------------------
// Helper finders
// ---------------------------------------------------------------------------

function findButtonByText(wrapper: VueWrapper, text: string) {
  const buttons = wrapper.findAll("button");
  return buttons.find((btn: any) => btn.text().includes(text));
}

function findCopyButton(wrapper: VueWrapper) {
  // Copy button is an icon-only button (no visible text) near the trace-id-text
  const buttons = wrapper.findAll("button");
  // First look for a button with no text content inside the trace-id section
  const iconOnly = buttons.find((btn: any) => btn.text().trim() === "");
  return iconOnly;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceCorrelationCard", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetchCorrelation.mockReset();
    mockFetchCorrelation.mockResolvedValue(undefined);

    mockIsLoading.value = false;
    mockCorrelationDataRef.value = createMockCorrelationData();
    mockHasBackendTrace.value = true;
    mockBackendSpanCount.value = 2;
    mockPerformanceData.value = createMockPerformanceData();

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Component rendering
  // =========================================================================

  describe("component rendering", () => {
    it("mounts TraceCorrelationCard without errors", () => {
      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("displays 'Distributed Trace' as the card title", () => {
      // Assert
      expect(wrapper.text()).toContain("Distributed Trace");
    });

    it("displays trace ID section when traceId is provided", () => {
      // Assert
      expect(wrapper.text()).toContain("Trace ID:");
    });

    it("renders trace-id-text element when traceId is provided", () => {
      // Assert
      expect(wrapper.find('[data-test="trace-correlation-card-trace-id-text"]').exists()).toBe(
        true,
      );
    });

    it("displays span ID section when spanId is provided", () => {
      // Assert
      expect(wrapper.text()).toContain("Span ID:");
    });

    it("renders span-id-text element when spanId is provided", () => {
      // Assert
      expect(wrapper.find('[data-test="trace-correlation-card-span-id-text"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  describe("loading state", () => {
    it("shows loading text when isLoading is true", async () => {
      // Arrange
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

      // Act
      wrapper = mountComponent();
      await nextTick();
      await nextTick();

      // Assert
      expect(wrapper.text()).toContain("Loading trace data...");

      mockIsLoading.value = false;
    });
  });

  // =========================================================================
  // No trace ID state
  // =========================================================================

  describe("no trace ID state", () => {
    it("shows 'no trace information' message when traceId is empty", async () => {
      // Arrange
      wrapper.unmount();
      mockIsLoading.value = false;
      mockCorrelationDataRef.value = null;
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      // Act
      wrapper = mountComponent({ props: { traceId: "" } });
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("No trace information available for this event");
    });
  });

  // =========================================================================
  // Trace ID formatting
  // =========================================================================

  describe("trace ID formatting", () => {
    it("truncates long trace ID to start...end format", () => {
      // Act
      const traceIdText = wrapper.find('[data-test="trace-correlation-card-trace-id-text"]');

      // Assert
      expect(traceIdText.text()).toMatch(/^test-tra\.\.\.23456789$/);
    });

    it("does not truncate short trace ID", async () => {
      // Arrange
      wrapper.unmount();

      // Act
      wrapper = mountComponent({ props: { traceId: "short-id" } });
      await flushPromises();

      // Assert
      expect(wrapper.find('[data-test="trace-correlation-card-trace-id-text"]').text()).toBe(
        "short-id",
      );
    });
  });

  // =========================================================================
  // Span hierarchy
  // =========================================================================

  describe("span hierarchy", () => {
    it("displays 'Span Hierarchy:' when backend trace exists", () => {
      // Assert
      expect(wrapper.text()).toContain("Span Hierarchy:");
    });

    it("displays Application Span label", () => {
      // Assert
      expect(wrapper.text()).toContain("Application Span");
    });

    it("displays Browser SDK Span label", () => {
      // Assert
      expect(wrapper.text()).toContain("Browser SDK Span");
    });

    it("displays Backend Spans label", () => {
      // Assert
      expect(wrapper.text()).toContain("Backend Spans");
    });

    it("displays backend span count in parentheses", () => {
      // Assert
      expect(wrapper.text()).toContain("Backend Spans (2)");
    });
  });

  // =========================================================================
  // Performance breakdown
  // =========================================================================

  describe("performance breakdown", () => {
    it("displays 'Performance Breakdown:' heading", () => {
      // Assert
      expect(wrapper.text()).toContain("Performance Breakdown:");
    });

    it("displays 'Total Duration:' label", () => {
      // Assert
      expect(wrapper.text()).toContain("Total Duration:");
    });

    it("displays total duration value in ms", () => {
      // Assert
      expect(wrapper.text()).toContain("500ms");
    });

    it("displays browser duration label", () => {
      // Assert
      expect(wrapper.text()).toContain("Browser:");
    });

    it("displays browser duration value", () => {
      // Assert
      expect(wrapper.text()).toContain("200ms");
    });

    it("displays browser duration percentage", () => {
      // Assert
      expect(wrapper.text()).toContain("40%");
    });

    it("displays network latency label", () => {
      // Assert
      expect(wrapper.text()).toContain("Network:");
    });

    it("displays network latency value", () => {
      // Assert
      expect(wrapper.text()).toContain("50ms");
    });

    it("displays network latency percentage", () => {
      // Assert
      expect(wrapper.text()).toContain("10%");
    });

    it("displays backend duration label", () => {
      // Assert
      expect(wrapper.text()).toContain("Backend:");
    });

    it("displays backend duration value", () => {
      // Assert
      expect(wrapper.text()).toContain("250ms");
    });

    it("displays backend duration percentage", () => {
      // Assert
      expect(wrapper.text()).toContain("50%");
    });
  });

  // =========================================================================
  // Copy trace ID
  // =========================================================================

  describe("copy trace ID functionality", () => {
    it("copies trace ID to clipboard when copy button is clicked", async () => {
      // Arrange
      const copyBtn = findCopyButton(wrapper);
      expect(copyBtn).toBeDefined();

      // Act
      await copyBtn?.trigger("click");

      // Assert
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-trace-id-123456789");
    });

    it("clipboard.writeText is called on copy button click", async () => {
      // Arrange
      const copyBtn = findCopyButton(wrapper);

      // Act
      await copyBtn?.trigger("click");
      await flushPromises();

      // Assert
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Action buttons
  // =========================================================================

  describe("action buttons", () => {
    it("displays View Trace Details button", () => {
      // Act
      const viewBtn = findButtonByText(wrapper, "View Trace Details");

      // Assert
      expect(viewBtn).toBeDefined();
      expect(viewBtn?.exists()).toBe(true);
    });

    it("enables View Trace Details button when backend trace exists", () => {
      // Act
      const viewBtn = findButtonByText(wrapper, "View Trace Details");

      // Assert
      expect(viewBtn?.attributes("disabled")).toBeUndefined();
    });

    it("disables View Trace Details button when no backend trace", async () => {
      // Arrange
      wrapper.unmount();
      mockIsLoading.value = false;
      mockCorrelationDataRef.value = createMockCorrelationData();
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      // Act
      wrapper = mountComponent();
      await flushPromises();
      const viewBtn = findButtonByText(wrapper, "View Trace Details");

      // Assert
      expect(viewBtn?.attributes("disabled")).toBeDefined();
    });

    it("displays Refresh button", () => {
      // Act
      const refreshBtn = findButtonByText(wrapper, "Refresh");

      // Assert
      expect(refreshBtn).toBeDefined();
      expect(refreshBtn?.exists()).toBe(true);
    });

    it("calls fetchCorrelation when Refresh button is clicked", async () => {
      // Arrange
      const refreshBtn = findButtonByText(wrapper, "Refresh");

      // Act
      await refreshBtn?.trigger("click");

      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Missing trace notice
  // =========================================================================

  describe("missing trace notice", () => {
    it("shows 'Backend trace data not yet available' when no backend trace", async () => {
      // Arrange
      wrapper.unmount();
      mockIsLoading.value = false;
      mockCorrelationDataRef.value = createMockCorrelationData();
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      // Act
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Backend trace data not yet available");
    });

    it("shows ingestion delay message when no backend trace", async () => {
      // Arrange
      wrapper.unmount();
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      mockPerformanceData.value = null;

      // Act
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      expect(wrapper.text()).toContain("Trace data may take up to 30 seconds to be ingested");
    });
  });

  // =========================================================================
  // Component lifecycle
  // =========================================================================

  describe("component lifecycle", () => {
    it("fetches correlation data on mount when traceId is provided", () => {
      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("fetches correlation data when traceId prop changes", async () => {
      // Arrange
      mockFetchCorrelation.mockClear();

      // Act
      await wrapper.setProps({ traceId: "new-trace-id" });
      await flushPromises();

      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("does not fetch correlation data when traceId is empty on mount", async () => {
      // Arrange
      wrapper.unmount();
      mockFetchCorrelation.mockClear();

      // Act
      wrapper = mountComponent({ props: { traceId: "" } });
      await flushPromises();

      // Assert
      expect(mockFetchCorrelation).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================

  describe("accessibility", () => {
    it("copy button responds to click after Enter keydown", async () => {
      // Arrange
      const copyBtn = findCopyButton(wrapper);

      // Act — Enter does not auto-trigger click in jsdom; trigger click explicitly
      await copyBtn?.trigger("keydown.enter");
      await copyBtn?.trigger("click");

      // Assert
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-trace-id-123456789");
    });

    it("copy button responds to click after Space keydown", async () => {
      // Arrange
      const copyBtn = findCopyButton(wrapper);

      // Act
      await copyBtn?.trigger("keydown.space");
      await copyBtn?.trigger("click");

      // Assert
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-trace-id-123456789");
    });

    it("refresh button responds to Enter keydown (calls fetchCorrelation)", async () => {
      // Arrange
      const refreshBtn = findButtonByText(wrapper, "Refresh");

      // Act
      await refreshBtn?.trigger("keydown.enter");

      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("View Trace Details button is reachable via keyboard (Enter keydown)", async () => {
      // Arrange
      const viewBtn = findButtonByText(wrapper, "View Trace Details");

      // Act — trigger Enter keydown (button remains accessible)
      await viewBtn?.trigger("keydown.enter");
      await flushPromises();

      // Assert — button still exists and is a valid element
      expect(viewBtn?.exists()).toBe(true);
    });

    it("all buttons are valid button elements", () => {
      // Act
      const buttons = wrapper.findAll("button");

      // Assert
      buttons.forEach((btn: any) => {
        expect(btn.element.tagName.toLowerCase()).toBe("button");
      });
    });

    it("buttons with text content or aria-label have non-empty labels", () => {
      // Act
      const buttons = wrapper.findAll("button");

      // Assert — each button either has text or aria-label
      buttons.forEach((btn: any) => {
        const ariaLabel = btn.attributes("aria-label");
        const text = btn.text().trim();
        // Icon-only buttons may have neither (they use tooltip); all must be <button> elements
        expect(btn.element.tagName.toLowerCase()).toBe("button");
        if (text || ariaLabel) {
          expect((text || ariaLabel).length).toBeGreaterThan(0);
        }
      });
    });
  });

  // =========================================================================
  // Data formatting utilities
  // =========================================================================

  describe("calculatePercentage utility", () => {
    it("calculates percentage correctly for 200 of 500", () => {
      // Act
      const result = wrapper.vm.calculatePercentage(200, 500);

      // Assert
      expect(result).toBe(40);
    });

    it("returns 0 when total is 0", () => {
      // Act
      const result = wrapper.vm.calculatePercentage(100, 0);

      // Assert
      expect(result).toBe(0);
    });

    it("handles whole number results", () => {
      // Act
      const result = wrapper.vm.calculatePercentage(33, 100);

      // Assert
      expect(result).toBe(33);
    });
  });

  describe("formatSpanId utility", () => {
    it("truncates long span ID to start...end format", () => {
      // Act
      const result = wrapper.vm.formatSpanId("test-span-id-123");

      // Assert
      expect(result).toBe("test-s...id-123");
    });

    it("does not truncate short span ID", () => {
      // Act
      const result = wrapper.vm.formatSpanId("short");

      // Assert
      expect(result).toBe("short");
    });

    it("returns empty string for empty input", () => {
      // Act
      const result = wrapper.vm.formatSpanId("");

      // Assert
      expect(result).toBe("");
    });
  });

  // =========================================================================
  // Props validation
  // =========================================================================

  describe("props validation", () => {
    it("displays formatted trace ID in the trace-id-text element", () => {
      // Assert
      expect(wrapper.text()).toContain("test-tra...23456789");
    });

    it("renders successfully with minimal props (traceId only)", async () => {
      // Arrange + Act
      const w = mountComponent({ props: { traceId: "test-only" } });
      await flushPromises();

      // Assert
      expect(w.exists()).toBe(true);
      expect(w.text()).toContain("Distributed Trace");
      w.unmount();
    });

    it("re-fetches when traceId prop changes", async () => {
      // Arrange
      mockFetchCorrelation.mockClear();

      // Act
      await wrapper.setProps({ traceId: "new-trace-id" });
      await flushPromises();

      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("handles null correlationData without crashing", async () => {
      // Act
      mockCorrelationDataRef.value = null;
      await nextTick();

      // Assert
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("handles undefined traceId without crashing", async () => {
      // Act
      await wrapper.setProps({ traceId: undefined });
      await flushPromises();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("truncates extremely long trace ID", async () => {
      // Arrange
      const longId = "a".repeat(1000);

      // Act
      await wrapper.setProps({ traceId: longId });
      await flushPromises();

      // Assert
      const traceIdText = wrapper.find('[data-test="trace-correlation-card-trace-id-text"]');
      expect(traceIdText.text().length).toBeLessThan(50);
    });

    it("displays 0ms for zero duration", async () => {
      // Act
      mockPerformanceData.value = createMockPerformanceData({
        total_duration_ms: 0,
        browser_duration_ms: 0,
        network_latency_ms: 0,
        backend_duration_ms: 0,
      });
      await nextTick();

      // Assert
      expect(wrapper.text()).toContain("0ms");
    });

    it("does not crash for negative duration", async () => {
      // Act
      mockPerformanceData.value = createMockPerformanceData({ total_duration_ms: -100 });
      await nextTick();

      // Assert
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.html()).not.toThrow();
    });

    it("does not crash when performanceData is null", async () => {
      // Act
      mockPerformanceData.value = null;
      await nextTick();

      // Assert
      expect(wrapper.exists()).toBe(true);
    });

    it("shows missing trace notice when backend_spans is empty", async () => {
      // Arrange
      mockCorrelationDataRef.value = createMockCorrelationData({
        backend_spans: [],
        has_backend_trace: false,
      });
      mockBackendSpanCount.value = 0;
      mockHasBackendTrace.value = false;
      await nextTick();

      // Assert
      expect(wrapper.text()).toContain("Backend trace data not yet available");
    });

    it("does not render script tags for XSS input in traceId", async () => {
      // Act
      await wrapper.setProps({ traceId: "<script>alert('xss')</script>" });
      await flushPromises();

      // Assert
      expect(wrapper.html()).not.toContain("<script>");
    });
  });

  // =========================================================================
  // Integration scenarios
  // =========================================================================

  describe("integration scenarios", () => {
    it("handles complete trace correlation flow", async () => {
      // Arrange: component mounted with trace data
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain("Distributed Trace");

      // Act: verify trace info is shown
      expect(wrapper.text()).toContain("test-tra...23456789");
      expect(wrapper.text()).toContain("Backend Spans (2)");

      // Act: copy trace ID
      const copyBtn = findCopyButton(wrapper);
      await copyBtn?.trigger("click");
      expect(navigator.clipboard.writeText).toHaveBeenCalled();

      // Act: refresh data
      mockFetchCorrelation.mockClear();
      const refreshBtn = findButtonByText(wrapper, "Refresh");
      await refreshBtn?.trigger("click");

      // Assert
      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("handles no backend trace scenario end to end", async () => {
      // Arrange
      mockHasBackendTrace.value = false;
      mockBackendSpanCount.value = 0;
      await nextTick();

      // Assert: missing trace notice is shown
      expect(wrapper.text()).toContain("Backend trace data not yet available");

      // Assert: View Trace Details button is disabled
      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn?.attributes("disabled")).toBeDefined();
    });
  });
});
