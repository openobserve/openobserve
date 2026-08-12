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

// Regression cover for issue #13708 — "View Trace" inside an expanded log row
// threw `TypeError: Cannot read properties of undefined (reading '_timestamp')`.
//
// The expansion slot bound the handler by reference
// (`@view-trace="redirectToTraces"`), and JsonPreview emitted the event without
// a payload, so `redirectToTraces` read the timestamp column off `undefined`.
// Before #13451 the intervening TenstackTable re-emitted the event with the row
// attached, which is why the binding used to work.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import i18n from "@/locales";
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

// Renders the `expansion` slot with the first row, the way OTable does for an
// expanded log. Everything else about the table is irrelevant here.
const oTableStub = {
  name: "OTable",
  props: ["data", "columns", "expandedIds"],
  template: `<div data-test="o-table-stub"><slot name="expansion" :row="data[0]" /></div>`,
};

// Emits `view-trace` with no payload — the historical JsonPreview contract that
// exposed the bug. The listener must still resolve the row on its own.
const jsonPreviewStub = {
  name: "JsonPreview",
  props: ["value", "index", "mode", "highlightQuery", "hideSearchTermActions"],
  emits: ["view-trace"],
  template: `<button data-test="json-preview-view-trace" @click="$emit('view-trace')" />`,
};

const oContextMenuStub = {
  name: "OContextMenu",
  template: `<div><slot name="trigger" /></div>`,
};

const mountSearchResult = async () => {
  const wrapper = mount(SearchResult, {
    attachTo: document.body,
    global: {
      provide: { store },
      plugins: [i18n],
      stubs: {
        DetailTable: true,
        ChartRenderer: true,
        SanitizedHtmlRenderer: true,
        CellActions: true,
        O2AIContextAddBtn: true,
        PatternDetailsDialog: true,
        TracesAnalysisDashboard: true,
        ODrawer: true,
        OContextMenu: oContextMenuStub,
        OTable: oTableStub,
        JsonPreview: jsonPreviewStub,
      },
    },
    props: {
      expandedLogs: [],
    },
  });

  await flushPromises();
  return wrapper;
};

describe("SearchResult — View Trace from an expanded row (issue #13708)", () => {
  let wrapper: any;

  beforeEach(async () => {
    HTMLElement.prototype.scrollTo = vi.fn();
    mockRouterPush.mockClear();

    store.state.zoConfig = {
      timestamp_column: "_timestamp",
    };
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.organizationData = {
      organizationSettings: {
        trace_id_field_name: "trace_id",
        span_id_field_name: "span_id",
      },
    };

    wrapper = await mountSearchResult();

    wrapper.vm.searchObj.meta.logsVisualizeToggle = "logs";
    wrapper.vm.searchObj.meta.selectedTraceStream = "test_otel";
    wrapper.vm.searchObj.data.queryResults = { hits: [LOG] };
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
    expect(pushed.query.stream).toBe("test_otel");
    expect(pushed.query.from).toBe(LOG._timestamp - 900000000);
    expect(pushed.query.to).toBe(LOG._timestamp + 900000000);
  });

  it("does not throw or navigate when the log is missing", () => {
    expect(() => wrapper.vm.redirectToTraces(undefined)).not.toThrow();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
