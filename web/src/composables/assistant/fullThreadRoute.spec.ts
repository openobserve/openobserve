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
import { isHomeAskShown, pushFromThread } from "./fullThreadRoute";

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
