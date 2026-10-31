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
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import SavedViewsMenu from "@/components/savedViews/SavedViewsMenu.vue";
import SavedViewsSubmenu from "@/components/savedViews/SavedViewsSubmenu.vue";

const {
  mockSavedViewsGet,
  mockSavedViewsDelete,
  mockSavedViewsPost,
  mockSavedViewsPut,
  mockGetViewDetail,
} = vi.hoisted(() => ({
  mockSavedViewsGet: vi.fn(),
  mockSavedViewsDelete: vi.fn(),
  mockSavedViewsPost: vi.fn(),
  mockSavedViewsPut: vi.fn(),
  mockGetViewDetail: vi.fn(),
}));

vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: mockSavedViewsGet,
      delete: mockSavedViewsDelete,
      post: mockSavedViewsPost,
      put: mockSavedViewsPut,
      getViewDetail: mockGetViewDetail,
    },
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

describe("SearchBar — saved views submenu", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

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

  it("passes the logs data-test prefix, views and favourites to the submenu", async () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView }));
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.data.savedViews = [logsView, logsView2];
    await flushPromises();

    wrapper.vm.appliedSavedViewId = "l2";
    wrapper.vm.utilitiesMenuOpen = true;
    await flushPromises();

    const submenu = wrapper.findComponent(SavedViewsSubmenu);
    expect(submenu.props()).toMatchObject({
      dataTestPrefix: "logs-search-bar-menu-saved-views",
      triggerTestId: "logs-search-bar-menu-list-saved-views-btn",
      views: [logsView, logsView2],
      favoriteIds: ["l1"],
    });
    expect(submenu.vm.$attrs["applied-view-id"]).toBe("l2");

    document
      .querySelector<HTMLElement>('[data-test="logs-search-bar-menu-list-saved-views-btn"]')!
      .click();
    await flushPromises();
    const menu = wrapper.findComponent(SavedViewsMenu);
    expect(menu.props()).toMatchObject({
      views: [logsView, logsView2],
      favoriteIds: ["l1"],
      appliedViewId: "l2",
      dataTestPrefix: "logs-search-bar-menu-saved-views",
    });
  });

  const detail = (streamName = "default") => ({
    status: 200,
    data: {
      data: {
        data: {
          resultGrid: { columns: [], colOrder: {}, colSizes: {} },
          stream: {
            streamType: "logs",
            selectedStream: [streamName],
            selectedFields: [],
          },
          datetime: {},
          tempFunctionContent: "",
        },
        meta: { regions: [], showTransformEditor: false, logsVisualizeToggle: "logs" },
      },
    },
  });

  it("apply marks the view applied only after the apply path completes", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.searchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
    wrapper.vm.searchObj.data.stream.streamType = "logs";
    wrapper.vm.dateTimeRef = { setSavedDate: vi.fn() };

    mockGetViewDetail.mockResolvedValueOnce(detail("missing"));
    await wrapper.vm.applySavedView(logsView);
    await flushPromises();
    expect(wrapper.vm.appliedSavedViewId).toBeNull();

    mockGetViewDetail.mockResolvedValueOnce(detail());
    await wrapper.vm.applySavedView(logsView);
    await flushPromises();
    expect(mockGetViewDetail).toHaveBeenLastCalledWith("default", "l1");
    expect(wrapper.vm.appliedSavedViewId).toBe("l1");
  }, 20000);

  it("create marks the new view applied from the response view_id", async () => {
    mockSavedViewsPost.mockResolvedValue({
      status: 200,
      data: { view_id: "new1", org_id: "default" },
    });
    wrapper = mountSearchBar();
    await flushPromises();

    await wrapper.vm.createSavedViews("fresh view");
    await flushPromises();

    expect(mockSavedViewsPost).toHaveBeenCalled();
    expect(wrapper.vm.appliedSavedViewId).toBe("new1");
  }, 20000);

  it("overwrite closes both menus, confirms, then marks the view applied once it saves", async () => {
    mockSavedViewsPut.mockResolvedValue({ status: 200, data: {} });
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.searchObj.data.stream.selectedStream = ["default"];
    wrapper.vm.utilitiesMenuOpen = true;
    wrapper.vm.savedViewsDropdownOpen = true;

    wrapper.vm.requestUpdateSavedView(logsView2);
    await flushPromises();
    expect(wrapper.vm.utilitiesMenuOpen).toBe(false);
    expect(wrapper.vm.savedViewsDropdownOpen).toBe(false);
    expect(mockSavedViewsPut).not.toHaveBeenCalled();

    const confirm = wrapper
      .findAllComponents(ConfirmDialog)
      .find((c) => c.props("modelValue") === true)!;
    expect(confirm.props("title")).toBe(i18n.global.t("search.overwriteSavedView"));
    expect(confirm.props()).toMatchObject({
      messageKeypath: "search.overwriteSavedViewConfirm",
      messageName: "slow requests",
      focusCancel: true,
    });

    confirm.vm.$emit("update:ok");
    await flushPromises();

    expect(mockSavedViewsPut).toHaveBeenCalled();
    expect(wrapper.vm.appliedSavedViewId).toBe("l2");
  }, 20000);

  it("a cancelled overwrite leaves the view untouched", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.searchObj.data.stream.selectedStream = ["default"];

    wrapper.vm.requestUpdateSavedView(logsView2);
    await flushPromises();
    const confirm = wrapper
      .findAllComponents(ConfirmDialog)
      .find((c) => c.props("modelValue") === true)!;
    confirm.vm.$emit("update:cancel");
    await flushPromises();

    expect(mockSavedViewsPut).not.toHaveBeenCalled();
    expect(wrapper.vm.confirmOverwrite).toBe(false);
    expect(wrapper.vm.appliedSavedViewId).toBeNull();
  }, 20000);

  describe("applied check follows the live search", () => {
    const applyView = async () => {
      wrapper = mountSearchBar();
      await flushPromises();
      wrapper.vm.searchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      wrapper.vm.searchObj.data.stream.streamType = "logs";
      wrapper.vm.dateTimeRef = { setSavedDate: vi.fn() };
      mockGetViewDetail.mockResolvedValueOnce(detail());
      await wrapper.vm.applySavedView(logsView);
      await flushPromises();
      expect(wrapper.vm.appliedSavedViewId).toBe("l1");
      wrapper.vm.searchObj.shouldIgnoreWatcher = false;
    };

    it("keeps the check through the changes the apply itself makes", async () => {
      await applyView();
      wrapper.vm.searchObj.shouldIgnoreWatcher = true;
      wrapper.vm.searchObj.data.query = "select * from restored";
      await flushPromises();
      wrapper.vm.searchObj.shouldIgnoreWatcher = false;
      expect(wrapper.vm.appliedSavedViewId).toBe("l1");
    });

    it("clears when the query text is edited", async () => {
      await applyView();
      wrapper.vm.searchObj.data.query = "level = 'error'";
      await flushPromises();
      expect(wrapper.vm.appliedSavedViewId).toBeNull();
    });

    it("clears when the stream changes", async () => {
      await applyView();
      wrapper.vm.searchObj.data.stream.selectedStream = ["other"];
      await flushPromises();
      expect(wrapper.vm.appliedSavedViewId).toBeNull();
    });

    it("clears on Reset", async () => {
      await applyView();
      wrapper.vm.resetFilters();
      await flushPromises();
      expect(wrapper.vm.appliedSavedViewId).toBeNull();
    });
  });

  it("toggles a favourite from the submenu", async () => {
    wrapper = mountSearchBar();
    await flushPromises();

    wrapper.vm.handleFavoriteSavedView(logsView, false);
    await flushPromises();
    expect(wrapper.vm.favoriteViews).toEqual(["l1"]);
    expect(Object.keys(favorites())).toEqual(["l1"]);

    wrapper.vm.handleFavoriteSavedView(logsView, true);
    await flushPromises();
    expect(wrapper.vm.favoriteViews).toEqual([]);
    expect(favorites()).toEqual({});
  });

  it("a confirmed delete from the submenu drops the favourite", async () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView }));
    wrapper = mountSearchBar();
    await flushPromises();

    wrapper.vm.handleDeleteSavedView(logsView);
    await flushPromises();

    const confirm = wrapper
      .findAllComponents(ConfirmDialog)
      .find((c) => c.props("modelValue") === true)!;
    expect(confirm.props("title")).toBe(i18n.global.t("search.deleteSavedView"));
    expect(confirm.props()).toMatchObject({
      messageKeypath: "search.deleteSavedViewConfirm",
      messageName: "error logs",
      okVariant: "destructive",
    });
    expect(mockSavedViewsDelete).not.toHaveBeenCalled();

    confirm.vm.$emit("update:ok");
    await flushPromises();

    expect(mockSavedViewsDelete).toHaveBeenCalledWith("default", "l1");
    expect(wrapper.vm.favoriteViews).toEqual([]);
    expect(favorites()).toEqual({});
  }, 20000);

  it("clears the applied check when the applied view is deleted", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.appliedSavedViewId = "l1";
    wrapper.vm.deleteViewID = "l1";

    wrapper.vm.deleteSavedViews();
    await flushPromises();

    expect(wrapper.vm.appliedSavedViewId).toBeNull();
  }, 20000);

  it("keeps the applied check when another view is deleted", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.appliedSavedViewId = "l2";
    wrapper.vm.deleteViewID = "l1";

    wrapper.vm.deleteSavedViews();
    await flushPromises();

    expect(wrapper.vm.appliedSavedViewId).toBe("l2");
  }, 20000);

  it("closes both saved-views menus and queues the right view for delete", async () => {
    wrapper = mountSearchBar();
    await flushPromises();
    wrapper.vm.utilitiesMenuOpen = true;
    wrapper.vm.savedViewsDropdownOpen = true;

    wrapper.vm.handleDeleteSavedView(logsView2);
    await flushPromises();

    expect(wrapper.vm.utilitiesMenuOpen).toBe(false);
    expect(wrapper.vm.savedViewsDropdownOpen).toBe(false);
    expect(wrapper.vm.deleteViewID).toBe("l2");
    expect(wrapper.vm.deleteViewName).toBe("slow requests");
  });

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
    expect(wrapper.vm.favoriteViews).toHaveLength(10);

    wrapper.vm.onUtilitiesMenuOpenChange(true);
    await flushPromises();

    expect(mockSavedViewsGet).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.favoriteViews).toEqual(["l1"]);
    expect(Object.keys(favorites())).toEqual(["t1", "l1"]);

    wrapper.vm.handleFavoriteSavedView(logsView2, false);
    await flushPromises();
    expect(wrapper.vm.favoriteViews).toEqual(["l1", "l2"]);
  });

  it("keeps every favourite when the list fails to load", async () => {
    mockSavedViewsGet.mockRejectedValue(new Error("boom"));
    const gone = { ...logsView, view_id: "gone" };
    localStorage.setItem("savedViews", JSON.stringify({ l1: logsView, gone }));
    wrapper = mountSearchBar();
    wrapper.vm.searchObj.data.savedViews = [];
    await flushPromises();

    wrapper.vm.onUtilitiesMenuOpenChange(true);
    await flushPromises();

    expect(mockSavedViewsGet).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.searchObj.loadingSavedView).toBeFalsy();
    expect(wrapper.vm.searchObj.data.savedViews).toEqual([]);
    expect(wrapper.vm.favoriteViews).toEqual(["l1", "gone"]);
    expect(favorites()).toEqual({ l1: logsView, gone });
  });
});
