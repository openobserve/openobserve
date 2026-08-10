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

// Regression cover for issue #13708 — the correlation drawer's log table has the
// same defect the Logs result grid had: the expansion slot bound
// `@view-trace="handleViewTrace"` by reference while JsonPreview emitted the
// event without a payload, so the handler read the timestamp column off
// `undefined` and threw.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import CorrelatedLogsTable from "./CorrelatedLogsTable.vue";
import store from "@/test/unit/helpers/store";

const mockRouterPush = vi.fn();

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
  };
});

const LOG = {
  _timestamp: 1680246906650420,
  trace_id: "3fa1c0e1b2d34f56",
  span_id: "9b8c7d6e5f4a3b2c",
  message: "GET /sku/combination/querySkuId",
};

// Real refs, not `{ value }` literals: the template binds `:data="pagedResults"`
// and only a genuine ref auto-unwraps there.
vi.mock("@/composables/useCorrelatedLogs", async () => {
  const { ref } = await import("vue");
  return {
    useCorrelatedLogs: vi.fn(() => ({
      loading: ref(false),
      error: ref(null),
      searchResults: ref([LOG]),
      pagedResults: ref([LOG]),
      totalHits: ref(1),
      took: ref(5),
      currentFilters: ref({}),
      currentTimeRange: ref({ startTime: 0, endTime: 0 }),
      primaryStream: undefined,
      logStreamsCount: ref(1),
      hasResults: ref(true),
      isLoading: ref(false),
      hasError: ref(false),
      isEmpty: ref(false),
      fetchCorrelatedLogs: vi.fn(),
      updateFilter: vi.fn(),
      updateFilters: vi.fn(),
      refresh: vi.fn(),
      isMatchedDimension: vi.fn(() => false),
      isAdditionalDimension: vi.fn(() => false),
    })),
  };
});

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: vi.fn(() => ({
    loadKeyFields: vi.fn().mockResolvedValue({}),
  })),
  clearSemanticGroupsCaches: vi.fn(),
  getSemanticGroupsCacheStatus: vi.fn(),
}));

// Renders the `expansion` slot with the first row, the way OTable does for an
// expanded log.
vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["data", "columns"],
    template: `<div data-test="o-table-stub"><slot name="expansion" :row="data[0]" /></div>`,
  },
}));

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: {} },
});

// Emits `view-trace` with no payload — the historical JsonPreview contract that
// exposed the bug.
const jsonPreviewStub = {
  name: "JsonPreview",
  props: ["value", "mode", "streamName", "highlightQuery", "hideSearchTermActions", "hideViewRelated"],
  emits: ["view-trace"],
  template: `<button data-test="json-preview-view-trace" @click="$emit('view-trace')" />`,
};

describe("CorrelatedLogsTable — View Trace from an expanded row (issue #13708)", () => {
  let wrapper: any;

  const createWrapper = () =>
    mount(CorrelatedLogsTable, {
      props: {
        matchedDimensions: { service: "api" },
        additionalDimensions: { region: "us-west" },
        logStreams: [{ name: "test-stream", stream_type: "logs" }],
        sourceStream: "logs",
        sourceType: "logs",
        timeRange: { startTime: 0, endTime: 1 },
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          DimensionFiltersBar: true,
          CellActions: true,
          O2AIContextAddBtn: true,
          JsonPreview: jsonPreviewStub,
        },
      },
    });

  beforeEach(async () => {
    vi.clearAllMocks();

    store.state.zoConfig = { timestamp_column: "_timestamp" };
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.organizationData = {
      organizationSettings: {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
      },
    };

    wrapper = createWrapper();
    await flushPromises();
  });

  it("navigates to the trace when the expanded row emits view-trace", async () => {
    const button = wrapper.find('[data-test="json-preview-view-trace"]');
    expect(button.exists()).toBe(true);

    await button.trigger("click");

    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    const pushed = mockRouterPush.mock.calls[0][0];
    expect(pushed.name).toBe("traceDetails");
    expect(pushed.query.trace_id).toBe(LOG.trace_id);
    expect(pushed.span_id).toBe(LOG.span_id);
    expect(pushed.query.from).toBe(LOG._timestamp - 900000000);
    expect(pushed.query.to).toBe(LOG._timestamp + 900000000);
  });

  it("does not throw or navigate when the log is missing", () => {
    expect(() => wrapper.vm.handleViewTrace(undefined)).not.toThrow();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
