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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSelectItem from "@/lib/forms/Select/OSelectItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import TracesScopeSelect from "./TracesScopeSelect.vue";

const mountSelect = (props: Record<string, unknown> = {}) =>
  mount(TracesScopeSelect, {
    props: { modelValue: "all", hasParentColumn: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        OToggleGroup: {
          name: "OToggleGroup",
          props: ["modelValue"],
          template: "<div><slot /></div>",
        },
        OToggleGroupItem: {
          name: "OToggleGroupItem",
          props: ["value", "disabled", "focusableUnavailable", "tooltip", "size"],
          template: "<button><slot /></button>",
        },
        OSelect: {
          name: "OSelect",
          props: ["modelValue", "appearance", "searchable"],
          template: '<div><slot name="trigger" /><slot /></div>',
        },
        OSelectItem: {
          name: "OSelectItem",
          props: ["value", "label", "disabled"],
          template: "<div><slot /></div>",
        },
        OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
      },
    },
  });

const segments = (wrapper: ReturnType<typeof mountSelect>) =>
  wrapper.findAllComponents(OToggleGroupItem).map((item) => ({
    value: item.props("value"),
    disabled: !!item.props("disabled"),
    focusable: !!item.props("focusableUnavailable"),
    tooltip: item.props("tooltip"),
    hint: item.findComponent(OTooltip).exists()
      ? item.findComponent(OTooltip).props("content")
      : undefined,
    name: item.attributes("aria-label"),
    label: item.get('[data-test="traces-scope-option-label"]').text(),
    short: item.get('[data-test="traces-scope-option-short"]').text(),
  }));

describe("TracesScopeSelect", () => {
  describe("forms picked by the results pane width", () => {
    it("renders the switch from 67rem and the chip below it", () => {
      const wrapper = mountSelect();
      expect(wrapper.get('[data-test="traces-scope"]').classes()).toEqual(
        expect.arrayContaining(["hidden", "@min-[67rem]/results:inline-flex"]),
      );
      expect(wrapper.get('[data-test="traces-scope-chip-wrap"]').classes()).toEqual(
        expect.arrayContaining(["inline-flex", "@min-[67rem]/results:hidden"]),
      );
    });

    it("shows full names from 76rem and short names below it", () => {
      const item = mountSelect().findAllComponents(OToggleGroupItem)[0];
      expect(item.get('[data-test="traces-scope-option-label"]').classes()).toEqual([
        "hidden",
        "@min-[76rem]/results:inline",
      ]);
      expect(item.get('[data-test="traces-scope-option-short"]').classes()).toEqual([
        "@min-[76rem]/results:hidden",
      ]);
    });
  });

  describe("switch", () => {
    it("has a Scope label and full-name segments with short names and hover hints", () => {
      const wrapper = mountSelect();
      expect(wrapper.get('[data-test="traces-scope"] > span').text()).toBe("Scope");
      const group = wrapper.findComponent(OToggleGroup);
      expect(group.attributes("data-test")).toBe("traces-scope-switch");
      expect(group.props("modelValue")).toBe("all");
      expect(segments(wrapper)).toEqual([
        {
          value: "all",
          disabled: false,
          focusable: false,
          tooltip: undefined,
          hint: "Every span in the time range",
          name: "All spans",
          label: "All spans",
          short: "All",
        },
        {
          value: "root",
          disabled: false,
          focusable: false,
          tooltip: undefined,
          hint: "Only the first span of each trace",
          name: "Root spans",
          label: "Root spans",
          short: "Root",
        },
        {
          value: "entrypoint",
          disabled: false,
          focusable: false,
          tooltip: undefined,
          hint: "Server and consumer spans, plus roots",
          name: "Entry-point spans",
          label: "Entry-point spans",
          short: "Entry",
        },
      ]);
      expect(wrapper.find('[data-test="traces-scope-option-root"]').exists()).toBe(true);
    });

    it("emits the picked scope, and nothing for the scope already shown", () => {
      const wrapper = mountSelect();
      wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "root");
      wrapper.findComponent(OToggleGroup).vm.$emit("update:modelValue", "all");
      expect(wrapper.emitted("update:modelValue")).toEqual([["root"]]);
    });

    it("greys out Root spans with a keyboard-reachable reason when the stream has no reference_parent_span_id", () => {
      expect(segments(mountSelect({ hasParentColumn: false }))[1]).toMatchObject({
        disabled: true,
        focusable: true,
        tooltip: "This stream has no reference_parent_span_id field",
        hint: undefined,
      });
    });

    it("shows All spans while a Root spans scope cannot apply", () => {
      const wrapper = mountSelect({ modelValue: "root", hasParentColumn: false });
      expect(wrapper.findComponent(OToggleGroup).props("modelValue")).toBe("all");
      expect(wrapper.findComponent(OSelect).props("modelValue")).toBe("all");
    });
  });

  describe("chip", () => {
    it("names the scope, in its text and its accessible name, and opens the options with descriptions", () => {
      const wrapper = mountSelect({ modelValue: "root" });
      const select = wrapper.findComponent(OSelect);
      expect(select.attributes("data-test")).toBe("traces-scope-chip");
      expect(select.attributes("aria-label")).toBe("Scope: Root");
      expect(select.props("appearance")).toBe("inline");
      expect(wrapper.get('[data-test="traces-scope-chip-value"]').text()).toBe("Scope: Root");
      expect(
        wrapper.findAllComponents(OSelectItem).map((item) => [item.props("value"), item.text()]),
      ).toEqual([
        ["all", "All spansEvery span that matches the filter"],
        ["root", "Root spansSpans with no parent, where each trace starts"],
        ["entrypoint", "Entry-point spansServer or consumer spans, plus any root span"],
      ]);
    });

    it("marks the chip active only for a scope other than All spans", () => {
      const wrap = (props: Record<string, unknown>) =>
        mountSelect(props).get('[data-test="traces-scope-chip-wrap"]').classes();
      expect(wrap({ modelValue: "all" })).not.toContain("border-accent");
      expect(wrap({ modelValue: "entrypoint" })).toContain("border-accent");
    });

    it("greys out Root spans with a reason in the menu", () => {
      const wrapper = mountSelect({ hasParentColumn: false });
      const root = wrapper.findAllComponents(OSelectItem)[1];
      expect(root.props("disabled")).toBe(true);
      const chip = wrapper.findComponent(OSelect);
      expect(chip.findAllComponents(OTooltip).map((tip) => tip.props("content"))).toEqual([
        "This stream has no reference_parent_span_id field",
      ]);
    });

    it("emits the picked scope", () => {
      const wrapper = mountSelect();
      wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "entrypoint");
      expect(wrapper.emitted("update:modelValue")).toEqual([["entrypoint"]]);
    });
  });
});
