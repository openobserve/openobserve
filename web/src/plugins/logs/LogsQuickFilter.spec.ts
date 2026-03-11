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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import LogsQuickFilter, {
  DEFAULT_QUICK_FILTER_OPTIONS,
  type QuickFilterOption,
} from "./LogsQuickFilter.vue";

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

const stubQuasarComponents = {
  "q-btn-group": { name: "QBtnGroup", template: "<div><slot /></div>" },
  "q-btn": {
    name: "QBtn",
    template: `<button :data-test="$attrs['data-test']" :class="$attrs['class']" @click="$emit('click')"><slot /></button>`,
    emits: ["click"],
  },
};

describe("LogsQuickFilter.vue", () => {
  let wrapper: VueWrapper<any>;

  const mountComponent = (props: Record<string, any> = {}) => {
    return mount(LogsQuickFilter, {
      props: {
        modelValue: "",
        ...props,
      },
      global: {
        stubs: stubQuasarComponents,
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("Initialization", () => {
    it("should mount successfully", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the root element with correct data-test attribute", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="logs-quick-filter"]').exists()).toBe(
        true,
      );
    });

    it("should render all default filter options as buttons", () => {
      wrapper = mountComponent();
      const buttons = wrapper.findAll("button");
      expect(buttons).toHaveLength(DEFAULT_QUICK_FILTER_OPTIONS.length);
    });

    it("should render custom options when provided", () => {
      const customOptions: QuickFilterOption[] = [
        { label: "30s", value: "30s", seconds: 30 },
        { label: "2m", value: "2m", seconds: 120 },
      ];
      wrapper = mountComponent({ options: customOptions });
      const buttons = wrapper.findAll("button");
      expect(buttons).toHaveLength(2);
    });
  });

  describe("DEFAULT_QUICK_FILTER_OPTIONS", () => {
    it("should export the correct default options", () => {
      expect(DEFAULT_QUICK_FILTER_OPTIONS).toHaveLength(5);
      expect(DEFAULT_QUICK_FILTER_OPTIONS[0]).toEqual({
        label: "5m",
        value: "5m",
        seconds: 300,
      });
      expect(DEFAULT_QUICK_FILTER_OPTIONS[4]).toEqual({
        label: "24h",
        value: "24h",
        seconds: 86400,
      });
    });
  });

  describe("modelValue / selected state", () => {
    it("should not show selected label when modelValue is empty", () => {
      wrapper = mountComponent({ modelValue: "" });
      expect(
        wrapper.find('[data-test="quick-filter-selected-label"]').exists(),
      ).toBe(false);
    });

    it("should show selected label when a valid modelValue is set", () => {
      wrapper = mountComponent({ modelValue: "1h" });
      const label = wrapper.find('[data-test="quick-filter-selected-label"]');
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("1h");
    });

    it("should not show selected label when modelValue does not match any option", () => {
      wrapper = mountComponent({ modelValue: "unknown" });
      expect(
        wrapper.find('[data-test="quick-filter-selected-label"]').exists(),
      ).toBe(false);
    });
  });

  describe("selectFilter — emits", () => {
    it("should emit update:modelValue with the selected value on button click", async () => {
      wrapper = mountComponent({ modelValue: "" });
      const btn = wrapper.find('[data-test="quick-filter-5m"]');
      await btn.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual(["5m"]);
    });

    it("should emit filter-selected with the full option object on button click", async () => {
      wrapper = mountComponent({ modelValue: "" });
      const btn = wrapper.find('[data-test="quick-filter-1h"]');
      await btn.trigger("click");
      expect(wrapper.emitted("filter-selected")).toBeTruthy();
      expect(wrapper.emitted("filter-selected")![0]).toEqual([
        { label: "1h", value: "1h", seconds: 3600 },
      ]);
    });

    it("should emit both events when a filter button is clicked", async () => {
      wrapper = mountComponent({ modelValue: "" });
      const btn = wrapper.find('[data-test="quick-filter-6h"]');
      await btn.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("filter-selected")).toBeTruthy();
    });

    it("should not emit filter-selected when clicking an option not in the list", async () => {
      const customOptions: QuickFilterOption[] = [
        { label: "5m", value: "5m", seconds: 300 },
      ];
      wrapper = mountComponent({ options: customOptions, modelValue: "" });
      // Manually call selectFilter with a value not in options
      (wrapper.vm as any).selectFilter("nonexistent");
      expect(wrapper.emitted("filter-selected")).toBeFalsy();
    });
  });

  describe("clearFilter", () => {
    it("should emit update:modelValue with empty string when clearFilter is called", () => {
      wrapper = mountComponent({ modelValue: "1h" });
      (wrapper.vm as any).clearFilter();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([""]);
    });
  });

  describe("isActive", () => {
    it("should return true when value matches modelValue", () => {
      wrapper = mountComponent({ modelValue: "5m" });
      expect((wrapper.vm as any).isActive("5m")).toBe(true);
    });

    it("should return false when value does not match modelValue", () => {
      wrapper = mountComponent({ modelValue: "5m" });
      expect((wrapper.vm as any).isActive("1h")).toBe(false);
    });

    it("should return false when modelValue is empty", () => {
      wrapper = mountComponent({ modelValue: "" });
      expect((wrapper.vm as any).isActive("5m")).toBe(false);
    });
  });

  describe("button data-test attributes", () => {
    it("each button should have a data-test attribute matching its value", () => {
      wrapper = mountComponent();
      DEFAULT_QUICK_FILTER_OPTIONS.forEach((opt) => {
        expect(
          wrapper.find(`[data-test="quick-filter-${opt.value}"]`).exists(),
        ).toBe(true);
      });
    });
  });
});
