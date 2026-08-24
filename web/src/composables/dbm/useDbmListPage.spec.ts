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

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowReadonly, shallowRef } from "vue";

import { contextRegistry, DBM_CONTEXT_KEY } from "@/composables/contextProviders";
import type { ContextProvider } from "@/composables/contextProviders";

import { provideDbmTabCounts, type DbmTabCountsContext } from "./dbmTabCounts";
import { clearDbmAnchors } from "./useDbmScope";
import { emptyDbmTabCounts } from "./useDbmTabCounts";
import { useDbmListPage, type DbmListPageOptions } from "./useDbmListPage";

// ── the page's world, stubbed ────────────────────────────────────────────────

const replace = vi.fn(() => Promise.resolve());
let routeQuery: Record<string, unknown> = {};

vi.mock("vue-router", () => ({
  useRoute: () => ({ name: "dbmActivity", query: routeQuery }),
  useRouter: () => ({ replace }),
}));

let storeState: Record<string, unknown> = {};

vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState }),
}));

/** A promise plus the handle to settle it, so a test can control resolve order. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Mount a bare component whose whole setup is the composable under test. */
const mountPage = (
  options: DbmListPageOptions,
  tabCounts?: DbmTabCountsContext,
): { page: ReturnType<typeof useDbmListPage>; unmount: () => void } => {
  let page!: ReturnType<typeof useDbmListPage>;
  const Page = defineComponent({
    setup() {
      page = useDbmListPage(options);
      return () => h("div");
    },
  });
  const Host = defineComponent({
    setup(_, { slots }) {
      if (tabCounts) provideDbmTabCounts(tabCounts);
      return () => h("div", slots.default?.());
    },
  });
  const wrapper = mount(Host, { slots: { default: () => h(Page) } });
  return { page, unmount: () => wrapper.unmount() };
};

const axiosErr = (status: number, message?: string) => ({
  response: { status, data: message !== undefined ? { message } : {} },
});

describe("useDbmListPage", () => {
  beforeEach(() => {
    clearDbmAnchors();
    replace.mockClear();
    routeQuery = {};
    storeState = {
      selectedOrganization: { identifier: "acme" },
      zoConfig: { database_monitoring_enabled: true },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads exactly once on mount", () => {
    const load = vi.fn();
    mountPage({ load });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("seeds the scope from the URL", () => {
    routeQuery = { period: "24h" };
    const { page } = mountPage({ load: vi.fn() });
    expect(page.scope.range.value).toMatchObject({ type: "relative", relativeTimePeriod: "24h" });
  });

  it("reads the org and the feature flag off the store", () => {
    const { page } = mountPage({ load: vi.fn() });
    expect(page.org.value).toBe("acme");
    expect(page.dbmEnabled.value).toBe(true);
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  /**
   * A refresh must ALSO force the shell's badge cache alongside the page's own
   * load — the URL does not change on a refresh, so the shell cannot see one
   * on its own. This behaviour used to live as seven identical named handlers.
   */
  it("onRefresh reloads the page and forces the shared badges", () => {
    const load = vi.fn();
    const refresh = vi.fn();
    const { page } = mountPage(
      { load },
      { counts: shallowReadonly(shallowRef(emptyDbmTabCounts())), refresh },
    );
    load.mockClear();
    page.onRefresh();
    expect(load).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ force: true });
  });

  // ── date changes ──────────────────────────────────────────────────────────

  it("adopts a genuine pick, republishes the URL and reloads", () => {
    routeQuery = { period: "1h", system: "postgresql" };
    const load = vi.fn();
    const { page } = mountPage({ load });
    load.mockClear();
    page.onDateChange({ relativeTimePeriod: "24h", userChangedValue: true });
    expect(page.scope.range.value.relativeTimePeriod).toBe("24h");
    // The default sync writes the range over the EXISTING query, so a filter
    // another mechanism put there survives the pick.
    expect(replace).toHaveBeenCalledWith({
      query: expect.objectContaining({ period: "24h", system: "postgresql" }),
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  /**
   * The picker replays its resolved window from its own `onMounted`, and the
   * page already fetches from its own mount — acting on the replay too would
   * issue every request twice on first paint.
   */
  it("adopts but does not fetch on the picker's mount replay", () => {
    const load = vi.fn();
    const { page } = mountPage({ load });
    load.mockClear();
    page.onDateChange({ relativeTimePeriod: "24h", userChangedValue: false });
    expect(page.scope.range.value.relativeTimePeriod).toBe("24h");
    expect(load).not.toHaveBeenCalled();
  });

  it("uses the page's own syncUrl when one is passed", () => {
    const syncUrl = vi.fn();
    const { page } = mountPage({ load: vi.fn(), syncUrl });
    page.onDateChange({ relativeTimePeriod: "24h", userChangedValue: true });
    expect(syncUrl).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  /** Table health deliberately never writes the URL; `null` preserves that. */
  it("writes nothing to the URL when syncUrl is null", () => {
    const { page } = mountPage({ load: vi.fn(), syncUrl: null });
    page.onDateChange({ relativeTimePeriod: "24h", userChangedValue: true });
    expect(replace).not.toHaveBeenCalled();
  });

  // ── the load envelope ─────────────────────────────────────────────────────

  it("run guards on a missing org", async () => {
    storeState = {};
    const fetcher = vi.fn();
    const { page } = mountPage({ load: vi.fn() });
    await page.run(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("run drives the spinner around the fetch", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const gate = deferred();
    const done = page.run(() => gate.promise);
    expect(page.loading.value).toBe(true);
    gate.resolve();
    await done;
    expect(page.loading.value).toBe(false);
    expect(page.error.value).toBeNull();
  });

  /**
   * The token is claimed BEFORE `before` runs, so page-held caches cleared
   * there (Databases' breakdowns) leave anything still in flight against them
   * already stale when it tries to write back.
   */
  it("run claims the token before the before hook", async () => {
    const { page } = mountPage({ load: vi.fn() });
    let tokenInBefore = -1;
    let tokenInFetcher = -1;
    await page.run(
      async (token) => {
        tokenInFetcher = token;
      },
      { before: () => (tokenInBefore = page.requestSeq.current()) },
    );
    expect(tokenInBefore).toBe(tokenInFetcher);
    expect(page.requestSeq.isStale(tokenInFetcher)).toBe(false);
  });

  it("run surfaces the server's message on failure", async () => {
    const { page } = mountPage({ load: vi.fn() });
    await page.run(() => Promise.reject(axiosErr(500, "backend broke")));
    expect(page.error.value).toBe("backend broke");
    expect(page.loading.value).toBe(false);
  });

  it("run falls back to the error's own text when the server sent none", async () => {
    const { page } = mountPage({ load: vi.fn() });
    await page.run(() => Promise.reject(new Error("socket hang up")));
    expect(page.error.value).toBe("Error: socket hang up");
  });

  it.each([404, 501])("run maps %i to not-collecting, not to the banner", async (status) => {
    const { page } = mountPage({ load: vi.fn() });
    const onNotCollecting = vi.fn();
    await page.run(() => Promise.reject(axiosErr(status)), { onNotCollecting });
    expect(onNotCollecting).toHaveBeenCalledTimes(1);
    expect(page.error.value).toBeNull();
  });

  /** A page with no not-collecting concept keeps the honest error banner. */
  it("run banners a 404 for a page that passed no handler", async () => {
    const { page } = mountPage({ load: vi.fn() });
    await page.run(() => Promise.reject(axiosErr(404, "no stream")));
    expect(page.error.value).toBe("no stream");
  });

  it("run maps 403 to the forbidden handler", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const onForbidden = vi.fn();
    await page.run(() => Promise.reject(axiosErr(403)), { onForbidden });
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(page.error.value).toBeNull();
  });

  it("run lets a page own the banner copy via onError", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const onError = vi.fn();
    await page.run(() => Promise.reject(axiosErr(500, "backend broke")), { onError });
    expect(onError).toHaveBeenCalledWith("backend broke", axiosErr(500, "backend broke"));
    expect(page.error.value).toBeNull();
  });

  it("run resets the page's rows on failure", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const reset = vi.fn();
    const err = axiosErr(500, "boom");
    await page.run(() => Promise.reject(err), { reset });
    expect(reset).toHaveBeenCalledWith(err);
  });

  it("run runs settled after a non-stale load, success or failure", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const settled = vi.fn();
    await page.run(() => Promise.resolve(), { settled });
    await page.run(() => Promise.reject(axiosErr(500, "boom")), { settled });
    expect(settled).toHaveBeenCalledTimes(2);
  });

  /**
   * The whole reason the guard exists: a superseded load must neither paint
   * its failure nor clear the newer load's spinner.
   */
  it("a superseded run cannot touch the spinner, the banner or the reset", async () => {
    const { page } = mountPage({ load: vi.fn() });
    const reset = vi.fn();
    const settled = vi.fn();

    const slow = deferred();
    const first = page.run(() => slow.promise, { reset, settled });
    const second = page.run(() => Promise.resolve());
    await second;
    expect(page.loading.value).toBe(false);

    slow.reject(axiosErr(500, "stale failure"));
    await first;
    expect(page.error.value).toBeNull();
    expect(reset).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
  });

  // ── the shared badge snapshot ─────────────────────────────────────────────

  it("derives the empty-state signals from the shared snapshot", () => {
    const counts = shallowRef({
      ...emptyDbmTabCounts(),
      queryCount: { count: 7, complete: false },
      databaseCount: 3,
    });
    const { page } = mountPage(
      { load: vi.fn() },
      { counts: shallowReadonly(counts), refresh: vi.fn() },
    );
    // The claim's floor, as a number the checklist can pluralize on.
    expect(page.queryCount.value).toBe(7);
    expect(page.databaseCount.value).toBe(3);
  });

  // ── the AI context registry ───────────────────────────────────────────────

  it("registers the page's context on mount and tears it down on unmount", () => {
    const register = vi.spyOn(contextRegistry, "register");
    const unregister = vi.spyOn(contextRegistry, "unregister");
    const setActive = vi.spyOn(contextRegistry, "setActive");
    const provider = { getContext: vi.fn() } as unknown as ContextProvider;

    const { unmount } = mountPage({ load: vi.fn(), context: () => provider });
    expect(register).toHaveBeenCalledWith(DBM_CONTEXT_KEY, provider);
    expect(setActive).toHaveBeenCalledWith(DBM_CONTEXT_KEY);

    unmount();
    expect(unregister).toHaveBeenCalledWith(DBM_CONTEXT_KEY);
    expect(setActive).toHaveBeenLastCalledWith("");
  });

  it("touches the registry not at all for a page without a context", () => {
    const register = vi.spyOn(contextRegistry, "register");
    const { unmount } = mountPage({ load: vi.fn() });
    unmount();
    expect(register).not.toHaveBeenCalled();
  });

  /** Top queries restores its filters from the URL before the first fetch. */
  it("runs beforeMount before the first load", () => {
    const order: string[] = [];
    mountPage({
      load: () => {
        order.push("load");
      },
      beforeMount: () => order.push("beforeMount"),
    });
    expect(order).toEqual(["beforeMount", "load"]);
  });
});
