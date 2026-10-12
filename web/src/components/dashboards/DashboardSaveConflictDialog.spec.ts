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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DialogPortal: actual.DialogContent };
});

const service = vi.hoisted(() => ({
  get_Dashboard: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/services/dashboards", () => ({ default: service }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/dashboard/usePanelCache", () => ({
  dropPanelCache: vi.fn(),
  dropDashboardPanelCache: vi.fn(),
}));

import DashboardSaveConflictDialog from "./DashboardSaveConflictDialog.vue";
import { getDashboard } from "@/utils/commons";
import { openDashboardConflict } from "@/composables/dashboard/useDashboardSaveConflict";
import { dashboardSaveConflictState as state } from "@/composables/dashboard/dashboardSaveConflictState";

const panel = (id: string, title: string, y = 0) => ({
  id,
  title,
  type: "line",
  queries: [],
  layout: { x: 0, y, w: 96, h: 18, i: y + 1 },
});

const doc = (panels: any[], extra: Record<string, any> = {}) => ({
  version: 8,
  dashboardId: "d1",
  title: "Ops overview",
  description: "",
  tabs: [{ tabId: "default", name: "Overview", panels }],
  variables: { showDynamicFilters: false, list: [] },
  ...extra,
});

const response = (dashboard: any, hash: string) => ({
  data: { version: 8, hash, updatedAt: Date.now() * 1000 - 240_000_000, v8: dashboard },
});

const makeStore = () => {
  const store: any = {
    state: {
      selectedOrganization: { identifier: "acme" },
      userInfo: { name: "me" },
      organizationData: { allDashboardData: {}, allDashboardListHash: {}, allDashboardList: {} },
    },
    dispatch: vi.fn((action: string, payload: any) => {
      const od = store.state.organizationData;
      if (action === "setDashboardData") od.allDashboardData = payload;
      if (action === "setAllDashboardListHash") od.allDashboardListHash = payload;
    }),
  };
  return store;
};

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);

const BASE = () => doc([panel("p1", "Error rate"), panel("p2", "Latency", 18)]);
const LATEST = () => doc([panel("p1", "Error rate"), panel("p3", "Disk usage", 18)]);

const openConflict = async (
  panelId?: string,
  opts: { latest?: any; mine?: any; change?: string; wait?: boolean } = {},
) => {
  const store = makeStore();
  service.get_Dashboard.mockResolvedValueOnce(response(BASE(), "h1"));
  await getDashboard(store, "d1", "default");
  service.get_Dashboard.mockResolvedValueOnce(response(opts.latest ?? LATEST(), "h2"));
  const opened = openDashboardConflict(
    {
      dashboardId: "d1",
      folderId: "default",
      panelId,
      mine: opts.mine,
      change: opts.change ? raw(opts.change) : undefined,
    },
    { store, t: i18n.global.t as unknown as TranslateFn, locale: "en-US" },
  );
  if (opts.wait !== false) await opened;
  return opened;
};

describe("DashboardSaveConflictDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    service.list.mockResolvedValue({ data: { dashboards: [] } });
  });

  afterEach(() => {
    wrapper?.unmount();
    state.open = false;
  });

  const mountDialog = async () => {
    wrapper = mount(DashboardSaveConflictDialog, { global: { plugins: [i18n] } });
    await flushPromises();
  };

  it("shows when the other save happened and what it changed", async () => {
    await openConflict();
    await mountDialog();

    expect(byTest(wrapper, "dashboard-save-conflict-saved-by").text()).toMatch(
      /^Saved by someone else 4 minutes ago \(.+\)$/,
    );
    expect(byTest(wrapper, "dashboard-save-conflict-change-panel-added").text()).toContain(
      "Disk usage",
    );
    expect(byTest(wrapper, "dashboard-save-conflict-change-panel-removed").text()).toContain(
      "Latency",
    );
    expect(byTest(wrapper, "dashboard-save-conflict-chip-added").text()).toBe("1 panel added");
  });

  it("defaults to Reload outside the panel editor and has no Merge", async () => {
    await openConflict();
    await mountDialog();

    expect(byTest(wrapper, "dashboard-save-conflict-merge").exists()).toBe(false);
    const buttons = wrapper.findAll("button[data-test^='dashboard-save-conflict-']");
    expect(buttons.at(-1)?.attributes("data-test")).toBe("dashboard-save-conflict-reload");
  });

  it("offers only Reload and Overwrite when they also changed my panel, with Reload highlighted", async () => {
    const latest = doc([panel("p1", "Errors (theirs)"), panel("p2", "Latency", 18)]);
    const mine = doc([panel("p1", "Errors (mine)"), panel("p2", "Latency", 18)]);
    await openConflict("p1", { latest, mine });
    await mountDialog();

    expect(byTest(wrapper, "dashboard-save-conflict-panel-touched").exists()).toBe(true);
    expect(byTest(wrapper, "dashboard-save-conflict-panel-compare").exists()).toBe(true);
    expect(byTest(wrapper, "dashboard-save-conflict-merge").exists()).toBe(false);
    const buttons = wrapper
      .findAll("button[data-test^='dashboard-save-conflict-']")
      .map((b) => b.attributes("data-test"));
    expect(buttons).toEqual([
      "dashboard-save-conflict-overwrite",
      "dashboard-save-conflict-reload",
    ]);
    expect(wrapper.text()).not.toContain("Save as copy");
  });

  it("defaults to Merge in the panel editor when my panel was untouched", async () => {
    await openConflict("p1");
    await mountDialog();

    expect(byTest(wrapper, "dashboard-save-conflict-panel-untouched").exists()).toBe(true);
    const buttons = wrapper.findAll("button[data-test^='dashboard-save-conflict-']");
    expect(buttons.at(-1)?.attributes("data-test")).toBe("dashboard-save-conflict-merge");
  });

  it("asks for a second click before Overwrite, listing what it removes", async () => {
    await openConflict();
    await mountDialog();

    await byTest(wrapper, "dashboard-save-conflict-overwrite").trigger("click");
    const confirm = byTest(wrapper, "dashboard-save-conflict-confirm");
    expect(confirm.text()).toContain("Overwrite removes 1 panel");
    expect(confirm.text()).toContain("Removes 1 panel that someone else added: Disk usage");
    expect(confirm.text()).toContain("Restores 1 panel they removed: Latency");
    expect(byTest(wrapper, "dashboard-save-conflict-confirm-overwrite").text()).toBe(
      "Remove and overwrite",
    );
    expect(service.save).not.toHaveBeenCalled();
  });
  it("shows my pending change under the time of their save", async () => {
    await openConflict(undefined, { change: 'Deleted panel "Latency"' });
    await mountDialog();
    expect(byTest(wrapper, "dashboard-save-conflict-my-change").text()).toBe(
      'Your unsaved change: Deleted panel "Latency"',
    );
  });

  it("keeps the time and the warning as separate sentences on the Overwrite confirm", async () => {
    await openConflict();
    await mountDialog();
    await byTest(wrapper, "dashboard-save-conflict-overwrite").trigger("click");
    expect(byTest(wrapper, "dashboard-save-conflict-confirm-saved-by").text()).toMatch(
      /^Saved by someone else 4 minutes ago \(.+\)$/,
    );
    expect(byTest(wrapper, "dashboard-save-conflict-confirm").text()).toContain(
      "This cannot be undone from here.",
    );
  });

  it("names the settings they changed and shows a tab rename as old to new", async () => {
    const latest = doc([panel("p1", "Error rate"), panel("p2", "Latency", 18)], {
      description: "Now with SLOs",
    });
    latest.tabs[0].name = "Overview (prod)";
    await openConflict(undefined, { latest });
    await mountDialog();
    expect(byTest(wrapper, "dashboard-save-conflict-change-settings-changed").text()).toContain(
      "description",
    );
    expect(byTest(wrapper, "dashboard-save-conflict-change-tab-changed").text()).toContain(
      "Overview (prod) (renamed from Overview)",
    );
  });

  it("shows their title against mine when they also edited my panel", async () => {
    const latest = doc([panel("p1", "Errors (theirs)"), panel("p2", "Latency", 18)]);
    const mine = doc([panel("p1", "Errors (mine)"), panel("p2", "Latency", 18)]);
    await openConflict("p1", { latest, mine });
    await mountDialog();
    expect(byTest(wrapper, "dashboard-save-conflict-compare-title-theirs").text()).toBe(
      "Errors (theirs)",
    );
    expect(byTest(wrapper, "dashboard-save-conflict-compare-title-yours").text()).toBe(
      "Errors (mine)",
    );
  });

  it("opens at once with a loading summary while the latest version is fetched", async () => {
    const store = makeStore();
    let resolveLatest!: (value: unknown) => void;
    service.get_Dashboard.mockReturnValueOnce(new Promise((r) => (resolveLatest = r)));
    const opened = openDashboardConflict(
      { dashboardId: "d1", folderId: "default" },
      { store, t: i18n.global.t as unknown as TranslateFn, locale: "en-US" },
    );
    await mountDialog();
    expect(byTest(wrapper, "dashboard-save-conflict-loading").exists()).toBe(true);
    resolveLatest(response(LATEST(), "h2"));
    await opened;
    await flushPromises();
    expect(byTest(wrapper, "dashboard-save-conflict-loading").exists()).toBe(false);
  });

  it("renders the notice that a save after closing was not applied", async () => {
    await openConflict();
    state.notice = "stillUnresolved";
    await mountDialog();
    expect(byTest(wrapper, "dashboard-save-conflict-still-unresolved").exists()).toBe(true);
  });
});
