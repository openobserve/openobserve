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

// The list's right pane with the REAL offer banner and the REAL first-data card above the table; only the transports are faked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";

vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/commons")>()),
  getFoldersList: vi.fn().mockResolvedValue([]),
  getFoldersListByType: vi.fn().mockResolvedValue([]),
  getAllDashboards: vi.fn().mockResolvedValue([]),
  getAllDashboardsByFolderId: vi.fn().mockResolvedValue([]),
  loadDashboardsByFolderId: vi.fn(async (_store, _folder, { apply, loading }) => {
    apply([]);
    loading.value = false;
  }),
}));
const { getStreams } = vi.hoisted(() => ({ getStreams: vi.fn() }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams }) }));
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: () => ({
    state: ref("waiting"),
    result: ref(),
    diagnosis: ref(),
    startedAtMs: ref(Date.now()),
    troubleshooting: ref(false),
    start: vi.fn(),
    stop: vi.fn(),
    probeNow: vi.fn(),
    troubleshoot: vi.fn(),
    scope: computed(() => "new-data"),
    sinceUs: computed(() => undefined),
  }),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(() => vi.fn()) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

import dashboards from "@/services/dashboards";
import settings from "@/services/settings";
import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import { resetReadyMadeSessionMemory } from "@/composables/readyMade/readyMadeSettings";
import Dashboards from "./Dashboards.vue";

const ORG = "org1";
const POSTGRES_STREAMS = ["postgresql_backends", "postgresql_commits"];

const dashboardsSvc = dashboards as unknown as Record<string, ReturnType<typeof vi.fn>>;
const settingsSvc = settings as unknown as Record<string, ReturnType<typeof vi.fn>>;

const makeStore = (ingested: boolean) =>
  createStore({
    state: {
      API_ENDPOINT: "https://api.openobserve.ai",
      zoConfig: { restricted_routes_on_empty_data: true },
      timezone: "UTC",
      theme: "light",
      userInfo: { email: "me@x.io", name: "Me" },
      selectedOrganization: { identifier: ORG, label: "Org one" },
      organizations: [],
      organizationData: {
        isDataIngested: ingested,
        folders: [{ folderId: "default", name: "Default" }],
        foldersByType: {},
        allDashboardList: { default: [] },
        organizationPasscode: "passcode",
        organizationPasscodeForbidden: false,
        orgTokens: [],
      },
    },
    mutations: {
      setIsDataIngested(state: any, payload: boolean) {
        state.organizationData.isDataIngested = payload;
      },
    },
    actions: {
      setIsDataIngested({ commit }, payload: boolean) {
        commit("setIsDataIngested", payload);
      },
    },
  });

const slotStub = (name: string, slots: string[]) => ({
  name,
  template: `<div>${slots.map((slot) => `<slot name="${slot}" />`).join("")}</div>`,
});

describe("Dashboards — what sits above the table", () => {
  let wrapper: VueWrapper<any>;

  const mountList = async (opts: { ingested: boolean; metrics: string[] }) => {
    getStreams.mockImplementation(async (type: string) => ({
      list: (type === "metrics" ? opts.metrics : []).map((name) => ({ name })),
    }));
    // The lists MainLayout fetched for an org without data, which the first-data card waits on.
    if (!opts.ingested) {
      for (const type of ["logs", "metrics", "traces"]) {
        queryClient.setQueryData(streamKeys.nameList(ORG, type), []);
      }
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/dashboards", name: "dashboards", component: { template: "<div />" } },
        { path: "/dashboards/view", component: { template: "<div />" } },
      ],
    });
    await router.push({ path: "/dashboards", query: { folder: "default" } });
    await router.isReady();
    const mounted = mount(Dashboards, {
      global: {
        plugins: [makeStore(opts.ingested), router, i18n],
        stubs: {
          OPageLayout: slotStub("OPageLayout", ["actions", "actions-overflow", "default"]),
          OTable: { name: "OTable", template: "<div />" },
          FolderList: true,
          ODropdown: true,
          AddDashboardFromGitHub: true,
          MoveDashboardToAnotherFolder: true,
          ConfirmDialog: true,
        },
      },
      attachTo: document.body,
    });
    for (let i = 0; i < 6; i += 1) {
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return mounted;
  };

  const table = () => wrapper.find('[data-test="dashboard-table"]');
  const column = () => table().element.parentElement as HTMLElement;
  const banner = () => wrapper.find('[data-test="dashboards-ready-made-offers"]');
  const firstData = () => wrapper.find('[data-test="dashboards-first-data"]');
  /** The column's rendered children in order; a hidden block takes no room, so it is left out. */
  const stack = () =>
    Array.from(column().children)
      .filter((child) => (child as HTMLElement).style.display !== "none")
      .map((child) => child.getAttribute("data-test"));

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    resetReadyMadeSessionMemory();
    window.localStorage.clear();
    dashboardsSvc.list.mockResolvedValue({ data: { dashboards: [] } });
    settingsSvc.getSetting.mockResolvedValue({ data: null });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("neither: the table is the column's only visible child", async () => {
    wrapper = await mountList({ ingested: true, metrics: [] });
    expect(banner().exists()).toBe(false);
    expect(wrapper.find('[data-test="first-data-panel"]').exists()).toBe(false);
    expect(stack()).toEqual(["dashboard-table"]);
  });

  it("the offer banner alone sits above the table", async () => {
    wrapper = await mountList({ ingested: true, metrics: POSTGRES_STREAMS });
    expect(wrapper.find('[data-test="dashboards-ready-made-banner"]').exists()).toBe(true);
    expect(stack()).toEqual(["dashboards-ready-made-offers", "dashboard-table"]);
  });

  it("the first-data card alone sits above the table", async () => {
    wrapper = await mountList({ ingested: false, metrics: [] });
    expect(wrapper.find('[data-test="first-data-panel"]').exists()).toBe(true);
    expect(banner().exists()).toBe(false);
    expect(stack()).toEqual(["dashboards-first-data", "dashboard-table"]);
  });

  it("both stack in one column: banner, first-data card, then the table", async () => {
    // Unreachable through the real stream list (it flips isDataIngested as it finds a stream); forced here to pin the order.
    wrapper = await mountList({ ingested: false, metrics: POSTGRES_STREAMS });
    expect(stack()).toEqual([
      "dashboards-ready-made-offers",
      "dashboards-first-data",
      "dashboard-table",
    ]);
  });

  it("only the table takes the height the blocks above it leave", async () => {
    wrapper = await mountList({ ingested: false, metrics: POSTGRES_STREAMS });
    expect(column().classList.contains("flex")).toBe(true);
    expect(column().classList.contains("flex-col")).toBe(true);
    expect(column().classList.contains("h-full")).toBe(true);
    for (const block of [banner(), firstData()]) {
      expect(block.classes()).toContain("shrink-0");
      expect(block.classes()).not.toContain("flex-1");
    }
    expect(table().classes()).toEqual(expect.arrayContaining(["min-h-0", "flex-1"]));
  });

  it("the closed checklist dialog adds nothing to the column", async () => {
    wrapper = await mountList({ ingested: true, metrics: POSTGRES_STREAMS });
    expect(column().children).toHaveLength(3);
    expect(column().querySelector('[data-test="dashboards-ready-made-dialog"]')).toBeNull();
  });
});
