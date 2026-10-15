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

vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

import useSavedFunnels, { resetSavedFunnels } from "./useSavedFunnels";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import { isEntityId, type SavedFunnel } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const def = (...keys: string[]): FunnelDef => ({
  steps: keys.map((key) => ({ kind: "p" as const, key })),
  unit: "sessions",
  window: "session",
  breakdown: null,
});
const PARAM = {
  s: [
    ["p", "/a"],
    ["p", "/b"],
  ],
  u: "sessions",
  w: "session",
};
const SQL = 'SELECT 1 FROM "_rumdata"';
const draft = (name: string, d = def("/a", "/b")) => ({ name, def: d, sql: SQL });
const saved = (r: { kind: string; funnel?: SavedFunnel }) => {
  if (r.kind !== "saved" || !r.funnel) throw new Error(`expected saved, got ${r.kind}`);
  return r.funnel;
};

describe("useSavedFunnels (AC-67 to AC-70)", () => {
  beforeEach(() => {
    api.reset();
    mockToast.mockClear();
    resetSavedFunnels();
  });

  it("creates with def in its URL form and the compiled sql; the server's id passes the id rule", async () => {
    const sf = useSavedFunnels();
    const f = saved(await sf.save("org", "web", { ...draft("Signup"), description: "d" }));
    expect(isEntityId(f.id)).toBe(true);
    expect(api.service.createFunnel).toHaveBeenCalledWith("org", "web", {
      name: "Signup",
      description: "d",
      def: PARAM,
      sql: SQL,
    });
    expect(f).toMatchObject({ name: "Signup", version: 1, def: def("/a", "/b"), sql: SQL });
    expect(sf.funnels.value.map((x) => x.name)).toEqual(["Signup"]);
  });

  it("validates every row and counts the unreadable ones in its own warning (AC-69)", async () => {
    api.seedFunnel("web", "Good", PARAM);
    const bad = api.seedFunnel("web", "One step", {
      s: [["p", "/a"]],
      u: "sessions",
      w: "session",
    });
    api.seedFunnel("web", "Hostile", {
      s: [
        ["p", "/a"],
        ["x", "1=1"],
      ],
      u: "sessions",
    });
    const sf = useSavedFunnels();
    await sf.load("org", "web");
    expect(sf.funnels.value.map((f) => f.name)).toEqual(["Good"]);
    expect(sf.invalidCount.value).toBe(2);
    expect(await sf.fetchOne("org", "web", bad.id)).toBeNull();
  });

  it("an update sends the version captured when the funnel was opened, never one re-read later (AC-70)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    const sf = useSavedFunnels();
    await sf.load("org", "web");
    const opened = sf.funnels.value[0];
    api.touch("funnels", row.id, { name: "Signup" });
    await sf.load("org", "web", true);
    expect(sf.funnels.value[0].version).toBe(2);
    const res = await sf.save("org", "web", draft("Signup", def("/a", "/c")), opened);
    expect(res.kind).toBe("conflict");
    expect(res.kind === "conflict" && res.current).toMatchObject({
      version: 2,
      updatedBy: "other@x.com",
    });
    expect(api.bodies("updateFunnel")[0].version).toBe(1);
    const over = await sf.save("org", "web", draft("Signup", def("/a", "/c")), {
      id: row.id,
      version: 2,
    });
    expect(saved(over)).toMatchObject({ version: 3, def: def("/a", "/c") });
  });

  it("a name taken in the app, ignoring case, is a duplicate the dialog shows; a deleted funnel is gone", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    const sf = useSavedFunnels();
    await sf.load("org", "web");
    expect(sf.nameTaken(" SIGNUP ")).toBe(true);
    expect(sf.nameTaken("signup", row.id)).toBe(false);
    expect((await sf.save("org", "web", draft("signup"))).kind).toBe("duplicate");
    api.funnels.delete(row.id);
    expect((await sf.save("org", "web", draft("Signup 2"), sf.funnels.value[0])).kind).toBe("gone");
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("refuses below 2 steps and at 50 per app before any request, with a toast (F44 pattern)", async () => {
    const sf = useSavedFunnels();
    const one = sf.save("org", "web", draft("One", def("/a")));
    expect(mockToast).toHaveBeenCalledTimes(1);
    await expect(one).rejects.toThrow("This saved funnel is not valid");
    for (let i = 0; i < 50; i++) api.seedFunnel("web", `F${i}`, PARAM);
    await sf.load("org", "web", true);
    await expect(sf.save("org", "web", draft("F50"))).rejects.toThrow("50 saved funnels");
    expect(api.service.createFunnel).not.toHaveBeenCalled();
  });

  it("refuses sql over 65,536 bytes before any request, naming the size limit", async () => {
    const sf = useSavedFunnels();
    const big = { ...draft("Big"), sql: "é".repeat(32769) };
    await expect(sf.save("org", "web", big)).rejects.toThrow("over 64 KB");
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(api.service.createFunnel).not.toHaveBeenCalled();
  });

  it("maps 403 on list to forbidden, 403 on write to read-only, and toasts limit_reached and unknown_event (AC-68)", async () => {
    const sf = useSavedFunnels();
    api.failNext("listFunnels", 403);
    expect(await sf.ensure("org", "web")).toBe("forbidden");
    expect(sf.permission.value).toBe("none");
    expect(await sf.load("org", "web", true)).toBe(true);
    expect(sf.status("org", "web")).toBe("ready");
    api.failNext("createFunnel", 403);
    expect(await sf.save("org", "web", draft("A"))).toEqual({ kind: "forbidden" });
    expect(sf.permission.value).toBe("read");
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "Your role can open but not change saved funnels (RUM Product Analytics permission)",
    });
    api.failNext("createFunnel", 409, "limit_reached");
    await expect(sf.save("org", "web", draft("A"))).rejects.toBeTruthy();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: expect.stringContaining("50 saved funnels"),
    });
    api.failNext("createFunnel", 409, "unknown_event");
    await expect(sf.save("org", "web", draft("A"))).rejects.toBeTruthy();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "A named event in this funnel no longer exists; remove its step first",
    });
    api.failNext("listFunnels", 503);
    expect(await sf.load("org", "web", true)).toBe(false);
    expect(await sf.ensure("org", "web")).toBe("failed");
  });

  it("deletes, treating a funnel already gone as deleted, and reloads", async () => {
    const a = api.seedFunnel("web", "A", PARAM);
    const b = api.seedFunnel("web", "B", PARAM);
    const sf = useSavedFunnels();
    await sf.load("org", "web");
    await sf.remove("org", "web", a.id);
    api.funnels.delete(b.id);
    await sf.remove("org", "web", b.id);
    expect(sf.funnels.value).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("deletes several at once, reloading the list once and returning the ids it deleted", async () => {
    const a = api.seedFunnel("web", "A", PARAM);
    const b = api.seedFunnel("web", "B", PARAM);
    const c = api.seedFunnel("web", "C", PARAM);
    const sf = useSavedFunnels();
    await sf.load("org", "web");
    api.service.listFunnels.mockClear();
    api.funnels.delete(b.id);
    expect(await sf.removeMany("org", "web", [a.id, b.id])).toEqual([a.id, b.id]);
    expect(api.service.listFunnels).toHaveBeenCalledTimes(1);
    expect(sf.funnels.value.map((f) => f.name)).toEqual(["C"]);
    expect(mockToast).not.toHaveBeenCalled();

    api.failNext("deleteFunnel", 503);
    expect(await sf.removeMany("org", "web", [c.id])).toEqual([]);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "error",
      message: "The saved funnel could not be deleted",
    });
    expect(sf.funnels.value.map((f) => f.name)).toEqual(["C"]);
  });

  it("fetches one funnel by id for a link that arrives before the list; null only when it is confirmed absent (F50)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    const sf = useSavedFunnels();
    const one = await sf.fetchOne("org", "web", row.id);
    expect(one !== "failed" && one?.name).toBe("Signup");
    expect(await sf.fetchOne("org", "shop", row.id)).toBeNull();
    api.failNext("getFunnel", 403);
    expect(await sf.fetchOne("org", "web", row.id)).toBe("failed");
    api.failNext("getFunnel", 503);
    expect(await sf.fetchOne("org", "web", row.id)).toBe("failed");
  });
});
