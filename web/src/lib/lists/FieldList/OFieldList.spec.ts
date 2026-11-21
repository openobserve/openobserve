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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import OFieldList from "./OFieldList.vue";

const FIELDS = [
  { name: "Pages", isGroup: true, groupName: "Pages" },
  { name: "/a" },
  { name: "/b" },
];

describe("OFieldList keyboard", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const rows = () => wrapper.findAll(".o-field-list__row");

  it("leaves rows out of the tab order unless the list is a picker", () => {
    wrapper = mount(OFieldList, { props: { fields: FIELDS } });
    expect(rows()[0].attributes("tabindex")).toBeUndefined();
    rows()[0].element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wrapper.emitted("row-click")).toBeUndefined();
  });

  it("tells assistive tech whether an expandable row is open and which region it controls", async () => {
    wrapper = mount(OFieldList, {
      props: { fields: FIELDS, keyboard: true, expandedIds: ["/a"] },
      slots: { expansion: () => h("p", "values") },
    });
    const [open, closed] = rows();
    expect(open.attributes("aria-expanded")).toBe("true");
    expect(closed.attributes("aria-expanded")).toBe("false");
    const region = wrapper.find(`#${open.attributes("aria-controls")}`);
    expect(region.exists()).toBe(true);
    expect(region.text()).toBe("values");
    expect(closed.attributes("aria-controls")).toBeUndefined();
  });

  it("picks a focused row with Enter or Space", async () => {
    wrapper = mount(OFieldList, { props: { fields: FIELDS, keyboard: true } });
    expect(rows()[0].attributes("tabindex")).toBe("0");
    await rows()[0].trigger("keydown", { key: "Enter" });
    await rows()[1].trigger("keydown", { key: " " });
    const picked = wrapper.emitted("row-click")?.map((args) => (args[0] as { name: string }).name);
    expect(picked).toEqual(["/a", "/b"]);
  });

  it("moves focus between rows with the arrow keys", async () => {
    wrapper = mount(OFieldList, {
      props: { fields: FIELDS, keyboard: true },
      attachTo: document.body,
    });
    (rows()[0].element as HTMLElement).focus();
    await rows()[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1].element);
    await rows()[1].trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows()[0].element);
  });
});

const GROUPED = [
  { name: "A", isGroup: true, groupName: "A", group: "a" },
  { name: "a1", group: "a" },
  { name: "a2", group: "a" },
  { name: "a3", group: "a" },
  { name: "B", isGroup: true, groupName: "B", group: "b" },
  { name: "b1", group: "b" },
  { name: "C", isGroup: true, groupName: "C", group: "c" },
];

describe("OFieldList pagination", () => {
  let wrapper: VueWrapper;
  let pager: Record<string, any> = {};

  afterEach(() => {
    wrapper?.unmount();
  });

  const rows = () =>
    wrapper.findAll(".o-field-list__row").map((row) => row.attributes("data-test"));
  const headers = () =>
    wrapper.findAll(".o-field-list__group-header").map((row) => row.attributes("data-test"));

  const mountPaged = (pageSize: number) => {
    wrapper = mount(OFieldList, {
      props: { fields: GROUPED, pageSize },
      slots: {
        "after-list": (props: Record<string, any>) => {
          pager = props;
          return h("div");
        },
      },
    });
  };

  it("counts only field rows toward a page and carries the headers along", async () => {
    mountPaged(2);
    expect(pager.totalRows).toBe(4);
    expect(pager.totalPages).toBe(2);
    expect(rows()).toEqual(["o-field-list-row-a1", "o-field-list-row-a2"]);
    expect(headers()).toEqual(["o-field-list-group-A"]);
    pager.nextPage();
    await wrapper.vm.$nextTick();
    expect(rows()).toEqual(["o-field-list-row-a3", "o-field-list-row-b1"]);
    expect(headers()).toEqual([
      "o-field-list-group-A",
      "o-field-list-group-B",
      "o-field-list-group-C",
    ]);
  });

  it("moves to the last page and tells the owner when the list shrinks below the current page", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}` }));
    wrapper = mount(OFieldList, {
      props: { fields: many, pageSize: 2, currentPage: 3 },
      slots: {
        "after-list": (props: Record<string, any>) => {
          pager = props;
          return h("div");
        },
      },
    });
    expect(pager.currentPage).toBe(3);
    await wrapper.setProps({ fields: many.slice(0, 3) });
    expect(pager.currentPage).toBe(2);
    expect(pager.totalPages).toBe(2);
    expect(wrapper.emitted("update:currentPage")?.at(-1)).toEqual([2]);
    expect(rows()).toEqual(["o-field-list-row-f2"]);
  });

  it("honours the page size handed to setPageSize", async () => {
    mountPaged(2);
    pager.setPageSize(4);
    await wrapper.vm.$nextTick();
    expect(pager.totalPages).toBe(1);
    expect(rows()).toHaveLength(4);
  });
});

describe("OFieldList expansion", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("toggles a row's expansion on click and reports the new ids", async () => {
    wrapper = mount(OFieldList, {
      props: { fields: GROUPED, expandableFn: (row: { name: string }) => row.name !== "a2" },
      slots: { expansion: '<div data-test="expanded-body" />' },
    });
    await wrapper.find('[data-test="o-field-list-row-a1"]').trigger("click");
    expect(wrapper.emitted("update:expandedIds")?.[0]).toEqual([["a1"]]);
    expect(wrapper.find('[data-test="o-field-list-expansion-a1"]').exists()).toBe(true);
    await wrapper.find('[data-test="o-field-list-row-a2"]').trigger("click");
    expect(wrapper.emitted("update:expandedIds")).toHaveLength(1);
    await wrapper.find('[data-test="o-field-list-row-a1"]').trigger("click");
    expect(wrapper.emitted("update:expandedIds")?.[1]).toEqual([[]]);
  });

  it("never toggles without an expansion slot", async () => {
    wrapper = mount(OFieldList, { props: { fields: GROUPED } });
    await wrapper.find('[data-test="o-field-list-row-a1"]').trigger("click");
    expect(wrapper.emitted("update:expandedIds")).toBeUndefined();
    expect(wrapper.emitted("row-click")).toHaveLength(1);
  });

  it("expands one of two same-named rows by their row key", async () => {
    wrapper = mount(OFieldList, {
      props: {
        fields: [
          { name: "status", uid: "a:status" },
          { name: "status", uid: "b:status" },
        ],
        rowKey: "uid",
      },
      slots: { expansion: '<div data-test="expanded-body" />' },
    });
    await wrapper.findAll('[data-test="o-field-list-row-status"]')[1].trigger("click");
    expect(wrapper.emitted("update:expandedIds")?.[0]).toEqual([["b:status"]]);
    expect(wrapper.findAll('[data-test="expanded-body"]')).toHaveLength(1);
  });
});

describe("OFieldList opening a row near the bottom (P1)", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0 }) as DOMRect;

  const openAt = async (rowTop: number) => {
    wrapper = mount(OFieldList, {
      props: { fields: FIELDS },
      slots: { expansion: () => h("div", "values") },
      attachTo: document.body,
    });
    const scroller = wrapper.find(".overflow-y-auto").element as HTMLElement;
    scroller.getBoundingClientRect = () => rect(100, 200);
    const row = wrapper.findAll(".o-field-list__row")[1];
    (row.element as HTMLElement).getBoundingClientRect = () => rect(rowTop, 24);
    await row.trigger("click");
    await new Promise((resolve) => setTimeout(resolve));
    return scroller;
  };

  it("scrolls a row opened in the lower half of the list to its top, so its values show", async () => {
    const scroller = await openAt(250);
    expect(scroller.scrollTop).toBe(150);
  });

  it("leaves the list where it is when the opened row has room below it", async () => {
    const scroller = await openAt(150);
    expect(scroller.scrollTop).toBe(0);
  });
});

describe("OFieldList search", () => {
  it("starts a field search at the top, so the first match is not left behind the sticky group header (X5)", async () => {
    const wrapper = mount(OFieldList, { props: { fields: FIELDS }, attachTo: document.body });
    const scroller = wrapper.find(".overflow-y-auto").element as HTMLElement;
    scroller.scrollTop = 120;
    await wrapper.find('[data-test="o-field-list-search"] input').setValue("/b");
    expect(scroller.scrollTop).toBe(0);
    wrapper.unmount();
  });
});
