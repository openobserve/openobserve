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

// Mock rudder-sdk-js before other imports
vi.mock("rudder-sdk-js", () => ({
  default: {
    ready: vi.fn(),
    load: vi.fn(),
    track: vi.fn(),
  },
}));

// Mock segment_analytics service
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

import { mount, flushPromises } from "@vue/test-utils";
import SessionsList from "@/components/rum/SessionsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Mock zincutils
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    formatDuration: vi.fn((duration) => {
      if (duration < 60) return `${duration}s`;
      if (duration < 3600) return `${Math.floor(duration / 60)}m`;
      return `${Math.floor(duration / 3600)}h`;
    }),
    mergeRoutes: vi.fn((route1, route2) => [
      ...(route1 || []),
      ...(route2 || []),
    ]),
  };
});

// Mock child components
vi.mock("@/components/rum/SearchBar.vue", () => ({
  default: {
    name: "SearchBar",
    template: '<div data-test="search-bar">Search Bar</div>',
  },
}));

vi.mock("@/components/common/sidebar/SearchFieldList.vue", () => ({
  default: {
    name: "SearchFieldList",
    template: '<div data-test="field-list">Field List</div>',
  },
}));

// Mock router functions
const mockRouterPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({
      push: mockRouterPush,
    }),
  };
});

const mountComponent = () =>
  mount(SessionsList, {
    attachTo: "#app",
    global: {
      plugins: [i18n, router],
      provide: { store },
      stubs: {
        OTable: {
          template: `
            <div data-test="o-table"
              @click="$emit('row-click', mockRow)">
              <div data-test="o-table-columns">{{ columns.length }} columns</div>
              <div data-test="o-table-rows">{{ data.length }} rows</div>
              <slot name="cell-action_play" :row="mockRow" />
            </div>
          `,
          props: ["data", "columns", "rowKey", "pagination", "virtualScroll", "dense"],
          emits: ["row-click"],
          setup() {
            return {
              mockRow: { id: "session123" },
            };
          },
        },
        OSplitter: {
          template: `
            <div data-test="splitter">
              <div data-test="before-section"><slot name="before" /></div>
              <div data-test="after-section"><slot name="after" /></div>
            </div>
          `,
          props: ["modelValue", "unit", "horizontal"],
        },
        OIcon: {
          template: '<div class="o-icon" :data-name="name"></div>',
          props: ["name", "size"],
        },
      },
    },
  });

describe("SessionsList Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRouterPush.mockClear();

    wrapper = mountComponent();

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render sessions page container", () => {
      expect(wrapper.find(".sessions_page").exists()).toBe(true);
    });

    it("should render all child components", () => {
      expect(wrapper.find('[data-test="search-bar"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="field-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-table"]').exists()).toBe(true);
    });

    it("should render splitter layout", () => {
      expect(wrapper.find('[data-test="splitter"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="before-section"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="after-section"]').exists()).toBe(true);
    });
  });

  describe("Component Structure", () => {
    it("should pass FieldList to before slot", () => {
      const beforeSection = wrapper.find('[data-test="before-section"]');
      expect(beforeSection.find('[data-test="field-list"]').exists()).toBe(
        true,
      );
    });

    it("should pass OTable to after slot", () => {
      const afterSection = wrapper.find('[data-test="after-section"]');
      expect(afterSection.find('[data-test="o-table"]').exists()).toBe(true);
    });
  });

  describe("Data Properties", () => {
    it("should have splitterModel with default value", () => {
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("should have tableRows array", () => {
      expect(Array.isArray(wrapper.vm.tableRows)).toBe(true);
    });

    it("should have tableColumns array with correct structure", () => {
      expect(Array.isArray(wrapper.vm.tableColumns)).toBe(true);
      expect(wrapper.vm.tableColumns.length).toBeGreaterThan(0);
    });
  });

  describe("Columns Configuration", () => {
    it("should have action_play column with correct properties", () => {
      const actionColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "action_play",
      );

      expect(actionColumn).toBeDefined();
      expect(actionColumn.sortable).toBe(false);
      expect(actionColumn.size).toBe(56);
    });

    it("should have timestamp column", () => {
      const timestampColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "timestamp",
      );

      expect(timestampColumn).toBeDefined();
      expect(timestampColumn.sortable).toBe(true);
      expect(timestampColumn.accessorKey).toBe("timestamp");
    });

    it("should have type column", () => {
      const typeColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "type",
      );

      expect(typeColumn).toBeDefined();
      expect(typeColumn.sortable).toBe(true);
      expect(typeColumn.accessorKey).toBe("type");
    });

    it("should have time_spent column", () => {
      const timeSpentColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "time_spent",
      );

      expect(timeSpentColumn).toBeDefined();
      expect(timeSpentColumn.sortable).toBe(true);
      expect(typeof timeSpentColumn.accessorFn).toBe("function");
    });

    it("should have error_count column", () => {
      const errorCountColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "error_count",
      );

      expect(errorCountColumn).toBeDefined();
      expect(errorCountColumn.sortable).toBe(true);
      expect(errorCountColumn.accessorKey).toBe("error_count");
    });

    it("should have initial_view_name column", () => {
      const initialViewColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "initial_view_name",
      );

      expect(initialViewColumn).toBeDefined();
      expect(initialViewColumn.sortable).toBe(true);
      expect(initialViewColumn.accessorKey).toBe("initial_view_name");
    });
  });

  describe("Column Functions", () => {
    it("should format time_spent column via accessorFn", () => {
      const timeSpentColumn = wrapper.vm.tableColumns.find(
        (col: any) => col.id === "time_spent",
      );
      const mockRow = { time_spent: "120000000" };
      const result = timeSpentColumn.accessorFn(mockRow);
      expect(result).toBe("2m");
    });
  });

  describe("Event Handling", () => {
    it("should have handleRowClick function", () => {
      expect(typeof wrapper.vm.handleRowClick).toBe("function");
    });

    it("should have handleCellClick function", () => {
      expect(typeof wrapper.vm.handleCellClick).toBe("function");
    });

    it("should navigate to SessionViewer on row click", () => {
      const mockRow = { id: "session123" };
      wrapper.vm.handleRowClick(mockRow);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session123" },
      });
    });

    it("should navigate to SessionViewer on handleCellClick", () => {
      const mockPayload = { row: { id: "test-session" } };
      wrapper.vm.handleCellClick(mockPayload);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "test-session" },
      });
    });

    it("should trigger router navigation on table row-click emit", async () => {
      const oTable = wrapper.find('[data-test="o-table"]');
      await oTable.trigger("click");

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "session123" },
      });
    });
  });

  describe("OTable Integration", () => {
    it("should pass tableColumns to OTable", () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("columns")).toEqual(wrapper.vm.tableColumns);
    });

    it("should pass tableRows to OTable", () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.props("data")).toEqual(wrapper.vm.tableRows);
    });
  });

  describe("Data Updates", () => {
    it("should allow updating splitterModel", async () => {
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(300);
    });
  });

  describe("Router Integration", () => {
    it("should navigate to SessionViewer on cell click", async () => {
      const mockPayload = { row: { id: "test-session-id" } };

      await wrapper.vm.handleCellClick(mockPayload);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "SessionViewer",
        params: { id: "test-session-id" },
      });
    });
  });

  describe("Component Composition", () => {
    it("should use useI18n composable", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Layout and Styling", () => {
    it("should have sessions_page class", () => {
      expect(wrapper.classes()).toContain("sessions_page");
    });

    it("should apply correct CSS classes", () => {
      const sessionsPage = wrapper.find(".sessions_page");
      expect(sessionsPage.exists()).toBe(true);
    });
  });

  describe("Responsive Layout", () => {
    it("should handle splitter resizing", async () => {
      const initialModel = wrapper.vm.splitterModel;
      wrapper.vm.splitterModel = initialModel + 50;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.splitterModel).toBe(initialModel + 50);
    });
  });

  describe("Error Handling", () => {
    it("should handle empty rows gracefully", () => {
      expect(wrapper.find('[data-test="o-table"]').exists()).toBe(true);
    });
  });

  describe("Integration", () => {
    it("should work with store integration", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });

    it("should work with i18n integration", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      expect(wrapper.find('[data-test="search-bar"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="field-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-table"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="splitter"]').exists()).toBe(true);
    });
  });

  describe("Event Mapping", () => {
    it("should handle multiple cell clicks", async () => {
      const payload1 = { row: { id: "session1" } };
      const payload2 = { row: { id: "session2" } };

      await wrapper.vm.handleCellClick(payload1);
      await wrapper.vm.handleCellClick(payload2);

      expect(mockRouterPush).toHaveBeenCalledTimes(2);
      expect(mockRouterPush).toHaveBeenNthCalledWith(1, {
        name: "SessionViewer",
        params: { id: "session1" },
      });
      expect(mockRouterPush).toHaveBeenNthCalledWith(2, {
        name: "SessionViewer",
        params: { id: "session2" },
      });
    });
  });
});
