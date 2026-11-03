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
import TracesScopeSelect from "./TracesScopeSelect.vue";

const mountSelect = (props: Record<string, unknown> = {}) =>
  mount(TracesScopeSelect, {
    props: { modelValue: "all", sqlMode: false, hasParentColumn: true, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        OSelect: {
          name: "OSelect",
          props: ["modelValue", "disabled", "label"],
          template: '<div><slot name="trigger" /><slot /></div>',
        },
        OSelectItem: {
          name: "OSelectItem",
          props: ["value", "label", "disabled"],
          template: "<div><slot /></div>",
        },
        OTooltip: { name: "OTooltip", props: ["content", "disabled"], template: "<span />" },
      },
    },
  });

const items = (wrapper: ReturnType<typeof mountSelect>) =>
  wrapper.findAllComponents(OSelectItem).map((item) => ({
    value: item.props("value"),
    disabled: !!item.props("disabled"),
    text: item.text(),
  }));

const tooltips = (wrapper: ReturnType<typeof mountSelect>) =>
  wrapper
    .findAllComponents(OTooltip)
    .filter((tip) => !tip.props("disabled"))
    .map((tip) => tip.props("content"));

describe("TracesScopeSelect", () => {
  it("is labelled Scope and offers the three scopes, each with a one-line description", () => {
    const wrapper = mountSelect();
    expect(wrapper.findComponent(OSelect).props("label")).toBe("Scope");
    expect(items(wrapper)).toEqual([
      { value: "all", disabled: false, text: "All spansEvery span that matches the filter" },
      {
        value: "root",
        disabled: false,
        text: "Root spansSpans with no parent, where each trace starts",
      },
      {
        value: "entrypoint",
        disabled: false,
        text: "Entrypoint spansServer or consumer spans, plus any root span",
      },
    ]);
    expect(tooltips(wrapper)).toEqual([]);
  });

  it("shows the picked scope's name in the trigger", () => {
    const wrapper = mountSelect({ modelValue: "entrypoint" });
    expect(wrapper.find('[data-test="traces-scope-select-value"]').text()).toBe("Entrypoint spans");
  });

  it("greys out Root spans with a reason when the stream has no reference_parent_span_id", () => {
    const wrapper = mountSelect({ hasParentColumn: false });
    expect(items(wrapper).find((item) => item.value === "root")?.disabled).toBe(true);
    expect(tooltips(wrapper)).toEqual(["This stream has no reference_parent_span_id field"]);
  });

  it("shows All spans while a Root spans scope cannot apply", () => {
    const wrapper = mountSelect({ modelValue: "root", hasParentColumn: false });
    expect(wrapper.findComponent(OSelect).props("modelValue")).toBe("all");
  });

  it("is disabled in SQL mode, with a tooltip to put the condition in the WHERE", () => {
    const wrapper = mountSelect({ sqlMode: true });
    expect(wrapper.findComponent(OSelect).props("disabled")).toBe(true);
    expect(tooltips(wrapper)).toEqual(["Put the scope condition in your SQL WHERE"]);
  });

  it("emits the picked scope", async () => {
    const wrapper = mountSelect();
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "root");
    expect(wrapper.emitted("update:modelValue")).toEqual([["root"]]);
  });
});
