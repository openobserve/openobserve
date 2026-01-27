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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

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
const mockCorrelationData = {
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
};

vi.mock("@/composables/rum/useTraceCorrelation", () => ({
  default: () => ({
    correlationData: { value: mockCorrelationData },
    isLoading: { value: false },
    hasBackendTrace: { value: true },
    fetchCorrelation: mockFetchCorrelation,
    backendSpanCount: { value: 2 },
    performanceData: {
      value: mockCorrelationData.performance_breakdown,
    },
  }),
}));

describe("TraceCorrelationCard", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(TraceCorrelationCard, {
      props: {
        traceId: "test-trace-id-123456789",
        spanId: "test-span-id-123",
        sessionId: "test-session-123",
        resourceDuration: 500,
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

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

  describe("Loading state", () => {
    it("should show loading spinner when isLoading is true", async () => {
      // Re-mount with loading state
      vi.doMock("@/composables/rum/useTraceCorrelation", () => ({
        default: () => ({
          correlationData: { value: null },
          isLoading: { value: true },
          hasBackendTrace: { value: false },
          fetchCorrelation: mockFetchCorrelation,
          backendSpanCount: { value: 0 },
          performanceData: { value: null },
        }),
      }));

      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "test-trace-id-123456789",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.find(".q-spinner-hourglass").exists()).toBe(true);
      expect(wrapper.text()).toContain("Loading trace data...");
    });
  });

  describe("No trace ID state", () => {
    it("should show no trace message when traceId is empty", async () => {
      vi.doMock("@/composables/rum/useTraceCorrelation", () => ({
        default: () => ({
          correlationData: { value: null },
          isLoading: { value: false },
          hasBackendTrace: { value: false },
          fetchCorrelation: mockFetchCorrelation,
          backendSpanCount: { value: 0 },
          performanceData: { value: null },
        }),
      }));

      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain(
        "No trace information available for this event",
      );
    });
  });

  describe("Trace ID formatting", () => {
    it("should format long trace ID correctly", () => {
      const traceIdText = wrapper.find(".trace-id-text");
      expect(traceIdText.exists()).toBe(true);
      // Should show first 8 and last 8 characters with ellipsis
      expect(traceIdText.text()).toMatch(/^test-tra\.\.\.56789$/);
    });

    it("should not truncate short trace ID", async () => {
      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "short-id",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      const traceIdText = wrapper.find(".trace-id-text");
      expect(traceIdText.text()).toBe("short-id");
    });
  });

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

  describe("Copy trace ID functionality", () => {
    it("should copy trace ID to clipboard when copy button is clicked", async () => {
      const copyBtn = wrapper.find('[icon="content_copy"]');
      expect(copyBtn.exists()).toBe(true);

      await copyBtn.trigger("click");

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "test-trace-id-123456789",
      );
    });

    it("should show notification when trace ID is copied", async () => {
      const notifySpy = vi.spyOn(quasar.Notify, "create");
      const copyBtn = wrapper.find('[icon="content_copy"]');

      await copyBtn.trigger("click");

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Trace ID copied to clipboard",
        }),
      );
    });
  });

  describe("Action buttons", () => {
    it("should display View Trace Details button", () => {
      const viewBtn = wrapper.find('[label="View Trace Details"]');
      expect(viewBtn.exists()).toBe(true);
    });

    it("should enable View Trace Details button when backend trace exists", () => {
      const viewBtn = wrapper.find('[label="View Trace Details"]');
      expect(viewBtn.attributes("disable")).toBeUndefined();
    });

    it("should disable View Trace Details button when no backend trace", async () => {
      vi.doMock("@/composables/rum/useTraceCorrelation", () => ({
        default: () => ({
          correlationData: { value: mockCorrelationData },
          isLoading: { value: false },
          hasBackendTrace: { value: false },
          fetchCorrelation: mockFetchCorrelation,
          backendSpanCount: { value: 0 },
          performanceData: { value: null },
        }),
      }));

      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "test-trace-id-123456789",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      const viewBtn = wrapper.find('[label="View Trace Details"]');
      expect(viewBtn.attributes("disable")).toBe("true");
    });

    it("should show notification when View Trace Details is clicked", async () => {
      const notifySpy = vi.spyOn(quasar.Notify, "create");
      const viewBtn = wrapper.find('[label="View Trace Details"]');

      await viewBtn.trigger("click");

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          message: "Trace detail view coming soon",
        }),
      );
    });

    it("should display Refresh button", () => {
      const refreshBtn = wrapper.find('[label="Refresh"]');
      expect(refreshBtn.exists()).toBe(true);
    });

    it("should call fetchCorrelation when Refresh button is clicked", async () => {
      const refreshBtn = wrapper.find('[label="Refresh"]');

      await refreshBtn.trigger("click");

      expect(mockFetchCorrelation).toHaveBeenCalled();
    });

    it("should show notification when Refresh is clicked", async () => {
      const notifySpy = vi.spyOn(quasar.Notify, "create");
      const refreshBtn = wrapper.find('[label="Refresh"]');

      await refreshBtn.trigger("click");

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "info",
          message: "Refreshing trace data...",
        }),
      );
    });
  });

  describe("Missing trace notice", () => {
    it("should show missing trace notice when no backend trace", async () => {
      vi.doMock("@/composables/rum/useTraceCorrelation", () => ({
        default: () => ({
          correlationData: { value: mockCorrelationData },
          isLoading: { value: false },
          hasBackendTrace: { value: false },
          fetchCorrelation: mockFetchCorrelation,
          backendSpanCount: { value: 0 },
          performanceData: { value: null },
        }),
      }));

      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "test-trace-id-123456789",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      expect(wrapper.text()).toContain("Backend trace data not yet available");
      expect(wrapper.text()).toContain(
        "Trace data may take up to 30 seconds to be ingested",
      );
    });
  });

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
      mockFetchCorrelation.mockClear();

      wrapper = mount(TraceCorrelationCard, {
        props: {
          traceId: "",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
        },
      });

      await flushPromises();

      // Should not call fetch when traceId is empty
      expect(mockFetchCorrelation).not.toHaveBeenCalled();
    });
  });

  describe("Utility functions", () => {
    it("should calculate percentage correctly", () => {
      const result = wrapper.vm.calculatePercentage(200, 500);
      expect(result).toBe(40);
    });

    it("should return 0 when total is 0", () => {
      const result = wrapper.vm.calculatePercentage(100, 0);
      expect(result).toBe(0);
    });

    it("should format span ID correctly", () => {
      const result = wrapper.vm.formatSpanId("test-span-id-123");
      expect(result).toBe("test-s...id-123");
    });

    it("should not truncate short span ID", () => {
      const result = wrapper.vm.formatSpanId("short");
      expect(result).toBe("short");
    });
  });
});
