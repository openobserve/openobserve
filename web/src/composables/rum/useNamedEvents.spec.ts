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
import { computed, reactive } from "vue";

vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

import useNamedEvents, {
  namedEventHandoffState,
  readNamedEventHandoff,
  resetNamedEvents,
} from "./useNamedEvents";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import { isEntityId } from "@/utils/rum/productAnalyticsModel";

const rule = { t: "view" as const, op: "eq" as const, value: "/web/logs" };
const draft = (name: string, id?: string) => ({ id, app: "web", name, rules: [rule] });
const savedEvent = async (
  ne: ReturnType<typeof useNamedEvents>,
  ...args: Parameters<ReturnType<typeof useNamedEvents>["save"]>
) => {
  const out = await ne.save(...args);
  if (out.kind !== "saved") throw new Error(`save was ${out.kind}`);
  return out.event;
};

describe("useNamedEvents (AC-44)", () => {
  beforeEach(() => {
    api.reset();
    mockToast.mockClear();
    resetNamedEvents();
  });

  it("creates through the API; the server's id passes the id rule and the body has no v or id", async () => {
    const ne = useNamedEvents();
    const saved = await savedEvent(ne, "org", "web", draft("Logs"));
    expect(isEntityId(saved.id)).toBe(true);
    expect(saved).toMatchObject({ app: "web", name: "Logs", version: 1, createdBy: "me@x.com" });
    expect(api.service.createEvent).toHaveBeenCalledWith("org", "web", {
      name: "Logs",
      rules: [rule],
    });
    expect(ne.events.value.map((e) => e.id)).toEqual([saved.id]);
  });

  it("loads with one list call, validates every row and counts unreadable rows; another app's row is unreadable", async () => {
    api.seedEvent("web", "A");
    const bad = api.seedEvent("web", "Bad");
    api.events.delete(bad.id);
    api.events.set("bad", { ...bad, id: "bad" });
    const other = api.seedEvent("web", "B");
    api.events.set(other.id, { ...other, app: "shop" });
    api.service.listEvents.mockImplementationOnce(async () => ({
      data: { list: [...api.events.values()] },
    }));
    const ne = useNamedEvents();
    await ne.load("org", "web");
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    expect(api.service.getEvent).not.toHaveBeenCalled();
    expect(ne.events.value.map((e) => e.name)).toEqual(["A"]);
    expect(ne.invalidCount.value).toBe(2);
    expect(ne.permission.value).toBe("write");
  });

  it("updates in place with the stored version, then deletes", async () => {
    const ne = useNamedEvents();
    const saved = await savedEvent(ne, "org", "web", draft("Logs"));
    await ne.save("org", "web", draft("Logs page", saved.id));
    expect(api.service.updateEvent).toHaveBeenCalledWith("org", "web", saved.id, {
      name: "Logs page",
      rules: [rule],
      version: 1,
    });
    expect(api.events.size).toBe(1);
    expect(ne.events.value[0]).toMatchObject({ name: "Logs page", version: 2 });
    expect(await ne.remove("org", "web", saved.id)).toBeNull();
    expect(api.service.deleteEvent).toHaveBeenCalledWith("org", "web", saved.id, false);
    expect(ne.events.value).toEqual([]);
  });

  it("a 403 on list means no access; a 403 on write means read-only", async () => {
    const ne = useNamedEvents();
    api.failNext("listEvents", 403);
    await ne.load("org", "web", true);
    expect(ne.permission.value).toBe("none");
    api.failNext("createEvent", 403);
    expect(await ne.save("org", "web", draft("X"))).toEqual({ kind: "forbidden" });
    expect(ne.permission.value).toBe("read");
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast.mock.calls[0][0]).toMatchObject({
      variant: "error",
      message: "Your role can view but not change named events (RUM Product Analytics permission)",
    });
  });

  it("a write 403 in one org leaves another org writable (W6)", async () => {
    const ne = useNamedEvents();
    await ne.load("orgA", "web");
    api.failNext("createEvent", 403);
    expect((await ne.save("orgA", "web", draft("X"))).kind).toBe("forbidden");
    expect(ne.permission.value).toBe("read");
    await ne.load("orgB", "web");
    expect(ne.permission.value).toBe("write");
    expect((await ne.save("orgB", "web", draft("Y"))).kind).toBe("saved");
  });

  it("refuses a 51st event per app before any request", async () => {
    for (let i = 0; i < 50; i++) api.seedEvent("web", `E${i}`);
    const ne = useNamedEvents();
    await ne.load("org", "web");
    await expect(ne.save("org", "web", draft("E50"))).rejects.toThrow();
    expect(api.service.createEvent).not.toHaveBeenCalled();
  });

  it("toasts an invalid or over-cap refusal inside the save call, before it returns (F44)", async () => {
    const ne = useNamedEvents();
    const elevenRules = { app: "web", name: "Too many", rules: Array(11).fill(rule) };
    const invalid = ne.save("org", "web", elevenRules);
    expect(mockToast).toHaveBeenCalledTimes(1);
    const invalidError = (await invalid.catch((e: Error) => e)) as Error;
    expect(mockToast).toHaveBeenLastCalledWith({ variant: "error", message: invalidError.message });
    for (let i = 0; i < 50; i++) await ne.save("org", "web", draft(`E${i}`));
    mockToast.mockClear();
    const capped = ne.save("org", "web", draft("E50"));
    expect(mockToast).toHaveBeenCalledTimes(1);
    const cappedError = (await capped.catch((e: Error) => e)) as Error;
    expect(mockToast).toHaveBeenLastCalledWith({ variant: "error", message: cappedError.message });
    expect(cappedError.message).not.toBe(invalidError.message);
    expect(api.service.createEvent).toHaveBeenCalledTimes(50);
  });

  it("maps the server's refusals: limit_reached and 400 toast, duplicate_name is left to the form, version_conflict reloads", async () => {
    const ne = useNamedEvents();
    const saved = await savedEvent(ne, "org", "web", draft("Logs"));
    mockToast.mockClear();

    api.failNext("createEvent", 409, "limit_reached");
    await expect(ne.save("org", "web", draft("Other"))).rejects.toBeTruthy();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: expect.stringContaining("50 named events"),
    });

    api.failNext("createEvent", 400, "invalid_rules");
    await expect(ne.save("org", "web", draft("Other"))).rejects.toBeTruthy();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "This named event is not valid",
    });

    mockToast.mockClear();
    const dup = await ne.save("org", "web", draft("LOGS ")).catch((e) => e);
    expect(dup?.response?.data?.code).toBe("duplicate_name");
    expect(mockToast).not.toHaveBeenCalled();

    api.touch("events", saved.id, { name: "Logs (theirs)" });
    const lists = api.service.listEvents.mock.calls.length;
    await expect(ne.save("org", "web", draft("Logs (mine)", saved.id))).rejects.toBeTruthy();
    expect(mockToast).toHaveBeenLastCalledWith({
      variant: "error",
      message: "Someone else changed this named event; it was reloaded",
    });
    expect(api.service.listEvents.mock.calls.length).toBe(lists + 1);
    expect(ne.events.value[0]).toMatchObject({ name: "Logs (theirs)", version: 2 });
    await ne.save("org", "web", draft("Logs (mine)", saved.id));
    expect(ne.events.value[0]).toMatchObject({ name: "Logs (mine)", version: 3 });
  });

  it("remove returns the funnels of an in-use refusal and owns no UI; force deletes (CR-16)", async () => {
    const ne = useNamedEvents();
    const ev = await savedEvent(ne, "org", "web", draft("Logs"));
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/"],
        ["e", ev.id],
      ],
      u: "sessions",
      w: "session",
    });
    expect(await ne.usages("org", "web", ev.id)).toEqual([
      { id: expect.any(String), name: "Signup" },
    ]);
    expect(await ne.remove("org", "web", ev.id)).toEqual([
      { id: expect.any(String), name: "Signup" },
    ]);
    expect(mockToast).not.toHaveBeenCalled();
    expect(ne.events.value).toHaveLength(1);
    expect(await ne.remove("org", "web", ev.id, true)).toBeNull();
    expect(ne.events.value).toEqual([]);
  });

  it("removeMany runs every delete, reloads once, and reports the gone, the in-use and toasts the first failure (F2)", async () => {
    const ne = useNamedEvents();
    const a = api.seedEvent("web", "A");
    const b = api.seedEvent("web", "B");
    const c = api.seedEvent("web", "C");
    const d = api.seedEvent("web", "D");
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/"],
        ["e", b.id],
      ],
      u: "sessions",
      w: "session",
    });
    await ne.load("org", "web");
    api.events.delete(d.id);
    api.service.listEvents.mockClear();
    api.failNext("deleteEvent", 503);
    const out = await ne.removeMany("org", "web", [a.id, b.id, c.id, d.id], []);
    expect(out.gone).toEqual([c.id, d.id]);
    expect(out.inUse).toEqual([
      { id: b.id, funnels: [{ id: expect.any(String), name: "Signup" }] },
    ]);
    expect(api.service.deleteEvent).toHaveBeenCalledTimes(4);
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith({
      variant: "error",
      message: "The named event could not be deleted",
    });
    expect(ne.events.value.map((e) => e.name)).toEqual(["A", "B"]);

    mockToast.mockClear();
    const forced = await ne.removeMany("org", "web", [a.id, b.id], [b.id]);
    expect(forced).toEqual({ gone: [a.id, b.id], inUse: [] });
    expect(api.service.deleteEvent.mock.calls.slice(-2)).toEqual([
      ["org", "web", a.id, false],
      ["org", "web", b.id, true],
    ]);
    expect(ne.events.value).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("an id this app has not loaded is not removed", async () => {
    const ne = useNamedEvents();
    expect(await ne.remove("org", "web", api.seedEvent("web", "Unloaded").id)).toBeNull();
    expect(api.service.deleteEvent).not.toHaveBeenCalled();
  });

  it("any other failure toasts and keeps the list", async () => {
    const ne = useNamedEvents();
    await ne.save("org", "web", draft("Keep"));
    api.failNext("listEvents", 500, "internal_error");
    await ne.load("org", "web", true);
    expect(mockToast).toHaveBeenCalled();
    expect(ne.events.value.map((e) => e.name)).toEqual(["Keep"]);
  });

  it("a load for another app while one is in flight ends with that app's events", async () => {
    api.seedEvent("a", "EvA");
    api.seedEvent("b", "EvB");
    const releaseA = api.gate("listEvents");
    const ne = useNamedEvents();
    const loadA = ne.load("org", "a");
    const loadB = ne.load("org", "b");
    await loadB;
    releaseA();
    await loadA;
    expect(ne.events.value.map((e) => e.name)).toEqual(["EvB"]);
    await ne.load("org", "b");
    expect(api.service.listEvents).toHaveBeenCalledTimes(2);
  });

  it("load resolves true only when the app's events are current (F12)", async () => {
    api.seedEvent("web", "A");
    const ne = useNamedEvents();
    api.failNext("listEvents", 503);
    expect(await ne.load("org", "web")).toBe(false);
    expect(await ne.load("org", "web")).toBe(true);
    expect(await ne.load("org", "web")).toBe(true);
    api.failNext("listEvents", 500, "internal_error");
    expect(await ne.load("org", "web", true)).toBe(false);
    expect(await ne.load("org", "")).toBe(false);
  });

  it("status is loading, then failed, ready or forbidden per app, and ensure retries a failed load only when asked (F22, F24, F25)", async () => {
    const ne = useNamedEvents();
    const web = computed(() => ne.status("org", "web"));
    expect(web.value).toBe("loading");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.service.listEvents.mockImplementationOnce(async () => {
      await gate;
      throw { response: { status: 503 } };
    });
    const first = ne.ensure("org", "web");
    const joined = ne.ensure("org", "web");
    expect(web.value).toBe("loading");
    release();
    expect(await first).toBe("failed");
    expect(await joined).toBe("failed");
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    expect(await ne.ensure("org", "web")).toBe("failed");
    expect(api.service.listEvents).toHaveBeenCalledTimes(1);
    const retry = ne.ensure("org", "web", true);
    expect(web.value).toBe("loading");
    expect(await retry).toBe("ready");
    expect(ne.status("org", "shop")).toBe("loading");
    api.failNext("listEvents", 500, "internal_error");
    await ne.load("org", "web", true);
    expect(web.value).toBe("failed");
    api.failNext("listEvents", 403);
    await ne.load("org", "web", true);
    expect(web.value).toBe("forbidden");
    expect(await ne.ensure("org", "web")).toBe("forbidden");
  });

  it("a failed reload after a save or delete reads failed over the stale list until a retry reloads it (F33)", async () => {
    const ne = useNamedEvents();
    const keep = await savedEvent(ne, "org", "web", draft("Keep"));
    expect(ne.status("org", "web")).toBe("ready");
    api.failNext("listEvents", 503);
    await ne.save("org", "web", draft("New"));
    expect(ne.status("org", "web")).toBe("failed");
    expect(ne.events.value.map((e) => e.name)).toEqual(["Keep"]);
    expect(await ne.ensure("org", "web")).toBe("failed");
    expect(api.service.listEvents).toHaveBeenCalledTimes(2);
    expect(await ne.ensure("org", "web", true)).toBe("ready");
    expect(ne.events.value.map((e) => e.name)).toEqual(["Keep", "New"]);
    api.failNext("listEvents", 503);
    await ne.remove("org", "web", keep.id);
    expect(ne.status("org", "web")).toBe("failed");
    expect(await ne.load("org", "web")).toBe(true);
    expect(ne.events.value.map((e) => e.name)).toEqual(["New"]);
    expect(ne.status("org", "web")).toBe("ready");
  });

  it("a load superseded by another app's never marks its own app failed", async () => {
    const ne = useNamedEvents();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.service.listEvents.mockImplementationOnce(async () => {
      await gate;
      throw { response: { status: 503 } };
    });
    const a = ne.load("org", "a");
    await ne.load("org", "b");
    release();
    await a;
    expect(ne.status("org", "a")).toBe("loading");
    expect(ne.status("org", "b")).toBe("ready");
  });

  it("a failed app switch clears the previous app's unreadable count (F14)", async () => {
    api.service.listEvents.mockImplementationOnce(async () => ({
      data: { list: [{ id: "bad", app: "a" }] },
    }));
    const ne = useNamedEvents();
    await ne.load("org", "a");
    expect(ne.invalidCount.value).toBe(1);
    api.failNext("listEvents", 503);
    await ne.load("org", "b");
    expect(ne.events.value).toEqual([]);
    expect(ne.invalidCount.value).toBe(0);
  });

  it("a 403 after unreadable rows holds no rows, so it clears the unreadable count as saved funnels do (F55)", async () => {
    api.service.listEvents.mockImplementationOnce(async () => ({
      data: { list: [{ id: "bad", app: "web" }] },
    }));
    const ne = useNamedEvents();
    await ne.load("org", "web");
    expect(ne.invalidCount.value).toBe(1);
    api.failNext("listEvents", 403);
    await ne.load("org", "web", true);
    expect(ne.status("org", "web")).toBe("forbidden");
    expect(ne.invalidCount.value).toBe(0);
  });

  it("hands the editor a draft through history state: plain, cloneable and validated on read", () => {
    const rules = reactive([{ t: "action" as const, targets: ["save-btn"], onPage: "/a" }]);
    const state = namedEventHandoffState({ draft: { name: "save-btn", rules }, from: "overview" });
    expect(() => structuredClone(state)).not.toThrow();
    expect(readNamedEventHandoff(structuredClone(state))).toEqual({
      draft: { name: "save-btn", rules: [{ t: "action", targets: ["save-btn"], onPage: "/a" }] },
      pageHints: [],
      from: "overview",
    });
    const tampered = {
      rumNamedEventHandoff: {
        draft: { name: "x", rules: [rule, { t: "bogus" }, null] },
        pageHints: ["/a", 3],
        from: "settings",
      },
    };
    expect(readNamedEventHandoff(tampered)).toEqual({
      draft: { name: "x", rules: [rule] },
      pageHints: ["/a"],
      from: null,
    });
    expect(readNamedEventHandoff(null)).toEqual({ draft: null, pageHints: [], from: null });
    expect(readNamedEventHandoff({ back: "/x" })).toEqual({
      draft: null,
      pageHints: [],
      from: null,
    });
  });

  it("owns no drawer state any more: the editor is a route", () => {
    const keys = Object.keys(useNamedEvents());
    for (const gone of ["drawer", "openDrawer", "closeDrawer"]) expect(keys).not.toContain(gone);
  });
});
