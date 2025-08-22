// Copyright 2025 OpenObserve Inc.
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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import SettingsIndex from "./index.vue";
import i18n from "@/locales";
import { nextTick } from "vue";

installQuasar();

// Mock external dependencies
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "true",
  },
}));

vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: true },
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-${path}`),
}));

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

// Mock Vue Router
const mockRouter = {
  currentRoute: {
    value: {
      name: "settings",
      query: {},
    },
  },
  push: vi.fn(),
};

// Mock Quasar
const mockQuasar = {
  notify: vi.fn(),
};

const createWrapper = (props = {}, options = {}) => {
  return mount(SettingsIndex, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
        $router: mockRouter,
        $q: mockQuasar,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QPage: {
          template: "<div data-test-stub='q-page'><slot></slot></div>",
          props: ["class"],
        },
        QSeparator: {
          template: "<div data-test-stub='q-separator'></div>",
          props: ["class"],
        },
        QSplitter: {
          template: `<div data-test-stub='q-splitter'>
            <slot name='before'></slot>
            <slot name='after'></slot>
          </div>`,
          props: ["modelValue", "limits", "unit", "style"],
          emits: ["update:modelValue"],
        },
        QTabs: {
          template: `<div data-test-stub='q-tabs' :class='vertical ? "q-tabs--vertical" : ""'>
            <slot></slot>
          </div>`,
          props: ["modelValue", "indicatorColor", "inlineLabel", "vertical", "class"],
          emits: ["update:modelValue"],
        },
        QRouteTab: {
          template: `<div 
            data-test-stub='q-route-tab' 
            :data-test='$attrs["data-test"]'
            :data-name='name'
          >
            <slot></slot>
          </div>`,
          props: ["name", "to", "icon", "label", "contentClass", "default"],
        },
        QBtn: {
          template: `<button 
            data-test-stub='q-btn' 
            :data-test='$attrs["data-test"]'
            @click='$emit("click", $event)'
            :title='title'
          >
            <slot></slot>
          </button>`,
          props: ["icon", "title", "dense", "size", "round", "class", "style", "color"],
          emits: ["click"],
        },
        RouterView: {
          template: "<div data-test-stub='router-view'></div>",
          props: ["title"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("SettingsIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.state.theme = "light";
    mockStore.state.selectedOrganization.identifier = "test-org";
    mockRouter.currentRoute.value.name = "settings";
    mockRouter.push.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the settings header", () => {
      const wrapper = createWrapper();
      const header = wrapper.find(".head");
      expect(header.exists()).toBe(true);
    });

    it("should render management splitter", () => {
      const wrapper = createWrapper();
      const splitter = wrapper.find('[data-test-stub="q-splitter"]');
      expect(splitter.exists()).toBe(true);
    });
  });

  describe("Tab rendering", () => {
    it("should render general settings tab", () => {
      const wrapper = createWrapper();
      const generalTab = wrapper.find('[data-name="general"]');
      expect(generalTab.exists()).toBe(true);
    });

    it("should render organization tab", () => {
      const wrapper = createWrapper();
      const orgTab = wrapper.find('[data-name="organization"]');
      expect(orgTab.exists()).toBe(true);
    });

    it("should render alert destinations tab", () => {
      const wrapper = createWrapper();
      const alertTab = wrapper.find('[data-test="alert-destinations-tab"]');
      expect(alertTab.exists()).toBe(true);
    });

    it("should render alert templates tab", () => {
      const wrapper = createWrapper();
      const templatesTab = wrapper.find('[data-test="alert-templates-tab"]');
      expect(templatesTab.exists()).toBe(true);
    });

    it("should render query management tab for meta org", () => {
      const wrapper = createWrapper();
      const queryTab = wrapper.find('[data-name="queryManagement"]');
      expect(queryTab.exists()).toBe(true);
    });

    it("should render cipher keys tab for enterprise", () => {
      const wrapper = createWrapper();
      const cipherTab = wrapper.find('[data-test="management-cipher-key-tab"]');
      expect(cipherTab.exists()).toBe(true);
    });

    it("should render nodes tab for enterprise meta org", () => {
      const wrapper = createWrapper();
      const nodesTab = wrapper.find('[data-test="nodes-tab"]');
      expect(nodesTab.exists()).toBe(true);
    });

    it("should render domain management tab for enterprise meta org", () => {
      const wrapper = createWrapper();
      const domainTab = wrapper.find('[data-test="domain-management-tab"]');
      expect(domainTab.exists()).toBe(true);
    });

    it("should render organization management tab for cloud meta org", () => {
      const wrapper = createWrapper();
      const orgManagementTab = wrapper.find('[data-test="organization-management-tab"]');
      expect(orgManagementTab.exists()).toBe(true);
    });

    it("should render regex patterns tab for enterprise", () => {
      const wrapper = createWrapper();
      const regexTab = wrapper.find('[data-test="regex-patterns-tab"]');
      expect(regexTab.exists()).toBe(true);
    });

    it("should render pipeline destinations tab for enterprise", () => {
      const wrapper = createWrapper();
      const pipelineTab = wrapper.find('[data-test="pipeline-destinations-tab"]');
      expect(pipelineTab.exists()).toBe(true);
    });
  });

  describe("Tab management controls", () => {
    it("should show management tabs collapse button", () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      expect(collapseBtn.exists()).toBe(true);
    });

    it("should toggle management tabs visibility when collapse button is clicked", async () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      expect(wrapper.vm.showManagementTabs).toBe(true);
      expect(wrapper.vm.splitterModel).toBe(250);
      
      await collapseBtn.trigger("click");
      
      expect(wrapper.vm.showManagementTabs).toBe(false);
      expect(wrapper.vm.splitterModel).toBe(0);
    });

    it("should restore management tabs when toggled back", async () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      // First collapse
      await collapseBtn.trigger("click");
      expect(wrapper.vm.showManagementTabs).toBe(false);
      expect(wrapper.vm.splitterModel).toBe(0);
      
      // Then expand
      await collapseBtn.trigger("click");
      expect(wrapper.vm.showManagementTabs).toBe(true);
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("should show correct icon when tabs are visible", () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      expect(collapseBtn.attributes("icon")).toBe("chevron_left");
    });

    it("should show correct icon when tabs are hidden", async () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      await wrapper.setData({ showManagementTabs: false });
      await nextTick();
      
      expect(collapseBtn.attributes("icon")).toBe("chevron_right");
    });

    it("should show correct title when tabs are visible", () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      expect(collapseBtn.attributes("title")).toBe("Collapse Fields");
    });

    it("should show correct title when tabs are hidden", async () => {
      const wrapper = createWrapper();
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn-management"]');
      
      await wrapper.setData({ showManagementTabs: false });
      await nextTick();
      
      expect(collapseBtn.attributes("title")).toBe("Open Fields");
    });
  });

  describe("Router integration", () => {
    it("should redirect to query management for meta org on settings route", async () => {
      mockRouter.currentRoute.value.name = "settings";
      createWrapper();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/settings/query_management",
        query: {
          org_identifier: "test-org",
        },
      });
    });

    it("should redirect to general settings for non-meta org", async () => {
      const useIsMetaOrg = await import("@/composables/useIsMetaOrg");
      vi.mocked(useIsMetaOrg.default).mockReturnValue({
        isMetaOrg: { value: false },
      });

      mockRouter.currentRoute.value.name = "settings";
      createWrapper();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/settings/general",
        query: {
          org_identifier: "test-org",
        },
      });
    });

    it("should redirect to general settings when accessing nodes without proper permissions", async () => {
      const useIsMetaOrg = await import("@/composables/useIsMetaOrg");
      vi.mocked(useIsMetaOrg.default).mockReturnValue({
        isMetaOrg: { value: false },
      });

      mockRouter.currentRoute.value.name = "nodes";
      createWrapper();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/settings/general",
        query: {
          org_identifier: "test-org",
        },
      });
    });

    it("should render RouterView component", () => {
      const wrapper = createWrapper();
      const routerView = wrapper.find('[data-test-stub="router-view"]');
      expect(routerView.exists()).toBe(true);
    });
  });

  describe("Theme integration", () => {
    it("should compute correct regex icon for light theme", () => {
      mockStore.state.theme = "light";
      mockRouter.currentRoute.value.name = "otherRoute";
      const wrapper = createWrapper();
      
      expect(wrapper.vm.regexIcon).toBe("mocked-images/regex_pattern/regex_icon_light.svg");
    });

    it("should compute correct regex icon for dark theme", () => {
      mockStore.state.theme = "dark";
      mockRouter.currentRoute.value.name = "otherRoute";
      const wrapper = createWrapper();
      
      expect(wrapper.vm.regexIcon).toBe("mocked-images/regex_pattern/regex_icon_dark.svg");
    });

    it("should use light icon when on regex patterns route regardless of theme", () => {
      mockStore.state.theme = "dark";
      mockRouter.currentRoute.value.name = "regexPatterns";
      const wrapper = createWrapper();
      
      expect(wrapper.vm.regexIcon).toBe("mocked-images/regex_pattern/regex_icon_light.svg");
    });
  });

  describe("Tab configuration", () => {
    it("should have correct tab configuration structure", () => {
      const wrapper = createWrapper();
      
      const tabs = wrapper.find('[data-test-stub="q-tabs"]');
      expect(tabs.exists()).toBe(true);
      expect(tabs.classes()).toContain("management-tabs");
      expect(tabs.classes()).toContain("q-tabs--vertical");
    });

    it("should show tabs when showManagementTabs is true", () => {
      const wrapper = createWrapper();
      const tabs = wrapper.find('[data-test-stub="q-tabs"]');
      expect(tabs.exists()).toBe(true);
    });

    it("should hide tabs when showManagementTabs is false", async () => {
      const wrapper = createWrapper();
      await wrapper.setData({ showManagementTabs: false });
      await nextTick();
      
      const tabs = wrapper.find('[data-test-stub="q-tabs"]');
      expect(tabs.exists()).toBe(false);
    });
  });

  describe("Conditional rendering", () => {
    it("should hide enterprise-only tabs when not enterprise", async () => {
      const config = await import("@/aws-exports");
      vi.mocked(config.default).isEnterprise = "false";

      const wrapper = createWrapper();
      
      const cipherTab = wrapper.find('[data-test="management-cipher-key-tab"]');
      const nodesTab = wrapper.find('[data-test="nodes-tab"]');
      const pipelineTab = wrapper.find('[data-test="pipeline-destinations-tab"]');
      const regexTab = wrapper.find('[data-test="regex-patterns-tab"]');
      
      expect(cipherTab.exists()).toBe(false);
      expect(nodesTab.exists()).toBe(false);
      expect(pipelineTab.exists()).toBe(false);
      expect(regexTab.exists()).toBe(false);
    });

    it("should hide meta org tabs when not meta org", async () => {
      const useIsMetaOrg = await import("@/composables/useIsMetaOrg");
      vi.mocked(useIsMetaOrg.default).mockReturnValue({
        isMetaOrg: { value: false },
      });

      const wrapper = createWrapper();
      
      const queryTab = wrapper.find('[data-name="queryManagement"]');
      const nodesTab = wrapper.find('[data-test="nodes-tab"]');
      const domainTab = wrapper.find('[data-test="domain-management-tab"]');
      const orgManagementTab = wrapper.find('[data-test="organization-management-tab"]');
      
      expect(queryTab.exists()).toBe(false);
      expect(nodesTab.exists()).toBe(false);
      expect(domainTab.exists()).toBe(false);
      expect(orgManagementTab.exists()).toBe(false);
    });

    it("should hide cloud-only tabs when not cloud", async () => {
      const config = await import("@/aws-exports");
      vi.mocked(config.default).isCloud = "false";

      const wrapper = createWrapper();
      
      const orgManagementTab = wrapper.find('[data-test="organization-management-tab"]');
      expect(orgManagementTab.exists()).toBe(false);
    });
  });

  describe("Component data and methods", () => {
    it("should initialize with correct default values", () => {
      const wrapper = createWrapper();
      
      expect(wrapper.vm.settingsTab).toBe("general");
      expect(wrapper.vm.splitterModel).toBe(250);
      expect(wrapper.vm.showManagementTabs).toBe(true);
    });

    it("should store previous splitter model when collapsing", async () => {
      const wrapper = createWrapper();
      
      await wrapper.setData({ splitterModel: 300 });
      await wrapper.vm.controlManagementTabs();
      
      expect(wrapper.vm.storePreviousStoreModel).toBe(300);
      expect(wrapper.vm.splitterModel).toBe(0);
    });

    it("should restore previous splitter model when expanding", async () => {
      const wrapper = createWrapper();
      
      await wrapper.setData({ 
        splitterModel: 300,
        storePreviousStoreModel: 280 
      });
      
      await wrapper.vm.controlManagementTabs(); // collapse
      await wrapper.vm.controlManagementTabs(); // expand
      
      expect(wrapper.vm.splitterModel).toBe(280);
    });

    it("should use default splitter model if no previous value stored", async () => {
      const wrapper = createWrapper();
      
      await wrapper.setData({ 
        splitterModel: 0,
        showManagementTabs: false,
        storePreviousStoreModel: 0 
      });
      
      await wrapper.vm.controlManagementTabs();
      
      expect(wrapper.vm.splitterModel).toBe(250); // default value
    });
  });

  describe("Accessibility and styling", () => {
    it("should have proper CSS classes for management page", () => {
      const wrapper = createWrapper();
      const page = wrapper.find('[data-test-stub="q-page"]');
      expect(page.classes()).toContain("management-page");
    });

    it("should apply correct separator styling", () => {
      const wrapper = createWrapper();
      const separator = wrapper.find('[data-test-stub="q-separator"]');
      expect(separator.classes()).toContain("separator");
    });

    it("should have proper splitter configuration", () => {
      const wrapper = createWrapper();
      const splitter = wrapper.find('[data-test-stub="q-splitter"]');
      
      expect(splitter.attributes("unit")).toBe("px");
      expect(splitter.attributes("style")).toContain("min-height: calc(100vh - 104px)");
    });
  });

  describe("Edge cases", () => {
    it("should handle missing organization identifier", () => {
      mockStore.state.selectedOrganization = null;
      const wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      // Should handle gracefully without crashing
    });

    it("should handle undefined router current route", () => {
      mockRouter.currentRoute.value = null;
      const wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      // Should handle gracefully without crashing
    });
  });
});