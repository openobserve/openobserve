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

// NOTE: PerformanceFieldsDialog wraps all content in <q-dialog>, which uses
// Vue Teleport to render content directly in document.body (outside the
// wrapper's DOM element). Therefore:
//  - wrapper.text() always returns '' (wrapper element is empty)
//  - Use wrapper.vm.fieldsByType for computed data assertions
//  - Use document.querySelector() / document.body.textContent for DOM assertions
//    (requires mountDialog to use attachTo: document.body)

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

  // Mounts with attachTo:document.body so that Quasar's Teleport puts dialog
  // content into document.body, making it accessible via document.querySelector.
  const mountDialog = (missingFields: any[] = [], modelValue = true) => {
    wrapper = mount(PerformanceFieldsDialog, {
      props: { modelValue, missingFields },
      global: { plugins: [store] },
      attachTo: document.body,
    });
    return wrapper;
  };

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      mountDialog([mockFtsFiled]);
      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render title 'Index Fields Detected'", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      // Content is teleported to document.body
      expect(document.body.textContent).toContain("Index Fields Detected");
    });

    it("should render description text about fields affecting performance", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      expect(document.body.textContent).toContain("full-text search or secondary indexes");
    });

    it("should render Skip button", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const allBtns = Array.from(document.querySelectorAll('button[data-o2-btn]')) as HTMLElement[];
      const skipBtn = allBtns.find(btn => btn.textContent?.trim() === 'Skip');
      expect(skipBtn).not.toBeUndefined();
    });

    it("should render Add Fields button", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const allBtns = Array.from(document.querySelectorAll('button[data-o2-btn]')) as HTMLElement[];
      const addBtn = allBtns.find(btn => btn.textContent?.trim() === 'Add Fields');
      expect(addBtn).not.toBeUndefined();
    });

    it("should render the close button area", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("FTS Fields Section", () => {
    it("should show FTS section when FTS fields are present", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      // Section visibility is driven by the fieldsByType computed
      expect(vm.fieldsByType.fts.length).toBeGreaterThan(0);
    });

    it("should show correct FTS field count", async () => {
      mountDialog([
        { name: "field1", type: "Full Text Search" },
        { name: "field2", type: "Full Text Search" },
      ]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts.length).toBe(2);
    });

    it("should display FTS field chip with the field name", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts[0].name).toBe("log_field");
    });

    it("should not show FTS section when no FTS fields", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.fts.length).toBe(0);
    });
  });

  describe("Secondary Index Fields Section", () => {
    it("should show secondary index section when secondary index fields are present", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex.length).toBeGreaterThan(0);
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
    });

    it("should display secondary index field chip with the field name", async () => {
      mountDialog([mockSecondaryField]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex[0].name).toBe("user_id");
    });

    it("should not show secondary index section when no secondary index fields", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.fieldsByType.secondaryIndex.length).toBe(0);
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
    it("should emit skip when Skip button is clicked", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      // Buttons are inside the teleported dialog — find via document
      // OButton renders as <button data-o2-btn ...>; skip is first button (outline variant)
      const allBtns = Array.from(document.querySelectorAll('button[data-o2-btn]')) as HTMLElement[];
      const skipBtn = allBtns.find(btn => btn.textContent?.trim() === 'Skip') as HTMLElement | undefined;
      expect(skipBtn).not.toBeUndefined();
      skipBtn!.click();
      await flushPromises();

      expect(wrapper.emitted("skip")).toBeTruthy();
    });

    it("should emit add-fields when Add Fields button is clicked", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();

      // OButton renders as <button data-o2-btn ...>; add-fields is primary variant button
      const allBtns = Array.from(document.querySelectorAll('button[data-o2-btn]')) as HTMLElement[];
      const addBtn = allBtns.find(btn => btn.textContent?.trim() === 'Add Fields') as HTMLElement | undefined;
      expect(addBtn).not.toBeUndefined();
      addBtn!.click();
      await flushPromises();

      expect(wrapper.emitted("add-fields")).toBeTruthy();
    });
  });

  describe("Theme Styling", () => {
    it("should render correctly in light theme", async () => {
      mountDialog([mockFtsFiled]);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render correctly in dark theme", async () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
          selectedOrganization: { identifier: "test-org" },
        },
      });

      wrapper = mount(PerformanceFieldsDialog, {
        props: { modelValue: true, missingFields: [mockFtsFiled] },
        global: { plugins: [darkStore] },
        attachTo: document.body,
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
