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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import SavedViewsListDialog from "@/components/savedViews/SavedViewsListDialog.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, te: () => true }),
}));

const views = [
  { view_id: "t1", view_name: "checkout errors" },
  { view_id: "t2", view_name: "slow payments" },
];

// The real ODialog portals out of the wrapper; render its body inline instead.
const ODialogStub = {
  name: "ODialog",
  props: ["open", "size", "title"],
  emits: ["update:open"],
  template: '<div v-if="open" v-bind="$attrs"><slot /></div>',
};

// The real dropdown portals its items; render them inline so the < md menu is reachable.
const ODropdownStub = {
  name: "ODropdown",
  template: '<div><slot name="trigger" /><slot /></div>',
};

const ODropdownItemStub = {
  name: "ODropdownItem",
  props: ["iconLeft", "variant"],
  emits: ["select"],
  template: '<div v-bind="$attrs" @click="$emit(\'select\')"><slot /></div>',
};

describe("SavedViewsListDialog", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountDialog = (props: Record<string, unknown> = {}) =>
    mount(SavedViewsListDialog, {
      props: {
        open: true,
        views,
        favoriteIds: [],
        favoriteViews: [],
        dataTestPrefix: "traces-saved-views-dialog",
        ...props,
      },
      global: {
        stubs: {
          ODialog: ODialogStub,
          ODropdown: ODropdownStub,
          ODropdownItem: ODropdownItemStub,
        },
      },
    });

  const find = (dataTest: string) => wrapper!.find(`[data-test="${dataTest}"]`);

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("lists only the views passed in", async () => {
    wrapper = mountDialog({ views: [views[0]] });
    await flushPromises();

    expect(find("traces-saved-views-dialog-apply-t1").text()).toBe("checkout errors");
    expect(find("traces-saved-views-dialog-apply-t2").exists()).toBe(false);
  });

  it("filters the list by name, case-insensitively", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "SLOW");
    await flushPromises();

    expect(find("traces-saved-views-dialog-apply-t1").exists()).toBe(false);
    expect(find("traces-saved-views-dialog-apply-t2").exists()).toBe(true);
    expect(wrapper.emitted("update:search")?.[0]).toEqual(["SLOW"]);
  });

  it("clears the search each time the dialog opens", async () => {
    wrapper = mountDialog();
    await flushPromises();
    await wrapper.findComponent({ name: "OSearchInput" }).vm.$emit("update:modelValue", "SLOW");
    await flushPromises();
    expect(find("traces-saved-views-dialog-apply-t1").exists()).toBe(false);

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.findComponent({ name: "OSearchInput" }).props("modelValue")).toBe("");
    expect(find("traces-saved-views-dialog-apply-t1").exists()).toBe(true);
    expect(wrapper.emitted("update:search")?.at(-1)).toEqual([""]);
  });

  it("clears a bound search model when the dialog opens", async () => {
    wrapper = mountDialog({ open: false, search: "SLOW" });
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(wrapper.emitted("update:search")).toEqual([[""]]);
  });

  it("emits apply and closes when a view is chosen", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await find("traces-saved-views-dialog-apply-t2").trigger("click");

    expect(wrapper.emitted("apply")?.[0]).toEqual([views[1]]);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("emits update and delete without closing itself", async () => {
    wrapper = mountDialog();
    await flushPromises();

    await find("traces-saved-views-dialog-update-t1").trigger("click");
    await find("traces-saved-views-dialog-delete-t2").trigger("click");

    expect(wrapper.emitted("update")?.[0]).toEqual([views[0]]);
    expect(wrapper.emitted("delete")?.[0]).toEqual([views[1]]);
    expect(wrapper.emitted("apply")).toBeUndefined();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("emits edit and delete from the < md row menu", async () => {
    wrapper = mountDialog();
    await flushPromises();

    expect(find("traces-saved-views-dialog-more-actions-t1").classes()).toContain("md:hidden");
    await find("traces-saved-views-dialog-update-t1-menu").trigger("click");
    await find("traces-saved-views-dialog-delete-t1-menu").trigger("click");

    expect(wrapper.emitted("update")?.[0]).toEqual([views[0]]);
    expect(wrapper.emitted("delete")?.[0]).toEqual([views[0]]);
  });

  it("hides edit and delete buttons below md and reveals row actions on hover", async () => {
    wrapper = mountDialog();
    await flushPromises();

    const edit = find("traces-saved-views-dialog-update-t1");
    expect(edit.classes()).toEqual(
      expect.arrayContaining(["max-md:hidden", "opacity-0", "group-hover/row:opacity-100"]),
    );
    expect(find("traces-saved-views-dialog-favorite-t1").classes()).not.toContain("max-md:hidden");
  });

  it("shows the empty state only when not loading", async () => {
    wrapper = mountDialog({ views: [] });
    await flushPromises();
    expect(find("traces-saved-views-dialog-empty").text()).toContain("search.savedViewsNotFound");
    expect(find("traces-saved-views-dialog-loading").exists()).toBe(false);

    await wrapper.setProps({ loading: true });
    await flushPromises();
    expect(find("traces-saved-views-dialog-empty").exists()).toBe(false);
    expect(find("traces-saved-views-dialog-loading").text()).toContain("confirmDialog.loading");
  });

  it("renders the favourites pane only when there are favourites", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(find("traces-saved-views-dialog-favorites-table").exists()).toBe(false);
    expect(find("traces-saved-views-dialog-table").element.parentElement!.className).toContain(
      "w-full",
    );

    await wrapper.setProps({ favoriteIds: ["t2"], favoriteViews: [views[1]] });
    await flushPromises();

    const favorites = find("traces-saved-views-dialog-favorites-table");
    expect(favorites.exists()).toBe(true);
    expect(favorites.text()).toContain("search.favoriteViews");
    const header = favorites.element.firstElementChild as HTMLElement;
    expect(header.textContent!.trim()).toBe("search.favoriteViews");
    const below = header.nextElementSibling as HTMLElement;
    for (const el of [header, below]) {
      expect(el.tagName).not.toBe("HR");
      expect(el.className).not.toMatch(/(^|\s)border(-[tb])?(\s|$)/);
    }
    expect(favorites.find("hr").exists()).toBe(false);
    expect(
      favorites.find('[data-test="traces-saved-views-dialog-favorites-apply-t2"]').text(),
    ).toBe("slow payments");
    expect(find("traces-saved-views-dialog-table").element.parentElement!.className).toContain(
      "w-3/5",
    );
  });

  it("toggles favourites with the current state, and the favourites pane always removes", async () => {
    wrapper = mountDialog({ favoriteIds: ["t2"], favoriteViews: [views[1]] });
    await flushPromises();

    const starIcon = (dataTest: string) =>
      find(dataTest).findComponent({ name: "OIcon" }).props("name");
    expect(starIcon("traces-saved-views-dialog-favorite-t1")).toBe("star-outline");
    expect(starIcon("traces-saved-views-dialog-favorite-t2")).toBe("star");

    await find("traces-saved-views-dialog-favorite-t1").trigger("click");
    await find("traces-saved-views-dialog-favorite-t2").trigger("click");
    await find("traces-saved-views-dialog-favorites-favorite-t2").trigger("click");

    expect(wrapper.emitted("toggle-favorite")).toEqual([
      [views[0], false],
      [views[1], true],
      [views[1], true],
    ]);
  });

  it("applies from the favourites pane and closes", async () => {
    wrapper = mountDialog({ favoriteIds: ["t2"], favoriteViews: [views[1]] });
    await flushPromises();

    await find("traces-saved-views-dialog-favorites-apply-t2").trigger("click");

    expect(wrapper.emitted("apply")?.[0]).toEqual([views[1]]);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("renders compact rows with no header and no pager border", async () => {
    wrapper = mountDialog();
    await flushPromises();

    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("compact")).toBe(true);
    expect(table.props("showHeader")).toBe(false);
    expect(table.props("paginationBordered")).toBe(false);
    expect(table.find("thead").exists()).toBe(false);
  });

  it("renders the actions as an unpinned, right-aligned action cell", async () => {
    wrapper = mountDialog();
    await flushPromises();

    const cell = wrapper.find('[data-test="o2-table-cell-actions"]');
    expect(cell.attributes("style") ?? "").not.toContain("sticky");
    expect(cell.classes()).toContain("text-right");
    expect(cell.element.firstElementChild!.className).toContain("inline-flex");
    expect(cell.find(".truncate").exists()).toBe(false);
  });

  it("derives every data-test from dataTestPrefix", async () => {
    const p = "logs-saved-views-dialog";
    wrapper = mountDialog({ dataTestPrefix: p, favoriteIds: ["t2"], favoriteViews: [views[1]] });
    await flushPromises();

    const expected = [
      p,
      `${p}-list`,
      `${p}-search`,
      `${p}-search-field`,
      `${p}-table`,
      `${p}-favorites-table`,
      `${p}-apply-t1`,
      `${p}-favorite-t1`,
      `${p}-update-t1`,
      `${p}-delete-t1`,
      `${p}-more-actions-t1`,
      `${p}-update-t1-menu`,
      `${p}-delete-t1-menu`,
      `${p}-favorites-apply-t2`,
      `${p}-favorites-favorite-t2`,
      `${p}-favorites-update-t2`,
      `${p}-favorites-delete-t2`,
      `${p}-favorites-more-actions-t2`,
      `${p}-favorites-update-t2-menu`,
      `${p}-favorites-delete-t2-menu`,
    ];
    for (const id of expected) {
      expect(wrapper.find(`[data-test="${id}"]`).exists(), id).toBe(true);
    }
    expect(find(`${p}-apply-t1`).attributes("data-test-view-name")).toBe("checkout errors");
    expect(find(`${p}-favorites-apply-t2`).attributes("data-test-view-name")).toBe("slow payments");
    expect(wrapper.find('[data-test^="traces-"]').exists()).toBe(false);
  });

  it("re-renders data-test values when dataTestPrefix changes", async () => {
    wrapper = mountDialog();
    await wrapper.setProps({ dataTestPrefix: "other-dialog" });

    expect(find("other-dialog").exists()).toBe(true);
    expect(find("other-dialog-table").exists()).toBe(true);
    expect(find("other-dialog-apply-t1").exists()).toBe(true);
    expect(find("traces-saved-views-dialog-table").exists()).toBe(false);
  });
});
