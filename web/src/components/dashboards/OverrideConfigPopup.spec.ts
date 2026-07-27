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
import OverrideConfigPopup from "@/components/dashboards/OverrideConfigPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "width",
    "title",
    "subTitle",
    "neutralButtonLabel",
    "neutralButtonVariant",
    "primaryButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title">
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading"],
  emits: ["click"],
  inheritAttrs: false,
  template: `<button
    data-test-stub="o-button"
    :data-test="$attrs['data-test']"
    :disabled="disabled"
    @click="$emit('click', $event)"
  ><slot name="icon-left" /><slot /></button>`,
};

describe("OverrideConfigPopup", () => {
  let wrapper: any;

  const defaultColumns = [
    { label: "Field 1", alias: "field1", isNumeric: true },
    { label: "Field 2", alias: "field2", isNumeric: false },
    { label: "Timestamp", alias: "timestamp", isNumeric: false },
    { label: "Service Name", alias: "service_name", isNumeric: false },
  ];

  // Persisted override_config shape: one entry with a real column + a couple of
  // config items so loadAllFromRaw produces a populated UI row.
  const populatedOverrideConfig = () => ({
    overrideConfigs: [
      {
        field: { matchBy: "name", value: "field1" },
        config: [
          { type: "unit", value: { unit: "bytes", customUnit: "" } },
          { type: "alignment", value: "center" },
        ],
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = async (props = {}) => {
    const w = mount(OverrideConfigPopup, {
      props: {
        open: true,
        columns: defaultColumns,
        overrideConfig: populatedOverrideConfig(),
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
          OButton: OButtonStub,
          OSelect: {
            template: "<select :data-test=\"$attrs['data-test']\"><slot /></select>",
            props: ["modelValue", "options"],
            emits: ["update:modelValue"],
          },
          ColumnFormatControls: { template: "<div data-test-stub='cfc' />" },
          TableRenderer: { template: "<div data-test-stub='table-renderer' />" },
          OIcon: { template: '<span class="OIcon">{{ $attrs.name }}</span>' },
          ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
          ODropdownItem: {
            template: "<div @click=\"$emit('select')\"><slot /></div>",
            emits: ["select"],
          },
        },
        mocks: { $t: (key: string) => key },
      },
    });
    await flushPromises();
    return w;
  };

  describe("Initialization", () => {
    it("renders with required props", async () => {
      wrapper = await createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$props.columns).toEqual(defaultColumns);
    });

    it("loads the persisted override_config into UI rows", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.columnOverrides).toHaveLength(1);
      const row = wrapper.vm.columnOverrides[0];
      expect(row.field).toBe("field1");
      expect(row.unit).toBe("bytes");
      expect(row.alignment).toBe("center");
    });

    it("starts empty when there is no config", async () => {
      wrapper = await createWrapper({ overrideConfig: { overrideConfigs: [] } });
      expect(wrapper.vm.columnOverrides).toHaveLength(0);
      expect(wrapper.vm.selectedCol).toBeNull();
    });

    it("selects the first field by default", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.selectedIdx).toBe(0);
      expect(wrapper.vm.selectedCol?.field).toBe("field1");
    });
  });

  describe("Column management", () => {
    it("adds a field via addField and selects it", async () => {
      wrapper = await createWrapper();
      const before = wrapper.vm.columnOverrides.length;
      wrapper.vm.addField("field2");
      expect(wrapper.vm.columnOverrides).toHaveLength(before + 1);
      expect(wrapper.vm.selectedIdx).toBe(before);
      expect(wrapper.vm.columnOverrides[before].field).toBe("field2");
    });

    it("defaults a new field's unit to null (Default), not the panel unit", async () => {
      wrapper = await createWrapper({ panelUnit: "bytes", panelUnitCustom: "" });
      wrapper.vm.addField("field2");
      const added = wrapper.vm.columnOverrides.at(-1);
      expect(added.field).toBe("field2");
      expect(added.unit).toBeNull();
    });

    it("removes a column row", async () => {
      wrapper = await createWrapper();
      wrapper.vm.addField("field2");
      const before = wrapper.vm.columnOverrides.length;
      wrapper.vm.removeColumn(0);
      expect(wrapper.vm.columnOverrides).toHaveLength(before - 1);
    });

    it("excludes already-used columns from the add list", async () => {
      wrapper = await createWrapper();
      // field1 is used by the loaded row, so it must not be offered again.
      const opts = wrapper.vm.availableToAdd.map((o: any) => o.value);
      expect(opts).not.toContain("field1");
      expect(opts).toContain("field2");
    });

    it("falls back to the alias for the label when a column has no label", async () => {
      wrapper = await createWrapper({
        columns: [{ label: "", alias: "kubernetes_namespace", isNumeric: false }],
        overrideConfig: { overrideConfigs: [] },
      });
      const opt = wrapper.vm.availableToAdd.find((o: any) => o.value === "kubernetes_namespace");
      expect(opt).toBeTruthy();
      expect(opt.label).toBe("kubernetes_namespace");
    });
  });

  describe("Field helpers", () => {
    it("returns the column label for an alias", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.getFieldLabel("field1")).toBe("Field 1");
    });

    it("falls back to the alias when there is no label", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.getFieldLabel("unknown")).toBe("unknown");
      expect(wrapper.vm.getFieldLabel("")).toBe("");
    });

    it("detects numeric columns from the columns prop (fieldType 'auto')", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.isNumericColumn({ field: "field1", fieldType: "auto" })).toBe(true);
      expect(wrapper.vm.isNumericColumn({ field: "field2", fieldType: "auto" })).toBe(false);
      expect(wrapper.vm.isNumericColumn({ field: "", fieldType: "auto" })).toBe(false);
    });

    it("lets the field-type override win over detection", async () => {
      wrapper = await createWrapper();
      // field2 is detected text → force numeric; field1 is detected numeric → force text
      expect(wrapper.vm.isNumericColumn({ field: "field2", fieldType: "num" })).toBe(true);
      expect(wrapper.vm.isNumericColumn({ field: "field1", fieldType: "text" })).toBe(false);
    });
  });

  describe("Preview", () => {
    it("produces a preview for the selected field even with no previewData", async () => {
      wrapper = await createWrapper();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.selectedPreview).toBeTruthy();
      expect(wrapper.vm.selectedPreview.rows.length).toBeGreaterThan(0);
    });

    it("falls back to type-based dummy rows when a column has no data", async () => {
      wrapper = await createWrapper();
      // The selected numeric column with no previewData → numeric dummy rows.
      wrapper.vm.columnOverrides[0].fieldType = "num";
      await wrapper.vm.$nextTick();
      const preview = wrapper.vm.selectedPreview;
      expect(preview).toBeTruthy();
      expect(preview.rows.length).toBeGreaterThan(0);
      const key = preview.columns[0].field;
      expect(typeof preview.rows[0][key]).toBe("number");
    });

    it("uses text dummy rows when the field type is text", async () => {
      wrapper = await createWrapper();
      wrapper.vm.columnOverrides[0].fieldType = "text";
      await wrapper.vm.$nextTick();
      const preview = wrapper.vm.selectedPreview;
      const key = preview.columns[0].field;
      expect(typeof preview.rows[0][key]).toBe("string");
    });

    it("uses real preview rows when supplied", async () => {
      wrapper = await createWrapper({
        previewData: { field1: { column: { field: "field1" }, rows: [{ field1: 5 }] } },
      });
      await wrapper.vm.$nextTick();
      const preview = wrapper.vm.selectedPreview;
      expect(preview.rows).toEqual([{ field1: 5 }]);
    });
  });

  describe("Save / close", () => {
    it("serializes rows and emits save + close", async () => {
      wrapper = await createWrapper();
      wrapper.vm.saveOverrides();
      const saved = wrapper.emitted("save")?.[0]?.[0];
      expect(Array.isArray(saved)).toBe(true);
      // field1 carries a unit + alignment, so it round-trips to one entry.
      expect(saved[0].field.value).toBe("field1");
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("can save with no fields (clears all overrides)", async () => {
      wrapper = await createWrapper({ overrideConfig: { overrideConfigs: [] } });
      expect(wrapper.vm.columnOverrides).toHaveLength(0);
      wrapper.vm.saveOverrides();
      const saved = wrapper.emitted("save")?.[0]?.[0];
      expect(saved).toEqual([]);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("emits close on cancel", async () => {
      wrapper = await createWrapper();
      wrapper.vm.closePopup();
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });
});
