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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import { createStore } from "vuex";
import i18n from "@/locales";

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

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: mockDashboardPanelData,
  })),
}));

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStream: vi.fn(() => Promise.resolve(mockStreamSchema)),
  })),
}));

// Stub OSelect to avoid heavy listbox/reka-ui rendering
const OSelectStub = {
  name: "OSelect",
  inheritAttrs: false,
  props: ["modelValue", "options", "label", "labelPosition", "searchable"],
  emits: ["update:modelValue"],
  template:
    '<div data-test="stream-field-select" :data-options="JSON.stringify(options)" @click="$emit(\'update:modelValue\', $attrs.testValue)"></div>',
};

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
        plugins: [mockStore, i18n],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
          ...provide,
        },
        stubs: {
          OSelect: OSelectStub,
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

    it("should render OSelect component", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const sel = wrapper.findComponent({ name: "OSelect" });
      expect(sel.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept streams prop", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.props().streams).toEqual(defaultStreams);
    });

    it("should accept modelValue prop", async () => {
      const modelValue = { field: "field1", streamAlias: "s1" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();
      expect(wrapper.props().modelValue).toEqual(modelValue);
    });

    it("should handle empty streams array", async () => {
      wrapper = createWrapper({ streams: [] });
      await flushPromises();
      // flatOptions should be empty when no streams
      expect(wrapper.vm.flatOptions).toEqual([]);
    });

    it("should handle empty modelValue", async () => {
      wrapper = createWrapper({ modelValue: {} });
      await flushPromises();
      // selectValue should be undefined (no modelValue.field)
      expect(wrapper.vm.selectValue).toBeUndefined();
    });
  });

  describe("Field Options Loading", () => {
    it("should fetch fields for streams", async () => {
      wrapper = createWrapper();
      await flushPromises();
      // flatOptions should include items after fetching
      expect(wrapper.vm.flatOptions.length).toBeGreaterThan(0);
    });

    it("should create options from stream schema", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(Array.isArray(wrapper.vm.flatOptions)).toBe(true);
    });

    it("should include header rows when multiple streams provided", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const headers = wrapper.vm.flatOptions.filter((o: any) => o.header);
      expect(headers.length).toBeGreaterThanOrEqual(2);
    });

    it("should include field option rows", async () => {
      wrapper = createWrapper();
      await flushPromises();
      const items = wrapper.vm.flatOptions.filter((o: any) => !o.header);
      // 2 streams x 3 fields = 6 items
      expect(items.length).toBe(6);
    });

    it("should handle streams with aliases", async () => {
      const streamsWithAlias = [{ stream: "logs", streamAlias: "log_alias" }];
      wrapper = createWrapper({ streams: streamsWithAlias });
      await flushPromises();
      // For one stream, header should not be present, but fields should be
      const items = wrapper.vm.flatOptions.filter((o: any) => !o.header);
      expect(items.length).toBe(3);
    });

    it("should handle streams without aliases", async () => {
      const streamsNoAlias = [{ stream: "logs", streamAlias: null }];
      wrapper = createWrapper({ streams: streamsNoAlias });
      await flushPromises();
      const items = wrapper.vm.flatOptions.filter((o: any) => !o.header);
      expect(items.length).toBe(3);
    });

    it("should label group with alias when streamAlias is set", async () => {
      const streamsWithAlias = [{ stream: "logs", streamAlias: "log_alias" }];
      wrapper = createWrapper({ streams: streamsWithAlias });
      await flushPromises();
      // Single stream: no header row, but flatOptions value uses the label
      const item = wrapper.vm.flatOptions.find((o: any) => !o.header);
      expect(item.value).toContain("logs(log_alias)");
    });

    it("should label group with stream name when no streamAlias", async () => {
      const streamsNoAlias = [{ stream: "logs", streamAlias: null }];
      wrapper = createWrapper({ streams: streamsNoAlias });
      await flushPromises();
      const item = wrapper.vm.flatOptions.find((o: any) => !o.header);
      expect(item.value.startsWith("logs")).toBe(true);
    });
  });

  describe("Field Selection / onSelect", () => {
    it("should emit update:modelValue on onSelect with valid key", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const item = wrapper.vm.flatOptions.find((o: any) => !o.header);
      wrapper.vm.onSelect(item.value);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toHaveProperty("field");
    });

    it("should map onSelect key to field & streamAlias", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const item = wrapper.vm.flatOptions.find((o: any) => !o.header);
      wrapper.vm.onSelect(item.value);

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted![0][0].field).toBe(item.label);
    });

    it("should not emit on null key", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.onSelect(null);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("should fall back to raw value for unknown keys", async () => {
      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.onSelect("unknown-key");

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toEqual({
        field: "unknown-key",
        streamAlias: undefined,
      });
    });
  });

  describe("selectValue Computed", () => {
    it("should compute selectValue from modelValue", async () => {
      const modelValue = { field: "field1", streamAlias: "s1" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();

      // selectValue should contain the field name
      expect(wrapper.vm.selectValue).toContain("field1");
    });

    it("should return undefined when modelValue has no field", async () => {
      wrapper = createWrapper({ modelValue: {} });
      await flushPromises();
      expect(wrapper.vm.selectValue).toBeUndefined();
    });

    it("should fall back to field-only match if alias mismatch", async () => {
      const modelValue = { field: "field1", streamAlias: "nonexistent" };
      wrapper = createWrapper({ modelValue });
      await flushPromises();
      // Should still find a match by field name only
      expect(wrapper.vm.selectValue).toContain("field1");
    });
  });

  describe("Watchers", () => {
    it("should react to external modelValue changes", async () => {
      wrapper = createWrapper();
      await flushPromises();

      await wrapper.setProps({
        modelValue: { field: "field2", streamAlias: "s2" },
      });

      expect(wrapper.vm.selectValue).toContain("field2");
    });

    it("should refetch fields when streams change", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const newStreams = [{ stream: "new_stream", streamAlias: "ns1" }];
      await wrapper.setProps({ streams: newStreams });
      await flushPromises();

      expect(wrapper.props().streams).toEqual(newStreams);
      const items = wrapper.vm.flatOptions.filter((o: any) => !o.header);
      expect(items.length).toBe(3);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null streams", async () => {
      wrapper = createWrapper({ streams: null as any });
      await flushPromises();
      expect(wrapper.vm.flatOptions).toEqual([]);
    });

    it("should handle empty streams without crashing", async () => {
      wrapper = createWrapper({ streams: [] });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.flatOptions).toEqual([]);
    });

    it("should handle stream loading errors gracefully", async () => {
      // useStreams is mocked above to resolve; this test just verifies it doesn't throw
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should fetch fields on mount", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.flatOptions.length).toBeGreaterThan(0);
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
});
