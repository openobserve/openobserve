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
  getFoldersListByType: vi.fn().mockResolvedValue(undefined),
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

import Dashboards from "./Dashboards.vue";
import { loadDashboardsByFolderId } from "@/utils/commons";

const PUBLIC_ID = "__public_links__";

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
    routes: [{ path: "/dashboards", name: "dashboards", component: { template: "<div />" } }],
  });

const mountAt = async (
  router: Router,
  enabled: boolean,
  { folder = "default", realRail = false }: { folder?: string; realRail?: boolean } = {},
) => {
  await router.push({ path: "/dashboards", query: { folder } });
  const store = buildStore(enabled);
  const w = shallowMount(Dashboards, {
    global: {
      plugins: [store, router, i18n],
      provide: { store },
      stubs: {
        OPageLayout: {
          template: "<div><slot name='actions' /><slot name='actions-overflow' /><slot /></div>",
        },
        OButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
        OTable: { name: "OTable", template: "<div data-test='dashboard-table' />" },
        PublicLinksTable: { template: "<div data-test='dashboards-public-links' />" },
        ...(realRail ? { FolderList: false } : {}),
      },
    },
  });
  await flushPromises();
  return w;
};

const rail = (w: VueWrapper) => w.findComponent({ name: "FolderList" });
const pick = async (w: VueWrapper, folderId: string) => {
  rail(w).vm.$emit("update:activeFolderId", folderId);
  await flushPromises();
};

describe("Dashboards.vue public links entry", () => {
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

  it("offers the entry in the folder rail, not the header, while the feature is on", async () => {
    wrapper = await mountAt(router, true);
    expect(rail(wrapper).props("showPublicDashboards")).toBe(true);
    expect(wrapper.find('[data-test="dashboard-public-links"]').exists()).toBe(false);
  });

  it("leaves the rail without the entry when the feature is off", async () => {
    wrapper = await mountAt(router, false);
    expect(rail(wrapper).props("showPublicDashboards")).toBe(false);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(true);
  });

  it("swaps the dashboards table for the public links table when the entry is picked", async () => {
    wrapper = await mountAt(router, true);
    vi.mocked(loadDashboardsByFolderId).mockClear();
    await pick(wrapper, PUBLIC_ID);

    expect(wrapper.find('[data-test="dashboards-public-links"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboards-first-data"]').exists()).toBe(false);
    expect(router.currentRoute.value.query.folder).toBe(PUBLIC_ID);
    expect(loadDashboardsByFolderId).not.toHaveBeenCalled();

    await pick(wrapper, "default");
    expect(wrapper.find('[data-test="dashboards-public-links"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(true);
    expect(router.currentRoute.value.query.folder).toBe("default");
  });

  it("opens the public links table from ?folder on load, without a folder fetch", async () => {
    wrapper = await mountAt(router, true, { folder: PUBLIC_ID });

    expect(wrapper.find('[data-test="dashboards-public-links"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(false);
    expect(loadDashboardsByFolderId).not.toHaveBeenCalledWith(
      expect.anything(),
      PUBLIC_ID,
      expect.anything(),
    );
  });

  it("falls back to the Default folder when ?folder names the entry but the feature is off", async () => {
    wrapper = await mountAt(router, false, { folder: PUBLIC_ID });

    expect(wrapper.find('[data-test="dashboards-public-links"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="dashboard-table"]').exists()).toBe(true);
    expect(router.currentRoute.value.query.folder).toBe("default");
  });

  it("follows the real rail: its entry renders and selecting it shows the public links", async () => {
    wrapper = await mountAt(router, true, { realRail: true });
    const folderList = rail(wrapper);
    expect((folderList.vm as any).filteredTabs.map((t: any) => t.folderId)).toContain(PUBLIC_ID);

    (folderList.vm as any).activeFolderId = PUBLIC_ID;
    await flushPromises();

    expect(wrapper.find('[data-test="dashboards-public-links"]').exists()).toBe(true);
    expect(router.currentRoute.value.query.folder).toBe(PUBLIC_ID);
  });

  it("warns that deleting a dashboard deletes its public links while the feature is on", async () => {
    const prop = (w: VueWrapper, id: string, name: string) =>
      w
        .findAllComponents({ name: "ConfirmDialog" })
        .find((c) => c.attributes("data-test") === id)
        ?.props(name);
    wrapper = await mountAt(router, true);
    expect(prop(wrapper, "dashboard-confirm-dialog", "messageKeypath")).toBe(
      "dashboard.deleteDashboardConfirmMsgPublicLinks",
    );
    expect(i18n.global.t("dashboard.deleteDashboardConfirmMsgPublicLinks", { name: "cpu" })).toBe(
      "Are you sure you want to delete the cpu dashboard? Its public links will stop working and be deleted.",
    );
    expect(prop(wrapper, "dashboard-confirm-bulk-delete-dialog", "message")).toContain(
      "Their public links will stop working and be deleted.",
    );
    wrapper.unmount();

    wrapper = await mountAt(router, false);
    expect(prop(wrapper, "dashboard-confirm-dialog", "messageKeypath")).toBe(
      "dashboard.deleteDashboardConfirmMsg",
    );
  });
});
