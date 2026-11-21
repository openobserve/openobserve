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

import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";

import { makeEnv } from "./actions/__tests__/actionEnv";
import {
  fullThreadLocation,
  homeAskLocation,
  homeQueryFrom,
  isFullThreadRoute,
  fullTabPending,
  isHomeAskShown,
  leaveFullTabHandoff,
  pushFromThread,
  takeFullTabHandoff,
  threadHost,
} from "./fullThreadRoute";

describe("pushFromThread", () => {
  // The full view closes itself on the way out, as AssistantView's leave guard does.
  const leaving = (store: ReturnType<typeof makeEnv>["store"]) => ({
    push: vi.fn(async () => store.close("route")),
  });

  it("lands on the page with the full-page chat floating over it, focus left to the page", async () => {
    const { store, sid } = makeEnv();
    store.open({ kind: "full" }, { sid, focus: "none" });
    const focus = store.focusRequest.value;
    const router = leaving(store);
    await pushFromThread(router, { name: "logs" }, store);
    expect(router.push).toHaveBeenCalledWith({ name: "logs" });
    expect(store.state.shell.windows).toEqual([expect.objectContaining({ sid, state: "open" })]);
    expect(store.state.shell.placement.kind).toBe("hidden");
    expect(store.focusRequest.value).toBe(focus);
  });

  it("leaves a chat in the side panel where it is", async () => {
    const { store, sid } = makeEnv();
    store.open({ kind: "sidebar" }, { sid, focus: "none" });
    const router = { push: vi.fn(async () => undefined) };
    await pushFromThread(router, { name: "logs" }, store);
    expect(router.push).toHaveBeenCalledOnce();
    expect(store.state.shell.windows).toEqual([]);
    expect(store.state.shell.placement).toEqual({ kind: "sidebar" });
    expect(store.state.shell.activeSid).toBe(sid);
  });

  it("keeps a full view opened from the side panel in that panel on the way out", async () => {
    const { store, sid } = makeEnv();
    store.open({ kind: "sidebar" }, { sid, focus: "none" });
    store.open({ kind: "full" }, { sid, focus: "none" });
    await pushFromThread(leaving(store), { name: "logs" }, store);
    expect(store.state.shell.windows).toEqual([]);
    expect(store.state.shell.placement).toEqual({ kind: "sidebar" });
  });

  it("floats nothing when the navigation is declined", async () => {
    const { store, sid } = makeEnv();
    store.open({ kind: "full" }, { sid, focus: "none" });
    const blank = { render: () => null };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/logs", name: "logs", component: blank }],
    });
    router.beforeEach(() => false);
    await pushFromThread(router, { name: "logs" }, store);
    expect(store.state.shell.windows).toEqual([]);
    expect(store.state.shell.placement.kind).toBe("full");
  });
});

describe("isHomeAskShown", () => {
  it("is true only on Home's briefing while an Ask box listens, whatever ?tab= says", () => {
    const home = { name: "home", query: {} };
    expect(isHomeAskShown(home)).toBe(false);
    const stop = onOverviewFocusRequest(() => undefined);
    try {
      expect(isHomeAskShown(home)).toBe(true);
      expect(isHomeAskShown({ name: "home", query: { tab: "ai" } })).toBe(true);
      expect(isHomeAskShown({ name: "home", query: { tab: "ai", thread: "s1" } })).toBe(false);
      expect(isHomeAskShown({ name: "logs", query: {} })).toBe(false);
      expect(isHomeAskShown(null)).toBe(false);
    } finally {
      stop();
    }
    expect(isHomeAskShown(home)).toBe(false);
  });
});

describe("homeQueryFrom", () => {
  it("passes only the org from another page and keeps Home's own keys minus the thread", () => {
    expect(
      homeQueryFrom({ name: "logs", query: { org_identifier: "acme", stream: "a", sql: "b" } }),
    ).toEqual({ org_identifier: "acme" });
    expect(homeQueryFrom({ name: "logs", query: { stream: "a" } })).toEqual({});
    expect(
      homeQueryFrom({ name: "home", query: { period: "7d", org_identifier: "acme", thread: "x" } }),
    ).toEqual({ period: "7d", org_identifier: "acme" });
  });
});

describe("a page that hosts its own thread", () => {
  it("keeps the chat, New chat and its own keys on that page while it is mounted", () => {
    const route = { name: "autobotInvestigate", query: { org_identifier: "acme", thread: "x" } };
    threadHost.value = "autobotInvestigate";
    try {
      expect(isFullThreadRoute(route)).toBe(true);
      expect(homeQueryFrom(route)).toEqual({ org_identifier: "acme" });
      expect(fullThreadLocation("y", { org_identifier: "acme" })).toEqual({
        name: "autobotInvestigate",
        query: { org_identifier: "acme", thread: "y" },
      });
      expect(homeAskLocation(route.query)).toEqual({
        name: "autobotInvestigate",
        query: { org_identifier: "acme", focus: "ask" },
      });
    } finally {
      threadHost.value = "home";
    }
    expect(fullThreadLocation("y")).toEqual({ name: "home", query: { tab: "ai", thread: "y" } });
  });
});

describe("full page tab hand-off", () => {
  const handoff = (target: string | null, at = 1_000) => ({
    userOrgKey: "k1",
    target,
    text: "why 5xx?",
    chips: [],
    at,
  });

  it("gives a chat's draft once, to that chat in the same user+org", () => {
    leaveFullTabHandoff(handoff("s1"));
    expect(takeFullTabHandoff("k2", "s1", false, 2_000)).toBeNull();
    expect(takeFullTabHandoff("k1", "s2", true, 2_000)).toBeNull();
    expect(takeFullTabHandoff("k1", "s1", false, 2_000)?.text).toBe("why 5xx?");
    expect(takeFullTabHandoff("k1", "s1", false, 2_000)).toBeNull();
  });

  it("gives a draft aimed at no chat to a blank new chat only, and never a stale one", () => {
    leaveFullTabHandoff(handoff(null));
    expect(takeFullTabHandoff("k1", "s9", false, 2_000)).toBeNull();
    expect(takeFullTabHandoff("k1", "s9", true, 2_000)?.target).toBeNull();
    leaveFullTabHandoff(handoff(null));
    expect(takeFullTabHandoff("k1", "s9", true, 1_000 + 61_000)).toBeNull();
  });

  it("carries photos and the agent pick, and drops only the photos when storage is full", () => {
    const image = {
      id: "i1",
      data: "AAAA",
      mimeType: "image/png" as const,
      filename: "a.png",
      size: 3,
    };
    leaveFullTabHandoff({ ...handoff("s1"), images: [image], agentId: "sre" });
    expect(takeFullTabHandoff("k1", "s1", false, 2_000)).toMatchObject({
      images: [image],
      agentId: "sre",
    });
    const real = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (value.includes("AAAA")) throw new DOMException("full", "QuotaExceededError");
      real.call(this, key, value);
    });
    leaveFullTabHandoff({ ...handoff("s1"), images: [image], agentId: "sre" });
    set.mockRestore();
    const taken = takeFullTabHandoff("k1", "s1", false, 2_000);
    expect(taken?.text).toBe("why 5xx?");
    expect(taken?.images).toBeUndefined();
    expect(taken?.agentId).toBe("sre");
  });

  it("says a chat is on its way from its opener, without taking the hand-off", () => {
    leaveFullTabHandoff({ ...handoff("s1"), pending: true });
    expect(fullTabPending("k1", "s2", 2_000)).toBe(false);
    expect(fullTabPending("k2", "s1", 2_000)).toBe(false);
    expect(fullTabPending("k1", "s1", 2_000)).toBe(true);
    expect(takeFullTabHandoff("k1", "s1", false, 2_000)?.pending).toBe(true);
    expect(fullTabPending("k1", "s1", 2_000)).toBe(false);
    leaveFullTabHandoff({ ...handoff("s1"), pending: true });
    expect(fullTabPending("k1", "s1", 1_000 + 61_000)).toBe(false);
  });
});
