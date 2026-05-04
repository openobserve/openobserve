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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createI18n } from "vue-i18n";
import FilterCreatorPopup from "./FilterCreatorPopup.vue";

installQuasar();

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      filter: { operator: "Operator" },
      common: { cancel: "Cancel", apply: "Apply" },
    },
  },
});

const globalStubs = {
  ODialog: { template: '<div class="o-dialog"><slot name="header" /><slot /><slot name="footer" /></div>', props: ["open", "size"] },
  OButton: {
    template: '<button class="o-btn" @click="$emit(\'click\')"><slot /></button>',
    props: ["variant", "size"],
    emits: ["click"],
  },
  "q-card": { template: '<div class="q-card"><slot /></div>' },
  "q-card-section": { template: '<div class="q-card-section"><slot /></div>' },
  "q-card-actions": {
    template: '<div class="q-card-actions"><slot /></div>',
    props: ["align"],
  },
  "q-select": {
    template:
      '<select class="q-select"><option v-for="o in options" :key="o.value||o" :value="o.value||o">{{ o.label||o }}</option></select>',
    props: [
      "modelValue",
      "options",
      "label",
      "rules",
      "popupContentStyle",
      "color",
      "bgColor",
      "stackLabel",
      "outlined",
      "filled",
      "dense",
    ],
  },
  "q-list": { template: "<div><slot /></div>", props: ["dense"] },
  "q-item": { template: "<div><slot /></div>", props: ["tag"] },
  "q-item-section": { template: "<div><slot /></div>", props: ["avatar"] },
  "q-item-label": {
    template: "<span class='q-item-label'><slot /></span>",
    props: ["class"],
  },
  "q-checkbox": {
    template:
      '<input type="checkbox" class="q-checkbox" :value="val" :checked="modelValue && modelValue.includes(val)" />',
    props: ["modelValue", "val", "size", "dense"],
    emits: ["update:modelValue"],
  },
  "q-btn": {
    template:
      '<button class="q-btn" :class="closePop ? \'close-btn\' : \'\'" @click="$emit(\'click\')">{{ label }}</button>',
    props: ["label", "color", "flat", "noCaps", "class"],
    attrs: { "v-close-popup": "" },
    emits: ["click"],
  },
  OButton: {
    template:
      '<button class="q-btn" @click="$emit(\'click\')"><slot></slot></button>',
    props: ["variant", "size"],
    emits: ["click"],
  },
};

function mountComponent(props: Record<string, any> = {}) {
  return mount(FilterCreatorPopup, {
    global: {
      plugins: [mockI18n],
      stubs: globalStubs,
    },
    props: {
      fieldName: "test_field",
      fieldValues: ["value1", "value2", "value3"],
      operators: [
        { label: "equals", value: "=" },
        { label: "not equals", value: "!=" },
        { label: "contains", value: "LIKE" },
      ],
      defaultOperator: "=",
      defaultValues: ["value1"],
      ...props,
    },
  });
}

describe("FilterCreatorPopup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should render without errors", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the field name as title", () => {
      wrapper = mountComponent({ fieldName: "custom_field" });
      expect(wrapper.text()).toContain("custom_field");
    });

    it("should render q-select for operator", () => {
      wrapper = mountComponent();
      expect(wrapper.find(".q-select").exists()).toBe(true);
    });

    it("should display Values section label", () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain("Values");
    });

    it("should render cancel and apply buttons", () => {
      wrapper = mountComponent();
      const buttons = wrapper.findAll(".o-btn");
      expect(buttons.length).toBe(2);
      expect(buttons[0].text()).toBe("Cancel");
      expect(buttons[1].text()).toBe("Apply");
    });
  });

  describe("props initialization", () => {
    it("should initialize selectedOperator from defaultOperator", () => {
      wrapper = mountComponent({ defaultOperator: "LIKE" });
      expect((wrapper.vm as any).selectedOperator).toBe("LIKE");
    });

    it("should initialize selectedValues from defaultValues", () => {
      wrapper = mountComponent({ defaultValues: ["value2", "value3"] });
      expect((wrapper.vm as any).selectedValues).toEqual(["value2", "value3"]);
    });

    it("should handle undefined defaultOperator", () => {
      wrapper = mountComponent({ defaultOperator: undefined });
      expect((wrapper.vm as any).selectedOperator).toBeUndefined();
    });

    it("should handle undefined defaultValues", () => {
      wrapper = mountComponent({ defaultValues: undefined });
      expect((wrapper.vm as any).selectedValues).toBeUndefined();
    });

    it("should handle null defaultOperator", () => {
      wrapper = mountComponent({ defaultOperator: null });
      expect((wrapper.vm as any).selectedOperator).toBeNull();
    });
  });

  describe("field values display", () => {
    it("should render a checkbox for each fieldValue", () => {
      wrapper = mountComponent({
        fieldValues: ["a", "b", "c"],
        defaultValues: [],
      });
      expect(wrapper.findAll(".q-checkbox")).toHaveLength(3);
    });

    it("should show No values present when fieldValues is empty", () => {
      wrapper = mountComponent({ fieldValues: [] });
      expect(wrapper.text()).toContain("No values present");
    });

    it("should show No values present when fieldValues is null", () => {
      wrapper = mountComponent({ fieldValues: null });
      expect(wrapper.text()).toContain("No values present");
    });

    it("should display each value as a label", () => {
      wrapper = mountComponent({
        fieldValues: ["option1", "option2"],
        defaultValues: [],
      });
      expect(wrapper.text()).toContain("option1");
      expect(wrapper.text()).toContain("option2");
    });

    it("should handle 100 values without error", () => {
      const longValues = Array.from(
        { length: 100 },
        (_, i) => `value_${i}`,
      );
      wrapper = mountComponent({ fieldValues: longValues, defaultValues: [] });
      expect(wrapper.findAll(".q-checkbox")).toHaveLength(100);
    });

    it("should handle special characters in field values", () => {
      const special = ["val@#$", "val with spaces", "val/slashes"];
      wrapper = mountComponent({ fieldValues: special, defaultValues: [] });
      special.forEach((v) => expect(wrapper.text()).toContain(v));
    });
  });

  describe("applyFilter method", () => {
    it("should emit apply with correct payload", () => {
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.selectedOperator = "LIKE";
      vm.selectedValues = ["value1", "value2"];

      vm.applyFilter();

      expect(wrapper.emitted("apply")).toBeTruthy();
      expect(wrapper.emitted("apply")![0]).toEqual([
        {
          fieldName: "test_field",
          selectedValues: ["value1", "value2"],
          selectedOperator: "LIKE",
        },
      ]);
    });

    it("should include fieldName from props in emitted event", () => {
      wrapper = mountComponent({ fieldName: "my_custom_field" });
      (wrapper.vm as any).applyFilter();
      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(emitted.fieldName).toBe("my_custom_field");
    });

    it("should emit apply with empty selectedValues", () => {
      wrapper = mountComponent({ defaultValues: [] });
      (wrapper.vm as any).applyFilter();
      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(emitted.selectedValues).toEqual([]);
    });

    it("should emit apply when Apply button is clicked", async () => {
      wrapper = mountComponent();
      const applyBtn = wrapper.findAll(".o-btn")[1];
      await applyBtn.trigger("click");
      expect(wrapper.emitted("apply")).toBeTruthy();
    });

    it("emitted filter object has correct shape", () => {
      wrapper = mountComponent();
      (wrapper.vm as any).applyFilter();
      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(typeof emitted.fieldName).toBe("string");
      expect(Array.isArray(emitted.selectedValues)).toBe(true);
    });
  });

  describe("selectedValues reactivity", () => {
    it("should update selectedValues when mutated", async () => {
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.selectedValues = ["value2", "value3"];
      await wrapper.vm.$nextTick();
      expect(vm.selectedValues).toEqual(["value2", "value3"]);
    });

    it("should handle empty selectedValues", async () => {
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.selectedValues = [];
      await wrapper.vm.$nextTick();
      expect(vm.selectedValues).toEqual([]);
    });
  });

  describe("selectedOperator reactivity", () => {
    it("should update selectedOperator when mutated", async () => {
      wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.selectedOperator = "!=";
      await wrapper.vm.$nextTick();
      expect(vm.selectedOperator).toBe("!=");
    });
  });

  describe("component structure", () => {
    it("should have an ODialog as root", () => {
      wrapper = mountComponent();
      expect(wrapper.find(".o-dialog").exists()).toBe(true);
    });

    it("should have at least 2 q-card-section elements", () => {
      wrapper = mountComponent();
      expect(wrapper.findAll(".q-card-section").length).toBeGreaterThanOrEqual(
        2,
      );
    });

    it("should handle empty operators array without error", () => {
      wrapper = mountComponent({ operators: [] });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
