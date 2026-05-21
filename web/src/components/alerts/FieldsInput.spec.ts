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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import FieldsInput from "@/components/alerts/FieldsInput.vue";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeField = (overrides: Record<string, any> = {}) => ({
  uuid: Math.random().toString(36).slice(2),
  column: "",
  operator: "=",
  value: "",
  ...overrides,
});

const streamFields = [
  { label: "Host", value: "host" },
  { label: "Level", value: "level" },
  { label: "Message", value: "message" },
];

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(FieldsInput, {
    props: {
      fields: [],
      streamFields,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("FieldsInput", () => {
  let wrapper: VueWrapper<any> | null = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  // ── Renders with minimum props ────────────────────────────────────────────

  describe("renders with minimum props", () => {
    it("mounts without error", () => {
      wrapper = buildWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("renders the conditions title text element", () => {
      wrapper = buildWrapper();

      expect(wrapper.find('[data-test="alert-conditions-text"]').exists()).toBe(true);
    });

    it("shows the Add Condition button when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
    });

    it("does not show condition rows when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });
  });

  // ── Empty / null edge cases ───────────────────────────────────────────────

  describe("edge cases — empty fields array", () => {
    it("hides the Add Condition button once a field is added", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
    });
  });

  // ── Rendering with fields ─────────────────────────────────────────────────

  describe("rendering with non-empty fields", () => {
    it("renders one condition row per field", () => {
      wrapper = buildWrapper({ fields: [makeField(), makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
    });

    it("renders a column select for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-select-column"]').exists()).toBe(true);
    });

    it("renders an operator select for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-operator-select"]').exists()).toBe(true);
    });

    it("renders a value input for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-value-input"]').exists()).toBe(true);
    });

    it("renders a delete button for each field", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').exists()).toBe(true);
    });

    it("renders the add-condition inline button only on the last row", () => {
      wrapper = buildWrapper({ fields: [makeField(), makeField()] });

      const addBtns = wrapper.findAll('[data-test="alert-conditions-add-condition-btn"]');
      expect(addBtns).toHaveLength(1);
    });
  });

  // ── Interactive elements fire right events ────────────────────────────────

  describe("interactive elements", () => {
    it("clicking Add Condition button emits 'add'", async () => {
      wrapper = buildWrapper({ fields: [] });

      await wrapper.find('[data-test="alert-conditions-add-btn"]').trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
      expect(wrapper.emitted("add")!.length).toBe(1);
    });

    it("clicking delete button emits 'remove' with the field object", async () => {
      const field = makeField({ column: "host" });
      wrapper = buildWrapper({ fields: [field] });

      await wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");

      expect(wrapper.emitted("remove")).toBeTruthy();
      expect((wrapper.emitted("remove") as any[][])[0][0]).toMatchObject({ column: "host" });
    });

    it("clicking delete button also emits 'input:update'", async () => {
      const field = makeField({ column: "level" });
      wrapper = buildWrapper({ fields: [field] });

      await wrapper.find('[data-test="alert-conditions-delete-condition-btn"]').trigger("click");

      expect(wrapper.emitted("input:update")).toBeTruthy();
    });

    it("clicking the inline add-condition button emits 'add'", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.find('[data-test="alert-conditions-add-condition-btn"]').trigger("click");

      expect(wrapper.emitted("add")).toBeTruthy();
    });
  });

  // ── v-if branching ────────────────────────────────────────────────────────

  describe("v-if branching", () => {
    it("shows the Add Condition button branch (v-if=!fields.length) when fields is empty", () => {
      wrapper = buildWrapper({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });

    it("shows condition rows branch (v-else) and hides add-btn when fields is non-empty", () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
    });
  });

  // ── Props reactivity ──────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("switches to rows view when fields prop changes from empty to non-empty", async () => {
      wrapper = buildWrapper({ fields: [] });

      await wrapper.setProps({ fields: [makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(false);
    });

    it("switches back to add-btn view when fields prop changes to empty", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.setProps({ fields: [] });

      expect(wrapper.find('[data-test="alert-conditions-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-conditions-1"]').exists()).toBe(false);
    });

    it("renders correct number of rows after adding a second field", async () => {
      wrapper = buildWrapper({ fields: [makeField()] });

      await wrapper.setProps({ fields: [makeField(), makeField()] });

      expect(wrapper.find('[data-test="alert-conditions-2"]').exists()).toBe(true);
    });
  });

  // ── triggerOperators content ──────────────────────────────────────────────

  describe("triggerOperators data", () => {
    it("exposes triggerOperators on the component instance", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toBeDefined();
    });

    it("triggerOperators contains 8 operators", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators.length).toBe(8);
    });

    it("triggerOperators includes '='", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("=");
    });

    it("triggerOperators includes '!='", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("!=");
    });

    it("triggerOperators includes 'Contains'", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("Contains");
    });

    it("triggerOperators includes 'NotContains'", () => {
      wrapper = buildWrapper();

      expect((wrapper.vm as any).triggerOperators).toContain("NotContains");
    });
  });
});
