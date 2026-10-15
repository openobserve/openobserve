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

const draft = (title: string, extra: Record<string, unknown> = {}) => ({
  ...scope,
  draftId: "d1",
  folder: "default",
  tab: "t1",
  data: { id: "", title, type: "line", queries: [{ query: "SELECT 1" }] },
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

  it("saves and reads back a draft as plain data", async () => {
    const mod = await loadModule();
    expect(await mod.isPanelDraftStorageAvailable()).toBe(true);

    await mod.savePanelDraft(draft("First", { variablesWithCurrentPanel: ["v1"] }));
    const record = await mod.getPanelDraft(scope);

    expect(record?.key).toBe("a@b.c|org1|dash1");
    expect(record?.data.title).toBe("First");
    expect(record?.variables).toEqual([]);
    expect(record?.variablesWithCurrentPanel).toEqual(["v1"]);
    expect(record?.updatedAt).toBeTypeOf("number");
  });

  it("keeps one draft per dashboard, replaced by the next save", async () => {
    const mod = await loadModule();
    await mod.savePanelDraft(draft("First"));
    await mod.savePanelDraft(draft("Second", { draftId: "d2" }));

    expect(fake.records.size).toBe(1);
    expect((await mod.getPanelDraft(scope))?.draftId).toBe("d2");
  });

  it("separates drafts by user, org and dashboard", async () => {
    const mod = await loadModule();
    await mod.savePanelDraft(draft("Mine"));
    await mod.savePanelDraft(draft("Other user", { userId: "x@y.z" }));
    await mod.savePanelDraft(draft("Other org", { org: "org2" }));
    await mod.savePanelDraft(draft("Other dashboard", { dashboardId: "dash2" }));

    expect(fake.records.size).toBe(4);
    expect((await mod.getPanelDraft(scope))?.data.title).toBe("Mine");
  });

  it("drops drafts older than seven days on read and on prune", async () => {
    const mod = await loadModule();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1));
    await mod.savePanelDraft(draft("Old"));
    await mod.savePanelDraft(draft("Old elsewhere", { dashboardId: "dash2" }));
    vi.setSystemTime(new Date(2026, 0, 9));

    expect(await mod.getPanelDraft(scope)).toBeUndefined();
    expect(fake.records.has("a@b.c|org1|dash1")).toBe(false);
    expect(await mod.prunePanelDrafts()).toBe(1);
    expect(fake.records.size).toBe(0);
  });

  it("deletes by draftId only when the stored draft is that one", async () => {
    const mod = await loadModule();
    await mod.savePanelDraft(draft("Stored"));

    await mod.deletePanelDraft(scope, "someone-else");
    expect(fake.records.size).toBe(1);

    await mod.deletePanelDraft(scope, "d1");
    expect(fake.records.size).toBe(0);
  });

  it("deletes whatever is stored without a draftId", async () => {
    const mod = await loadModule();
    await mod.savePanelDraft(draft("Stored"));
    await mod.deletePanelDraft(scope);
    expect(fake.records.size).toBe(0);
  });

  it("formats recent and older timestamps", async () => {
    const mod = await loadModule();
    const ts = new Date(2026, 9, 14, 14, 32).getTime();
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 2 * 60 * 60_000)).toBe("14:32 (2 hours ago)");
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 5 * 60_000)).toBe("14:32 (5 minutes ago)");
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 10_000)).toBe("14:32");
    expect(mod.formatPanelDraftTime(ts, "en-US", ts + 2 * 24 * 60 * 60_000)).toBe("Oct 14, 14:32");
  });
});
