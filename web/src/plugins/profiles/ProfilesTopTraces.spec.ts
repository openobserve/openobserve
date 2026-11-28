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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "vuex";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import ProfilesTopTraces from "./ProfilesTopTraces.vue";

const mocks = vi.hoisted(() => ({
  schema: vi.fn(),
  nameList: vi.fn(),
  search: vi.fn(),
  push: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("@/services/stream", () => ({
  default: { schema: mocks.schema, nameList: mocks.nameList },
}));
vi.mock("@/services/search", () => ({ default: { search: mocks.search } }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: mocks.copy }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));

enableAutoUnmount(afterEach);

const RANGE = { startTime: 1_700_000_000_000_000, endTime: 1_700_000_600_000_000 };
const hits = [
  {
    trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    total: 75,
    first_ts: 3_000_000_000_000,
    last_ts: 3_000_060_000_000,
  },
  {
    trace_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    total: 25,
    first_ts: 3_100_000_000_000,
    last_ts: 3_100_000_000_000,
  },
];

const makeStore = (state: Record<string, unknown> = {}) =>
  createStore({ state: { hiddenMenus: [], zoConfig: { features: {} }, ...state } });

// A promise the test settles by hand, to order responses.
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Passes attributes (aria-*, data-test) through like the real OButton, so the specs see them.
const OButtonStub = {
  props: ["variant", "size", "iconLeft"],
  template: "<button><slot /></button>",
};

const mountList = (props: Record<string, unknown> = {}, state: Record<string, unknown> = {}) =>
  mount(ProfilesTopTraces, {
    props: {
      orgIdentifier: "org1",
      stream: "profiles-a",
      profileType: "cpu",
      profileUnit: "nanoseconds",
      service: "svc",
      filters: [],
      range: RANGE,
      grandTotal: 100,
      revision: 1,
      valueFormatter: (value: number) => `${value} ns`,
      ...props,
    },
    global: {
      plugins: [i18n],
      provide: { store: makeStore(state) },
      stubs: { OButton: OButtonStub },
    },
  });

const open = async (wrapper: ReturnType<typeof mountList>) => {
  await wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");
  await flushPromises();
};

const totals = (wrapper: ReturnType<typeof mountList>) =>
  [0, 1].map((index) => wrapper.find(`[data-test="profiles-top-trace-${index}-total"]`).text());

describe("ProfilesTopTraces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    mocks.schema.mockResolvedValue({ data: { schema: [{ name: "trace_id" }] } });
    mocks.nameList.mockResolvedValue({ data: { list: [{ name: "default" }] } });
    mocks.search.mockResolvedValue({ data: { hits } });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("is hidden when the stream has no trace_id column, and runs no query", async () => {
    mocks.schema.mockResolvedValue({ data: { schema: [{ name: "value" }] } });
    const wrapper = mountList();
    await flushPromises();
    expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(false);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("is hidden when the schema call fails", async () => {
    // A 4xx is not retried by the query client.
    mocks.schema.mockRejectedValue({ response: { status: 404 } });
    const wrapper = mountList();
    await flushPromises();
    expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(false);
  });

  it("queries only once opened, through the profiles search with the run's filters", async () => {
    const wrapper = mountList({
      filters: [
        { key: "k8s_pod_name", op: "=", value: "pod-1" },
        { key: 'bad" key', op: "=", value: "x" },
      ],
    });
    await flushPromises();
    expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(true);
    expect(mocks.search).not.toHaveBeenCalled();

    await open(wrapper);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    const request = mocks.search.mock.calls[0][0];
    expect(request.page_type).toBe("profiles");
    expect(request.org_identifier).toBe("org1");
    const { sql, start_time, end_time, size } = request.query.query;
    expect(sql).toContain('FROM "profiles-a"');
    expect(sql).toContain("profile_type = 'cpu'");
    expect(sql).toContain("service_name = 'svc'");
    expect(sql).toContain('"stack" IS NOT NULL');
    expect(sql).toContain("\"k8s_pod_name\" = 'pod-1'");
    expect(sql).not.toContain("bad");
    expect(sql).toContain("GROUP BY trace_id ORDER BY total DESC LIMIT 20");
    // No trace filter: the chosen window as it is.
    expect([start_time, end_time, size]).toEqual([RANGE.startTime, RANGE.endTime, 20]);
  });

  it("does not query while inactive (a run without trace links)", async () => {
    const wrapper = mountList({ active: false });
    await flushPromises();
    await open(wrapper);
    expect(mocks.search).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("pads the window once when a trace_id filter is applied", async () => {
    const wrapper = mountList({ filters: [{ key: "trace_id", op: "=", value: "t1" }] });
    await flushPromises();
    await open(wrapper);
    const { start_time, end_time } = mocks.search.mock.calls[0][0].query.query;
    expect(start_time).toBe(RANGE.startTime - 120_000_000);
    expect(end_time).toBe(RANGE.endTime + 60_000_000);
  });

  it("lists the traces with their share and total", async () => {
    const wrapper = mountList();
    await flushPromises();
    await open(wrapper);
    expect(wrapper.find('[data-test="profiles-top-trace-0-id"]').text()).toBe("aaaaaaaa…");
    expect(wrapper.find('[data-test="profiles-top-trace-0-id"]').attributes("title")).toBe(
      hits[0].trace_id,
    );
    expect(totals(wrapper)).toEqual(["75.00% · 75 ns", "25.00% · 25 ns"]);
  });

  it("copies the full trace id from the copy control", async () => {
    const wrapper = mountList();
    await flushPromises();
    await open(wrapper);
    await wrapper.find('[data-test="profiles-top-trace-1-copy"]').trigger("click");
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    expect(mocks.copy.mock.calls[0][0]).toBe(hits[1].trace_id);
  });

  it("opens a trace in the only traces stream, with microsecond bounds padded as the Logs action does", async () => {
    const wrapper = mountList();
    await flushPromises();
    await open(wrapper);
    await wrapper.find('[data-test="profiles-top-trace-0-open"]').trigger("click");
    expect(mocks.push).toHaveBeenCalledWith({
      name: "traceDetails",
      query: {
        stream: "default",
        trace_id: hits[0].trace_id,
        from: 3_000_000_000_000 - 900_000_000,
        to: 3_000_060_000_000 + 900_000_000,
        refresh: 0,
        org_identifier: "org1",
        reload: "true",
      },
    });
  });

  describe("Open trace gates", () => {
    const openButtonShown = async (
      list: { name: string }[],
      state: Record<string, unknown> = {},
    ) => {
      // A fresh cache for each call: the traces-stream list is cached per org.
      queryClient.clear();
      mocks.nameList.mockResolvedValue({ data: { list } });
      const wrapper = mountList({}, state);
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-trace-0"]').exists()).toBe(true);
      return wrapper.find('[data-test="profiles-top-trace-0-open"]').exists();
    };

    it.each([[[]], [[{ name: "t1" }, { name: "t2" }]]])(
      "is hidden unless there is exactly one traces stream (%j)",
      async (list) => {
        expect(await openButtonShown(list)).toBe(false);
      },
    );

    it("ignores internal traces streams when counting", async () => {
      expect(await openButtonShown([{ name: "default" }, { name: "_internal" }])).toBe(true);
      expect(await openButtonShown([{ name: "_one" }, { name: "_two" }])).toBe(false);
    });

    it("is hidden when the Traces menu is hidden (array or Set)", async () => {
      expect(await openButtonShown([{ name: "default" }], { hiddenMenus: ["traces"] })).toBe(false);
      expect(
        await openButtonShown([{ name: "default" }], { hiddenMenus: new Set(["traces"]) }),
      ).toBe(false);
      expect(await openButtonShown([{ name: "default" }], { hiddenMenus: ["logs"] })).toBe(true);
    });

    it("is hidden when the traces license is locked", async () => {
      expect(
        await openButtonShown([{ name: "default" }], {
          zoConfig: { features: { traces: "locked" } },
        }),
      ).toBe(false);
    });
  });

  it("shows an empty state and an error with Retry", async () => {
    mocks.search.mockResolvedValueOnce({ data: { hits: [] } });
    const wrapper = mountList();
    await flushPromises();
    await open(wrapper);
    expect(wrapper.find('[data-test="profiles-top-traces-empty"]').attributes("role")).toBe(
      "status",
    );

    mocks.search.mockRejectedValueOnce(new Error("search failed"));
    await wrapper.setProps({ service: "other" });
    await flushPromises();
    const error = wrapper.find('[data-test="profiles-top-traces-error"]');
    expect(error.text()).toContain("search failed");
    expect(error.attributes("role")).toBe("alert");

    mocks.search.mockResolvedValueOnce({ data: { hits } });
    await wrapper.find('[data-test="profiles-top-traces-retry"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(true);
  });

  describe("incomplete answers", () => {
    it("treats is_partial with hits as an error, not a list", async () => {
      mocks.search.mockResolvedValue({ data: { hits, is_partial: true } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-top-traces-error"]').text()).toContain(
        "incomplete",
      );
      expect(wrapper.find('[data-test="profiles-top-traces-retry"]').exists()).toBe(true);
    });

    it("treats a function_error with no hits as an error, not an empty list", async () => {
      mocks.search.mockResolvedValue({ data: { hits: [], function_error: ["shard failed"] } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-traces-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-top-traces-error"]').exists()).toBe(true);
    });

    it("does not cache an incomplete answer: Retry asks again", async () => {
      mocks.search.mockResolvedValueOnce({ data: { hits, is_partial: true } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      await wrapper.find('[data-test="profiles-top-traces-retry"]').trigger("click");
      await flushPromises();
      expect(mocks.search).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(true);
    });
  });

  it("queries again for a new run while open, and not while closed", async () => {
    const wrapper = mountList();
    await flushPromises();
    await wrapper.setProps({ service: "a" });
    await flushPromises();
    expect(mocks.search).not.toHaveBeenCalled();
    await open(wrapper);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ service: "b" });
    await flushPromises();
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  describe("revisions", () => {
    it("re-queries an identical run with new data, and the shares match the new run", async () => {
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(totals(wrapper)).toEqual(["75.00% · 75 ns", "25.00% · 25 ns"]);

      // The same inputs ran again, and the data (and its merge total) changed.
      mocks.search.mockResolvedValue({
        data: {
          hits: [
            { ...hits[1], total: 150 },
            { ...hits[0], total: 50 },
          ],
        },
      });
      await wrapper.setProps({ grandTotal: 200, revision: 2 });
      await flushPromises();
      expect(mocks.search).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="profiles-top-trace-0-id-full"]').text()).toBe(
        hits[1].trace_id,
      );
      expect(totals(wrapper)).toEqual(["75.00% · 150 ns", "25.00% · 50 ns"]);
    });

    it("keeps the shares of the list on screen until its own run's list arrives", async () => {
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);

      const pending = deferred<{ data: { hits: typeof hits } }>();
      mocks.search.mockReturnValueOnce(pending.promise);
      await wrapper.setProps({ grandTotal: 400, revision: 2 });
      await flushPromises();
      // Loading: the old list is not shown against the new total.
      expect(wrapper.find('[data-test="profiles-top-traces-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(false);

      pending.resolve({ data: { hits } });
      await flushPromises();
      expect(totals(wrapper)).toEqual(["18.75% · 75 ns", "6.25% · 25 ns"]);

      // A total that changes alone (no new run) does not rewrite the shares of the rows it was read with.
      await wrapper.setProps({ grandTotal: 1 });
      await flushPromises();
      expect(totals(wrapper)).toEqual(["18.75% · 75 ns", "6.25% · 25 ns"]);
    });

    it("serves the last result on collapse and expand, and re-queries after a new revision", async () => {
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(mocks.search).toHaveBeenCalledTimes(1);

      await wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");
      await open(wrapper);
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(true);

      await wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(mocks.search).toHaveBeenCalledTimes(1);
      await open(wrapper);
      expect(mocks.search).toHaveBeenCalledTimes(2);
    });
  });

  describe("stale responses", () => {
    it("discards a search that answers after a newer one", async () => {
      const first = deferred<{ data: { hits: typeof hits } }>();
      const second = deferred<{ data: { hits: typeof hits } }>();
      mocks.search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      await wrapper.setProps({ service: "other", grandTotal: 50, revision: 2 });
      await flushPromises();

      second.resolve({ data: { hits: [hits[1]] } });
      await flushPromises();
      first.resolve({ data: { hits } });
      await flushPromises();

      expect(wrapper.find('[data-test="profiles-top-trace-0-id-full"]').text()).toBe(
        hits[1].trace_id,
      );
      expect(wrapper.find('[data-test="profiles-top-trace-1"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-top-trace-0-total"]').text()).toBe(
        "50.00% · 25 ns",
      );
    });

    it("discards a schema answer for a stream that is no longer selected", async () => {
      const slow = deferred<{ data: { schema: { name: string }[] } }>();
      mocks.schema.mockImplementation((_org: string, stream: string) =>
        stream === "profiles-a"
          ? slow.promise
          : Promise.resolve({ data: { schema: [{ name: "value" }] } }),
      );
      const wrapper = mountList();
      await flushPromises();
      await wrapper.setProps({ stream: "profiles-b" });
      await flushPromises();
      slow.resolve({ data: { schema: [{ name: "trace_id" }] } });
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(false);
    });

    it("resets the trace_id column state when the stream changes", async () => {
      const wrapper = mountList();
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(true);

      const pending = deferred<{ data: { schema: { name: string }[] } }>();
      mocks.schema.mockReturnValueOnce(pending.promise);
      await wrapper.setProps({ stream: "profiles-b" });
      // Hidden while the new stream's schema is unknown.
      expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(false);
      pending.resolve({ data: { schema: [{ name: "value" }] } });
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces"]').exists()).toBe(false);
    });

    it("never blocks the list on the traces-stream lookup", async () => {
      mocks.nameList.mockReturnValue(new Promise(() => {}));
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-traces-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-top-trace-0-open"]').exists()).toBe(false);
    });

    it("discards a traces-stream answer for another org", async () => {
      const slow = deferred<{ data: { list: { name: string }[] } }>();
      mocks.nameList.mockImplementation((org: string) =>
        org === "org1" ? slow.promise : Promise.resolve({ data: { list: [] } }),
      );
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      await wrapper.setProps({ orgIdentifier: "org2", revision: 2 });
      await flushPromises();
      slow.resolve({ data: { list: [{ name: "org1-traces" }] } });
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-trace-0"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="profiles-top-trace-0-open"]').exists()).toBe(false);
    });
  });

  it("asks the server for fresh rows: use_cache=false, and the aborting signal", async () => {
    const wrapper = mountList();
    await flushPromises();
    await open(wrapper);
    // search(params, search_type, is_multi_stream_search, useCache)
    const [params, searchType, multi, useCache] = mocks.search.mock.calls[0];
    expect([searchType, multi, useCache]).toEqual(["ui", false, false]);
    expect(params.signal).toBeInstanceOf(AbortSignal);
  });

  it("shows Open trace whatever service_streams_enabled says", async () => {
    // Unlike the Logs View Trace action, which gives way to View Related when service streams are on.
    for (const enabled of [true, false, undefined]) {
      queryClient.clear();
      const wrapper = mountList(
        {},
        { zoConfig: { features: {}, service_streams_enabled: enabled } },
      );
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-trace-0-open"]').exists()).toBe(true);
      wrapper.unmount();
    }
  });

  describe("aborting searches", () => {
    type Answer = { data: { hits: typeof hits } };
    const signalOf = (call: number): AbortSignal => mocks.search.mock.calls[call][0].signal;

    it("aborts the search a newer run supersedes, and shows no error for it", async () => {
      const first = deferred<Answer>();
      const second = deferred<Answer>();
      mocks.search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(signalOf(0).aborted).toBe(false);

      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(signalOf(0).aborted).toBe(true);
      expect(signalOf(1).aborted).toBe(false);

      // What axios does for an aborted request.
      first.reject(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="profiles-top-traces-loading"]').exists()).toBe(true);

      second.resolve({ data: { hits } });
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces-error"]').exists()).toBe(false);
      expect(totals(wrapper)).toEqual(["75.00% · 75 ns", "25.00% · 25 ns"]);
    });

    it("aborts when the list is collapsed, and shows no error for it", async () => {
      const pending = deferred<Answer>();
      mocks.search.mockReturnValueOnce(pending.promise);
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(signalOf(0).aborted).toBe(false);

      await wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");
      expect(signalOf(0).aborted).toBe(true);
      pending.reject(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      await flushPromises();
      await wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="profiles-top-traces-error"]').exists()).toBe(false);
      expect(mocks.search).toHaveBeenCalledTimes(2);
    });

    it("aborts when the page deactivates it (the results are expanded over it)", async () => {
      mocks.search.mockReturnValueOnce(deferred<Answer>().promise);
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      await wrapper.setProps({ active: false });
      expect(signalOf(0).aborted).toBe(true);
    });

    it("aborts the search in flight when unmounted", async () => {
      mocks.search.mockReturnValueOnce(deferred<Answer>().promise);
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(signalOf(0).aborted).toBe(false);
      wrapper.unmount();
      expect(signalOf(0).aborted).toBe(true);
    });

    it("does not let a search for another key land after returning to a cached one", async () => {
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      const slow = deferred<Answer>();
      mocks.search.mockReturnValueOnce(slow.promise);
      await wrapper.setProps({ service: "other" });
      await flushPromises();
      // Back to the inputs of the cached result: the slow search is dropped and aborted.
      await wrapper.setProps({ service: "svc" });
      await flushPromises();
      expect(signalOf(1).aborted).toBe(true);
      slow.resolve({ data: { hits: [hits[1]] } });
      await flushPromises();
      expect(totals(wrapper)).toEqual(["75.00% · 75 ns", "25.00% · 25 ns"]);
    });
  });

  describe("a negative schema answer does not stick", () => {
    const noTraceId = { data: { schema: [{ name: "value" }] } };
    const withTraceId = { data: { schema: [{ name: "value" }, { name: "trace_id" }] } };
    const listShown = (wrapper: ReturnType<typeof mountList>) =>
      wrapper.find('[data-test="profiles-top-traces"]').exists();

    it("reads the schema again when the list is eligible again with a new run, once per run", async () => {
      mocks.schema.mockResolvedValue(noTraceId);
      const wrapper = mountList();
      await flushPromises();
      expect(listShown(wrapper)).toBe(false);
      expect(mocks.schema).toHaveBeenCalledTimes(1);

      // Trace-linked profiles are ingested; the run on screen has no trace links (inuse_*): nothing is read.
      mocks.schema.mockResolvedValue(withTraceId);
      await wrapper.setProps({ active: false, revision: 2 });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(1);
      expect(listShown(wrapper)).toBe(false);

      // Back to cpu: the cached negative answer does not defeat the re-read.
      await wrapper.setProps({ active: true, revision: 3 });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(2);
      expect(listShown(wrapper)).toBe(true);
    });

    it("re-reads once per revision, not on every change", async () => {
      mocks.schema.mockResolvedValue(noTraceId);
      const wrapper = mountList();
      await flushPromises();
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(2);
      // Same revision: the active flag moving and other props changing ask nothing.
      await wrapper.setProps({ active: false });
      await wrapper.setProps({ active: true });
      await wrapper.setProps({ service: "other" });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(2);
      await wrapper.setProps({ revision: 3 });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(3);
      expect(listShown(wrapper)).toBe(false);
    });

    it("re-reads when an eligible run completes, and then lists", async () => {
      mocks.schema.mockResolvedValue(noTraceId);
      const wrapper = mountList();
      await flushPromises();
      mocks.schema.mockResolvedValue(withTraceId);
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(listShown(wrapper)).toBe(true);
      // Found: no further schema reads for later runs.
      await wrapper.setProps({ revision: 3 });
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(2);
    });

    it("re-reads once when an older in-flight negative answer arrives for a newer run", async () => {
      const first = deferred<unknown>();
      mocks.schema.mockReturnValueOnce(first.promise).mockResolvedValue(withTraceId);
      const wrapper = mountList();
      await flushPromises();
      // The newer run's check joins the read still in flight.
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      first.resolve(noTraceId);
      await flushPromises();
      expect(mocks.schema).toHaveBeenCalledTimes(2);
      expect(listShown(wrapper)).toBe(true);
    });

    it("recovers from a failed schema call on the next run", async () => {
      mocks.schema.mockRejectedValue({ response: { status: 404 } });
      const wrapper = mountList();
      await flushPromises();
      expect(listShown(wrapper)).toBe(false);
      mocks.schema.mockResolvedValue(withTraceId);
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(listShown(wrapper)).toBe(true);
    });

    it("loads the list for an already open panel once the column appears", async () => {
      mocks.schema.mockResolvedValue(noTraceId);
      const wrapper = mountList({ expanded: true });
      await flushPromises();
      expect(mocks.search).not.toHaveBeenCalled();
      mocks.schema.mockResolvedValue(withTraceId);
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(mocks.search).toHaveBeenCalledTimes(1);
      expect(wrapper.find('[data-test="profiles-top-trace-0"]').exists()).toBe(true);
    });
  });

  describe("a negative traces-stream lookup does not stick", () => {
    const openShown = (wrapper: ReturnType<typeof mountList>) =>
      wrapper.find('[data-test="profiles-top-trace-0-open"]').exists();
    const toggle = (wrapper: ReturnType<typeof mountList>) =>
      wrapper.find('[data-test="profiles-top-traces-toggle"]').trigger("click");

    it("finds a traces stream created after the first open, on the next open", async () => {
      mocks.nameList.mockResolvedValue({ data: { list: [] } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(openShown(wrapper)).toBe(false);
      expect(mocks.nameList).toHaveBeenCalledTimes(1);

      mocks.nameList.mockResolvedValue({ data: { list: [{ name: "default" }] } });
      await toggle(wrapper);
      await toggle(wrapper);
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(2);
      expect(openShown(wrapper)).toBe(true);
    });

    it("does not ask again on a new run while it stays open", async () => {
      mocks.nameList.mockResolvedValue({ data: { list: [] } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(1);
    });

    it("does not retry a failed lookup on a new run while open, but does on the next open", async () => {
      mocks.nameList.mockRejectedValue({ response: { status: 404 } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(mocks.nameList).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ revision: 2 });
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(1);

      mocks.nameList.mockResolvedValue({ data: { list: [{ name: "default" }] } });
      await toggle(wrapper);
      await toggle(wrapper);
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(2);
      expect(openShown(wrapper)).toBe(true);
    });

    it("asks again only on a real open, not when active flips while expanded", async () => {
      mocks.nameList.mockResolvedValue({ data: { list: [] } });
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(mocks.nameList).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ active: false });
      await wrapper.setProps({ active: true });
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(1);
    });

    it("keeps a found stream without asking again", async () => {
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(openShown(wrapper)).toBe(true);
      await toggle(wrapper);
      await toggle(wrapper);
      await flushPromises();
      expect(mocks.nameList).toHaveBeenCalledTimes(1);
    });
  });

  describe("accessibility", () => {
    it("labels the controls and exposes the full id", async () => {
      const wrapper = mountList();
      await flushPromises();
      const toggle = wrapper.find('[data-test="profiles-top-traces-toggle"]');
      expect(toggle.attributes("aria-expanded")).toBe("false");
      // The panel does not exist while collapsed, so nothing is controlled yet.
      expect(toggle.attributes("aria-controls")).toBeUndefined();
      await open(wrapper);
      expect(toggle.attributes("aria-expanded")).toBe("true");
      const panelId = toggle.attributes("aria-controls");
      expect(panelId).toBeTruthy();
      expect(wrapper.element.querySelector(`[id="${panelId}"]`)).not.toBeNull();
      await open(wrapper);
      expect(toggle.attributes("aria-expanded")).toBe("false");
      expect(toggle.attributes("aria-controls")).toBeUndefined();
      await open(wrapper);

      const list = wrapper.find('[data-test="profiles-top-traces-list"]');
      expect(list.attributes("tabindex")).toBe("0");
      expect(list.attributes("aria-label")).toBe("Top traces");

      expect(wrapper.find('[data-test="profiles-top-trace-0-open"]').attributes("aria-label")).toBe(
        "Open trace aaaaaaaa…",
      );
      expect(wrapper.find('[data-test="profiles-top-trace-0-copy"]').attributes("aria-label")).toBe(
        "Copy trace ID aaaaaaaa…",
      );
      // The short id is for the eye; the full id is in text assistive technology reads.
      expect(wrapper.find('[data-test="profiles-top-trace-0-id"]').attributes("aria-hidden")).toBe(
        "true",
      );
      expect(wrapper.find('[data-test="profiles-top-trace-0-id-full"]').text()).toBe(
        hits[0].trace_id,
      );
    });

    it("announces loading as a status", async () => {
      mocks.search.mockReturnValue(new Promise(() => {}));
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      expect(wrapper.find('[data-test="profiles-top-traces-loading"]').attributes("role")).toBe(
        "status",
      );
    });

    it("does not truncate a long error", async () => {
      mocks.search.mockRejectedValue(new Error("x".repeat(300)));
      const wrapper = mountList();
      await flushPromises();
      await open(wrapper);
      const message = wrapper.find('[data-test="profiles-top-traces-error"] span');
      expect(message.text()).toBe("x".repeat(300));
      expect(message.classes()).not.toContain("truncate");
    });
  });
});
