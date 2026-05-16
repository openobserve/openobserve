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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import PerformanceFieldsDialog from "./PerformanceFieldsDialog.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog } from "quasar";
import { createStore } from "vuex";

installQuasar({ plugins: [Dialog] });

// PerformanceFieldsDialog now wraps content in <ODialog> (migrated from
// <q-dialog>). The dialog exposes:
//   - prop  : open (v-model:open), persistent, size, title,
//             primary-button-label, secondary-button-label
//   - emits : update:open, click:primary, click:secondary
// In tests we stub ODialog with a minimal template that renders the default
// slot inline (no Teleport), exposes the title/labels via data attributes and
// emits click:primary / click:secondary from inline buttons. This keeps the
// tests deterministic and removes the need to query document.body.

const ODialogStub = {
  name: "ODialog",
  template: `
    <div
      v-if="open"
      data-test-stub="o-dialog"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <div data-test="o-dialog-title">{{ title }}</div>
      <div data-test="o-dialog-body"><slot /></div>
      <button
        data-test="o-dialog-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        data-test="o-dialog-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
  props: [
    "open",
    "persistent",
    "size",
    "title",
    "subTitle",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: [
    "update:open",
    "click:primary",
    "click:secondary",
    "click:neutral",
  ],
};

describe("PerformanceFieldsDialog", () => {
  let store: any;
  let wrapper: any;

  const mockFtsFiled = { name: "log_field", type: "Full Text Search" };
  const mockSecondaryField = { name: "user_id", type: "Secondary Index" };

  beforeEach(() => {
    vi.clearAllMocks();

    store = createStore({
      state: {
        theme: "light",
        selectedOrganization: { identifier: "test-org" },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  const mountDialog = (
    missingFields: any[] = [],
    modelValue = true,
    customStore: any = store,
  ) => {
    wrapper = mount(PerformanceFieldsDialog, {
      props: { modelValue, missingFields },
      global: {
        plugins: [customStore],
        stubs: { ODialog: ODialogStub },
      },
    });
    return wrapper;
  };

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      mountDialog([mockFtsFiled]);
      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render the ODialog with title 'Index Fields Detected'", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe("Index Fields Detected");
    });

    it("should pass size='md' to ODialog", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-size"),
      ).toBe("md");
    });

    it("should render Skip as the secondary button label", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.attributes("data-secondary-label")).toBe("Skip");
    });

    it("should render Add Fields as the primary button label", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.attributes("data-primary-label")).toBe("Add Fields");
    });

    it("should not render the dialog body when modelValue is false", async () => {
      mountDialog([mockFtsFiled], false);
      await flushPromises();
      expect(wrapper.find('[data-test-stub="o-dialog"]').exists()).toBe(false);
    });
  });

  describe("FTS Fields Section", () => {
    it("should show FTS section when FTS fields are present", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts.length).toBeGreaterThan(0);
      expect(wrapper.text()).toContain("Full Text Search (1)");
    });

    it("should show correct FTS field count", async () => {
      mountDialog([
        { name: "field1", type: "Full Text Search" },
        { name: "field2", type: "Full Text Search" },
      ]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts.length).toBe(2);
      expect(wrapper.text()).toContain("Full Text Search (2)");
    });

    it("should display FTS field chip with the field name", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts[0].name).toBe("log_field");
      expect(wrapper.text()).toContain("log_field");
    });

    it("should not show FTS section when no FTS fields", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts.length).toBe(0);
      expect(wrapper.text()).not.toContain("Full Text Search (");
    });
  });

  describe("Secondary Index Fields Section", () => {
    it("should show secondary index section when secondary index fields are present", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex.length).toBeGreaterThan(0);
      expect(wrapper.text()).toContain("Secondary Index (1)");
    });

    it("should show correct secondary index field count", async () => {
      mountDialog([
        { name: "idx1", type: "Secondary Index" },
        { name: "idx2", type: "Secondary Index" },
        { name: "idx3", type: "Secondary Index" },
      ]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex.length).toBe(3);
      expect(wrapper.text()).toContain("Secondary Index (3)");
    });

    it("should display secondary index field chip with the field name", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex[0].name).toBe("user_id");
      expect(wrapper.text()).toContain("user_id");
    });

    it("should not show secondary index section when no secondary index fields", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex.length).toBe(0);
      expect(wrapper.text()).not.toContain("Secondary Index (");
    });
  });

  describe("fieldsByType computed", () => {
    it("should group fields correctly by type", async () => {
      mountDialog([mockFtsFiled, mockSecondaryField]);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts).toHaveLength(1);
      expect(vm.fieldsByType.fts[0].name).toBe("log_field");
      expect(vm.fieldsByType.secondaryIndex).toHaveLength(1);
      expect(vm.fieldsByType.secondaryIndex[0].name).toBe("user_id");
    });

    it("should return empty fts array when no fts fields", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts).toHaveLength(0);
    });

    it("should return empty secondaryIndex array when no secondary index fields", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex).toHaveLength(0);
    });

    it("should handle empty missingFields", async () => {
      mountDialog([]);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts).toHaveLength(0);
      expect(vm.fieldsByType.secondaryIndex).toHaveLength(0);
    });

    it("should handle mixed fields", async () => {
      mountDialog([
        { name: "f1", type: "Full Text Search" },
        { name: "f2", type: "Secondary Index" },
        { name: "f3", type: "Full Text Search" },
      ]);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts).toHaveLength(2);
      expect(vm.fieldsByType.secondaryIndex).toHaveLength(1);
    });
  });

  describe("Emits", () => {
    it("should emit skip when ODialog emits click:secondary", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      await wrapper
        .find('[data-test="o-dialog-secondary"]')
        .trigger("click");

      expect(wrapper.emitted("skip")).toBeTruthy();
      expect(wrapper.emitted("skip")!.length).toBe(1);
    });

    it("should emit add-fields when ODialog emits click:primary", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      await wrapper
        .find('[data-test="o-dialog-primary"]')
        .trigger("click");

      expect(wrapper.emitted("add-fields")).toBeTruthy();
      expect(wrapper.emitted("add-fields")!.length).toBe(1);
    });

    it("should emit update:modelValue when ODialog emits update:open", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      await wrapper
        .find('[data-test="o-dialog-close"]')
        .trigger("click");

      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("should not emit skip or add-fields before user interaction", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      expect(wrapper.emitted("skip")).toBeFalsy();
      expect(wrapper.emitted("add-fields")).toBeFalsy();
    });
  });

  describe("Theme Styling", () => {
    it("should render correctly in light theme", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      // light theme adds the light scroll-area class
      expect(wrapper.html()).toContain("bordered-scroll-area-light");
      expect(wrapper.html()).not.toContain("bordered-scroll-area-dark");
    });

    it("should render correctly in dark theme", async () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
          selectedOrganization: { identifier: "test-org" },
        },
      });

      mountDialog([mockFtsFiled], true, darkStore);
      await flushPromises();
      expect(wrapper.html()).toContain("bordered-scroll-area-dark");
      expect(wrapper.html()).not.toContain("bordered-scroll-area-light");
    });
  });
});
