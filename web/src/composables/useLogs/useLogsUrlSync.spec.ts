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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { searchState } from "@/composables/useLogs/searchState";
import {
  readLogsSignature,
  resetLogsAutoRunForTests,
  useLogsAutoRun,
} from "@/composables/useLogs/logsAutoRun";
import { notifyHitsComplete } from "@/composables/useLogs/logsRowNav";
import { useLogsUrlSync } from "@/composables/useLogs/useLogsUrlSync";
import {
  resetLogsUrlForTests,
  sharedPage,
  sharedPageNotice,
} from "@/composables/useLogs/useLogsUrl";
import {
  activePermalink,
  mintInitOrigin,
  noteGridQuery,
  resetPermalinkForTests,
} from "@/composables/useLogs/useLogPermalink";

const nav = vi.hoisted(() => ({ router: null as any }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => nav.router,
}));

const makeRouter = (query: Record<string, unknown>) => {
  const currentRoute = ref<any>({ name: "logs", query });
  return {
    currentRoute,
    push: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", query: to.query };
    }),
    replace: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", query: to.query };
    }),
  };
};

const Host = defineComponent({
  setup() {
    useLogsUrlSync();
    return () => h("div");
  },
});

describe("useLogsUrlSync (4c C7b URL timing)", () => {
  const { searchObj } = searchState();
  let wrapper: any;
  const engine = () => useLogsAutoRun().engine;

  const dispatch = (
    req: Record<string, unknown> = { from: 0, size: 50, start_time: 1, end_time: 2 },
  ) => {
    const generation = engine().newGeneration({
      lane: "grid",
      kind: "explicit",
      reason: "run",
      op: "full",
      signature: readLogsSignature(searchObj),
    });
    engine().recordDispatch(generation.id, { req: { query: req }, traceId: `t${generation.id}` });
    return generation.id;
  };

  beforeEach(async () => {
    resetLogsAutoRunForTests(store as any);
    resetLogsUrlForTests();
    resetPermalinkForTests();
    store.state.zoConfig = { ...store.state.zoConfig, timestamp_column: "_timestamp" };
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = false;
    searchObj.meta.refreshInterval = 0;
    searchObj.meta.editorDirty = false;
    searchObj.meta.isFtsDefaultColumn = false;
    searchObj.meta.executed = null;
    searchObj.meta.pendingExecution = null;
    searchObj.shouldIgnoreWatcher = false;
    searchObj.meta.liveMode = false;
    searchObj.meta.showTransformEditor = false;
    searchObj.data.transformType = "";
    searchObj.data.tempFunctionContent = "";
    searchObj.data.query = "level = 'error'";
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedFields = [];
    searchObj.data.datetime = {
      type: "relative",
      relativeTimePeriod: "15m",
      startTime: 1,
      endTime: 2,
    } as any;
    searchObj.data.queryResults = { hits: [] } as any;
    nav.router = makeRouter({ stream: "app", period: "15m", org_identifier: "default" });
    wrapper = mount(Host, { global: { provide: { store }, plugins: [i18n] } });
    await flushPromises();
  });

  afterEach(() => wrapper?.unmount());

  it("dispatch writes nothing; the first chunk publishes the run with a push (J-C26, J-C27)", async () => {
    searchObj.data.stream.selectedStream = ["web"];
    const id = dispatch();
    await flushPromises();
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(nav.router.replace).not.toHaveBeenCalled();
    engine().recordChunk(id);
    await flushPromises();
    expect(nav.router.push).toHaveBeenCalledTimes(1);
    expect(nav.router.currentRoute.value.query.stream).toBe("web");
  });

  it("with Auto Run off, VRL picked while the run is pending is not published; the executed VRL is (F2)", async () => {
    const plain = dispatch();
    searchObj.meta.showTransformEditor = true;
    searchObj.data.transformType = "function";
    searchObj.data.tempFunctionContent = ".draft = 1";
    engine().recordChunk(plain);
    await flushPromises();
    expect(engine().currentGeneration("grid")?.id).toBe(plain);
    expect(nav.router.currentRoute.value.query.functionContent).toBeUndefined();
    expect(nav.router.currentRoute.value.query.fn_editor).toBe(false);

    const withVrl = dispatch();
    searchObj.data.tempFunctionContent = "";
    searchObj.meta.showTransformEditor = false;
    engine().recordChunk(withVrl);
    await flushPromises();
    const query = nav.router.currentRoute.value.query;
    expect(Buffer.from(String(query.functionContent), "base64").toString()).toBe(".draft = 1");
    expect(query.fn_editor).toBe(true);
  });

  it("a run that fails or is cancelled before its first chunk leaves the URL on the shown run (J-C27, J-C28)", async () => {
    const shown = dispatch();
    engine().recordChunk(shown);
    await flushPromises();
    const before = { ...nav.router.currentRoute.value.query };
    searchObj.data.stream.selectedStream = ["web"];
    const failed = dispatch();
    engine().recordFailure(failed, `t${failed}`);
    dispatch();
    engine().cancelGeneration(engine().currentGeneration("grid"), { cause: "user" });
    await flushPromises();
    expect(nav.router.currentRoute.value.query).toEqual(before);
    expect(nav.router.currentRoute.value.query.stream).toBe("app");
  });

  it("a page of the same query replaces, so Back does not step through pages", async () => {
    engine().recordChunk(dispatch());
    await flushPromises();
    const pushes = nav.router.push.mock.calls.length;
    const generation = engine().currentGeneration("grid")!;
    engine().recordDispatch(generation.id, {
      req: { query: { from: 100, size: 50, start_time: 1, end_time: 2 } },
      traceId: "page3",
      pagination: true,
    });
    engine().recordChunk(generation.id);
    await flushPromises();
    expect(nav.router.push.mock.calls.length).toBe(pushes);
    expect(nav.router.currentRoute.value.query.page).toBe(3);
  });

  it("a window the server moved is patched over the shown run with a replace", async () => {
    const id = dispatch();
    engine().recordChunk(id);
    await flushPromises();
    const pushes = nav.router.push.mock.calls.length;
    engine().recordWindowMove(id, { startUs: 5, endUs: 9 });
    await flushPromises();
    expect(nav.router.push.mock.calls.length).toBe(pushes);
    expect(nav.router.currentRoute.value.query).toMatchObject({ from: 5, to: 9 });
    expect(nav.router.currentRoute.value.query.period).toBeUndefined();
  });

  it("Back onto an entry with log_* and no open permalink drops them with a replace (J-C25)", async () => {
    nav.router.currentRoute.value = {
      name: "logs",
      query: { stream: "app", log_stream: "app", log_ts: "5", log_fp: "x" },
    };
    await flushPromises();
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledTimes(1));
    expect(nav.router.currentRoute.value.query).toEqual({ stream: "app" });
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("keeps log_* while a permalink is open", async () => {
    activePermalink.value = {
      org: "default",
      link: { stream: "app", ts: 5, fp: "x" },
      generation: 1,
      multiStream: false,
      regions: [],
      clusters: [],
      outcome: null,
    };
    nav.router.currentRoute.value = {
      name: "logs",
      query: { stream: "app", log_stream: "app", log_ts: "5", log_fp: "x" },
    };
    await flushPromises();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("a picked column patches the address bar with a replace", async () => {
    searchObj.data.stream.selectedFields = ["level"];
    await flushPromises();
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.currentRoute.value.query.columns).toBeDefined();
    expect(nav.router.currentRoute.value.query.period).toBe("15m");
  });

  describe("Go to page N (J-C21)", () => {
    const complete = (generationId: number) =>
      notifyHitsComplete({
        traceId: "t",
        type: "search",
        isPagination: false,
        generationId,
      } as any);

    it("offers the shared page after the link's own first run completes", () => {
      const token = mintInitOrigin().token;
      sharedPage.value = 3;
      noteGridQuery(token, 41);
      searchObj.meta.executed = { complete: true } as any;
      complete(41);
      expect(sharedPageNotice.value).toEqual({ page: 3, lastPage: null });
      expect(sharedPage.value).toBeNull();
    });

    it("is not offered when that run failed or was partial, nor for another run", () => {
      const token = mintInitOrigin().token;
      sharedPage.value = 3;
      noteGridQuery(token, 41);
      complete(40);
      expect(sharedPageNotice.value).toBeNull();
      searchObj.meta.executed = null;
      complete(41);
      expect(sharedPageNotice.value).toBeNull();
      expect(sharedPage.value).toBeNull();
    });

    it("a user search drops a pending notice", () => {
      mintInitOrigin();
      sharedPage.value = 3;
      noteGridQuery(undefined, 50);
      searchObj.meta.executed = { complete: true } as any;
      complete(50);
      expect(sharedPageNotice.value).toBeNull();
    });
  });
});
