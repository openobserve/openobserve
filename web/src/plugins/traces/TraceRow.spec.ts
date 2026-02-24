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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

/**
 * Creates a standard trace list item with sensible defaults.
 * Pass overrides to tailor for specific test scenarios.
 */
function createMockTraceItem(overrides: Record<string, any> = {}) {
  return {
    trace_id: "abc123def456",
    service_name: "frontend-proxy",
    operation_name: "GET /api/v1/products",
    duration: 42500000,
    spans: 12,
    errors: 0,
    trace_start_time: Date.now() * 1000,
    trace_end_time: Date.now() * 1000 + 42500000,
    services: {
      "frontend-proxy": 10,
      "load-generator": 2,
    },
    ...overrides,
  };
}

/**
 * Creates a trace item enriched with LLM observability fields.
 */
function createMockLlmTraceItem(overrides: Record<string, any> = {}) {
  return createMockTraceItem({
    _o2_llm_provider_name: "openai",
    _o2_llm_model_name: "gpt-4",
    _o2_llm_usage_details_input: 1500,
    _o2_llm_usage_details_output: 350,
    _o2_llm_usage_details_total: 1850,
    _o2_llm_cost_details_input: 0.003,
    _o2_llm_cost_details_output: 0.0007,
    _o2_llm_cost_details_total: 0.0037,
    _o2_llm_input: "What is the weather today?",
    ...overrides,
  });
}

/**
 * Creates the useTraces mock object with service colors for the given services.
 */
function createMockSearchObj(colorOverrides: Record<string, string> = {}) {
  return {
    meta: {
      serviceColors: {
        "frontend-proxy": "#1976d2",
        "load-generator": "#9c27b0",
        "flagd-service": "#e91e63",
        ...colorOverrides,
      },
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Finds a single element by its data-test attribute.
 */
function findByTestId(wrapper: any, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Finds all elements matching a data-test attribute.
 */
function findAllByTestId(wrapper: any, testId: string) {
  return wrapper.findAll(`[data-test="${testId}"]`);
}

/**
 * Triggers a click on the trace row element.
 */
async function clickRow(wrapper: any) {
  await findByTestId(wrapper, "trace-row").trigger("click");
}

// ============================================================================
// TESTS
// ============================================================================

describe("TraceRow", () => {
  let wrapper: any;
  let TraceRow: any;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("@/composables/useTraces", () => ({
      default: () => ({ searchObj: createMockSearchObj() }),
    }));

    TraceRow = (await import("@/plugins/traces/TraceRow.vue")).default;

    wrapper = mount(TraceRow, {
      props: {
        item: createMockTraceItem(),
        index: 0,
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  describe("Rendering", () => {
    it("should render the root row element", () => {
      expect(findByTestId(wrapper, "trace-row").exists()).toBe(true);
    });

    it("should render the timestamp column", () => {
      expect(findByTestId(wrapper, "trace-row-timestamp").exists()).toBe(true);
    });

    it("should render the service & operation column", () => {
      expect(findByTestId(wrapper, "trace-row-service").exists()).toBe(true);
    });

    it("should render the duration column", () => {
      expect(findByTestId(wrapper, "trace-row-duration").exists()).toBe(true);
    });

    it("should render the spans badge", () => {
      expect(findByTestId(wrapper, "trace-row-spans-badge").exists()).toBe(true);
    });

    it("should render the status column", () => {
      expect(findByTestId(wrapper, "trace-row-status").exists()).toBe(true);
    });

    it("should render the service latency bar", () => {
      expect(findByTestId(wrapper, "trace-row-latency-bar").exists()).toBe(true);
    });

    it("should display the service name", () => {
      expect(findByTestId(wrapper, "trace-row-service-name").text()).toBe(
        "frontend-proxy",
      );
    });

    it("should display the operation name", () => {
      expect(findByTestId(wrapper, "trace-row-operation-name").text()).toBe(
        "GET /api/v1/products",
      );
    });

    it("should render the service color dot", () => {
      expect(findByTestId(wrapper, "trace-row-service-dot").exists()).toBe(true);
    });

    it("should have cursor-pointer class to signal it is clickable", () => {
      expect(findByTestId(wrapper, "trace-row").classes()).toContain(
        "cursor-pointer",
      );
    });
  });

  // --------------------------------------------------------------------------
  describe("Timestamp formatting", () => {
    it("should show 'Today' for a trace that started within the last 24 hours", () => {
      expect(findByTestId(wrapper, "trace-row-timestamp-day").text()).toBe(
        "Today",
      );
    });

    it("should show 'Yesterday' for a trace approximately 25 hours old", async () => {
      const yesterdayTs = Date.now() * 1000 - 90_000_000_000;

      vi.resetModules();
      vi.doMock("@/composables/useTraces", () => ({
        default: () => ({ searchObj: createMockSearchObj() }),
      }));
      const FreshTraceRow = (await import("@/plugins/traces/TraceRow.vue"))
        .default;

      const w = mount(FreshTraceRow, {
        props: {
          item: createMockTraceItem({ trace_start_time: yesterdayTs }),
          index: 0,
        },
        global: { plugins: [i18n, router], provide: { store } },
      });
      await flushPromises();

      expect(findByTestId(w, "trace-row-timestamp-day").text()).toBe(
        "Yesterday",
      );
      w.unmount();
    });

    it("should display time in HH:MM:SS AM/PM format", () => {
      const timeText = findByTestId(wrapper, "trace-row-timestamp-time").text();
      expect(timeText).toMatch(/^\d{2}:\d{2}:\d{2} (AM|PM)$/);
    });
  });

  // --------------------------------------------------------------------------
  describe("Status pill", () => {
    it("should show SUCCESS pill for a trace with no errors", () => {
      const pill = findByTestId(wrapper, "trace-row-status-pill");
      expect(pill.text()).toContain("SUCCESS");
    });

    it("should apply success styling for a trace with no errors", () => {
      expect(
        findByTestId(wrapper, "trace-row-status-pill").classes(),
      ).toContain("status-pill--success");
    });

    it("should show an error pill for a trace with errors", async () => {
      await wrapper.setProps({ item: createMockTraceItem({ errors: 3 }) });

      expect(findByTestId(wrapper, "trace-row-status-pill").text()).toContain(
        "3 ERRORS",
      );
    });

    it("should apply error styling when a trace has errors", async () => {
      await wrapper.setProps({ item: createMockTraceItem({ errors: 2 }) });

      expect(
        findByTestId(wrapper, "trace-row-status-pill").classes(),
      ).toContain("status-pill--error");
    });

    it("should use singular ERROR label when error count is exactly 1", async () => {
      await wrapper.setProps({ item: createMockTraceItem({ errors: 1 }) });

      const pillText = findByTestId(wrapper, "trace-row-status-pill").text();
      expect(pillText).toContain("1 ERROR");
      expect(pillText).not.toMatch(/1 ERRORS/);
    });

    it("should apply error border class to the row when the trace has errors", async () => {
      await wrapper.setProps({ item: createMockTraceItem({ errors: 2 }) });

      expect(findByTestId(wrapper, "trace-row").classes()).toContain(
        "trace-row--error",
      );
    });

    it("should not apply error border class for a successful trace", () => {
      expect(findByTestId(wrapper, "trace-row").classes()).not.toContain(
        "trace-row--error",
      );
    });
  });

  // --------------------------------------------------------------------------
  describe("Multi-service badge", () => {
    it("should show +1 badge when the trace spans 2 services", () => {
      const badge = findByTestId(wrapper, "trace-row-extra-services");
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("+1");
    });

    it("should not render a badge for a single-service trace", async () => {
      await wrapper.setProps({
        item: createMockTraceItem({ services: { "frontend-proxy": 10 } }),
      });

      expect(
        findByTestId(wrapper, "trace-row-extra-services").exists(),
      ).toBe(false);
    });

    it("should show +2 badge for a 3-service trace", async () => {
      await wrapper.setProps({
        item: createMockTraceItem({
          services: { "frontend-proxy": 5, "svc-b": 3, "svc-c": 2 },
        }),
      });

      expect(findByTestId(wrapper, "trace-row-extra-services").text()).toBe(
        "+2",
      );
    });
  });

  // --------------------------------------------------------------------------
  describe("Service latency bar", () => {
    it("should render one segment per service in the trace", () => {
      expect(
        findAllByTestId(wrapper, "trace-row-latency-segment").length,
      ).toBe(2);
    });

    it("should render a single segment for a single-service trace", async () => {
      await wrapper.setProps({
        item: createMockTraceItem({ services: { "frontend-proxy": 12 } }),
      });

      expect(
        findAllByTestId(wrapper, "trace-row-latency-segment").length,
      ).toBe(1);
    });

    it("should not crash when the services object is empty", async () => {
      await wrapper.setProps({
        item: createMockTraceItem({ services: {} }),
      });

      expect(findByTestId(wrapper, "trace-row").exists()).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  describe("LLM columns", () => {
    it("should not render LLM columns when showLlmColumns is false (default)", () => {
      expect(
        findByTestId(wrapper, "trace-row-input-tokens").exists(),
      ).toBe(false);
      expect(
        findByTestId(wrapper, "trace-row-output-tokens").exists(),
      ).toBe(false);
      expect(findByTestId(wrapper, "trace-row-cost").exists()).toBe(false);
    });

    it("should show '-' for a non-LLM trace when LLM columns are enabled", async () => {
      await wrapper.setProps({ showLlmColumns: true });

      expect(findByTestId(wrapper, "trace-row-input-tokens").text()).toBe("-");
      expect(findByTestId(wrapper, "trace-row-output-tokens").text()).toBe("-");
      expect(findByTestId(wrapper, "trace-row-cost").text()).toBe("-");
    });

    it("should display formatted token counts for an LLM trace", async () => {
      await wrapper.setProps({
        item: createMockLlmTraceItem(),
        showLlmColumns: true,
      });

      expect(findByTestId(wrapper, "trace-row-input-tokens").text()).toBe(
        "1.5K",
      );
      expect(findByTestId(wrapper, "trace-row-output-tokens").text()).toBe(
        "350",
      );
    });

    it("should display a dollar-prefixed cost for an LLM trace", async () => {
      await wrapper.setProps({
        item: createMockLlmTraceItem(),
        showLlmColumns: true,
      });

      expect(findByTestId(wrapper, "trace-row-cost").text()).toMatch(/^\$/);
    });
  });

  // --------------------------------------------------------------------------
  describe("Click interaction", () => {
    it("should emit a click event with the trace item when the row is clicked", async () => {
      await clickRow(wrapper);

      const emitted = wrapper.emitted("click");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toMatchObject({ service_name: "frontend-proxy" });
    });
  });

  // --------------------------------------------------------------------------
  describe("Edge cases", () => {
    it("should render without crashing when item is an empty object", async () => {
      await wrapper.setProps({ item: {} });

      expect(findByTestId(wrapper, "trace-row").exists()).toBe(true);
    });

    it("should display '0us' when the duration field is absent", async () => {
      await wrapper.setProps({
        item: createMockTraceItem({ duration: undefined }),
      });

      expect(findByTestId(wrapper, "trace-row-duration").text()).toBe("0us");
    });
  });
});
