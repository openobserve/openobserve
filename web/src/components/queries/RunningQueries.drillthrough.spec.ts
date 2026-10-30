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

// Mock SearchService
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_running_queries: vi.fn(),
      delete_running_queries: vi.fn(),
    },
  });
});

// Mock composables
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({ isMetaOrg: true }),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("RunningQueries user drill-through", () => {
  let wrapper: any = null;
  const mockQueries = [
    {
      trace_id: "trace-1",
      user_id: "user@example.com",
      org_id: "org-1",
      search_type: "dashboards",
      search_type_label: "dashboards",
      created_at: 1640995200000000,
      started_at: 1640995200000000,
      status: "running",
      work_group: "default",
      stream_type: "logs",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995260000000,
        sql: "SELECT * FROM logs",
      },
      scan_stats: {
        files: 10,
        records: 100,
        original_size: 1024,
        compressed_size: 512,
      },
      search_event_context: {
        dashboard_name: "MyDashboard",
        dashboard_folder: "MyDashboardFolder",
      },
    },
    {
      trace_id: "trace-2",
      user_id: "user2@example.com",
      org_id: "org-1",
      search_type: "ui",
      search_type_label: "ui",
      created_at: 1640995260000000,
      started_at: 1640995260000000,
      status: "completed",
      work_group: "default",
      stream_type: "metrics",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995320000000,
        sql: "SELECT * FROM metrics",
      },
      scan_stats: {
        files: 5,
        records: 50,
        original_size: 512,
        compressed_size: 256,
      },
    },
    {
      trace_id: "trace-1",
      user_id: "user@example.com",
      org_id: "org-1",
      search_type: "alerts",
      search_type_label: "alerts",
      created_at: 1640995200000000,
      started_at: 1640995200000000,
      status: "running",
      work_group: "default",
      stream_type: "alerts",
      query: {
        start_time: 1640995200000000,
        end_time: 1640995260000000,
        sql: "SELECT * FROM logs",
      },
      scan_stats: {
        files: 10,
        records: 100,
        original_size: 1024,
        compressed_size: 512,
      },
      search_event_context: {
        alert_name: "MyALert",
        alert_key: "/alerts/_meta/logs/default/MyAlert",
      },
    },
  ];

  beforeEach(async () => {
    // Mock the store state
    store.state.zoConfig = {
      ...store.state.zoConfig,
      meta_org: "test-org",
    };

    vi.clearAllMocks();

    // Mock successful API response
    (SearchService.get_running_queries as any).mockResolvedValue({
      data: {
        status: mockQueries,
      },
    });

    wrapper = mount(RunningQueries, {
      attachTo: "#app",
      global: {
        plugins: [i18n],
        provide: {
          store: store,
        },
        mocks: {
          $store: store,
        },
        stubs: {
          OIcon: true,
          "confirm-dialog": true,
          "query-list": true,

          ODrawer: {
            name: "ODrawer",
            props: [
              "open",
              "size",
              "showClose",
              "title",
              "subTitle",
              "width",
              "persistent",
              "primaryButtonLabel",
              "secondaryButtonLabel",
              "neutralButtonLabel",
            ],
            emits: ["update:open", "close", "click:primary", "click:secondary", "click:neutral"],
            template: '<div data-test="o-drawer-stub" v-if="open"><slot /></div>',
          },
          ODialog: {
            name: "ODialog",
            props: [
              "open",
              "size",
              "showClose",
              "title",
              "subTitle",
              "width",
              "persistent",
              "primaryButtonLabel",
              "secondaryButtonLabel",
              "neutralButtonLabel",
            ],
            emits: ["update:open", "close", "click:primary", "click:secondary", "click:neutral"],
            template: '<div data-test="o-dialog-stub" v-if="open"><slot /></div>',
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("opens the All Queries view on every user click in User Summary", async () => {
    const clickUser = async () => {
      await wrapper.find('[data-test="running-queries-summary-list"] tbody tr').trigger("click");
      await wrapper.vm.$nextTick();
    };

    for (let i = 0; i < 2; i++) {
      await clickUser();

      expect(wrapper.vm.selectedQueryTypeTab).toBe("all");
      expect(wrapper.vm.filterQuery).toBe(wrapper.vm.rowsQuery[0].user_id);
      expect(wrapper.vm.rowsQuery.length).toBeGreaterThan(0);
      expect(
        wrapper.find('[data-test="running-queries-all-queries-list"]').attributes("style") ?? "",
      ).not.toContain("display: none");

      wrapper.vm.onChangeQueryTab("summary");
      await wrapper.vm.$nextTick();
    }
  });
});
