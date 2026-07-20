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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import FilterCreatorPopup from "./FilterCreatorPopup.vue";

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      filter: { operator: "Operator" },
      common: { cancel: "Cancel", apply: "Apply" },
    },
  },
});

// Stub ONLY the ODialog overlay (so its body slot renders inline instead of
// teleporting to document.body). The OForm + OForm* fields stay REAL so the
// schema-validation wiring is exercised (playbook §5 / R22).
const globalStubs = {
  ODialog: {
    name: "ODialog",
    template:
      '<div class="o-dialog"><slot name="header" /><slot /><slot name="footer" /></div>',
    props: [
      "open",
      "size",
      "title",
      "formId",
      "secondaryButtonLabel",
      "primaryButtonLabel",
    ],
    emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
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

const getForm = (wrapper: VueWrapper) =>
  (wrapper.findComponent({ name: "OForm" }).vm as any).form;

const submit = async (wrapper: VueWrapper) => {
  await getForm(wrapper).handleSubmit();
  await flushPromises();
};

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
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("title")).toBe("custom_field");
    });

    it("should wire the dialog footer to the form via form-id", () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("formId")).toBe("filter-creator-popup-form");
    });

    it("should render the operator OFormSelect inside the real OForm", () => {
      wrapper = mountComponent();
      expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
      expect(
        wrapper.find('[data-test="filter-creator-popup-operator-select"]').exists(),
      ).toBe(true);
    });

    it("should display Values section label", () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain("Values");
    });

    it("should render cancel and apply buttons", () => {
      wrapper = mountComponent();
      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog.props("primaryButtonLabel")).toBe("Apply");
    });
  });

  describe("field values display", () => {
    it("should render a checkbox row for each fieldValue", () => {
      wrapper = mountComponent({
        fieldValues: ["a", "b", "c"],
        defaultValues: [],
      });
      expect(
        wrapper.findAll('[data-test^="filter-creator-popup-value-"]'),
      ).toHaveLength(3);
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

    it("should handle special characters in field values", () => {
      const special = ["val@#$", "val with spaces", "val/slashes"];
      wrapper = mountComponent({ fieldValues: special, defaultValues: [] });
      special.forEach((v) => expect(wrapper.text()).toContain(v));
    });
  });

  describe("OForm schema validation (real form)", () => {
    it("emits apply with the validated payload on submit", async () => {
      wrapper = mountComponent({
        defaultOperator: "LIKE",
        defaultValues: ["value1", "value2"],
      });

      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(true);
      expect(wrapper.emitted("apply")).toBeTruthy();
      expect(wrapper.emitted("apply")![0]).toEqual([
        {
          fieldName: "test_field",
          selectedValues: ["value1", "value2"],
          selectedOperator: "LIKE",
        },
      ]);
    });

    it("includes fieldName from props in emitted event", async () => {
      wrapper = mountComponent({ fieldName: "my_custom_field" });
      await submit(wrapper);
      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(emitted.fieldName).toBe("my_custom_field");
    });

    it("emits apply with empty selectedValues when none are selected", async () => {
      wrapper = mountComponent({ defaultValues: [] });
      await submit(wrapper);
      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(emitted.selectedValues).toEqual([]);
    });

    // The restored required rule: an empty operator must block submit and the
    // schema (not a disabled button) is what gates it.
    it("blocks submit + does NOT emit apply when operator is empty", async () => {
      wrapper = mountComponent({ defaultOperator: "", defaultValues: [] });

      await submit(wrapper);

      expect(getForm(wrapper).state.isValid).toBe(false);
      expect(wrapper.emitted("apply")).toBeFalsy();
    });

    it("collects a checkbox toggle into the emitted selectedValues", async () => {
      wrapper = mountComponent({
        fieldValues: ["value1", "value2"],
        defaultOperator: "=",
        defaultValues: [],
      });

      // Toggle the first value's checkbox (real OCheckbox inside the group).
      await wrapper
        .find('[data-test="filter-creator-popup-value-value1"] button[role="checkbox"]')
        .trigger("click");

      await submit(wrapper);

      const emitted = wrapper.emitted("apply")![0][0] as any;
      expect(emitted.selectedValues).toEqual(["value1"]);
    });

    it("does NOT close the dialog implicitly on apply (parent owns closing)", async () => {
      wrapper = mountComponent();
      await submit(wrapper);
      expect((wrapper.vm as any).show).toBe(true);
    });
  });

  describe("cancel", () => {
    it("should close dialog when Cancel (secondary) is clicked", async () => {
      wrapper = mountComponent();
      expect((wrapper.vm as any).show).toBe(true);
      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:secondary");
      expect((wrapper.vm as any).show).toBe(false);
      expect(wrapper.emitted("apply")).toBeFalsy();
    });
  });

  describe("component structure", () => {
    it("should have an ODialog as root", () => {
      wrapper = mountComponent();
      expect(wrapper.find(".o-dialog").exists()).toBe(true);
    });

    it("should handle empty operators array without error", () => {
      wrapper = mountComponent({ operators: [] });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
