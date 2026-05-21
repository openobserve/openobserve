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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import VariablesInput from "@/components/alerts/VariablesInput.vue";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(VariablesInput, {
    props: {
      variables: [],
      ...props,
    },
    global: {
      plugins: [i18n, store],
    },
  });
}

const twoVars = [
  { uuid: "1", key: "var1", value: "value1" },
  { uuid: "2", key: "var2", value: "value2" },
];

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("VariablesInput", () => {
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

    it("renders the 'Variable' section heading", () => {
      wrapper = buildWrapper();

      expect(wrapper.text()).toContain("Variable");
    });

    it("renders the info-outline icon in the heading area", () => {
      wrapper = buildWrapper();

      const icons = wrapper.findAllComponents({ name: "OIcon" });
      expect(icons.some((i) => i.props("name") === "info-outline")).toBe(true);
    });
  });

  // ── Empty variables state (v-if branch) ──────────────────────────────────

  describe("empty variables state", () => {
    it("shows the Add Variable button when variables is empty", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(true);
    });

    it("Add Variable button contains the expected text", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').text()).toContain("Add Variable");
    });

    it("does not show individual variable rows when variables is empty", () => {
      wrapper = buildWrapper({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(false);
    });

    it("emits 'add:variable' when the add button is clicked in empty state", async () => {
      wrapper = buildWrapper({ variables: [] });

      await wrapper.find('[data-test="alert-variables-add-btn"]').trigger("click");

      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")!.length).toBe(1);
    });
  });

  // ── Non-empty variables state (v-else branch) ─────────────────────────────

  describe("non-empty variables state", () => {
    it("hides the Add Variable button when variables is non-empty", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
    });

    it("renders one row per variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-2"]').exists()).toBe(true);
    });

    it("renders a key input for each variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs).toHaveLength(2);
    });

    it("renders a value input for each variable", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const valueInputs = wrapper.findAll('[data-test="alert-variables-value-input"]');
      expect(valueInputs).toHaveLength(2);
    });

    it("reflects variable key data in the rendered HTML", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.html()).toContain("var1");
      expect(wrapper.html()).toContain("var2");
    });

    it("reflects variable value data in the rendered HTML", () => {
      wrapper = buildWrapper({ variables: twoVars });

      expect(wrapper.html()).toContain("value1");
      expect(wrapper.html()).toContain("value2");
    });
  });

  // ── Delete variable ───────────────────────────────────────────────────────

  describe("delete variable", () => {
    it("renders a delete button for every variable row", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const deleteBtns = wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]');
      expect(deleteBtns).toHaveLength(2);
    });

    it("emits 'remove:variable' when a delete button is clicked", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");

      expect(wrapper.emitted("remove:variable")).toBeTruthy();
      expect(wrapper.emitted("remove:variable")!.length).toBe(1);
    });

    it("emits 'remove:variable' with the correct variable object", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");

      expect(wrapper.emitted("remove:variable")![0]).toEqual([twoVars[0]]);
    });
  });

  // ── Add variable inline button ────────────────────────────────────────────

  describe("add variable inline button", () => {
    it("shows the inline add button only on the last row", () => {
      wrapper = buildWrapper({ variables: twoVars });

      const addBtns = wrapper.findAll('[data-test="alert-variables-add-variable-btn"]');
      expect(addBtns).toHaveLength(1);
    });

    it("emits 'add:variable' when the inline add button is clicked", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");

      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")!.length).toBe(1);
    });
  });

  // ── Input placeholders ────────────────────────────────────────────────────

  describe("input placeholders", () => {
    it("key input has a defined placeholder", () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      const keyInput = wrapper
        .findAllComponents({ name: "OInput" })
        .find((c) => c.attributes("data-test") === "alert-variables-key-input");
      expect(keyInput?.props("placeholder")).toBeDefined();
    });

    it("value input has a defined placeholder", () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      const valueInput = wrapper
        .findAllComponents({ name: "OInput" })
        .find((c) => c.attributes("data-test") === "alert-variables-value-input");
      expect(valueInput?.props("placeholder")).toBeDefined();
    });
  });

  // ── Component methods ─────────────────────────────────────────────────────

  describe("component method exposure", () => {
    it("exposes removeVariable as a function", () => {
      wrapper = buildWrapper();

      expect(typeof wrapper.vm.removeVariable).toBe("function");
    });

    it("exposes addVariable as a function", () => {
      wrapper = buildWrapper();

      expect(typeof wrapper.vm.addVariable).toBe("function");
    });
  });

  // ── Props reactivity ──────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("switches to list view when variables prop changes from empty to non-empty", async () => {
      wrapper = buildWrapper({ variables: [] });

      await wrapper.setProps({ variables: [twoVars[0]] });

      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(false);
    });

    it("switches back to add-btn view when variables prop changes to empty", async () => {
      wrapper = buildWrapper({ variables: twoVars });

      await wrapper.setProps({ variables: [] });

      expect(wrapper.find('[data-test="alert-variables-add-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="alert-variables-1"]').exists()).toBe(false);
    });

    it("renders correct number of rows for 3 variables", () => {
      const threeVars = [
        { uuid: "1", key: "k1", value: "v1" },
        { uuid: "2", key: "k2", value: "v2" },
        { uuid: "3", key: "k3", value: "v3" },
      ];
      wrapper = buildWrapper({ variables: threeVars });

      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs.length).toBe(3);
    });
  });

  // ── Emit event names ──────────────────────────────────────────────────────

  describe("all emitted event names", () => {
    it("emits 'remove:variable' and 'add:variable' with correct names", async () => {
      wrapper = buildWrapper({ variables: [twoVars[0]] });

      await wrapper.find('[data-test="alert-variables-delete-variable-btn"]').trigger("click");
      await wrapper.find('[data-test="alert-variables-add-variable-btn"]').trigger("click");

      expect(Object.keys(wrapper.emitted())).toContain("remove:variable");
      expect(Object.keys(wrapper.emitted())).toContain("add:variable");
    });
  });
});
