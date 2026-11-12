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
//
// @vitest-environment jsdom

import { ref } from "vue";

const mockGetStreams = vi.fn();
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams: mockGetStreams }) }));
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "test-org" } } }),
}));
// Real refs: the component reads and mutates the composable's state directly.
vi.mock("./composables/useSessions", () => ({
  SESSION_SEARCH_MAX_LEN: 256,
  normalizeSearchTerm: (raw: string) => String(raw ?? "").trim(),
  useSessions: () => ({
    sessions: ref([]),
    total: ref(0),
    hasMore: ref(false),
    loading: ref(false),
    error: ref(null),
    hasLoadedOnce: ref(false),
    lastRunAt: ref(null),
    loadedOrg: ref(null),
    currentPage: ref(1),
    rowsPerPage: ref(20),
    searchKeyword: ref("foo"),
    searchUser: ref(""),
    sortBy: ref("end_time"),
    sortOrder: ref("desc"),
    agents: ref([]),
    agentsLoaded: ref(false),
    agentsError: ref(null),
    agentsOrg: ref(null),
    fetchPage: vi.fn(),
    cancelAll: vi.fn(),
  }),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import { resetPendingNavigationForTests } from "@/utils/pendingNavigation";
import SessionsList from "./SessionsList.vue";

const ROUTE = "aiSessions";
const START = "/tab";
const STREAM = "test-stream";
const COMPONENT = SessionsList;
const PROPS = { streamName: STREAM, startTime: 1000, endTime: 2000 };
const STUBS = {};
const WRITTEN_KEY = "keyword";
const WRITTEN_VALUE = "foo";

enableAutoUnmount(afterEach);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/tab", name: ROUTE, component: { template: "<div />" } },
      { path: "/other", name: "other", component: { template: "<div />" } },
    ],
  });
  await router.push(START);
  const streams = deferred<any>();
  mockGetStreams.mockReturnValue(streams.promise);
  const wrapper = mount(COMPONENT, { props: PROPS, global: { plugins: [router], stubs: STUBS } });
  const load = (wrapper.vm as any).refresh(undefined, undefined, true);
  await flushPromises();
  const finishLoad = async () => {
    streams.resolve({ list: [{ name: STREAM, settings: { is_llm_stream: true } }] });
    await load;
    await flushPromises();
  };
  return { router, finishLoad };
}

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
  resetPendingNavigationForTests();
});

describe(`${ROUTE} filter URL sync during navigation`, () => {
  it("skips the write after the user has left the route", async () => {
    const { router, finishLoad } = await setup();
    await router.push("/other?x=1");
    await finishLoad();
    expect(router.currentRoute.value.name).toBe("other");
    expect(router.currentRoute.value.query).toEqual({ x: "1" });
  });

  it("skips the write while a navigation away is held and lets it complete", async () => {
    const { router, finishLoad } = await setup();
    const gate = deferred<void>();
    router.beforeEach(async (to) => {
      if (to.name === "other") await gate.promise;
    });
    const nav = router.push("/other");
    await flushPromises();
    await finishLoad();
    gate.resolve();
    await nav;
    expect(router.currentRoute.value.name).toBe("other");
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("still writes the query while on the route", async () => {
    const { router, finishLoad } = await setup();
    await finishLoad();
    expect(router.currentRoute.value.name).toBe(ROUTE);
    expect(router.currentRoute.value.query[WRITTEN_KEY]).toBe(WRITTEN_VALUE);
  });
});
