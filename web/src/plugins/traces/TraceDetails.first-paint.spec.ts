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
import { ref } from "vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const mocks = vi.hoisted(() => ({
  getTraceDetails: vi.fn(),
  getStreams: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/services/search", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, get_trace_details: mocks.getTraceDetails } };
});

vi.mock("@/composables/rum/useRumSpanBuilder", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: () => ({
      fetchRumEventsForTrace: vi.fn().mockResolvedValue({
        tracedResources: [],
        viewEvents: [],
        actionEvents: [],
        allViewEvents: [],
      }),
      formatRumEventsAsSpans: vi.fn().mockReturnValue([]),
    }),
  };
});

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mocks.getStreams,
    getStream: vi.fn().mockResolvedValue({ name: "test-stream", schema: [] }),
  }),
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({ loadKeyFields: vi.fn().mockResolvedValue({}) }),
  TRACE_SERVICE_DETECTION_KEY: Symbol("traceServiceDetection"),
  initServiceCorrelationProviders: vi.fn(),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

const STUBS = {
  "chart-renderer": { template: "<div />", props: ["data", "id"] },
  "trace-tree": {
    template: '<div data-test="trace-tree" />',
    props: ["collapseMapping", "spans", "baseTracePosition", "spanDimensions", "spanMap"],
    methods: { nextMatch: vi.fn(), prevMatch: vi.fn(), cancelScroll: vi.fn() },
  },
  "trace-header": { template: "<div />", props: ["baseTracePosition", "splitterWidth"] },
  "trace-details-sidebar": { template: "<div />", props: ["span"] },
};

const SPINNER = '[data-test="trace-details-loading-spinner"]';

describe("TraceDetails - first paint (T-8)", () => {
  let wrapper: any;

  beforeEach(() => {
    mocks.order.length = 0;
    mocks.getTraceDetails.mockReset();
    mocks.getStreams.mockReset();
    vi.spyOn(router, "currentRoute", "get").mockReturnValue(
      ref({
        query: {
          trace_id: "trace-a",
          from: "1755853740000000",
          to: "1755853750000000",
          stream: "test-stream",
          org_identifier: "default",
        },
        name: "traceDetails",
      }) as any,
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("raises the loading flag before any request, so the first paint is the loader, not blank", () => {
    mocks.getStreams.mockImplementation(() => {
      mocks.order.push("streams");
      return new Promise(() => {});
    });
    mocks.getTraceDetails.mockImplementation(() => {
      mocks.order.push("trace");
      return new Promise(() => {});
    });

    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "trace-a" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });

    expect(wrapper.vm.searchObj.data.traceDetails.isLoadingTraceDetails).toBe(true);
    expect(wrapper.find(SPINNER).exists()).toBe(true);
  });

  it("requests the trace without waiting for the log stream list, which only feeds View Logs", async () => {
    mocks.getStreams.mockImplementation(() => {
      mocks.order.push("streams");
      return new Promise(() => {});
    });
    mocks.getTraceDetails.mockImplementation(() => {
      mocks.order.push("trace");
      return new Promise(() => {});
    });

    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "trace-a" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });
    await flushPromises();

    expect(mocks.order).toEqual(["streams", "trace"]);
    expect(mocks.getTraceDetails).toHaveBeenCalledTimes(1);
  });

  it("still loads the trace when the log stream list fails", async () => {
    mocks.getStreams.mockRejectedValue(new Error("boom"));
    mocks.getTraceDetails.mockReturnValue(new Promise(() => {}));

    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "trace-a" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });
    await flushPromises();

    expect(mocks.getTraceDetails).toHaveBeenCalledTimes(1);
  });
});
