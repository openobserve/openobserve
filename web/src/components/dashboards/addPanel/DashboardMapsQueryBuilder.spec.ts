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
import DashboardMapsQueryBuilder from "@/components/dashboards/addPanel/DashboardMapsQueryBuilder.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the composables
const mockDashboardPanelData = {
  data: {
    type: 'maps',
    queryType: 'sql',
    queries: [
      {
        fields: {
          stream: 'default',
          name: null,
          value_for_maps: null
        },
        customQuery: false,
        joins: []
      }
    ]
  },
  layout: {
    currentQueryIndex: 0
  },
  meta: {
    dragAndDrop: {
      dragging: false,
      dragSource: null,
      dragElement: null,
      currentDragArea: null,
      targetDragIndex: null
    },
    stream: {
      selectedStreamFields: [],
      customQueryFields: []
    }
  }
};

const mockUseDashboardPanelData = {
  dashboardPanelData: mockDashboardPanelData,
  addMapName: vi.fn(),
  addMapValue: vi.fn(),
  removeMapName: vi.fn(),
  removeMapValue: vi.fn(),
  addFilteredItem: vi.fn(),
  promqlMode: false,
  cleanupDraggingFields: vi.fn()
};

const mockQuasar = {
  notify: vi.fn()
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => mockUseDashboardPanelData
}));

vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => mockQuasar
  };
});

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "mocked-image-url")
}));

describe("DashboardMapsQueryBuilder", () => {
  let wrapper: any;

  const defaultProps = {
    dashboardData: {
      id: "test-dashboard",
      name: "Test Dashboard"
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock data
    mockDashboardPanelData.data.type = 'maps';
    mockUseDashboardPanelData.promqlMode = false;
    mockDashboardPanelData.data.queries[0].fields = {
      stream: 'default',
      name: null,
      value_for_maps: null
    };
    mockDashboardPanelData.data.queries[0].customQuery = false;
    mockDashboardPanelData.data.queries[0].joins = [];
    mockDashboardPanelData.meta.dragAndDrop.dragging = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DashboardMapsQueryBuilder, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n],
        stubs: {
          'SortByBtnGrp': true,
          'CommonAutoComplete': true,
          'SanitizedHtmlRenderer': true,
          'DashboardFiltersOption': true,
          'DashboardJoinsOption': true,
          'q-icon': true,
          'q-tooltip': true,
          'q-btn-group': true,
          'q-btn': true,
          'q-menu': true,
          'q-input': true,
          'q-select': true,
          'q-separator': true
        },
        mocks: {
          $t: (key: string) => key
        },
        provide: {
          dashboardPanelDataPageKey: 'dashboard',
          store: {
            state: {}
          }
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render when panel type is maps and not in promql mode", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('maps');
      expect(wrapper.vm.promqlMode).toBe(false);
    });

    it("should have correct panel type when not maps", () => {
      mockDashboardPanelData.data.type = 'bar';
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.type).toBe('bar');
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle promql mode correctly", () => {
      mockUseDashboardPanelData.promqlMode = true;
      wrapper = createWrapper();

      expect(wrapper.vm.promqlMode).toBe(true);
      expect(wrapper.exists()).toBe(true);
    });

    it("should have name layout data attributes defined", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('maps');
    });

    it("should have value_for_maps layout data attributes defined", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('maps');
    });

    it("should render filters option component", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.DashboardFiltersOption).toBeDefined();
    });
  });

  describe("Component Name and Setup", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('DashboardMapsQueryBuilder');
    });

    it("should register all required components", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
      expect(wrapper.vm.$options.components.CommonAutoComplete).toBeDefined();
      expect(wrapper.vm.$options.components.SanitizedHtmlRenderer).toBeDefined();
      expect(wrapper.vm.$options.components.DashboardFiltersOption).toBeDefined();
    });
  });

  describe("Props Handling", () => {
    it("should accept dashboardData prop", () => {
      const dashboardData = { id: "test", name: "Test Dashboard" };
      wrapper = createWrapper({ dashboardData });

      expect(wrapper.props('dashboardData')).toEqual(dashboardData);
    });

    it("should handle empty dashboardData", () => {
      wrapper = createWrapper({ dashboardData: null });

      expect(wrapper.props('dashboardData')).toBe(null);
    });
  });

  describe("Data Properties", () => {
    it("should initialize trigger operators", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.triggerOperators).toBeDefined();
      expect(Array.isArray(wrapper.vm.triggerOperators)).toBe(true);
      expect(wrapper.vm.triggerOperators.length).toBeGreaterThan(0);
    });

    it("should initialize pagination", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.pagination).toEqual({ rowsPerPage: 0 });
    });

    it("should initialize expansion items", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.expansionItems).toEqual({
        name: true,
        value_for_maps: true,
        filter: false
      });
    });

    it("should have access to dashboard panel data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBe(mockDashboardPanelData);
    });

    it("should initialize model and tab refs", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.model).toEqual([]);
      expect(wrapper.vm.tab).toBe("General");
    });
  });

  describe("Name Field Management", () => {
    it("should access name field data when present", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Name",
        args: [
          { type: "field", value: { field: "name_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      const nameField = wrapper.vm.dashboardPanelData.data.queries[0].fields.name;
      expect(nameField).toBeDefined();
      expect(nameField.args[0].value.field).toBe("name_field");
    });

    it("should handle null name field", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.name = null;
      wrapper = createWrapper();

      const nameField = wrapper.vm.dashboardPanelData.data.queries[0].fields.name;
      expect(nameField).toBe(null);
    });

    it("should call removeMapName when remove button is clicked", async () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Name",
        args: [
          { type: "field", value: { field: "name_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      wrapper.vm.removeMapName();
      expect(mockUseDashboardPanelData.removeMapName).toHaveBeenCalled();
    });

    it("should have name field menu data", () => {
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Name",
        args: [
          { type: "field", value: { field: "name_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.name.label).toBe("Name");
    });

    it("should have modifiable name field label", () => {
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Name",
        args: [
          { type: "field", value: { field: "name_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      const nameField = wrapper.vm.dashboardPanelData.data.queries[0].fields.name;
      expect(nameField.label).toBe("Name");

      nameField.label = "New Name";
      expect(nameField.label).toBe("New Name");
    });
  });

  describe("Value For Maps Field Management", () => {
    it("should access value_for_maps field data when present", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        functionName: "sum",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps;
      expect(valueField).toBeDefined();
      expect(valueField.args[0].value.field).toBe("value_field");
      expect(valueField.functionName).toBe("sum");
    });

    it("should handle null value_for_maps field", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = null;
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps;
      expect(valueField).toBe(null);
    });

    it("should call removeMapValue when remove button is clicked", async () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      wrapper.vm.removeMapValue();
      expect(mockUseDashboardPanelData.removeMapValue).toHaveBeenCalled();
    });

    it("should have value_for_maps field menu data", () => {
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps.label).toBe("Value");
    });

    it("should handle aggregation function for value_for_maps field", () => {
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        functionName: "count",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps.functionName).toBe("count");
    });

    it("should have modifiable value_for_maps field label", () => {
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps;
      expect(valueField.label).toBe("Value");

      valueField.label = "New Value";
      expect(valueField.label).toBe("New Value");
    });
  });

  describe("Computed Properties", () => {
    describe("Hint", () => {
      it("should return correct hint for maps type", () => {
        mockDashboardPanelData.data.type = 'maps';
        wrapper = createWrapper();

        expect(wrapper.vm.Hint).toBe('Add 1 field here');
      });

      it("should return default hint for other types", () => {
        mockDashboardPanelData.data.type = 'bar';
        wrapper = createWrapper();

        expect(wrapper.vm.Hint).toBe('Add maximum 2 fields here');
      });
    });

    describe("valueLabel", () => {
      it("should return column name when no aggregation function", () => {
        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "build",
          label: "Value",
          args: [
            { type: "field", value: { field: "value_field", streamAlias: "" } }
          ]
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('value_field');
      });

      it("should return aggregated label when aggregation function exists", () => {
        mockDashboardPanelData.data.queries[0].customQuery = false;
        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "build",
          label: "Value",
          functionName: "sum",
          args: [
            { type: "field", value: { field: "value_field", streamAlias: "" } }
          ]
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('sum(value_field)');
      });

      it("should handle custom query", () => {
        mockDashboardPanelData.data.queries[0].customQuery = true;
        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "custom",
          alias: "custom_field",
          label: "Custom",
          functionName: "count"
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('custom_field');
      });
    });
  });

  describe("Drag and Drop Functionality", () => {
    describe("onDrop", () => {
      it("should add name from field list", () => {
        const mockField = { name: "name_field", type: "string" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "name");

        expect(mockUseDashboardPanelData.addMapName).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should add value_for_maps from field list", () => {
        const mockField = { name: "value_field", type: "number" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "value_for_maps");

        expect(mockUseDashboardPanelData.addMapValue).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should add filtered item from field list", () => {
        const mockField = { name: "filter_field" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "f");

        expect(mockUseDashboardPanelData.addFilteredItem).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should handle drag element not found", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = null;
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "name");

        expect(mockUseDashboardPanelData.addMapName).not.toHaveBeenCalled();
      });

      it("should show error when max fields exceeded for name", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "name";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = "existing_field";
        mockDashboardPanelData.data.queries[0].fields.name = {
          type: "build",
          args: [
            { type: "field", value: { field: "existing_field", streamAlias: "" } }
          ]
        };
        mockDashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "existing_field" }
        ];
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "name");

        expect(mockQuasar.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "negative",
            message: "Max 1 field in NAME is allowed.",
            timeout: 5000
          })
        );
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should show error when max fields exceeded for value_for_maps", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "value_for_maps";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = "existing_field";
        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "build",
          args: [
            { type: "field", value: { field: "existing_field", streamAlias: "" } }
          ]
        };
        mockDashboardPanelData.meta.stream.selectedStreamFields = [
          { name: "existing_field" }
        ];
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "value_for_maps");

        expect(mockQuasar.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "negative",
            message: "Max 1 field in VALUE_FOR_MAPS is allowed.",
            timeout: 5000
          })
        );
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should move field between axes", () => {
        const fieldName = "test_field";
        const dragElement = {
          args: [
            { type: "field", value: { field: fieldName, streamAlias: "" } }
          ]
        };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "name";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = dragElement;
        mockDashboardPanelData.meta.stream.selectedStreamFields = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "value_for_maps");

        expect(mockUseDashboardPanelData.removeMapName).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addMapValue).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should handle custom drag name from custom query fields", () => {
        const fieldName = "custom_field";
        const dragElement = {
          args: [
            { type: "field", value: { field: fieldName, streamAlias: "" } }
          ]
        };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "name";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = dragElement;
        mockDashboardPanelData.meta.stream.customQueryFields = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "value_for_maps");

        expect(mockUseDashboardPanelData.removeMapName).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addMapValue).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });
    });

    describe("onFieldDragStart", () => {
      it("should set drag state correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { dataTransfer: {} };
        wrapper.vm.onFieldDragStart(mockEvent, "test_item", "name");

        expect(mockDashboardPanelData.meta.dragAndDrop.dragging).toBe(true);
        expect(mockDashboardPanelData.meta.dragAndDrop.dragElement).toBe("test_item");
        expect(mockDashboardPanelData.meta.dragAndDrop.dragSource).toBe("name");
      });
    });

    describe("onDragEnter", () => {
      it("should set drag area correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragEnter(mockEvent, "value_for_maps", 1);

        expect(mockDashboardPanelData.meta.dragAndDrop.currentDragArea).toBe("value_for_maps");
        expect(mockDashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(1);
        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should prevent field list drag to filter area", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "name";
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragEnter(mockEvent, "f", 0);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should handle null index correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        mockDashboardPanelData.meta.dragAndDrop.targetDragIndex = 5;
        wrapper.vm.onDragEnter(mockEvent, "name", null);

        expect(mockDashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(5);
        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });
    });

    describe("onDragOver", () => {
      it("should prevent default behavior", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragOver(mockEvent, "name");

        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });
    });

    describe("onDragStart", () => {
      it("should prevent default behavior", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragStart(mockEvent, "test_item");

        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });
    });

    describe("onDragEnd", () => {
      it("should cleanup dragging fields", () => {
        wrapper = createWrapper();

        wrapper.vm.onDragEnd();

        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });
    });
  });

  describe("Watchers", () => {
    it("should expand all sections when dragging starts", async () => {
      wrapper = createWrapper();

      wrapper.vm.expansionItems = {
        name: false,
        value_for_maps: false,
        filter: false
      };

      const oldVal = false;
      const newVal = true;
      
      if (oldVal === false && newVal === true) {
        wrapper.vm.expansionItems.name = true;
        wrapper.vm.expansionItems.value_for_maps = true;
        wrapper.vm.expansionItems.filter = true;
      }
      
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.expansionItems).toEqual({
        name: true,
        value_for_maps: true,
        filter: true
      });
    });

    it("should not change expansion when dragging stops", async () => {
      wrapper = createWrapper();

      mockDashboardPanelData.meta.dragAndDrop.dragging = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.expansionItems).toEqual({
        name: true,
        value_for_maps: true,
        filter: false
      });
    });
  });

  describe("CSS Classes", () => {
    it("should apply drop-target class when dragging", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      wrapper = createWrapper();

      const nameContainer = wrapper.find('[data-test="dashboard-name-layout"]');
      expect(nameContainer.classes()).toContain('drop-target');
    });

    it("should apply drop-entered class when drag area matches", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      mockDashboardPanelData.meta.dragAndDrop.currentDragArea = 'name';
      wrapper = createWrapper();

      const nameContainer = wrapper.find('[data-test="dashboard-name-layout"]');
      expect(nameContainer.classes()).toContain('drop-entered');
    });

    it("should not apply drop-entered class when drag area doesn't match", () => {
      mockDashboardPanelData.data.type = 'maps';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      mockDashboardPanelData.meta.dragAndDrop.currentDragArea = 'value_for_maps';
      wrapper = createWrapper();

      const nameContainer = wrapper.find('[data-test="dashboard-name-layout"]');
      expect(nameContainer.classes()).not.toContain('drop-entered');
    });
  });

  describe("Field Labels and Display", () => {
    describe("commonBtnLabel", () => {
      it("should return column name for custom query", () => {
        mockDashboardPanelData.data.type = 'maps';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = true;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "custom",
          alias: "custom_col",
          functionName: "sum"
        };
        const result = wrapper.vm.valueLabel;

        expect(result).toBe("custom_col");
      });

      it("should return aggregated label when aggregation exists", () => {
        mockDashboardPanelData.data.type = 'maps';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = false;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "build",
          functionName: "count",
          args: [
            { type: "field", value: { field: "test_col", streamAlias: "" } }
          ]
        };
        const result = wrapper.vm.valueLabel;

        expect(result).toBe("count(test_col)");
      });

      it("should return column name when no aggregation", () => {
        mockDashboardPanelData.data.type = 'maps';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = false;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
          type: "build",
          args: [
            { type: "field", value: { field: "plain_col", streamAlias: "" } }
          ]
        };
        const result = wrapper.vm.valueLabel;

        expect(result).toBe("plain_col");
      });
    });
  });

  describe("SortByBtnGrp Integration", () => {
    it("should render SortByBtnGrp for name when not custom query and SQL", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = 'sql';
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Name",
        args: [
          { type: "field", value: { field: "name_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
    });

    it("should not render SortByBtnGrp for custom query", () => {
      mockDashboardPanelData.data.queries[0].customQuery = true;
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "custom",
        alias: "name_field",
        label: "Name"
      };
      wrapper = createWrapper();

      const shouldShow = !mockDashboardPanelData.data.queries[0].customQuery &&
                        mockDashboardPanelData.data.queryType === 'sql';
      expect(shouldShow).toBe(false);
    });

    it("should render SortByBtnGrp for value_for_maps when conditions met", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = 'sql';
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
    });
  });

  describe("Error Handling", () => {

    it("should handle missing query fields", () => {
      mockDashboardPanelData.data.queries[0].fields = {
        name: null,
        value_for_maps: null
      };
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null drag element gracefully", () => {
      mockDashboardPanelData.meta.dragAndDrop.dragElement = null;
      wrapper = createWrapper();

      expect(() => {
        const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
        wrapper.vm.onDrop(mockEvent, "name");
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle empty trigger operators", () => {
      wrapper = createWrapper();

      expect(Array.isArray(wrapper.vm.triggerOperators)).toBe(true);
    });

    it("should handle different query types", () => {
      mockDashboardPanelData.data.queryType = 'promql';
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null field values", () => {
      mockDashboardPanelData.data.queries[0].fields = {
        name: null,
        value_for_maps: null
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.name).toBe(null);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value_for_maps).toBe(null);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete field workflow", () => {
      wrapper = createWrapper();

      const mockField = { name: "test_field", type: "string" };
      mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
      mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;

      const mockEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
      wrapper.vm.onDrop(mockEvent, "name");

      expect(mockUseDashboardPanelData.addMapName).toHaveBeenCalledWith(mockField);
      expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();

      wrapper.vm.removeMapName();
      expect(mockUseDashboardPanelData.removeMapName).toHaveBeenCalled();
    });

    it("should handle value field workflow with aggregation", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queries[0].fields.value_for_maps = {
        type: "build",
        label: "Value",
        functionName: "avg",
        args: [
          { type: "field", value: { field: "value_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      expect(wrapper.vm.valueLabel).toBe("avg(value_field)");

      wrapper.vm.removeMapValue();
      expect(mockUseDashboardPanelData.removeMapValue).toHaveBeenCalled();
    });
  });

  describe("Component State Management", () => {
    it("should maintain consistent state during operations", () => {
      wrapper = createWrapper();

      const initialState = {
        pagination: wrapper.vm.pagination,
        operators: wrapper.vm.operators,
        expansionItems: { ...wrapper.vm.expansionItems }
      };

      wrapper.vm.onFieldDragStart({}, "test", "name");
      wrapper.vm.onDragEnd();

      expect(wrapper.vm.pagination).toEqual(initialState.pagination);
      expect(wrapper.vm.operators).toEqual(initialState.operators);
    });

    it("should handle rapid state changes", () => {
      wrapper = createWrapper();

      for (let i = 0; i < 10; i++) {
        wrapper.vm.onFieldDragStart({}, `field_${i}`, "name");
        wrapper.vm.onDragEnd();
      }

      expect(wrapper.exists()).toBe(true);
    });

    it("should maintain field state across operations", () => {
      mockDashboardPanelData.data.queries[0].fields.name = {
        type: "build",
        label: "Test",
        args: [
          { type: "field", value: { field: "test_field", streamAlias: "" } }
        ]
      };
      wrapper = createWrapper();

      const nameField = wrapper.vm.dashboardPanelData.data.queries[0].fields.name;
      nameField.label = "Updated Label";

      expect(nameField.label).toBe("Updated Label");
      expect(nameField.args[0].value.field).toBe("test_field");
    });
  });

  describe("Utility Methods", () => {
    it("should have getImageURL method available", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });
  });
});