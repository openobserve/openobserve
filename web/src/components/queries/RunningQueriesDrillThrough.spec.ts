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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import RunningQueries from "@/components/queries/RunningQueries.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SearchService from "@/services/search";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_running_queries: vi.fn(),
      delete_running_queries: vi.fn(),
    },
  });
});

vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({ isMetaOrg: true }),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const query = (traceId: string, userId: string, searchType: string) => ({
  trace_id: traceId,
  user_id: userId,
  org_id: "org-1",
  search_type: searchType,
  created_at: 1640995200000000,
  started_at: 1640995200000000,
  status: "running",
  work_group: "default",
  stream_type: "logs",
  query: { start_time: 1640995200000000, end_time: 1640995260000000, sql: "SELECT 1" },
  scan_stats: { files: 1, records: 1, original_size: 1, compressed_size: 1 },
  search_event_context: { dashboard_name: "d", folder_name: "f" },
});

describe("RunningQueries drill-through from User Summary", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    store.state.zoConfig = { ...store.state.zoConfig, meta_org: "test-org" };
    vi.clearAllMocks();
    (SearchService.get_running_queries as any).mockResolvedValue({
      data: {
        status: [
          query("t1", "alice@example.com", "dashboards"),
          query("t2", "alice@example.com", "dashboards"),
          query("t3", "bob@example.com", "ui"),
        ],
      },
    });

    wrapper = mount(RunningQueries, {
      attachTo: "#app",
      global: {
        plugins: [i18n],
        provide: { store },
        mocks: { $store: store },
        stubs: { OIcon: true, "confirm-dialog": true },
      },
    });
    await flushPromises();
  });

  afterEach(() => wrapper?.unmount());

  const visible = (testId: string) => {
    const el = wrapper.find(`[data-test="${testId}"]`).element as HTMLElement;
    return el.style.display !== "none";
  };

  const tab = (value: string) =>
    wrapper
      .find('[data-test="running-queries-query-type-tabs"]')
      .findAll("button")
      .find((b: any) => b.attributes("data-otoggle-value") === value);

  const drill = async (userId: string) => {
    const summary = wrapper.findComponent({
      name: "RunningQueriesList",
      props: { searchType: undefined },
    });
    void summary;
    wrapper.vm.filterUserQueries({ user_id: userId, search_type_label: "dashboards" });
    await flushPromises();
  };

  it("shows the All Queries list on every drill-through, not only the first", async () => {
    for (const round of [1, 2, 3]) {
      await drill("alice@example.com");
      expect(visible("running-queries-all-queries-list"), `round ${round} all`).toBe(true);
      expect(visible("running-queries-summary-list"), `round ${round} summary`).toBe(false);
      expect(tab("all")?.attributes("data-state")).toBe("on");

      await tab("summary")!.trigger("click");
      await flushPromises();
      expect(visible("running-queries-summary-list"), `round ${round} back`).toBe(true);
      expect(visible("running-queries-all-queries-list"), `round ${round} back all`).toBe(false);
    }
  });

  it("drills in via a real row click, repeatedly", async () => {
    for (const round of [1, 2, 3]) {
      const rows = wrapper.find('[data-test="running-queries-summary-list"]').findAll("tbody tr");
      expect(rows.length, `round ${round} rows`).toBeGreaterThan(0);
      await rows[0].trigger("click");
      await flushPromises();
      expect(wrapper.vm.selectedQueryTypeTab, `round ${round}`).toBe("all");
      expect(visible("running-queries-all-queries-list")).toBe(true);
      expect(visible("running-queries-summary-list")).toBe(false);
      await tab("summary")!.trigger("click");
      await flushPromises();
      expect(wrapper.vm.selectedQueryTypeTab).toBe("summary");
    }
  });

  it("keeps the tab highlight and rendered list in agreement after a repeat drill", async () => {
    await drill("alice@example.com");
    await tab("summary")!.trigger("click");
    await flushPromises();
    await drill("alice@example.com");

    expect(wrapper.vm.selectedQueryTypeTab).toBe("all");
    expect(tab("all")?.attributes("data-state")).toBe("on");
    expect(wrapper.vm.rowsQuery.every((r: any) => r.user_id === "alice@example.com")).toBe(true);
    expect(wrapper.vm.rowsQuery).toHaveLength(2);
  });
});
