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

import { flushPromises } from "@vue/test-utils";
import { effectScope, reactive } from "vue";
import { createMemoryHistory, createRouter, type RouteLocationNormalizedLoaded } from "vue-router";
import { describe, expect, it } from "vitest";

import {
  isSavedSession,
  useThreadUrl,
  type ThreadUrlSession,
  type ThreadUrlStore,
} from "./useThreadUrl";

function session(sid: string, over: Record<string, unknown> = {}): ThreadUrlSession {
  return {
    sid,
    record: { serverBacked: false },
    turn: { state: "idle" },
    messages: [],
    ...over,
  } as unknown as ThreadUrlSession;
}

async function setup(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: { render: () => null } }],
  });
  await router.push(path);
  const store = reactive({ state: { shell: { activeSid: null }, sessions: {} } }) as ThreadUrlStore;
  const scope = effectScope();
  // useRoute needs an app; these getters read the same reactive source it does.
  const route = {
    get name() {
      return router.currentRoute.value.name;
    },
    get query() {
      return router.currentRoute.value.query;
    },
  } as unknown as RouteLocationNormalizedLoaded;
  scope.run(() => useThreadUrl(store, route, router));
  await flushPromises();
  return { router, store, scope };
}

describe("useThreadUrl", () => {
  it("names the saved active chat when the URL's thread is empty", async () => {
    const { router, store } = await setup("/?tab=ai&thread=");
    store.state.sessions.a = session("a");
    store.state.shell.activeSid = "a";
    await flushPromises();
    expect(router.currentRoute.value.query.thread).toBe("");
    store.state.sessions.a.turn = { state: "done", saved: "server" };
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ tab: "ai", thread: "a" });
  });

  it("clears the id of the open chat once it is deleted", async () => {
    const { router, store } = await setup("/?tab=ai&thread=b&org_identifier=default");
    store.state.sessions.b = session("b", { record: { serverBacked: true } });
    await flushPromises();
    expect(router.currentRoute.value.query.thread).toBe("b");
    delete store.state.sessions.b;
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      tab: "ai",
      thread: "",
      org_identifier: "default",
    });
  });

  it("leaves a thread that has not loaded yet alone", async () => {
    const { router } = await setup("/?tab=ai&thread=c");
    await flushPromises();
    expect(router.currentRoute.value.query.thread).toBe("c");
  });

  it("counts only a chat the history can read back as saved", () => {
    expect(isSavedSession(undefined)).toBe(false);
    expect(isSavedSession(session("n"))).toBe(false);
    expect(isSavedSession(session("n", { turn: { state: "done", saved: "not_saved" } }))).toBe(
      false,
    );
    expect(isSavedSession(session("l", { turn: { state: "done", saved: "local" } }))).toBe(true);
    expect(isSavedSession(session("s", { record: { serverBacked: true } }))).toBe(true);
  });
});
