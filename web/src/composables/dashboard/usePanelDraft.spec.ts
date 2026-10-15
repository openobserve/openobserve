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
import { nextTick, reactive } from "vue";

// jsdom ships no IndexedDB; this covers the request surface the draft store uses.
const installFakeIdb = () => {
  const records = new Map<string, any>();
  const request = (fn: () => any) => {
    const req: any = { onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (e) {
        req.error = e;
        req.onerror?.();
      }
    });
    return req;
  };
  const inRange = (key: string, range?: any) =>
    !range || (key >= range.lower && key <= range.upper);
  const store = {
    get: (key: string) => request(() => structuredClone(records.get(key))),
    put: (value: any) => request(() => records.set(value.key, structuredClone(value))),
    delete: (key: string) => request(() => records.delete(key)),
    getAll: (range?: any) =>
      request(() =>
        [...records.entries()]
          .filter(([key]) => inRange(key, range))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([, value]) => structuredClone(value)),
      ),
  };
  const db: any = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
    close: () => {},
  };
  vi.stubGlobal("indexedDB", {
    open: () => request(() => db),
  });
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: string, upper: string) => ({ lower, upper }),
  });
  return { records, db };
};

const loadModule = async () => {
  vi.resetModules();
  return import("./usePanelDraft");
};

const scope = { userId: "a@b.c", org: "org1", dashboardId: "dash1" };

const panel = (title: string, extra: Record<string, unknown> = {}) => ({
  id: "p1",
  title,
  type: "line",
  queries: [{ query: "SELECT 1" }],
  layout: { x: 0, y: 0, w: 48, h: 9, i: 1 },
  ...extra,
});

describe("usePanelDraft storage", () => {
  let fake: ReturnType<typeof installFakeIdb>;

  beforeEach(() => {
    fake = installFakeIdb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports storage unavailable when IndexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const mod = await loadModule();
    expect(await mod.isPanelDraftStorageAvailable()).toBe(false);
  });

  it("saves and reads back an edited-panel draft with plain data", async () => {
    const mod = await loadModule();
    expect(await mod.isPanelDraftStorageAvailable()).toBe(true);

    const data = reactive(panel("Edited"));
    const saved = await mod.savePanelDraft({
      ...scope,
      folder: "default",
      tab: "t1",
      panelId: "p1",
      base: panel("Server"),
      data,
    });

    expect(saved.isNew).toBe(false);
    expect(saved.key).toBe("a@b.c|org1|dash1|p:p1");
    const read = await mod.getPanelDraft(scope, { panelId: "p1" });
    expect(read?.data.title).toBe("Edited");
    expect(read?.base).toEqual(panel("Server"));
  });

  it("keys new-panel drafts by draftId and marks them new", async () => {
    const mod = await loadModule();
    const saved = await mod.savePanelDraft({
      ...scope,
      folder: "default",
      tab: "t1",
      draftId: "d-1",
      base: null,
      data: panel("New"),
    });
    expect(saved.isNew).toBe(true);
    expect(saved.panelId).toBeNull();
    expect((await mod.getPanelDraft(scope, { draftId: "d-1" }))?.data.title).toBe("New");
  });

  it("keys a second copy of an edited panel by its draftId", async () => {
    const mod = await loadModule();
    const saved = await mod.savePanelDraft({
      ...scope,
      folder: "default",
      tab: "t1",
      panelId: "p1",
      draftId: "copy",
      base: panel("Server"),
      data: panel("Copy"),
    });
    expect(saved.key).toBe("a@b.c|org1|dash1|d:copy");
    expect(saved.isNew).toBe(false);
    expect(saved.panelId).toBe("p1");
  });

  it("refuses a draft with neither panelId nor draftId", async () => {
    const mod = await loadModule();
    await expect(
      mod.savePanelDraft({ ...scope, folder: "f", tab: "t", base: null, data: {} }),
    ).rejects.toThrow();
  });

  it("lists only this user's drafts on this dashboard, newest first", async () => {
    const mod = await loadModule();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const base = { folder: "f", tab: "t1", base: null, data: panel("x") };
    await mod.savePanelDraft({ ...scope, ...base, panelId: "old" });
    vi.setSystemTime(2_000);
    await mod.savePanelDraft({ ...scope, ...base, draftId: "newer" });
    await mod.savePanelDraft({ ...scope, userId: "other@b.c", ...base, panelId: "p9" });
    await mod.savePanelDraft({ ...scope, dashboardId: "dash2", ...base, panelId: "p8" });

    const list = await mod.listPanelDrafts(scope);
    expect(list.map((r) => r.panelId ?? r.draftId)).toEqual(["newer", "old"]);
  });

  it("drops drafts older than seven days on read and on prune", async () => {
    const mod = await loadModule();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const base = { folder: "f", tab: "t1", base: null, data: panel("x") };
    await mod.savePanelDraft({ ...scope, ...base, panelId: "p1" });
    await mod.savePanelDraft({ ...scope, ...base, panelId: "p2" });
    vi.setSystemTime(mod.PANEL_DRAFT_TTL_MS + 1);
    await mod.savePanelDraft({ ...scope, ...base, panelId: "fresh" });

    expect(await mod.getPanelDraft(scope, { panelId: "p1" })).toBeUndefined();
    expect(await mod.prunePanelDrafts()).toBe(1);
    expect([...fake.records.keys()]).toEqual(["a@b.c|org1|dash1|p:fresh"]);
  });

  it("deletes a draft and bumps the revision", async () => {
    const mod = await loadModule();
    await mod.savePanelDraft({
      ...scope,
      folder: "f",
      tab: "t1",
      panelId: "p1",
      base: null,
      data: panel("x"),
    });
    const before = mod.panelDraftsRevision.value;
    await mod.deletePanelDraft(scope, { panelId: "p1" });
    expect(mod.panelDraftsRevision.value).toBe(before + 1);
    expect(await mod.getPanelDraft(scope, { panelId: "p1" })).toBeUndefined();
  });
});

describe("panel draft status", () => {
  afterEach(() => vi.unstubAllGlobals());

  const record = (overrides: Record<string, unknown> = {}) =>
    ({
      key: "k",
      ...scope,
      folder: "f",
      tab: "t1",
      panelId: "p1",
      draftId: null,
      isNew: false,
      base: panel("Server"),
      data: panel("Draft"),
      variables: [],
      variablesWithCurrentPanel: [],
      updatedAt: 0,
      ...overrides,
    }) as any;

  it("is edited when the server panel still matches the base, ignoring layout moves", async () => {
    const mod = await loadModule();
    const dashboard = {
      tabs: [{ tabId: "t1", panels: [panel("Server", { layout: { x: 9, y: 9, w: 1, h: 1 } })] }],
    };
    expect(mod.panelDraftStatus(record(), dashboard)).toEqual({ status: "edited", tabId: "t1" });
  });

  it("is stale when someone else changed the panel", async () => {
    const mod = await loadModule();
    const dashboard = { tabs: [{ tabId: "t1", panels: [panel("Renamed by a teammate")] }] };
    expect(mod.panelDraftStatus(record(), dashboard).status).toBe("stale");
  });

  it("follows a panel moved to another tab", async () => {
    const mod = await loadModule();
    const dashboard = {
      tabs: [
        { tabId: "t1", panels: [] },
        { tabId: "t2", panels: [panel("Server")] },
      ],
    };
    expect(mod.panelDraftStatus(record(), dashboard)).toEqual({ status: "edited", tabId: "t2" });
  });

  it("is deleted when the panel is gone, and new drafts fall back to the first tab", async () => {
    const mod = await loadModule();
    const dashboard = { tabs: [{ tabId: "t0", panels: [] }] };
    expect(mod.panelDraftStatus(record(), dashboard)).toEqual({ status: "deleted", tabId: "t0" });
    expect(
      mod.panelDraftStatus(record({ isNew: true, panelId: null, draftId: "d" }), dashboard),
    ).toEqual({ status: "new", tabId: "t0" });
  });

  it("formats recent and older timestamps", async () => {
    const mod = await loadModule();
    const ts = new Date(2026, 9, 14, 14, 32).getTime();
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 5 * 60_000).full).toBe(
      "14:32 (5 minutes ago)",
    );
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 10_000).relative).toBe("now");
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 10_000, "just now")).toEqual({
      full: "14:32",
      relative: "just now",
    });
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 2 * 24 * 60 * 60_000).full).toBe(
      "Oct 14, 14:32",
    );
  });
});

describe("usePanelDraftsList", () => {
  beforeEach(() => {
    installFakeIdb();
  });
  afterEach(() => vi.unstubAllGlobals());

  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("loads drafts for the dashboard and refreshes after a write", async () => {
    const mod = await loadModule();
    const dashboard = { tabs: [{ tabId: "t1", panels: [panel("Server")] }] };
    const ctx = mod.usePanelDraftsList({
      scope: () => scope,
      dashboard: () => dashboard,
      open: vi.fn(),
    });
    await flush();
    expect(ctx.entries.value).toEqual([]);

    await mod.savePanelDraft({
      ...scope,
      folder: "f",
      tab: "t1",
      panelId: "p1",
      base: panel("Server"),
      data: panel("Draft"),
    });
    await nextTick();
    await flush();

    expect(ctx.entries.value).toHaveLength(1);
    expect(ctx.byPanelId.value.get("p1")?.status).toBe("edited");

    await ctx.remove(ctx.entries.value[0]);
    await nextTick();
    await flush();
    expect(ctx.entries.value).toEqual([]);
  });

  it("points the badge at the newest copy and removes every draft of a deleted panel", async () => {
    const mod = await loadModule();
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    const dashboard = { tabs: [{ tabId: "t1", panels: [panel("Server")] }] };
    const ctx = mod.usePanelDraftsList({
      scope: () => scope,
      dashboard: () => dashboard,
      open: vi.fn(),
    });
    const base = { ...scope, folder: "f", tab: "t1", panelId: "p1", base: panel("Server") };
    vi.setSystemTime(t0 - 2_000);
    await mod.savePanelDraft({ ...base, data: panel("Older") });
    vi.setSystemTime(t0 - 1_000);
    await mod.savePanelDraft({ ...base, draftId: "copy", data: panel("Newer") });
    vi.useRealTimers();
    await nextTick();
    await flush();

    expect(ctx.entries.value).toHaveLength(2);
    expect(ctx.byPanelId.value.get("p1")?.record.data.title).toBe("Newer");

    await ctx.removeForPanel("p1");
    await nextTick();
    await flush();
    expect(ctx.entries.value).toEqual([]);
  });

  it("waits for an in-flight write and announces a kept draft once", async () => {
    const mod = await loadModule();
    sessionStorage.clear();
    const onKeptDraft = vi.fn();
    const write = mod.savePanelDraft({
      ...scope,
      folder: "f",
      tab: "t1",
      draftId: "d1",
      base: null,
      data: panel("Leaving"),
    });
    mod.markPanelDraftKept("dash1", "k1");
    const ctx = mod.usePanelDraftsList({
      scope: () => scope,
      dashboard: () => ({ tabs: [{ tabId: "t1", panels: [] }] }),
      open: vi.fn(),
      onKeptDraft,
    });
    await write;
    await nextTick();
    await flush();

    expect(ctx.entries.value).toHaveLength(1);
    expect(onKeptDraft).toHaveBeenCalledTimes(1);
  });

  it("stays empty without a scope", async () => {
    const mod = await loadModule();
    const ctx = mod.usePanelDraftsList({ scope: () => null, dashboard: () => ({}), open: vi.fn() });
    await flush();
    expect(ctx.entries.value).toEqual([]);
  });
});
