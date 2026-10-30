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
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { http, HttpResponse } from "msw";
import tracesMockData from "@/test/unit/mockData/traces";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "test-stream" }] }),
    getStream: vi.fn().mockResolvedValue({ name: "test-stream", schema: [] }),
  }),
}));

const STUBS = {
  "chart-renderer": { template: "<div />", props: ["data", "id"] },
  "trace-tree": {
    template: '<div data-test="trace-tree" />',
    props: ["collapseMapping", "spans", "baseTracePosition", "spanDimensions", "spanMap"],
    methods: { scrollToSpan: vi.fn(), nextMatch: vi.fn(), prevMatch: vi.fn() },
  },
  "trace-header": { template: "<div />", props: ["baseTracePosition", "splitterWidth"] },
  "trace-details-sidebar": { template: "<div />", props: ["span", "baseTracePosition"] },
};

// The mock spans form one chain: root 6b08… → d427… → bf6b….
const ROOT = "6b080023171f5767";
const LEAF = "bf6bde74cdcc245f";

function detailsWithErrors(errorIds: string[]) {
  const hits = JSON.parse(JSON.stringify(tracesMockData.tracesDetails.traceSpans.hits));
  for (const hit of hits) {
    if (errorIds.includes(hit.span_id)) {
      hit.span_status = "ERROR";
      hit.status_message = `failed in ${hit.span_id}`;
    }
  }
  return { hits };
}

describe("TraceDetails - error strip and error spans menu", () => {
  let wrapper: any;

  async function mountWith(details: any) {
    const org = store.state.selectedOrganization.identifier;
    globalThis.server.use(
      http.get(`${store.state.API_ENDPOINT}/api/${org}/settings/v2/key_fields`, () =>
        HttpResponse.json({ setting_value: {} }),
      ),
      http.get(`${store.state.API_ENDPOINT}/api/${org}/:stream/traces/:traceId/details`, () =>
        HttpResponse.json(details),
      ),
      http.post(`${store.state.API_ENDPOINT}/api/${org}/_search`, () =>
        HttpResponse.json({ took: 0, hits: [], total: 0, from: 0, size: 0 }),
      ),
    );
    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "test-trace-id" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBe(3), { timeout: 5000 });
    await flushPromises();
  }

  beforeEach(() => {
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          trace_id: "test-trace-id",
          from: "1752490492843",
          to: "1752490493164",
          stream: "test-stream",
          org_identifier: "default",
        },
        name: "traceDetails",
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("hides the strip and the error chip when the trace has no error spans", async () => {
    await mountWith(detailsWithErrors([]));
    expect(wrapper.find('[data-test="trace-details-error-strip"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="trace-details-error-spans-count"]').exists()).toBe(false);
  });

  it("names the deepest error span and selects it on click", async () => {
    await mountWith(detailsWithErrors([ROOT, LEAF]));
    const strip = wrapper.get('[data-test="trace-details-error-strip"]');
    expect(strip.text()).toContain(`failed in ${LEAF}`);
    expect(strip.text()).toContain("(1 of 2 errors)");
    expect(wrapper.find('[data-test="trace-details-error-spans-count"]').text()).toContain("2");

    await strip.trigger("click");
    expect(wrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(LEAF);
    expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(true);
  });
});
