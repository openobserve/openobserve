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
            template:
              '<select :data-test="$attrs[\'data-test\']"><slot /></select>',
            props: ["modelValue", "options"],
            emits: ["update:modelValue"],
          },
          ColumnFormatControls: { template: "<div data-test-stub='cfc' />" },
          TableRenderer: { template: "<div data-test-stub='table-renderer' />" },
          OIcon: { template: '<span class="OIcon">{{ $attrs.name }}</span>' },
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

    it("starts with a single blank row when there is no config", async () => {
      wrapper = await createWrapper({ overrideConfig: { overrideConfigs: [] } });
      expect(wrapper.vm.columnOverrides).toHaveLength(1);
      expect(wrapper.vm.columnOverrides[0].field).toBe("");
    });

    it("expands the first row by default", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.isExpanded(0)).toBe(true);
    });
  });

  describe("Column management", () => {
    it("adds a new column row and expands it", async () => {
      wrapper = await createWrapper();
      const before = wrapper.vm.columnOverrides.length;
      wrapper.vm.addColumn();
      expect(wrapper.vm.columnOverrides).toHaveLength(before + 1);
      expect(wrapper.vm.isExpanded(before)).toBe(true);
    });

    it("removes a column row", async () => {
      wrapper = await createWrapper();
      wrapper.vm.addColumn();
      const before = wrapper.vm.columnOverrides.length;
      wrapper.vm.removeColumn(0);
      expect(wrapper.vm.columnOverrides).toHaveLength(before - 1);
    });

    it("excludes already-used columns from the option list", async () => {
      wrapper = await createWrapper();
      // field1 is used by row 0, so it must not be offered to a second row.
      wrapper.vm.addColumn();
      const opts = wrapper.vm.columnOptionsFor(1).map((o: any) => o.value);
      expect(opts).not.toContain("field1");
      expect(opts).toContain("field2");
    });

    it("offers all columns to the row that currently uses one", async () => {
      wrapper = await createWrapper();
      const opts = wrapper.vm.columnOptionsFor(0).map((o: any) => o.value);
      expect(opts).toContain("field1");
    });

    it("toggles row expansion", async () => {
      wrapper = await createWrapper();
      wrapper.vm.toggle(0);
      expect(wrapper.vm.isExpanded(0)).toBe(false);
      wrapper.vm.toggle(0);
      expect(wrapper.vm.isExpanded(0)).toBe(true);
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

    it("detects numeric columns from the columns prop", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.isNumericColumn("field1")).toBe(true);
      expect(wrapper.vm.isNumericColumn("field2")).toBe(false);
      expect(wrapper.vm.isNumericColumn("")).toBe(false);
    });
  });

  describe("Summary chips", () => {
    it("builds chips from unit / alignment overrides", async () => {
      wrapper = await createWrapper();
      const chips = wrapper.vm
        .summaryChips(wrapper.vm.columnOverrides[0])
        .map((c: any) => c.text);
      // bytes unit + center alignment, both resolved via shared option labels.
      expect(chips.some((t: string) => /bytes/i.test(t))).toBe(true);
      expect(chips.length).toBeGreaterThanOrEqual(2);
    });

    it("uses the custom unit text for custom units", async () => {
      wrapper = await createWrapper();
      const col = { ...wrapper.vm.columnOverrides[0], unit: "custom", customUnit: "req/s", alignment: "", conditions: [] };
      const chips = wrapper.vm.summaryChips(col).map((c: any) => c.text);
      expect(chips).toContain("req/s");
    });
  });

  describe("Preview gating", () => {
    it("hides the preview pane when no previewData is supplied", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.hasPreviewData).toBe(false);
    });

    it("shows the preview pane when previewData is supplied", async () => {
      wrapper = await createWrapper({
        previewData: { field1: { column: { field: "field1" }, rows: [{ field1: 5 }] } },
      });
      expect(wrapper.vm.hasPreviewData).toBe(true);
      expect(Array.isArray(wrapper.vm.previews)).toBe(true);
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

    it("emits close on cancel", async () => {
      wrapper = await createWrapper();
      wrapper.vm.closePopup();
      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });
});
