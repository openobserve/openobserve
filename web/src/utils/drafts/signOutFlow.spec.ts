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
import { createRouter, createMemoryHistory, type Router } from "vue-router";
import { defineComponent, h } from "vue";
import {
  draftSessionEnded,
  draftSigningOut,
  draftSignOutDiscardOnly,
  draftSignOutForced,
  resumeDraftSession,
} from "@/utils/drafts/draftSession";
import { readEditorDraft, writeEditorDraft } from "@/utils/drafts/editorDraftStore";
import { stopSessionServices } from "@/utils/sessionServices";
import { invalidateLoginData } from "@/utils/zincutils";
import { signOutThroughLeaveGuards } from "./signOutFlow";

vi.mock("@/utils/sessionServices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/sessionServices")>()),
  stopSessionServices: vi.fn(),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  invalidateLoginData: vi.fn(),
}));

const Blank = defineComponent({ setup: () => () => h("div") });
const email = "me@x.io";

const realLocation = window.location;

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Blank },
      { path: "/editor", component: Blank },
      { path: "/login", component: Blank },
      { path: "/logout", component: Blank },
    ],
  });

const makeStore = () => ({
  state: { userInfo: { email }, zoConfig: { rum: { enabled: true } } },
  dispatch: vi.fn(),
});

describe("signOutThroughLeaveGuards", () => {
  let router: Router;
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    router = makeRouter();
    await router.push("/editor");
  });

  afterEach(() => {
    vi.stubGlobal("location", realLocation);
    vi.clearAllMocks();
    localStorage.clear();
    resumeDraftSession();
  });

  it("ends the session, stops its services and reloads to login with no unload prompt", async () => {
    const prompt = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener("beforeunload", prompt);
    try {
      const store = makeStore();
      const before = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(true);
      prompt.mockClear();

      await expect(signOutThroughLeaveGuards(router, store)).resolves.toBe(true);

      expect(stopSessionServices).toHaveBeenCalledWith(store);
      expect(invalidateLoginData).toHaveBeenCalledTimes(1);
      expect(store.dispatch).toHaveBeenCalledWith("logout", { draftsOf: email });
      expect(draftSessionEnded.value).toBe(true);
      expect(router.currentRoute.value.path).toBe("/login");
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign.mock.calls[0][0]).toMatch(/login$/);

      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload);
      expect(prompt).not.toHaveBeenCalled();
      expect(unload.defaultPrevented).toBe(false);
    } finally {
      window.removeEventListener("beforeunload", prompt);
    }
  });

  it("drops only the signed-out user's editor drafts", async () => {
    writeEditorDraft({ kind: "slo", org: "o1", entityId: null, userEmail: email }, { data: {} });
    const other = { kind: "slo" as const, org: "o1", entityId: null, userEmail: "other@x.io" };
    writeEditorDraft(other, { data: { keep: true } });

    await signOutThroughLeaveGuards(router, makeStore());

    expect(readEditorDraft({ kind: "slo", org: "o1", entityId: null, userEmail: email })).toBe(
      null,
    );
    resumeDraftSession();
    expect(readEditorDraft(other)?.data).toEqual({ keep: true });
  });

  it("stays in the session when a leave guard keeps the user", async () => {
    const removeGuard = router.beforeEach((to) => to.path !== "/logout");
    const store = makeStore();

    await expect(signOutThroughLeaveGuards(router, store)).resolves.toBe(false);
    removeGuard();

    expect(router.currentRoute.value.path).toBe("/editor");
    expect(stopSessionServices).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(draftSigningOut.value).toBe(false);
    expect(draftSessionEnded.value).toBe(false);
  });

  it("signs out even when a guard refuses, once the sign-out is forced", async () => {
    let flags: boolean[] = [];
    const removeGuard = router.beforeEach((to) => {
      if (to.path !== "/logout") return true;
      flags = [draftSigningOut.value, draftSignOutDiscardOnly.value, draftSignOutForced.value];
      return false;
    });
    const store = makeStore();

    await expect(signOutThroughLeaveGuards(router, store, { forced: true })).resolves.toBe(true);
    removeGuard();

    expect(flags).toEqual([true, true, true]);
    expect(stopSessionServices).toHaveBeenCalledWith(store);
    expect(store.dispatch).toHaveBeenCalledWith("logout", { draftsOf: email });
    expect(draftSessionEnded.value).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("treats a guard that throws as a refusal: a forced sign-out still reloads, a voluntary one stays", async () => {
    const removeGuard = router.beforeEach((to) => {
      if (to.path === "/logout") throw new Error("guard failed");
      return true;
    });
    const store = makeStore();

    await expect(signOutThroughLeaveGuards(router, store)).resolves.toBe(false);
    expect(draftSigningOut.value).toBe(false);
    expect(assign).not.toHaveBeenCalled();

    await expect(signOutThroughLeaveGuards(router, store, { forced: true })).resolves.toBe(true);
    removeGuard();
    expect(store.dispatch).toHaveBeenCalledWith("logout", { draftsOf: email });
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
