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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import SortByBtnGrp from "@/components/dashboards/addPanel/SortByBtnGrp.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock dashboard panel composable
vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: {
      value: {
        data: {
          queries: [{ fields: [] }],
          type: "line"
        },
        layout: {
          currentQueryIndex: 0
        }
      }
    }
  }))
}));

installQuasar({
  plugins: [Dialog, Notify],
});

const defaultFieldObj = {
  name: "testField",
  type: "string",
  sortBy: null
};

describe("SortByBtnGrp", () => {
  let wrapper: any;

  const defaultProps = {
    fieldObj: { ...defaultFieldObj }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(SortByBtnGrp, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard"
        },
        stubs: {
          'AscSort': {
            template: '<div data-test="asc-sort-icon"></div>'
          },
          'DescSort': {
            template: '<div data-test="desc-sort-icon"></div>'
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render sort by label", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain('Sort By:');
    });

    it("should render button group", () => {
      wrapper = createWrapper();

      expect(wrapper.find('.q-btn-group').exists()).toBe(true);
    });

    it("should render clear sort button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-sort-by-item-clear"]').exists()).toBe(true);
    });

    it("should render ascending sort button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-sort-by-item-asc"]').exists()).toBe(true);
    });

    it("should render descending sort button", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-sort-by-item-desc"]').exists()).toBe(true);
    });

    it("should render sort icons", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="asc-sort-icon"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="desc-sort-icon"]').exists()).toBe(true);
    });
  });

  describe("Sort State Display", () => {
    it("should highlight clear button when no sort is applied", () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      expect(clearBtn.classes()).toContain('selected');
    });

    it("should highlight ascending button when ASC sort is applied", () => {
      const fieldObjAsc = { ...defaultFieldObj, sortBy: 'ASC' };
      wrapper = createWrapper({ fieldObj: fieldObjAsc });

      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      expect(ascBtn.classes()).toContain('selected');
    });

    it("should highlight descending button when DESC sort is applied", () => {
      const fieldObjDesc = { ...defaultFieldObj, sortBy: 'DESC' };
      wrapper = createWrapper({ fieldObj: fieldObjDesc });

      const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');
      expect(descBtn.classes()).toContain('selected');
    });

    it("should only highlight one button at a time", () => {
      const fieldObjAsc = { ...defaultFieldObj, sortBy: 'ASC' };
      wrapper = createWrapper({ fieldObj: fieldObjAsc });

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');

      expect(clearBtn.classes()).not.toContain('selected');
      expect(ascBtn.classes()).toContain('selected');
      expect(descBtn.classes()).not.toContain('selected');
    });
  });

  describe("Button Interactions", () => {
    it("should clear sort when clear button is clicked", async () => {
      const fieldObjAsc = { ...defaultFieldObj, sortBy: 'ASC' };
      wrapper = createWrapper({ fieldObj: fieldObjAsc });

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      await clearBtn.trigger('click');

      expect(wrapper.props('fieldObj').sortBy).toBe(null);
    });

    it("should set ascending sort when ASC button is clicked", async () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      await ascBtn.trigger('click');

      expect(wrapper.props('fieldObj').sortBy).toBe('ASC');
    });

    it("should set descending sort when DESC button is clicked", async () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');
      await descBtn.trigger('click');

      expect(wrapper.props('fieldObj').sortBy).toBe('DESC');
    });

    it("should allow switching between sort options", async () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      // Set to ASC
      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      await ascBtn.trigger('click');
      expect(wrapper.props('fieldObj').sortBy).toBe('ASC');

      // Change to DESC
      const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');
      await descBtn.trigger('click');
      expect(wrapper.props('fieldObj').sortBy).toBe('DESC');

      // Clear sort
      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      await clearBtn.trigger('click');
      expect(wrapper.props('fieldObj').sortBy).toBe(null);
    });
  });

  describe("Component Methods", () => {
    it("should have updateSortOption method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.updateSortOption).toBe('function');
    });

    it("should update field sort property through updateSortOption", () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      wrapper.vm.updateSortOption('ASC');
      expect(wrapper.props('fieldObj').sortBy).toBe('ASC');

      wrapper.vm.updateSortOption('DESC');
      expect(wrapper.props('fieldObj').sortBy).toBe('DESC');

      wrapper.vm.updateSortOption(null);
      expect(wrapper.props('fieldObj').sortBy).toBe(null);
    });
  });

  describe("Field Object Validation", () => {
    it("should handle field object with different initial states", () => {
      const variants = [
        { ...defaultFieldObj, sortBy: null },
        { ...defaultFieldObj, sortBy: 'ASC' },
        { ...defaultFieldObj, sortBy: 'DESC' },
        { ...defaultFieldObj, sortBy: undefined }
      ];

      variants.forEach(fieldObj => {
        const localWrapper = createWrapper({ fieldObj });
        expect(localWrapper.exists()).toBe(true);
        localWrapper.unmount();
      });
    });

    it("should handle field object with additional properties", () => {
      const extendedFieldObj = {
        ...defaultFieldObj,
        sortBy: 'ASC',
        extraProp: 'test',
        nested: { value: 123 }
      };

      wrapper = createWrapper({ fieldObj: extendedFieldObj });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props('fieldObj').extraProp).toBe('test');
    });
  });

  describe("Styling and CSS Classes", () => {
    it("should apply selected class correctly", () => {
      const fieldObjAsc = { ...defaultFieldObj, sortBy: 'ASC' };
      wrapper = createWrapper({ fieldObj: fieldObjAsc });

      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      expect(ascBtn.classes()).toContain('selected');
    });

    it("should not apply selected class to non-active buttons", () => {
      const fieldObjAsc = { ...defaultFieldObj, sortBy: 'ASC' };
      wrapper = createWrapper({ fieldObj: fieldObjAsc });

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');

      expect(clearBtn.classes()).not.toContain('selected');
      expect(descBtn.classes()).not.toContain('selected');
    });
  });

  describe("Button Properties", () => {
    it("should have correct button properties", () => {
      wrapper = createWrapper();

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      expect(clearBtn.exists()).toBe(true);
    });

    it("should have icon on clear button", () => {
      wrapper = createWrapper();

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      // The clear button should exist and be part of the component
      expect(clearBtn.exists()).toBe(true);
    });
  });

  describe("Dashboard Panel Integration", () => {
    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
    });

    it("should work with injected dashboard panel data key", () => {
      wrapper = createWrapper();

      // Component should render without errors when dashboard panel data is provided
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined sortBy value", () => {
      const fieldObjUndefined = { ...defaultFieldObj, sortBy: undefined };
      wrapper = createWrapper({ fieldObj: fieldObjUndefined });

      expect(wrapper.exists()).toBe(true);
      
      // Should treat undefined as falsy and highlight clear button
      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      expect(clearBtn.classes()).toContain('selected');
    });

    it("should handle empty field object gracefully", () => {
      const emptyFieldObj = {};

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper({ fieldObj: emptyFieldObj });

      expect(wrapper.exists()).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Reactive Updates", () => {
    it("should react to field object changes", async () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
      expect(clearBtn.classes()).toContain('selected');

      // Update the field object
      await wrapper.setProps({ 
        fieldObj: { ...fieldObjNoSort, sortBy: 'ASC' }
      });

      const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
      expect(ascBtn.classes()).toContain('selected');
    });

    it("should maintain state consistency during rapid changes", async () => {
      const fieldObjNoSort = { ...defaultFieldObj, sortBy: null };
      wrapper = createWrapper({ fieldObj: fieldObjNoSort });

      const sortOptions = [null, 'ASC', 'DESC', null, 'ASC'];
      
      for (const sortOption of sortOptions) {
        await wrapper.setProps({ 
          fieldObj: { ...fieldObjNoSort, sortBy: sortOption }
        });
        
        // Verify the correct button is highlighted
        const clearBtn = wrapper.find('[data-test="dashboard-sort-by-item-clear"]');
        const ascBtn = wrapper.find('[data-test="dashboard-sort-by-item-asc"]');
        const descBtn = wrapper.find('[data-test="dashboard-sort-by-item-desc"]');

        if (sortOption === null) {
          expect(clearBtn.classes()).toContain('selected');
        } else if (sortOption === 'ASC') {
          expect(ascBtn.classes()).toContain('selected');
        } else if (sortOption === 'DESC') {
          expect(descBtn.classes()).toContain('selected');
        }
      }
    });
  });
});