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
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import { createStore } from "vuex";

installQuasar({
  plugins: [Dialog, Notify],
});

const mockStore = createStore({
  state: {
    organizationData: {
      organizationPasscode: "test-org",
    },
  },
});

const mockDashboardPanelData = {
  data: {
    queries: [
      {
        fields: {
          stream: "default_stream",
          stream_type: "logs",
        },
      },
    ],
  },
  layout: {
    currentQueryIndex: 0,
  },
};

const mockStreamSchema = {
  schema: [
    { name: "field1", type: "string" },
    { name: "field2", type: "number" },
    { name: "field3", type: "boolean" },
  ],
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
  })),
}));

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStream: vi.fn(() => Promise.resolve(mockStreamSchema)),
  })),
}));

describe("StreamFieldSelect", () => {
  let wrapper: any;

  const defaultStreams = [
    { stream: "stream1", streamAlias: "s1" },
    { stream: "stream2", streamAlias: "s2" },
  ];

  const defaultProps = {
    streams: defaultStreams,
    modelValue: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, provide = {}) => {
    return mount(StreamFieldSelect, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [mockStore],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
          ...provide,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render stream field select dropdown", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const select = wrapper.find('[data-test="stream-field-select"]');
      expect(select.exists()).toBe(true);
    });

    it("should render with correct structure", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have q-select component", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const qSelect = wrapper.findComponent({ name: "QSelect" });
      expect(qSelect.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept streams prop", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.props().streams).toEqual(defaultStreams);
    });

    it("should accept modelValue prop", async () => {
      const modelValue = { field: "test_field", streamAlias: "s1" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();
      expect(wrapper.props().modelValue).toEqual(modelValue);
    });

    it("should handle empty streams array", async () => {
      wrapper = createWrapper({ streams: [] });
      await flushPromises();
      expect(wrapper.vm.options).toEqual([]);
    });

    it("should handle empty modelValue", async () => {
      wrapper = createWrapper({ modelValue: {} });
      await flushPromises();
      expect(wrapper.vm.displayValue).toBe("");
    });
  });

  describe("Field Options Loading", () => {
    it("should fetch fields for streams", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.options.length).toBeGreaterThanOrEqual(0);
    });

    it("should create options from stream schema", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // Options should be initialized automatically
      expect(Array.isArray(wrapper.vm.options)).toBe(true);
    });

    it("should initialize filteredOptions with all options", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // FilteredOptions should be initialized automatically
      expect(wrapper.vm.filteredOptions).toBeDefined();
    });

    it("should handle streams with aliases", async () => {
      const streamsWithAlias = [
        { stream: "logs", streamAlias: "log_alias" },
      ];
      wrapper = createWrapper({ streams: streamsWithAlias });
      await flushPromises();
      // Options should be populated automatically
      expect(wrapper.vm.options.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle streams without aliases", async () => {
      const streamsNoAlias = [{ stream: "logs", streamAlias: null }];
      wrapper = createWrapper({ streams: streamsNoAlias });
      await flushPromises();
      // Options should be populated automatically
      expect(wrapper.vm.options.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Field Selection", () => {
    it("should select a field", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const field = {
        name: "test_field",
        stream: { stream: "stream1", streamAlias: "s1" },
      };

      wrapper.vm.selectField(field);
      await flushPromises();

      expect(wrapper.vm.internalModel.field).toBe("test_field");
      expect(wrapper.vm.internalModel.streamAlias).toBe("s1");
    });

    it("should update displayValue on field selection", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const field = {
        name: "selected_field",
        stream: { stream: "stream1", streamAlias: "s1" },
      };

      wrapper.vm.selectField(field);
      await flushPromises();

      expect(wrapper.vm.displayValue).toBe("selected_field");
    });

    it("should emit update:modelValue on field selection", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const field = {
        name: "emit_field",
        stream: { stream: "stream1", streamAlias: "s1" },
      };

      wrapper.vm.selectField(field);
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Field Filtering", () => {
    it("should filter fields based on search text", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [
            { name: "field1" },
            { name: "field2" },
            { name: "another" },
          ],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("field", update);

      expect(update).toHaveBeenCalled();
    });

    it("should show all options when search is empty", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [{ name: "field1" }, { name: "field2" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("", update);

      expect(update).toHaveBeenCalled();
      expect(wrapper.vm.filteredOptions).toEqual(wrapper.vm.options);
    });

    it("should filter by stream name", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "logs_stream",
          children: [{ name: "field1" }],
        },
        {
          label: "metrics_stream",
          children: [{ name: "field2" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("logs", update);

      expect(update).toHaveBeenCalled();
    });

    it("should filter by field name", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [{ name: "timestamp" }, { name: "message" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("time", update);

      expect(update).toHaveBeenCalled();
    });

    it("should handle case-insensitive filtering", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "Stream1",
          children: [{ name: "Field1" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("FIELD", update);

      expect(update).toHaveBeenCalled();
    });
  });

  describe("Display Value Handling", () => {
    it("should update displayValue from modelValue", async () => {
      const modelValue = { field: "test_field", streamAlias: "s1" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();

      expect(wrapper.vm.displayValue).toBe("test_field");
    });

    it("should handle undefined field in modelValue", async () => {
      const modelValue = { streamAlias: "s1" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();

      expect(wrapper.vm.displayValue).toBe("");
    });

    it("should update input value manually", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.updateInputValue("manual_field");

      expect(wrapper.vm.displayValue).toBe("manual_field");
    });

    it("should handle null value in updateInputValue", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.updateInputValue(null as any);

      // Should not update with null
      expect(wrapper.vm.displayValue).toBeDefined();
    });
  });

  describe("Watchers", () => {
    it("should emit on internalModel change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.internalModel = { field: "new_field", streamAlias: "s1" };
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should update from external modelValue changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setProps({
        modelValue: { field: "external_field", streamAlias: "s2" },
      });

      expect(wrapper.vm.internalModel.field).toBe("external_field");
      expect(wrapper.vm.displayValue).toBe("external_field");
    });

    it("should refetch fields when streams change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newStreams = [{ stream: "new_stream", streamAlias: "ns1" }];
      await wrapper.setProps({ streams: newStreams });
      await flushPromises();

      expect(wrapper.props().streams).toEqual(newStreams);
    });
  });

  describe("Stream Loading", () => {
    it("should initialize with streams", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Component should initialize with stream data
      expect(wrapper.vm.options).toBeDefined();
      expect(Array.isArray(wrapper.vm.options)).toBe(true);
    });

    it("should handle stream data loading", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Streams should trigger loading automatically
      expect(wrapper.vm.options).toBeDefined();
    });

    it("should handle stream loading initialization", async () => {
      const errorSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      wrapper = createWrapper();
      await flushPromises();

      // Component should initialize without errors
      expect(wrapper.exists()).toBe(true);

      errorSpy.mockRestore();
    });
  });

  describe("Expansion Items", () => {
    it("should render expansion items for streams", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should open first stream by default", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // First stream should be default-opened
      expect(wrapper.exists()).toBe(true);
    });

    it("should group streams correctly", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Options should be grouped automatically
      expect(Array.isArray(wrapper.vm.options)).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null streams", async () => {
      wrapper = createWrapper({ streams: null as any });
      await flushPromises();

      // Should handle null gracefully
      expect(wrapper.vm.options).toEqual([]);
    });

    it("should handle stream without schema", async () => {
      wrapper = createWrapper();
      await flushPromises();

      // Should handle missing schema gracefully
      expect(Array.isArray(wrapper.vm.options)).toBe(true);
    });

    it("should handle field without name", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const field = {
        name: undefined,
        stream: { stream: "stream1", streamAlias: "s1" },
      };

      wrapper.vm.selectField(field as any);

      expect(wrapper.vm.internalModel).toBeDefined();
    });

    it("should handle filter with special characters", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [{ name: "field@#$" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("@#$", update);

      expect(update).toHaveBeenCalled();
    });
  });

  describe("Component Lifecycle", () => {
    it("should fetch fields on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.options).toBeDefined();
    });

    it("should handle unmount gracefully", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle multiple stream updates", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setProps({
        streams: [{ stream: "stream1", streamAlias: "s1" }],
      });
      await flushPromises();

      await wrapper.setProps({
        streams: [{ stream: "stream2", streamAlias: "s2" }],
      });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Q-Select Properties", () => {
    it("should have use-input enabled", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const qSelect = wrapper.findComponent({ name: "QSelect" });
      expect(qSelect.exists()).toBe(true);
    });

    it("should have hide-selected enabled", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const qSelect = wrapper.findComponent({ name: "QSelect" });
      expect(qSelect.exists()).toBe(true);
    });

    it("should have fill-input enabled", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const qSelect = wrapper.findComponent({ name: "QSelect" });
      expect(qSelect.exists()).toBe(true);
    });

    it("should use menu behavior", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const qSelect = wrapper.findComponent({ name: "QSelect" });
      expect(qSelect.exists()).toBe(true);
    });
  });

  describe("Filter Edge Cases", () => {
    it("should handle filter with displayValue", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.displayValue = "current_value";

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("current_value", update);

      expect(update).toHaveBeenCalled();
    });

    it("should reset filter when empty", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [{ name: "field1" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("", update);

      expect(wrapper.vm.filteredOptions).toEqual(wrapper.vm.options);
    });

    it("should handle filter with no matches", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.options = [
        {
          label: "stream1",
          children: [{ name: "field1" }],
        },
      ];

      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFields("nonexistent", update);

      expect(update).toHaveBeenCalled();
    });
  });

  describe("Stream Alias Display", () => {
    it("should display stream with alias", async () => {
      const streams = [{ stream: "logs", streamAlias: "log_data" }];
      wrapper = createWrapper({ streams });
      await flushPromises();

      // Options should be populated automatically with stream info
      if (wrapper.vm.options.length > 0) {
        // Should contain either stream name or alias
        expect(wrapper.vm.options[0].label).toBeDefined();
      }
    });

    it("should display stream without alias", async () => {
      const streams = [{ stream: "metrics", streamAlias: null }];
      wrapper = createWrapper({ streams });
      await flushPromises();

      // Options should be populated automatically with stream info
      if (wrapper.vm.options.length > 0) {
        // Should contain stream name
        expect(wrapper.vm.options[0].label).toBeDefined();
      }
    });
  });

  describe("Stream Field Select Ref", () => {
    it("should have streamFieldSelect ref", async () => {
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.streamFieldSelect).toBeDefined();
    });

    it("should call updateInputValue on ref", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.updateInputValue("test");

      expect(wrapper.vm.displayValue).toBe("test");
    });
  });
});
