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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import SavedViewsListDialog from "@/components/savedViews/SavedViewsListDialog.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";

const { mockSavedViewsGet, mockSavedViewsDelete } = vi.hoisted(() => ({
  mockSavedViewsGet: vi.fn(),
  mockSavedViewsDelete: vi.fn(),
}));

vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { get: mockSavedViewsGet, delete: mockSavedViewsDelete },
  });
});

// A light in-memory router: the app router lazy-loads real pages on navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

const logsView = {
  view_id: "l1",
  view_name: "error logs",
  org_id: "default",
  view_type: "logs",
};
const logsView2 = {
  view_id: "l2",
  view_name: "slow requests",
  org_id: "default",
  view_type: "logs",
};

describe("SearchBar — saved views list dialog", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

  const dialog = () => wrapper!.findComponent(SavedViewsListDialog);
  const favorites = () => JSON.parse(localStorage.getItem("savedViews") || "{}");

  beforeEach(() => {
    localStorage.removeItem("savedViews");
    mockSavedViewsGet.mockResolvedValue({ data: { views: [logsView, logsView2] } });
    mockSavedViewsDelete.mockResolvedValue({ status: 200, data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    localStorage.removeItem("savedViews");
    vi.clearAllMocks();
  });

  it("passes the logs data-test prefix, views and favourites to the dialog", async () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView }));
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.data.savedViews = [logsView, logsView2];
    await flushPromises();

    expect(dialog().props("dataTestPrefix")).toBe("logs-saved-views-dialog");
    expect(dialog().props("views")).toEqual([logsView, logsView2]);
    expect(dialog().props("favoriteIds")).toEqual(["l1"]);
    expect(dialog().props("favoriteViews")).toEqual([logsView]);
  });

  it("toggles a favourite from the dialog", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    dialog().vm.$emit("toggle-favorite", logsView, false);
    await flushPromises();
    expect(dialog().props("favoriteIds")).toEqual(["l1"]);
    expect(Object.keys(favorites())).toEqual(["l1"]);

    dialog().vm.$emit("toggle-favorite", logsView, true);
    await flushPromises();
    expect(dialog().props("favoriteIds")).toEqual([]);
    expect(favorites()).toEqual({});
  });

  it("a confirmed delete from the dialog drops the favourite", async () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView }));
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.savedViewsListDialog = true;
    await flushPromises();

    dialog().vm.$emit("delete", logsView);
    await flushPromises();

    expect(dialog().props("open")).toBe(false);
    const confirm = wrapper
      .findAllComponents(ConfirmDialog)
      .find((c) => c.props("modelValue") === true)!;
    expect(confirm.props("title")).toBe(i18n.global.t("search.deleteSavedView"));
    expect(mockSavedViewsDelete).not.toHaveBeenCalled();

    confirm.vm.$emit("update:ok");
    await flushPromises();

    expect(mockSavedViewsDelete).toHaveBeenCalledWith("default", "l1");
    expect(dialog().props("favoriteIds")).toEqual([]);
    expect(favorites()).toEqual({});
  }, 20000);

  it("prunes favourites deleted elsewhere once the list loads, freeing the cap", async () => {
    const stored: Record<string, unknown> = {
      t1: { ...logsView, view_id: "t1", view_type: "traces" },
    };
    for (let i = 0; i < 9; i++) stored[`gone${i}`] = { ...logsView, view_id: `gone${i}` };
    stored.l1 = logsView;
    localStorage.setItem("savedViews", JSON.stringify(stored));
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.data.savedViews = [];
    await flushPromises();
    expect(dialog().props("favoriteIds")).toHaveLength(10);

    wrapper.vm.openSavedViewsList();
    await flushPromises();

    expect(mockSavedViewsGet).toHaveBeenCalledTimes(1);
    expect(dialog().props("favoriteIds")).toEqual(["l1"]);
    expect(Object.keys(favorites())).toEqual(["t1", "l1"]);

    dialog().vm.$emit("toggle-favorite", logsView2, false);
    await flushPromises();
    expect(dialog().props("favoriteIds")).toEqual(["l1", "l2"]);
  });

  it("keeps every favourite when the list fails to load", async () => {
    mockSavedViewsGet.mockRejectedValue(new Error("boom"));
    const gone = { ...logsView, view_id: "gone" };
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView, gone }));
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.data.savedViews = [];
    await flushPromises();

    wrapper.vm.openSavedViewsList();
    await flushPromises();

    expect(mockSavedViewsGet).toHaveBeenCalledTimes(1);
    expect(dialog().props("loading")).toBe(false);
    expect(dialog().props("views")).toEqual([]);
    expect(dialog().props("favoriteIds")).toEqual(["l1", "gone"]);
    expect(favorites()).toEqual({ l1: logsView, gone });
  });
});
