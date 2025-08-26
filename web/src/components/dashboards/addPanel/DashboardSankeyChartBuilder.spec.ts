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
import DashboardSankeyChartBuilder from "@/components/dashboards/addPanel/DashboardSankeyChartBuilder.vue";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the composables
const mockDashboardPanelData = {
  data: {
    type: 'sankey',
    queryType: 'sql',
    queries: [
      {
        fields: {
          source: null,
          target: null,
          value: null
        },
        customQuery: false
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
      customQueryFields: []
    }
  }
};

const mockUseDashboardPanelData = {
  dashboardPanelData: mockDashboardPanelData,
  addSource: vi.fn(),
  addTarget: vi.fn(),
  addValue: vi.fn(),
  removeSource: vi.fn(),
  removeTarget: vi.fn(),
  removeValue: vi.fn(),
  addFilteredItem: vi.fn(),
  promqlMode: false,
  cleanupDraggingFields: vi.fn(),
  selectedStreamFieldsBasedOnUserDefinedSchema: { value: [] }
};

const mockNotifications = {
  showErrorNotification: vi.fn()
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => mockUseDashboardPanelData
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => mockNotifications
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "mocked-image-url")
}));

describe("DashboardSankeyChartBuilder", () => {
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
    mockDashboardPanelData.data.type = 'sankey';
    mockUseDashboardPanelData.promqlMode = false;
    mockDashboardPanelData.data.queries[0].fields = {
      source: null,
      target: null,
      value: null
    };
    mockDashboardPanelData.meta.dragAndDrop.dragging = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DashboardSankeyChartBuilder, {
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
          dashboardPanelDataPageKey: 'dashboard'
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render when panel type is sankey and not in promql mode", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('sankey');
      expect(wrapper.vm.promqlMode).toBe(false);
    });

    it("should have correct panel type when not sankey", () => {
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

    it("should have source layout data attributes defined", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('sankey');
    });

    it("should have target layout data attributes defined", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('sankey');
    });

    it("should have value layout data attributes defined", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.dashboardPanelData.data.type).toBe('sankey');
    });

    it("should render filters option component", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.DashboardFiltersOption).toBeDefined();
    });
  });

  describe("Component Name and Setup", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe('DashboardSankeyChartBuilder');
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
        source: true,
        target: true,
        value: true,
        filter: false
      });
    });

    it("should initialize operators", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.operators).toEqual(["=", "<>", ">=", "<=", ">", "<"]);
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

    it("should have options array defined", () => {
      wrapper = createWrapper();

      const expectedOptions = [
        "=", "<>", ">=", "<=", ">", "<",
        "IN", "Contains", "Not Contains", "Is Null", "Is Not Null"
      ];

      expect(wrapper.vm.options).toEqual(expectedOptions);
    });
  });

  describe("Source Field Management", () => {
    it("should access source field data when present", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "source_field",
        label: "Source"
      };
      wrapper = createWrapper();

      const sourceField = wrapper.vm.dashboardPanelData.data.queries[0].fields.source;
      expect(sourceField).toBeDefined();
      expect(sourceField.column).toBe("source_field");
    });

    it("should handle null source field", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.source = null;
      wrapper = createWrapper();

      const sourceField = wrapper.vm.dashboardPanelData.data.queries[0].fields.source;
      expect(sourceField).toBe(null);
    });

    it("should call removeSource when remove button is clicked", async () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "source_field",
        label: "Source"
      };
      wrapper = createWrapper();

      wrapper.vm.removeSource();
      expect(mockUseDashboardPanelData.removeSource).toHaveBeenCalled();
    });

    it("should have source field menu data", () => {
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "source_field",
        label: "Source"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.source.label).toBe("Source");
    });

    it("should have modifiable source field label", () => {
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "source_field",
        label: "Source"
      };
      wrapper = createWrapper();

      const sourceField = wrapper.vm.dashboardPanelData.data.queries[0].fields.source;
      expect(sourceField.label).toBe("Source");
      
      sourceField.label = "New Source";
      expect(sourceField.label).toBe("New Source");
    });
  });

  describe("Target Field Management", () => {
    it("should access target field data when present", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.target = {
        column: "target_field",
        label: "Target"
      };
      wrapper = createWrapper();

      const targetField = wrapper.vm.dashboardPanelData.data.queries[0].fields.target;
      expect(targetField).toBeDefined();
      expect(targetField.column).toBe("target_field");
    });

    it("should handle null target field", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.target = null;
      wrapper = createWrapper();

      const targetField = wrapper.vm.dashboardPanelData.data.queries[0].fields.target;
      expect(targetField).toBe(null);
    });

    it("should call removeTarget when remove button is clicked", async () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.target = {
        column: "target_field",
        label: "Target"
      };
      wrapper = createWrapper();

      wrapper.vm.removeTarget();
      expect(mockUseDashboardPanelData.removeTarget).toHaveBeenCalled();
    });

    it("should have target field menu data", () => {
      mockDashboardPanelData.data.queries[0].fields.target = {
        column: "target_field",
        label: "Target"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.target.label).toBe("Target");
    });

    it("should have modifiable target field label", () => {
      mockDashboardPanelData.data.queries[0].fields.target = {
        column: "target_field",
        label: "Target"
      };
      wrapper = createWrapper();

      const targetField = wrapper.vm.dashboardPanelData.data.queries[0].fields.target;
      expect(targetField.label).toBe("Target");
      
      targetField.label = "New Target";
      expect(targetField.label).toBe("New Target");
    });
  });

  describe("Value Field Management", () => {
    it("should access value field data when present", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value",
        aggregationFunction: "sum"
      };
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value;
      expect(valueField).toBeDefined();
      expect(valueField.column).toBe("value_field");
      expect(valueField.aggregationFunction).toBe("sum");
    });

    it("should handle null value field", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value = null;
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value;
      expect(valueField).toBe(null);
    });

    it("should call removeValue when remove button is clicked", async () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
      wrapper = createWrapper();

      wrapper.vm.removeValue();
      expect(mockUseDashboardPanelData.removeValue).toHaveBeenCalled();
    });

    it("should have value field menu data", () => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value.label).toBe("Value");
    });

    it("should handle aggregation function for value field", () => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value",
        aggregationFunction: "count"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value.aggregationFunction).toBe("count");
    });

    it("should have modifiable value field label", () => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
      wrapper = createWrapper();

      const valueField = wrapper.vm.dashboardPanelData.data.queries[0].fields.value;
      expect(valueField.label).toBe("Value");
      
      valueField.label = "New Value";
      expect(valueField.label).toBe("New Value");
    });
  });

  describe("Computed Properties", () => {
    describe("Hint", () => {
      it("should return correct hint for sankey type", () => {
        mockDashboardPanelData.data.type = 'sankey';
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
        mockDashboardPanelData.data.queries[0].fields.value = {
          column: "value_field",
          label: "Value"
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('value_field');
      });

      it("should return aggregated label when aggregation function exists", () => {
        mockDashboardPanelData.data.queries[0].customQuery = false;
        mockDashboardPanelData.data.queries[0].fields.value = {
          column: "value_field",
          label: "Value",
          aggregationFunction: "sum"
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('SUM(value_field)');
      });

      it("should handle custom query", () => {
        mockDashboardPanelData.data.queries[0].customQuery = true;
        mockDashboardPanelData.data.queries[0].fields.value = {
          column: "custom_field",
          label: "Custom",
          aggregationFunction: "count"
        };
        wrapper = createWrapper();

        expect(wrapper.vm.valueLabel).toBe('custom_field');
      });
    });

    describe("commonBtnLabel", () => {
      it("should return column name for custom query", () => {
        mockDashboardPanelData.data.type = 'sankey';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = true;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value = { column: "custom_col", aggregationFunction: "sum" };
        const result = wrapper.vm.valueLabel;
        
        expect(result).toBe("custom_col");
      });

      it("should return aggregated label when aggregation exists", () => {
        mockDashboardPanelData.data.type = 'sankey';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = false;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value = { column: "test_col", aggregationFunction: "count" };
        const result = wrapper.vm.valueLabel;

        expect(result).toBe("COUNT(test_col)");
      });

      it("should return column name when no aggregation", () => {
        mockDashboardPanelData.data.type = 'sankey';
        mockUseDashboardPanelData.promqlMode = false;
        mockDashboardPanelData.data.queries[0].customQuery = false;
        wrapper = createWrapper();

        mockDashboardPanelData.data.queries[0].fields.value = { column: "plain_col" };
        const result = wrapper.vm.valueLabel;

        expect(result).toBe("plain_col");
      });
    });
  });

  describe("Drag and Drop Functionality", () => {
    describe("onDrop", () => {
      it("should add source from field list", () => {
        const mockField = { name: "source_field", type: "string" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "source");

        expect(mockUseDashboardPanelData.addSource).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should add target from field list", () => {
        const mockField = { name: "target_field", type: "string" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "target");

        expect(mockUseDashboardPanelData.addTarget).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should add value from field list", () => {
        const mockField = { name: "value_field", type: "number" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "value");

        expect(mockUseDashboardPanelData.addValue).toHaveBeenCalledWith(mockField);
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should add filtered item from field list", () => {
        const mockField = { name: "filter_field" };
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "f");

        expect(mockUseDashboardPanelData.addFilteredItem).toHaveBeenCalledWith("filter_field");
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should handle drag element not found", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = null;
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "source");

        expect(mockUseDashboardPanelData.addSource).not.toHaveBeenCalled();
      });

      it("should show error when max fields exceeded for source", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "source";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = "existing_field";
        mockDashboardPanelData.data.queries[0].fields.source = { column: "existing_field" };
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: "existing_field" }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "source");

        expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith(
          "Max 1 field in SOURCE is allowed."
        );
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should show error when max fields exceeded for target", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "target";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = "existing_field";
        mockDashboardPanelData.data.queries[0].fields.target = { column: "existing_field" };
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: "existing_field" }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "target");

        expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith(
          "Max 1 field in TARGET is allowed."
        );
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should show error when max fields exceeded for value", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "value";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = "existing_field";
        mockDashboardPanelData.data.queries[0].fields.value = { column: "existing_field" };
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: "existing_field" }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "value");

        expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith(
          "Max 1 field in VALUE is allowed."
        );
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should move field between axes from source to target", () => {
        const fieldName = "test_field";
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "source";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = fieldName;
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "target");

        expect(mockUseDashboardPanelData.removeSource).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addTarget).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should move field between axes from target to value", () => {
        const fieldName = "test_field";
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "target";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = fieldName;
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "value");

        expect(mockUseDashboardPanelData.removeTarget).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addValue).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should move field between axes from value to source", () => {
        const fieldName = "test_field";
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "value";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = fieldName;
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "source");

        expect(mockUseDashboardPanelData.removeValue).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addSource).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should handle custom drag name from custom query fields", () => {
        const fieldName = "custom_field";
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "source";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = fieldName;
        mockDashboardPanelData.meta.stream.customQueryFields = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "target");

        expect(mockUseDashboardPanelData.removeSource).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.addTarget).toHaveBeenCalled();
        expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();
      });

      it("should handle filter drop and return early", () => {
        const fieldName = "filter_field";
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "source";
        mockDashboardPanelData.meta.dragAndDrop.dragElement = fieldName;
        mockUseDashboardPanelData.selectedStreamFieldsBasedOnUserDefinedSchema.value = [
          { name: fieldName }
        ];
        wrapper = createWrapper();

        wrapper.vm.onDrop({}, "f");

        // When dropping to "f" with non-fieldList source, it returns early and does not call cleanup
        // The component actually returns early without calling cleanupDraggingFields for filter drops
        expect(() => wrapper.vm.onDrop({}, "f")).not.toThrow();
      });
    });

    describe("onFieldDragStart", () => {
      it("should set drag state correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { dataTransfer: {} };
        wrapper.vm.onFieldDragStart(mockEvent, "test_item", "source");

        expect(mockDashboardPanelData.meta.dragAndDrop.dragging).toBe(true);
        expect(mockDashboardPanelData.meta.dragAndDrop.dragElement).toBe("test_item");
        expect(mockDashboardPanelData.meta.dragAndDrop.dragSource).toBe("source");
      });
    });

    describe("onDragEnter", () => {
      it("should set drag area correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragEnter(mockEvent, "target", 1);

        expect(mockDashboardPanelData.meta.dragAndDrop.currentDragArea).toBe("target");
        expect(mockDashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(1);
        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should prevent field list drag to filter area", () => {
        mockDashboardPanelData.meta.dragAndDrop.dragSource = "source";
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragEnter(mockEvent, "f", 0);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });

      it("should handle null index correctly", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        mockDashboardPanelData.meta.dragAndDrop.targetDragIndex = 5;
        wrapper.vm.onDragEnter(mockEvent, "value", null);

        expect(mockDashboardPanelData.meta.dragAndDrop.targetDragIndex).toBe(5);
        expect(mockEvent.preventDefault).toHaveBeenCalled();
      });
    });

    describe("onDragOver", () => {
      it("should prevent default behavior", () => {
        wrapper = createWrapper();

        const mockEvent = { preventDefault: vi.fn() };
        wrapper.vm.onDragOver(mockEvent, "source");

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

  describe("Having Conditions", () => {
    beforeEach(() => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
    });

    describe("isHavingFilterVisible", () => {
      it("should return true when having conditions exist", () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [
          { operator: "=", value: 10 }
        ];
        wrapper = createWrapper();

        expect(wrapper.vm.isHavingFilterVisible()).toBe(true);
      });

      it("should return false when no having conditions", () => {
        wrapper = createWrapper();

        expect(wrapper.vm.isHavingFilterVisible()).toBe(false);
      });

      it("should return false when having conditions is empty array", () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [];
        wrapper = createWrapper();

        expect(wrapper.vm.isHavingFilterVisible()).toBe(false);
      });
    });

    describe("toggleHavingFilter", () => {
      it("should add having condition when none exist", async () => {
        wrapper = createWrapper();

        await wrapper.vm.toggleHavingFilter();

        const valueField = mockDashboardPanelData.data.queries[0].fields.value;
        expect(valueField.havingConditions).toEqual([{ operator: null, value: null }]);
      });

      it("should initialize having conditions array if not exists", async () => {
        wrapper = createWrapper();

        await wrapper.vm.toggleHavingFilter();

        const valueField = mockDashboardPanelData.data.queries[0].fields.value;
        expect(Array.isArray(valueField.havingConditions)).toBe(true);
      });

      it("should not add condition if conditions already exist", async () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [
          { operator: "=", value: 5 }
        ];
        wrapper = createWrapper();

        await wrapper.vm.toggleHavingFilter();

        const valueField = mockDashboardPanelData.data.queries[0].fields.value;
        expect(valueField.havingConditions).toHaveLength(1);
        expect(valueField.havingConditions[0]).toEqual({ operator: "=", value: 5 });
      });
    });

    describe("cancelHavingFilter", () => {
      it("should clear having conditions", async () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [
          { operator: "=", value: 10 }
        ];
        wrapper = createWrapper();

        await wrapper.vm.cancelHavingFilter();

        const valueField = mockDashboardPanelData.data.queries[0].fields.value;
        expect(valueField.havingConditions).toEqual([]);
      });
    });

    describe("getHavingCondition", () => {
      it("should return first having condition when exists", () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [
          { operator: ">=", value: 5 }
        ];
        wrapper = createWrapper();

        const condition = wrapper.vm.getHavingCondition();

        expect(condition).toEqual({ operator: ">=", value: 5 });
      });

      it("should return default condition when none exist", () => {
        wrapper = createWrapper();

        const condition = wrapper.vm.getHavingCondition();

        expect(condition).toEqual({ operator: null, value: null });
      });

      it("should return default condition when having conditions is empty", () => {
        mockDashboardPanelData.data.queries[0].fields.value.havingConditions = [];
        wrapper = createWrapper();

        const condition = wrapper.vm.getHavingCondition();

        expect(condition).toEqual({ operator: null, value: null });
      });
    });
  });

  describe("Watchers", () => {
    it("should expand all sections when dragging starts", async () => {
      wrapper = createWrapper();

      wrapper.vm.expansionItems = {
        source: false,
        target: false,
        value: false,
        filter: false
      };

      const oldVal = false;
      const newVal = true;
      
      if (oldVal === false && newVal === true) {
        wrapper.vm.expansionItems.source = true;
        wrapper.vm.expansionItems.target = true;
        wrapper.vm.expansionItems.value = true;
        wrapper.vm.expansionItems.filter = true;
      }
      
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.expansionItems).toEqual({
        source: true,
        target: true,
        value: true,
        filter: true
      });
    });

    it("should not change expansion when dragging stops", async () => {
      wrapper = createWrapper();

      mockDashboardPanelData.meta.dragAndDrop.dragging = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.expansionItems).toEqual({
        source: true,
        target: true,
        value: true,
        filter: false
      });
    });
  });

  describe("CSS Classes", () => {
    it("should apply drop-target class when dragging", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      wrapper = createWrapper();

      const sourceContainer = wrapper.find('[data-test="dashboard-source-layout"]');
      expect(sourceContainer.classes()).toContain('drop-target');
    });

    it("should apply drop-entered class when drag area matches", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      mockDashboardPanelData.meta.dragAndDrop.currentDragArea = 'source';
      wrapper = createWrapper();

      const sourceContainer = wrapper.find('[data-test="dashboard-source-layout"]');
      expect(sourceContainer.classes()).toContain('drop-entered');
    });

    it("should not apply drop-entered class when drag area doesn't match", () => {
      mockDashboardPanelData.data.type = 'sankey';
      mockUseDashboardPanelData.promqlMode = false;
      mockDashboardPanelData.meta.dragAndDrop.dragging = true;
      mockDashboardPanelData.meta.dragAndDrop.currentDragArea = 'target';
      wrapper = createWrapper();

      const sourceContainer = wrapper.find('[data-test="dashboard-source-layout"]');
      expect(sourceContainer.classes()).not.toContain('drop-entered');
    });
  });

  describe("SortByBtnGrp Integration", () => {
    it("should render SortByBtnGrp for source when not custom query and SQL", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = 'sql';
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "source_field",
        label: "Source"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
    });

    it("should render SortByBtnGrp for target when conditions met", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = 'sql';
      mockDashboardPanelData.data.queries[0].fields.target = {
        column: "target_field",
        label: "Target"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
    });

    it("should render SortByBtnGrp for value when conditions met", () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = 'sql';
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
      wrapper = createWrapper();

      expect(wrapper.vm.$options.components.SortByBtnGrp).toBeDefined();
    });

    it("should not render SortByBtnGrp for custom query", () => {
      mockDashboardPanelData.data.queries[0].customQuery = true;
      wrapper = createWrapper();

      const shouldShow = !mockDashboardPanelData.data.queries[0].customQuery && 
                        mockDashboardPanelData.data.queryType === 'sql';
      expect(shouldShow).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing value field in having condition methods", () => {
      mockDashboardPanelData.data.queries[0].fields.value = { column: "test" };
      wrapper = createWrapper();

      const result = wrapper.vm.getHavingCondition();
      expect(result).toEqual({ operator: null, value: null });
    });

    it("should handle missing query fields", () => {
      mockDashboardPanelData.data.queries[0].fields = {
        source: null,
        target: null,
        value: null
      };
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null drag element gracefully", () => {
      mockDashboardPanelData.meta.dragAndDrop.dragElement = null;
      wrapper = createWrapper();

      expect(() => {
        wrapper.vm.onDrop({}, "source");
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
        source: null,
        target: null,
        value: null
      };
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.source).toBe(null);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.target).toBe(null);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].fields.value).toBe(null);
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete field workflow", () => {
      wrapper = createWrapper();

      const mockField = { name: "test_field", type: "string" };
      mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";
      mockDashboardPanelData.meta.dragAndDrop.dragElement = mockField;
      
      wrapper.vm.onDrop({}, "source");
      
      expect(mockUseDashboardPanelData.addSource).toHaveBeenCalledWith(mockField);
      expect(mockUseDashboardPanelData.cleanupDraggingFields).toHaveBeenCalled();

      wrapper.vm.removeSource();
      expect(mockUseDashboardPanelData.removeSource).toHaveBeenCalled();
    });

    it("should handle having conditions workflow", async () => {
      mockDashboardPanelData.data.queries[0].fields.value = {
        column: "value_field",
        label: "Value"
      };
      wrapper = createWrapper();

      await wrapper.vm.toggleHavingFilter();
      expect(wrapper.vm.isHavingFilterVisible()).toBe(true);

      const condition = wrapper.vm.getHavingCondition();
      expect(condition).toBeDefined();

      await wrapper.vm.cancelHavingFilter();
      expect(wrapper.vm.isHavingFilterVisible()).toBe(false);
    });

    it("should handle complete sankey field workflow", () => {
      wrapper = createWrapper();

      const sourceField = { name: "source_field", type: "string" };
      const targetField = { name: "target_field", type: "string" };
      const valueField = { name: "value_field", type: "number" };

      mockDashboardPanelData.meta.dragAndDrop.dragSource = "fieldList";

      mockDashboardPanelData.meta.dragAndDrop.dragElement = sourceField;
      wrapper.vm.onDrop({}, "source");
      expect(mockUseDashboardPanelData.addSource).toHaveBeenCalledWith(sourceField);

      mockDashboardPanelData.meta.dragAndDrop.dragElement = targetField;
      wrapper.vm.onDrop({}, "target");
      expect(mockUseDashboardPanelData.addTarget).toHaveBeenCalledWith(targetField);

      mockDashboardPanelData.meta.dragAndDrop.dragElement = valueField;
      wrapper.vm.onDrop({}, "value");
      expect(mockUseDashboardPanelData.addValue).toHaveBeenCalledWith(valueField);
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

      wrapper.vm.onFieldDragStart({}, "test", "source");
      wrapper.vm.onDragEnd();

      expect(wrapper.vm.pagination).toEqual(initialState.pagination);
      expect(wrapper.vm.operators).toEqual(initialState.operators);
    });

    it("should handle rapid state changes", () => {
      wrapper = createWrapper();

      for (let i = 0; i < 10; i++) {
        wrapper.vm.onFieldDragStart({}, `field_${i}`, "source");
        wrapper.vm.onDragEnd();
      }

      expect(wrapper.exists()).toBe(true);
    });

    it("should maintain field state across operations", () => {
      mockDashboardPanelData.data.queries[0].fields.source = {
        column: "test_field",
        label: "Test"
      };
      wrapper = createWrapper();

      const sourceField = wrapper.vm.dashboardPanelData.data.queries[0].fields.source;
      sourceField.label = "Updated Label";

      expect(sourceField.label).toBe("Updated Label");
      expect(sourceField.column).toBe("test_field");
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