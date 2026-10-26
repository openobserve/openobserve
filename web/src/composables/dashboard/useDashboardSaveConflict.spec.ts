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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, effectScope, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";

const service = vi.hoisted(() => ({
  get_Dashboard: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/services/dashboards", () => ({ default: service }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
const dialogModuleLoaded = vi.hoisted(() => vi.fn());
vi.mock("@/components/dashboards/DashboardSaveConflictDialog.vue", () => {
  dialogModuleLoaded();
  return { default: {} };
});
vi.mock("@/composables/dashboard/usePanelCache", () => ({
  dropPanelCache: vi.fn(),
  dropDashboardPanelCache: vi.fn(),
}));

import {
  addTab,
  deletePanel,
  getDashboard,
  setUnresolvedDashboardConflict,
  updateDashboard,
  updatePanel,
} from "@/utils/commons";
import {
  onDashboardConflictResolved,
  openDashboardConflict,
  useDashboardSaveConflict,
  useDashboardSaveConflictDialog,
} from "./useDashboardSaveConflict";
import { dashboardSaveConflictState as state } from "./dashboardSaveConflictState";
import * as commons from "@/utils/commons";

const DASH = "d1";
const FOLDER = "default";

const panel = (id: string, title: string, y = 0) => ({
  id,
  title,
  type: "line",
  queries: [],
  layout: { x: 0, y, w: 96, h: 18, i: y + 1 },
});

const doc = (panels: any[], extraVars: any[] = []) => ({
  version: 8,
  dashboardId: DASH,
  title: "Ops overview",
  description: "",
  tabs: [{ tabId: "default", name: "Overview", panels }],
  variables: { showDynamicFilters: false, list: [{ name: "env" }, ...extraVars] },
});

const response = (dashboard: any, hash: string, updatedAt = 1_760_000_000_000_000) => ({
  data: { version: 8, hash, updatedAt, v8: JSON.parse(JSON.stringify(dashboard)) },
});

const conflict = () => Object.assign(new Error("conflict"), { response: { status: 409 } });

const makeStore = () => {
  const store: any = {
    state: {
      selectedOrganization: { identifier: "acme" },
      userInfo: { name: "me" },
      zoConfig: { timestamp_column: "_timestamp" },
      organizationData: { allDashboardData: {}, allDashboardListHash: {}, allDashboardList: {} },
    },
    dispatch: vi.fn((action: string, payload: any) => {
      const od = store.state.organizationData;
      if (action === "setDashboardData") od.allDashboardData = payload;
      if (action === "setAllDashboardListHash") od.allDashboardListHash = payload;
      if (action === "setAllDashboardList") od.allDashboardList = payload;
    }),
  };
  return store;
};

const BASE = doc([panel("p1", "Error rate"), panel("p2", "Latency", 18)]);
const LATEST = doc(
  [panel("p1", "Error rate"), { ...panel("p2", "Latency p99", 18) }, panel("p3", "Disk usage", 36)],
  [{ name: "region" }],
);

const MY_CHANGE = raw('Edited panel "Error rate"');

let store: any;
const t = i18n.global.t as unknown as TranslateFn;
const dialog = useDashboardSaveConflictDialog();

const savedBodies = () => service.save.mock.calls.map((c) => ({ body: c[2], hash: c[4] }));

// Loads BASE, edits panel p1 through the real helper, and lets the save fail with 409.
const editPanelAndConflict = async (onResolved = vi.fn()) => {
  service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
  await getDashboard(store, DASH, FOLDER);
  service.save.mockRejectedValueOnce(conflict());
  await expect(
    updatePanel(
      store,
      DASH,
      { ...panel("p1", "Error rate"), queries: [{ q: "mine" }] },
      FOLDER,
      "default",
    ),
  ).rejects.toBeTruthy();
  const staleObject = store.state.organizationData.allDashboardData[DASH];
  service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
  await openDashboardConflict(
    { dashboardId: DASH, folderId: FOLDER, panelId: "p1", change: MY_CHANGE, onResolved },
    { store, t, locale: "en-US" },
  );
  return { staleObject, onResolved };
};

beforeEach(() => {
  vi.clearAllMocks();
  service.list.mockResolvedValue({ data: { dashboards: [] } });
  service.save.mockResolvedValue({ data: {} });
  store = makeStore();
  state.open = false;
  setUnresolvedDashboardConflict(DASH, null);
});

describe("openDashboardConflict", () => {
  it("re-fetches once, keeps my working copy in the cache and lists what they changed", async () => {
    await editPanelAndConflict();

    expect(service.get_Dashboard).toHaveBeenCalledTimes(2);
    const cached = store.state.organizationData.allDashboardData[DASH];
    expect(cached.tabs[0].panels.map((p: any) => p.id)).toEqual(["p1", "p2"]);
    expect(cached.tabs[0].panels[0].queries).toEqual([{ q: "mine" }]);
    expect(store.state.organizationData.allDashboardListHash[DASH]).toBe("h1");
    expect(state).toMatchObject({ open: true, step: "main", panelTouched: false, hasMine: true });
    expect(state.latestUpdatedAt).toBe(1_760_000_000_000);
    expect(state.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "panel", change: "added", key: "p3" }),
        expect.objectContaining({ kind: "panel", change: "changed", key: "p2" }),
        expect.objectContaining({ kind: "variable", change: "added", key: "region" }),
      ]),
    );
  });

  it("flags when the other save also edited my panel", async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    await getDashboard(store, DASH, FOLDER);
    service.get_Dashboard.mockResolvedValueOnce(
      response(doc([panel("p1", "Errors (theirs)"), panel("p2", "Latency", 18)]), "h2"),
    );
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER, panelId: "p1" },
      { store, t, locale: "en-US" },
    );
    expect(state.panelTouched).toBe(true);
  });

  it("keeps a stale screen object on its own base hash, while fresh loads save on the latest", async () => {
    const { staleObject } = await editPanelAndConflict();
    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(LATEST, "h3"));

    await expect(updateDashboard(store, "acme", DASH, staleObject, FOLDER)).resolves.toBeTruthy();
    const fresh = await getDashboard(store, DASH, FOLDER);
    await updateDashboard(store, "acme", DASH, fresh, FOLDER);

    expect(savedBodies().map((s) => s.hash)).toEqual(["h1", "h3"]);
  });

  it("shows the load error and retries on request", async () => {
    service.get_Dashboard.mockRejectedValueOnce(new Error("offline"));
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER },
      { store, t, locale: "en-US" },
    );
    expect(state.step).toBe("error");

    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await dialog.retry();
    expect(state.step).toBe("main");
  });
});

describe("o2-enterprise#2875: closing the dialog and editing again", () => {
  const ctx = () => ({ store, t, locale: "en-US" });
  const open = (change: string) =>
    openDashboardConflict({ dashboardId: DASH, folderId: FOLDER, change: raw(change) }, ctx());
  const tabNames = (d: any) => d.tabs.map((tab: any) => tab.name);
  const panelTitles = (d: any) => d.tabs[0].panels.map((p: any) => p.title);

  it("deleting a second panel stacks on the first; Overwrite saves exactly {Disk} and claims no restore", async () => {
    const start = doc([panel("e", "Errors"), panel("l", "Latency", 18), panel("d", "Disk", 36)]);
    const afterB = doc([panel("e", "Errors"), panel("d", "Disk", 36)]);
    service.get_Dashboard.mockResolvedValueOnce(response(start, "h1"));
    await getDashboard(store, DASH, FOLDER);

    service.save.mockRejectedValueOnce(conflict());
    await expect(deletePanel(store, DASH, "e", FOLDER, "default")).rejects.toBeTruthy();
    service.get_Dashboard.mockResolvedValueOnce(response(afterB, "h2"));
    await open('Deleted panel "Errors"');

    const cached = () => store.state.organizationData.allDashboardData[DASH];
    expect(panelTitles(cached())).toEqual(["Latency", "Disk"]);
    expect(state.changes).toEqual([
      expect.objectContaining({ kind: "panel", change: "removed", name: "Latency" }),
    ]);
    dialog.close();

    service.save.mockRejectedValueOnce(conflict());
    await expect(deletePanel(store, DASH, "l", FOLDER, "default")).rejects.toBeTruthy();
    expect(savedBodies().at(-1)!.hash).toBe("h1");
    expect(panelTitles(cached())).toEqual(["Disk"]);
    service.get_Dashboard.mockResolvedValueOnce(response(afterB, "h2"));
    await open('Deleted panel "Latency"');

    expect(state).toMatchObject({ notice: "stillUnresolved", myChangeCount: 2 });
    expect(state.myChange).toBe('Deleted panel "Errors" and Deleted panel "Latency"');

    dialog.startOverwrite();
    expect(state.impact).toEqual({
      removes: [],
      deletesEdited: [],
      reverts: [],
      restores: [],
      settings: [],
    });

    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(doc([panel("d", "Disk", 36)]), "h3"));
    await dialog.confirmOverwrite();
    const [{ body, hash }] = savedBodies();
    expect(hash).toBe("h2");
    expect(panelTitles(body)).toEqual(["Disk"]);
  });

  it("adding a second tab stacks on the first; Overwrite saves both and says it replaces their description", async () => {
    const start = { ...doc([panel("p1", "Errors")]), description: "original" };
    start.tabs[0].name = "Overview";
    const afterB = { ...start, description: "changed by B" };
    service.get_Dashboard.mockResolvedValueOnce(response(start, "h1"));
    await getDashboard(store, DASH, FOLDER);

    service.save.mockRejectedValueOnce(conflict());
    await expect(addTab(store, DASH, FOLDER, { name: "TabA", panels: [] })).rejects.toBeTruthy();
    service.get_Dashboard.mockResolvedValueOnce(response(afterB, "h2"));
    await open("Added tab 'TabA'");
    expect(state.changedSettings).toEqual(["description"]);
    dialog.close();

    service.save.mockRejectedValueOnce(conflict());
    await expect(addTab(store, DASH, FOLDER, { name: "TabB", panels: [] })).rejects.toBeTruthy();
    service.get_Dashboard.mockResolvedValueOnce(response(afterB, "h2"));
    await open("Added tab 'TabB'");

    expect(state.myChange).toBe("Added tab 'TabA' and Added tab 'TabB'");

    dialog.startOverwrite();
    expect(state.impact).toMatchObject({ removes: [], restores: [], settings: ["description"] });

    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(afterB, "h3"));
    await dialog.confirmOverwrite();
    const [{ body, hash }] = savedBodies();
    expect(hash).toBe("h2");
    expect(tabNames(body)).toEqual(["Overview", "TabA", "TabB"]);
    expect(body.description).toBe("original");
  });

  it("Reload replaces the working copy with the latest and clears every pending change", async () => {
    await editPanelAndConflict();
    dialog.close();
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await open("second change");
    expect(state.myChangeCount).toBe(2);

    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await dialog.reload();

    const cached = store.state.organizationData.allDashboardData[DASH];
    expect(cached.tabs[0].panels.map((p: any) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(store.state.organizationData.allDashboardListHash[DASH]).toBe("h2");
    expect(state.unresolvedDashboardId).toBe("");

    service.save.mockRejectedValueOnce(conflict());
    await expect(updateDashboard(store, "acme", DASH, cached, FOLDER)).rejects.toBeTruthy();
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h3"));
    await open("fresh change");
    expect(state).toMatchObject({ notice: null, myChangeCount: 1, myChange: "fresh change" });
  });

  it("a save from its own copy (settings forms) becomes the working copy shown in place", async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    const cached = await getDashboard(store, DASH, FOLDER);
    const form = JSON.parse(JSON.stringify(cached));
    form.title = "Renamed by me";
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));

    await openDashboardConflict({ dashboardId: DASH, folderId: FOLDER, mine: form }, ctx());

    expect(store.state.organizationData.allDashboardData[DASH]).toBe(cached);
    expect(cached.title).toBe("Renamed by me");
  });
});

describe("regression pass on 093855bec9", () => {
  it("Resolve reopens without the 'not applied' notice, which belongs to a real save attempt", async () => {
    await editPanelAndConflict();
    dialog.close();
    service.save.mockRejectedValueOnce(conflict());
    await expect(
      updateDashboard(
        store,
        "acme",
        DASH,
        store.state.organizationData.allDashboardData[DASH],
        FOLDER,
      ),
    ).rejects.toBeTruthy();
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER },
      { store, t, locale: "en-US" },
    );
    expect(state.notice).toBe("stillUnresolved");
    dialog.close();

    const seq = state.openSeq;
    dialog.reopen();

    expect(state).toMatchObject({ open: true, step: "main", notice: null });
    expect(state.openSeq).toBe(seq + 1);
  });

  it("Reload shows its toast before the site reacts, so a page that navigates away still shows it", async () => {
    const { onResolved } = await editPanelAndConflict();
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));

    await dialog.reload();

    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      timeout: 15_000,
      message: `Loaded the latest version. Discarded your change: ${MY_CHANGE}`,
    });
    expect(toast.mock.invocationCallOrder[0]).toBeLessThan(onResolved.mock.invocationCallOrder[0]);
  });
});

describe("adoptDashboardWorkingCopy", () => {
  it("never copies a __proto__ key from parsed JSON onto the cached dashboard", async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    const target = await getDashboard(store, DASH, FOLDER);
    const prototypeBefore = Object.getPrototypeOf(target);

    commons.adoptDashboardWorkingCopy(
      store,
      DASH,
      JSON.parse('{"__proto__":{"polluted":1},"title":"x"}'),
    );

    expect(Object.getPrototypeOf(target)).toBe(prototypeBefore);
    expect(({} as any).polluted).toBeUndefined();
    expect((target as any).polluted).toBeUndefined();
    expect(target.title).toBe("x");
  });
});

describe("save helpers do nothing when the id is not found", () => {
  beforeEach(async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    await getDashboard(store, DASH, FOLDER);
    service.save.mockClear();
  });

  const titles = () =>
    store.state.organizationData.allDashboardData[DASH].tabs[0].panels.map((p: any) => p.id);

  it.each([
    ["deletePanel, unknown panel", () => deletePanel(store, DASH, "nope", FOLDER, "default")],
    ["deletePanel, unknown tab", () => deletePanel(store, DASH, "p1", FOLDER, "nope")],
    ["deleteTab, unknown tab", () => commons.deleteTab(store, DASH, FOLDER, "nope")],
    [
      "deleteTab, unknown target tab",
      () => commons.deleteTab(store, DASH, FOLDER, "default", "nope"),
    ],
    ["editTab, unknown tab", () => commons.editTab(store, DASH, FOLDER, "nope", { name: "x" })],
    [
      "movePanelToAnotherTab, unknown panel",
      () => commons.movePanelToAnotherTab(store, DASH, "nope", FOLDER, "default", "default"),
    ],
    [
      "movePanelToAnotherTab, unknown target tab",
      () => commons.movePanelToAnotherTab(store, DASH, "p1", FOLDER, "default", "nope"),
    ],
    ["deleteVariable, unknown name", () => commons.deleteVariable(store, DASH, "nope", FOLDER)],
    [
      "updateVariable, unknown name",
      () => commons.updateVariable(t, store, DASH, "nope", { name: "nope" }, FOLDER),
    ],
    ["addPanel, unknown tab", () => commons.addPanel(store, DASH, panel("n", "N"), FOLDER, "nope")],
  ])("%s", async (_label, call) => {
    const before = JSON.stringify(store.state.organizationData.allDashboardData[DASH]);
    await call();
    expect(service.save).not.toHaveBeenCalled();
    expect(JSON.stringify(store.state.organizationData.allDashboardData[DASH])).toBe(before);
    expect(titles()).toEqual(["p1", "p2"]);
  });

  it("updatePanel, unknown panel: rejects without saving or touching the copy", async () => {
    const before = JSON.stringify(store.state.organizationData.allDashboardData[DASH]);
    await expect(updatePanel(store, DASH, panel("nope", "x"), FOLDER, "default")).rejects.toThrow();
    expect(service.save).not.toHaveBeenCalled();
    expect(JSON.stringify(store.state.organizationData.allDashboardData[DASH])).toBe(before);
  });

  it("addPanel replaces a panel that is already pending instead of adding a twin", async () => {
    await commons.addPanel(
      store,
      DASH,
      { ...panel("p2", "Latency v2"), layout: undefined },
      FOLDER,
      "default",
    );
    const [{ body }] = savedBodies();
    expect(body.tabs[0].panels.map((p: any) => [p.id, p.title])).toEqual([
      ["p1", "Error rate"],
      ["p2", "Latency v2"],
    ]);
    expect(body.tabs[0].panels[1].layout).toEqual(panel("p2", "Latency", 18).layout);
  });
});

describe("fix round 2", () => {
  it("stamps every save with the time, since the server stores updatedAt as the client sends it", async () => {
    service.get_Dashboard.mockResolvedValue(response(BASE, "h1"));
    const cached = await getDashboard(store, DASH, FOLDER);
    const before = Date.now() * 1000;

    await updateDashboard(store, "acme", DASH, cached, FOLDER);

    const [{ body }] = savedBodies();
    expect(body.updatedAt).toBeGreaterThanOrEqual(before);
    expect(body.updatedAt).toBeLessThanOrEqual(Date.now() * 1000);
    expect(body.tabs).toEqual(BASE.tabs);
    expect(cached).not.toHaveProperty("updatedAt");
  });

  it("shows the time a stamped save carried back in the real GET shape", async () => {
    await editPanelAndConflict();
    expect(state.latestUpdatedAt).toBe(1_760_000_000_000);
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2", 0));
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER },
      { store, t, locale: "en-US" },
    );
    expect(state.latestUpdatedAt).toBeNull();
  });

  it("marks the dashboard not saved until the conflict is resolved, and can reopen the dialog", async () => {
    await editPanelAndConflict();
    expect(state.unresolvedDashboardId).toBe(DASH);

    dialog.close();
    expect(state.unresolvedDashboardId).toBe(DASH);
    dialog.reopen();
    expect(state).toMatchObject({ open: true, step: "main" });

    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await dialog.reload();
    expect(state.unresolvedDashboardId).toBe("");
  });

  it("drops the not-saved mark when the dashboard is loaded fresh", async () => {
    await editPanelAndConflict();
    store.state.organizationData.allDashboardData = {};
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await getDashboard(store, DASH, FOLDER);
    expect(state.unresolvedDashboardId).toBe("");
  });
});

describe("fix round 1", () => {
  it("fetches the dialog as soon as a save site mounts, so a conflict opens it at once", async () => {
    const Site = defineComponent({
      setup() {
        useDashboardSaveConflict();
        return () => h("div");
      },
    });
    mount(Site, { global: { plugins: [i18n], provide: { store: makeStore() } } });
    await flushPromises();
    expect(dialogModuleLoaded).toHaveBeenCalledTimes(1);
  });

  it("reads the other save's time from the camelCase updatedAt the server sends", async () => {
    await editPanelAndConflict();
    expect(state.latestUpdatedAt).toBe(1_760_000_000_000);
  });

  it("still reads a snake_case updated_at", async () => {
    service.get_Dashboard.mockResolvedValueOnce({
      data: { version: 8, hash: "h2", updated_at: 1_760_000_000_000_000, v8: LATEST },
    });
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER },
      { store, t, locale: "en-US" },
    );
    expect(state.latestUpdatedAt).toBe(1_760_000_000_000);
  });

  it("shows my pending change and names it when Reload discards it", async () => {
    await editPanelAndConflict();
    expect(state.myChange).toBe(MY_CHANGE);

    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await dialog.reload();
    expect(toast).toHaveBeenCalledWith({
      variant: "success",
      timeout: 15_000,
      message: `Loaded the latest version. Discarded your change: ${MY_CHANGE}`,
    });
  });

  it("a save after closing the dialog is not silent: it reopens the dialog against my original base", async () => {
    await editPanelAndConflict();
    dialog.close();
    service.save.mockClear();
    service.save.mockRejectedValueOnce(conflict());

    await expect(
      updatePanel(store, DASH, { ...panel("p1", "Error rate v2") }, FOLDER, "default"),
    ).rejects.toBeTruthy();
    expect(savedBodies()[0].hash).toBe("h1");

    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER, panelId: "p1" },
      { store, t, locale: "en-US" },
    );
    expect(state).toMatchObject({ open: true, notice: "stillUnresolved" });
    expect(state.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "p3", change: "added" })]),
    );
  });

  it("resolving clears the unresolved conflict so the next save uses the latest hash", async () => {
    await editPanelAndConflict();
    service.get_Dashboard.mockResolvedValue(response(LATEST, "h3"));
    dialog.startOverwrite();
    await dialog.confirmOverwrite();
    service.save.mockClear();

    await updateDashboard(store, "acme", DASH, await getDashboard(store, DASH, FOLDER), FOLDER);
    expect(savedBodies()[0].hash).toBe("h3");
  });

  it("compares their version of my panel with mine when they also edited it", async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    await getDashboard(store, DASH, FOLDER);
    service.get_Dashboard.mockResolvedValueOnce(
      response(doc([panel("p1", "Errors (theirs)"), panel("p2", "Latency", 18)]), "h2"),
    );
    await openDashboardConflict(
      {
        dashboardId: DASH,
        folderId: FOLDER,
        panelId: "p1",
        mine: doc([panel("p1", "Errors (mine)"), panel("p2", "Latency", 18)]),
      },
      { store, t, locale: "en-US" },
    );
    expect(state.panelComparison).toMatchObject({
      theirsTitle: "Errors (theirs)",
      mineTitle: "Errors (mine)",
      sameTitle: false,
    });
  });
});

describe("dialog actions", () => {
  it("Reload re-fetches in place, reports it and never reloads the page", async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadSpy });
    const scope = effectScope();
    const resolved = vi.fn();
    scope.run(() => onDashboardConflictResolved(resolved));
    const { onResolved } = await editPanelAndConflict();
    service.get_Dashboard.mockResolvedValueOnce(response(LATEST, "h2"));

    await dialog.reload();
    await nextTick();

    expect(service.get_Dashboard).toHaveBeenCalledTimes(3);
    expect(onResolved).toHaveBeenCalledWith("reloaded");
    expect(resolved).toHaveBeenCalledWith(DASH, "reloaded");
    expect(state.open).toBe(false);
    expect(reloadSpy).not.toHaveBeenCalled();
    scope.stop();
    vi.unstubAllGlobals();
  });

  it("Overwrite needs a confirm step, then saves my version against the latest hash", async () => {
    const { onResolved } = await editPanelAndConflict();
    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(LATEST, "h3"));

    dialog.startOverwrite();
    expect(state.step).toBe("confirm");
    await dialog.confirmOverwrite();

    const [{ body, hash }] = savedBodies();
    expect(hash).toBe("h2");
    expect(body.tabs[0].panels.map((p: any) => p.id)).toEqual(["p1", "p2"]);
    expect(body.tabs[0].panels[0].queries).toEqual([{ q: "mine" }]);
    expect(onResolved).toHaveBeenCalledWith("overwritten");
    expect(state.open).toBe(false);
  });

  it("a second 409 during an action reopens the dialog on the newer version", async () => {
    const { onResolved } = await editPanelAndConflict();
    service.save.mockRejectedValueOnce(conflict());
    service.get_Dashboard.mockResolvedValueOnce(
      response(doc([panel("p1", "Error rate"), panel("p4", "Queue", 18)]), "h3"),
    );

    dialog.startOverwrite();
    await dialog.confirmOverwrite();

    expect(onResolved).not.toHaveBeenCalled();
    expect(state).toMatchObject({ open: true, step: "main", notice: "savedAgain" });
    expect(state.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "p4", change: "added" })]),
    );

    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(LATEST, "h4"));
    dialog.startOverwrite();
    await dialog.confirmOverwrite();
    expect(savedBodies()[0].hash).toBe("h3");
  });

  it("Merge puts my panel on the latest version for review, then saves it", async () => {
    const { onResolved } = await editPanelAndConflict();
    service.save.mockClear();
    service.get_Dashboard.mockResolvedValue(response(LATEST, "h3"));

    dialog.merge();
    expect(state.step).toBe("review");
    expect(state.mergedRows).toEqual([
      { key: "p1", name: "Error rate", tag: "yours" },
      { key: "p2", name: "Latency p99", tag: "theirsEdited" },
      { key: "p3", name: "Disk usage", tag: "theirsNew" },
    ]);

    await dialog.saveMerged();
    const [{ body, hash }] = savedBodies();
    expect(hash).toBe("h2");
    expect(body.tabs[0].panels.map((p: any) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(body.tabs[0].panels[0].queries).toEqual([{ q: "mine" }]);
    expect(body.variables.list.map((v: any) => v.name)).toEqual(["env", "region"]);
    expect(onResolved).toHaveBeenCalledWith("merged");
  });

  it("Discarding a merge closes the dialog and keeps my edit unsaved", async () => {
    const { onResolved } = await editPanelAndConflict();
    dialog.merge();
    dialog.discardMerge();
    expect(state.open).toBe(false);
    expect(onResolved).not.toHaveBeenCalled();
    expect(service.save).toHaveBeenCalledTimes(1);
  });

  it("does not merge when their save also changed my panel", async () => {
    service.get_Dashboard.mockResolvedValueOnce(response(BASE, "h1"));
    await getDashboard(store, DASH, FOLDER);
    service.get_Dashboard.mockResolvedValueOnce(
      response(doc([panel("p1", "Errors (theirs)"), panel("p2", "Latency", 18)]), "h2"),
    );
    await openDashboardConflict(
      { dashboardId: DASH, folderId: FOLDER, panelId: "p1" },
      { store, t, locale: "en-US" },
    );
    expect(state.panelTouched).toBe(true);

    dialog.merge();

    expect(state.step).toBe("main");
    expect(state.mergedRows).toEqual([]);
  });

  it("closing keeps my edit and resolves nothing", async () => {
    const { onResolved } = await editPanelAndConflict();
    dialog.close();
    expect(state.open).toBe(false);
    expect(onResolved).not.toHaveBeenCalled();
  });
});
