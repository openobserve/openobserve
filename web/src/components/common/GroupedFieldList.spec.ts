// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import GroupedFieldList from "./GroupedFieldList.vue";

const FIELDS = [
  { name: "Alpha", label: true, group: "a" },
  { name: "a1", group: "a" },
  { name: "a2", group: "a" },
  { name: "Beta", label: true, group: "b" },
  { name: "b1", group: "b" },
];

describe("GroupedFieldList", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const rows = () =>
    wrapper.findAll(".o-field-list__row").map((row) => row.attributes("data-test"));
  const header = (group: string) => wrapper.find(`[data-test="o-field-list-group-${group}"] > div`);

  it("renders a header with its count and every field row", () => {
    wrapper = mount(GroupedFieldList, { props: { fields: FIELDS } });
    expect(header("Alpha").text()).toContain("Alpha (2)");
    expect(rows()).toEqual(["o-field-list-row-a1", "o-field-list-row-a2", "o-field-list-row-b1"]);
  });

  it("keeps the collapse state itself when no model is bound", async () => {
    wrapper = mount(GroupedFieldList, { props: { fields: FIELDS } });
    await header("Alpha").trigger("click");
    expect(rows()).toEqual(["o-field-list-row-b1"]);
    expect(wrapper.emitted("update:collapsedGroups")?.[0][0]).toEqual(new Set(["a"]));
    await header("Alpha").trigger("click");
    expect(rows()).toHaveLength(3);
  });

  it("renders the bound collapsed groups and asks the owner to change them", async () => {
    wrapper = mount(GroupedFieldList, {
      props: { fields: FIELDS, collapsedGroups: new Set(["a"]) },
    });
    expect(rows()).toEqual(["o-field-list-row-b1"]);
    expect(header("Alpha").find("button").attributes("aria-expanded")).toBe("false");
    await header("Alpha").trigger("click");
    expect(wrapper.emitted("update:collapsedGroups")?.[0][0]).toEqual(new Set());
    expect(rows()).toEqual(["o-field-list-row-b1"]);
    await wrapper.setProps({ collapsedGroups: new Set() });
    expect(rows()).toHaveLength(3);
  });

  it("keeps a collapsed group's header while a search matches one of its rows", async () => {
    wrapper = mount(GroupedFieldList, {
      props: { fields: FIELDS, collapsedGroups: new Set(["a"]), search: "a1" },
    });
    expect(header("Alpha").exists()).toBe(true);
    expect(header("Beta").exists()).toBe(false);
  });

  it("forwards keyboard mode, the expansion slot and the field-actions slot", async () => {
    wrapper = mount(GroupedFieldList, {
      props: {
        fields: FIELDS,
        keyboard: true,
        expandedIds: ["a1"],
        expandableFn: (row: { name: string }) => row.name === "a1",
      },
      slots: {
        expansion: '<div data-test="expansion-slot">values</div>',
        "field-actions": '<button data-test="action-slot">act</button>',
      },
    });
    const a1 = wrapper.find('[data-test="o-field-list-row-a1"]');
    expect(a1.find('[data-test="o-field-list-toggle-a1"]').attributes("tabindex")).toBe("0");
    expect(wrapper.find('[data-test="expansion-slot"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="action-slot"]')).toHaveLength(3);
    await a1.trigger("click");
    expect(wrapper.emitted("update:expanded-ids")?.[0]).toEqual([[]]);
    await wrapper.find('[data-test="o-field-list-row-a2"]').trigger("click");
    expect(wrapper.emitted("update:expanded-ids")).toHaveLength(1);
  });
});
