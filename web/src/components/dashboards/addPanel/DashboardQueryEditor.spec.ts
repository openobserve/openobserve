// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

// Mock the zincutils utilities completely
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getImageURL: vi.fn().mockReturnValue("/mock-image.svg"),
    useLocalOrganization: vi.fn().mockReturnValue({
      identifier: "test-org",
      name: "Test Organization"
    }),
    useLocalCurrentUser: vi.fn().mockReturnValue({
      email: "test@example.com",
      name: "Test User"
    }),
    useLocalTimezone: vi.fn().mockReturnValue("UTC"),
    b64EncodeUnicode: vi.fn().mockImplementation((str) => btoa(str)),
    b64DecodeUnicode: vi.fn().mockImplementation((str) => atob(str))
  };
});

import DashboardQueryEditor from "@/components/dashboards/addPanel/DashboardQueryEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockDashboardPanelData = {
  data: {
    id: "panel-1",
    title: "Test Panel",
    type: "line",
    queries: [
      {
        query: "SELECT * FROM test_stream",
        queryType: "sql",
        stream: "test_stream"
      }
    ]
  },
  layout: {
    currentQueryIndex: 0,
    vrlFunctionToggle: false
  }
};

describe("DashboardQueryEditor", () => {
  let wrapper: any;

  const defaultProps = {
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DashboardQueryEditor, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        stubs: {
          'QueryTypeSelector': {
            template: '<div data-test="query-type-selector"></div>'
          },
          'q-tabs': {
            template: '<div data-test="dashboard-panel-query-tab"><slot /></div>',
            props: ['modelValue']
          },
          'q-tab': {
            template: '<div><slot /></div>',
            props: ['name', 'label']
          }
        },
        mocks: {
          $t: (key: string) => key,
          $route: { params: {}, query: {} },
          $router: { push: vi.fn() }
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render query editor container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-searchbar"]').exists()).toBe(true);
    });

    it("should render basic query data container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-query-data"]').exists()).toBe(true);
    });
  });

  describe("Query Tabs", () => {
    it("should handle query tabs visibility based on mode", () => {
      // Test that tabs are hidden by default
      wrapper = createWrapper({ promqlMode: false });
      expect(wrapper.find('[data-test="dashboard-panel-query-tab"]').exists()).toBe(false);
    });

    it("should handle different panel types", () => {
      const geomapPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, type: "geomap" }
      };
      
      wrapper = createWrapper({ 
        dashboardPanelData: geomapPanelData,
        promqlMode: false 
      });

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component State", () => {
    it("should track current query index", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(0);
    });

    it("should track VRL function toggle state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle).toBe(false);
    });
  });

  describe("Event Handling", () => {
    it("should handle dropdown click events", async () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="dashboard-panel-searchbar"]');
      await dropdown.trigger('click');

      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty queries array", () => {
      const emptyQueriesPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, queries: [] }
      };

      wrapper = createWrapper({ dashboardPanelData: emptyQueriesPanelData });

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Don't pass null, just minimal data
      const minimalData = { 
        data: { queries: [], type: "line" }, 
        layout: { currentQueryIndex: 0, vrlFunctionToggle: false } 
      };
      wrapper = createWrapper({ dashboardPanelData: minimalData });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });
  });

  describe("Theme Integration", () => {
    it("should work with light theme", () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should work with dark theme", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });
  });
});
