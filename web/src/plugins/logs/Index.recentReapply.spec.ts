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
import { flushPromises, mount } from "@vue/test-utils";
import Index from "./Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { readLogsSignature, resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import { buildLogsRecord } from "@/utils/queryHistory/logs";
import type { QueryHistoryEntry } from "@/services/query_history";
import { openRecentOnItsPage, recentSearchRoute } from "@/utils/queryHistory/routes";
import { landingRouter } from "@/test/unit/helpers/recentLanding";

interface SentSearch {
  type: string;
  queryReq: { query: { sql: string } };
}

const { sent, streams } = vi.hoisted(() => ({
  sent: [] as SentSearch[],
  streams: [
    {
      name: "app",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "method", type: "Utf8" },
        { name: "status", type: "Int64" },
      ],
      settings: {},
    },
  ],
}));
vi.mock("@/stores", async () => ({ default: (await import("@/test/unit/helpers/store")).default }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: SentSearch) => {
      sent.push(payload);
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));
vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useStreams")>();
  return {
    ...actual,
    default: () => ({
      ...actual.default(),
      getStream: async (name: string) => streams.find((stream) => stream.name === name),
      getStreams: async () => ({ list: streams }),
    }),
  };
});

const app = document.createElement("div");
app.id = "app";
document.body.appendChild(app);

const recorded = (query: string): QueryHistoryEntry => {
  const signature = readLogsSignature(wrapper.vm.searchObj);
  const body = buildLogsRecord({
    signature: { ...signature, query, sqlMode: true, streams: ["app"] },
    startUs: 1,
    endUs: 2,
    columns: [],
    result: { status: "ok" },
  });
  if (!body) throw new Error("no record for " + query);
  return {
    ...body,
    id: query,
    query_key: "k",
    starred: false,
    run_count: 1,
    created_at: 1,
    updated_at: 2,
  };
};

const Q1 = "SELECT * FROM \"app\" WHERE method = 'GET'";
const Q2 = 'SELECT * FROM "app" WHERE status >= 500';

let wrapper: ReturnType<typeof mount<typeof Index>>;

const WAIT = { timeout: 5000 };

interface SearchBarApi {
  restoreRecent: (entry: QueryHistoryEntry, when: "now" | "original", run: boolean) => void;
}

const restore = async (query: string, run: boolean) => {
  const searchBar = (wrapper.vm as unknown as { searchBarRef: SearchBarApi }).searchBarRef;
  searchBar.restoreRecent(recorded(query), "now", run);
  await flushPromises();
};

const searchesFor = (text: string) =>
  sent.filter((s) => s.type === "search" && s.queryReq.query.sql.includes(text)).length;

describe("Logs re-apply from recent searches", { timeout: 30000 }, () => {
  beforeEach(async () => {
    resetLogsAutoRunForTests();
    sent.length = 0;
    (store.state as Record<string, unknown>).logs = { isInitialized: true, logs: {} };
    vi.spyOn(store, "dispatch").mockResolvedValue(undefined as never);
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    resetLogsAutoRunForTests();
  });

  it("applies two re-runs of different rows in a row", async () => {
    const state = wrapper.vm.searchObj;
    await restore(Q1, true);
    await vi.waitFor(() => expect(state.data.query).toBe(Q1), WAIT);
    await restore(Q2, true);
    await vi.waitFor(() => expect(state.data.query).toBe(Q2), WAIT);
    expect(state.data.editorValue).toBe(Q2);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(1), WAIT);
  });

  it("runs the same row twice when it is re-run twice", async () => {
    await restore(Q2, true);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(1), WAIT);
    await restore(Q2, true);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(2), WAIT);
  });

  it("loads without running after a re-run, so no run request leaks into the next restore", async () => {
    const state = wrapper.vm.searchObj;
    await restore(Q2, true);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(1), WAIT);
    await restore(Q1, false);
    await vi.waitFor(() => expect(state.data.query).toBe(Q1), WAIT);
    await flushPromises();
    expect(searchesFor("method = 'GET'")).toBe(0);
  });

  it("runs only the last of two overlapping restores when that one asked to run", async () => {
    const state = wrapper.vm.searchObj;
    const searchBar = (wrapper.vm as unknown as { searchBarRef: SearchBarApi }).searchBarRef;
    searchBar.restoreRecent(recorded(Q1), "now", false);
    searchBar.restoreRecent(recorded(Q2), "now", true);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(1), WAIT);
    await flushPromises();
    expect(state.data.query).toBe(Q2);
    expect(searchesFor("method = 'GET'")).toBe(0);
    expect(searchesFor("status >= 500")).toBe(1);
  });

  it("re-applies an AI-chat landing once, not again when a column or the refresh interval changes the URL", async () => {
    const state = wrapper.vm.searchObj;
    const org = store.state.selectedOrganization.identifier;
    const landing = recentSearchRoute(recorded(Q1), "now", org, "load")!;
    const query = { ...landing.query, type: "ai_chat_query" };
    router.currentRoute.value = router.resolve({ ...landing, query });
    await vi.waitFor(() => expect(state.data.query).toBe(Q1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    state.data.editorValue = Q2;
    state.data.query = Q2;
    router.currentRoute.value = router.resolve({
      ...landing,
      query: { ...query, fields: "status" },
    });
    await flushPromises();
    router.currentRoute.value = router.resolve({
      ...landing,
      query: { ...query, fields: "status", refresh: "10" },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(state.data.editorValue).toBe(Q2);
    expect(state.data.query).toBe(Q2);
  });

  it("does not run a re-run that a load-only restore overtook", async () => {
    const state = wrapper.vm.searchObj;
    const searchBar = (wrapper.vm as unknown as { searchBarRef: SearchBarApi }).searchBarRef;
    searchBar.restoreRecent(recorded(Q2), "now", true);
    searchBar.restoreRecent(recorded(Q1), "now", false);
    await vi.waitFor(() => expect(state.data.query).toBe(Q1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(searchesFor("status >= 500")).toBe(0);
    expect(searchesFor("method = 'GET'")).toBe(0);
  });
});

describe("Logs landing for a restore from another page", { timeout: 30000 }, () => {
  beforeEach(async () => {
    // The server default: the picker's first emit on mount does not search.
    store.state.zoConfig.query_on_stream_selection = true;
    resetLogsAutoRunForTests();
    sent.length = 0;
    (store.state as Record<string, unknown>).logs = { isInitialized: true, logs: {} };
    vi.spyOn(store, "dispatch").mockImplementation((async (type: string, payload: unknown) => {
      if (type === "logs/setIsInitialized") {
        (store.state as { logs: { isInitialized: unknown } }).logs.isInitialized = payload;
      }
    }) as never);
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    resetLogsAutoRunForTests();
    store.state.zoConfig.query_on_stream_selection = false;
  });

  // The page left with Q1 cached for the same stream and org, then another page restores Q2 here.
  const landWith = async (run: boolean) => {
    await restore(Q1, false);
    await vi.waitFor(() => expect(wrapper.vm.searchObj.data.query).toBe(Q1), WAIT);
    const entry = recorded(Q2);
    wrapper.unmount();
    sent.length = 0;
    const org = store.state.selectedOrganization.identifier;
    await openRecentOnItsPage(landingRouter().router, entry, "now", org, run);
    // A full navigation never settles in this harness; the landing reads only the current route.
    router.currentRoute.value = router.resolve(
      recentSearchRoute(entry, "now", org, run ? "run" : "load")!,
    );
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
  };

  it("applies the picked query over the cached one, and Load without running does not run it", async () => {
    await landWith(false);
    await vi.waitFor(() => expect(wrapper.vm.searchObj.data.query).toBe(Q2), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(searchesFor("status >= 500")).toBe(0);
  });

  it("runs the picked query once when it was restored with Run", async () => {
    await landWith(true);
    await vi.waitFor(() => expect(wrapper.vm.searchObj.data.query).toBe(Q2), WAIT);
    await vi.waitFor(() => expect(searchesFor("status >= 500")).toBe(1), WAIT);
  });
});
