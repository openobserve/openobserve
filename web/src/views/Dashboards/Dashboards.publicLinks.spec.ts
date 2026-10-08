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
import { shallowMount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory, type Router } from "vue-router";
import i18n from "@/locales";

vi.mock("@/utils/commons", () => ({
  deleteDashboardById: vi.fn(),
  deleteFolderById: vi.fn(),
  evictDashboardsFromCache: vi.fn(),
  getAllDashboards: vi.fn().mockResolvedValue([]),
  getAllDashboardsByFolderId: vi.fn().mockResolvedValue([]),
  loadDashboardsByFolderId: vi.fn().mockResolvedValue(undefined),
  getDashboard: vi.fn().mockResolvedValue({}),
  getFoldersList: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getSetting: vi.fn().mockResolvedValue({ data: null }),
      setOrgSetting: vi.fn().mockResolvedValue({}),
      setUserSetting: vi.fn().mockResolvedValue({}),
    },
  });
});
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showPositiveNotification: vi.fn(), showErrorNotification: vi.fn() }),
}));

import * as commons from "@/utils/commons";
import Dashboards from "./Dashboards.vue";

const buildStore = (enabled: boolean) =>
  createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      userInfo: { name: "Test User" },
      zoConfig: { public_dashboards_enabled: enabled },
      timezone: "UTC",
      organizationData: {
        folders: [{ folderId: "default", name: "Default" }],
        foldersByType: { dashboards: [{ folderId: "default", name: "Default" }] },
        allDashboardList: { default: [] },
      },
    },
  });

const buildRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/dashboards", component: { template: "<div />" } },
      { path: "/dashboards/import", component: { template: "<div />" } },
    ],
  });

const mountAt = async (router: Router, enabled: boolean) => {
  await router.push({ path: "/dashboards", query: { folder: "__public_links__" } });
  const store = buildStore(enabled);
  const w = shallowMount(Dashboards, {
    global: {
      plugins: [store, router, i18n],
      provide: { store },
      stubs: {
        OPageLayout: { template: "<div><slot name='actions' /><slot /></div>" },
        OTable: { name: "OTable", template: "<div data-test='dashboard-table' />" },
        PublicLinksTable: { name: "PublicLinksTable", template: "<div />" },
        FolderList: { name: "FolderList", props: ["showPublicLinks"], template: "<div />" },
      },
    },
  });
  await flushPromises();
  return w;
};

describe("Dashboards.vue public links view", () => {
  let wrapper: VueWrapper | undefined;
  let router: Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = buildRouter();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("renders the org-wide list for the pseudo-folder and never fetches it as a folder", async () => {
    wrapper = await mountAt(router, true);

    expect(wrapper.findComponent({ name: "FolderList" }).props("showPublicLinks")).toBe(true);
    expect(wrapper.findComponent({ name: "PublicLinksTable" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(false);
    expect(commons.loadDashboardsByFolderId).not.toHaveBeenCalled();
    expect(commons.getAllDashboardsByFolderId).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query.folder).toBe("__public_links__");
  });

  it("imports into the default folder while the pseudo-folder is active", async () => {
    wrapper = await mountAt(router, true);
    (wrapper.vm as unknown as { importDashboard: () => void }).importDashboard();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/dashboards/import");
    expect(router.currentRoute.value.query.folder).toBe("default");
  });

  it("hides the entry and lands on the default folder when the feature is off", async () => {
    wrapper = await mountAt(router, false);

    expect(wrapper.findComponent({ name: "FolderList" }).props("showPublicLinks")).toBe(false);
    expect(wrapper.findComponent({ name: "PublicLinksTable" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(true);
    expect(commons.loadDashboardsByFolderId).toHaveBeenCalledWith(
      expect.anything(),
      "default",
      expect.anything(),
    );
  });

  it("warns that deleting a dashboard deletes its public links while the feature is on", async () => {
    const message = (w: VueWrapper, id: string) =>
      w.findAll(`[data-test="${id}"]`)[0]?.attributes("message");
    wrapper = await mountAt(router, true);
    expect(message(wrapper, "dashboard-confirm-dialog")).toBe(
      "Are you sure you want to delete the dashboard? Its public links will stop working and be deleted.",
    );
    expect(message(wrapper, "dashboard-confirm-bulk-delete-dialog")).toContain(
      "Their public links will stop working and be deleted.",
    );
    wrapper.unmount();

    wrapper = await mountAt(router, false);
    expect(message(wrapper, "dashboard-confirm-dialog")).toBe(
      "Are you sure you want to delete the dashboard?",
    );
  });
});
