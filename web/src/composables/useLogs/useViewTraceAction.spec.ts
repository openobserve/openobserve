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
import { flushPromises } from "@vue/test-utils";
import { gt } from "@/types/i18n";

const { mockGetStreams } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
  }),
}));

// The composable resolves the store itself, so the whole vuex module is mocked
// and `mockStore.state` is re-seeded per test rather than mutated across tests.
const mockStore: any = { state: {} };

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

import useViewTraceAction from "./useViewTraceAction";

const TRACE_ID_FIELD = "trace_id";

/** A log record that carries the configured trace id field. */
const recordWithTraceId = { [TRACE_ID_FIELD]: "abc-123", message: "hello" };

/** A log record from a stream that never emits a trace id. */
const recordWithoutTraceId = { message: "hello" };

/** Fresh search state per test — the real one is shared module state. */
const makeSearchObj = (selectedTraceStream = "") => ({
  meta: { selectedTraceStream },
});

describe("useViewTraceAction", () => {
  let searchObj: ReturnType<typeof makeSearchObj>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStore.state = {
      // `false` is the only value that enables the action — see the gate tests.
      zoConfig: { service_streams_enabled: false },
      hiddenMenus: [],
      organizationData: {
        organizationSettings: { trace_id_field_name: TRACE_ID_FIELD },
      },
    };

    mockGetStreams.mockResolvedValue({
      list: [{ name: "trace-stream1" }, { name: "trace-stream2" }],
    });

    searchObj = makeSearchObj();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initial state", () => {
    it("starts with no streams, nothing loading and the button hidden", () => {
      const action = useViewTraceAction(gt, searchObj);

      expect(action.tracesStreams.value).toEqual([]);
      expect(action.filteredTracesStreamOptions.value).toEqual([]);
      expect(action.isTracesStreamsLoading.value).toBe(false);
      expect(action.showViewTraceBtn.value).toBe(false);
    });

    it("does not fetch streams until the action is evaluated", () => {
      useViewTraceAction(gt, searchObj);

      expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("gives each caller its own refs so JsonPreview and DetailTable do not share state", () => {
      const first = useViewTraceAction(gt, searchObj);
      const second = useViewTraceAction(gt, searchObj);

      first.tracesStreams.value = ["only-mine"];

      expect(second.tracesStreams.value).toEqual([]);
    });
  });

  describe("setViewTraceBtn — gate", () => {
    it("shows the button when the menu is visible, service streams are off and the record has a trace id", async () => {
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeTruthy();
    });

    it("hides the button when the traces menu is hidden", async () => {
      mockStore.state.hiddenMenus = new Set(["traces"]);
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("hides the button when service streams are enabled", async () => {
      mockStore.state.zoConfig.service_streams_enabled = true;
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("treats service streams as enabled when the flag is missing entirely", async () => {
      mockStore.state.zoConfig = {};
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("hides the button when the record has no trace id field", async () => {
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithoutTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("hides the button when the record's trace id is an empty string", async () => {
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn({ [TRACE_ID_FIELD]: "" });
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("hides the button when the org has no trace id field configured", async () => {
      mockStore.state.organizationData.organizationSettings = {};
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("re-evaluates on every call, so the button can go from shown to hidden", async () => {
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();
      expect(showViewTraceBtn.value).toBeTruthy();

      setViewTraceBtn(recordWithoutTraceId);
      await flushPromises();
      expect(showViewTraceBtn.value).toBeFalsy();
    });
  });

  describe("setViewTraceBtn — missing record (row-detail drawer regression)", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an empty object", {}],
    ])("does not throw and hides the button when the record is %s", async (_label, record) => {
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      expect(() => setViewTraceBtn(record)).not.toThrow();
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
      expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("does not throw when the org settings are not loaded yet", async () => {
      mockStore.state.organizationData = {};
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      expect(() => setViewTraceBtn(recordWithTraceId)).not.toThrow();
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });
  });

  describe("setViewTraceBtn — hiddenMenus shape", () => {
    // `hiddenMenus` is seeded as an array by the store and only replaced with a
    // Set by MainLayout, so both shapes reach this code. Calling `.has` on the
    // array shape used to crash the drawer.
    it("hides the button when hiddenMenus is a Set containing 'traces'", async () => {
      mockStore.state.hiddenMenus = new Set(["traces"]);
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("shows the button when hiddenMenus is a Set without 'traces'", async () => {
      mockStore.state.hiddenMenus = new Set(["metrics"]);
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(showViewTraceBtn.value).toBeTruthy();
    });

    it("hides the button when hiddenMenus is an Array containing 'traces'", async () => {
      mockStore.state.hiddenMenus = ["traces"];
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      expect(() => setViewTraceBtn(recordWithTraceId)).not.toThrow();
      await flushPromises();

      expect(showViewTraceBtn.value).toBeFalsy();
    });

    it("shows the button when hiddenMenus is an Array without 'traces'", async () => {
      mockStore.state.hiddenMenus = ["metrics"];
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      expect(() => setViewTraceBtn(recordWithTraceId)).not.toThrow();
      await flushPromises();

      expect(showViewTraceBtn.value).toBeTruthy();
    });

    it("shows the button when hiddenMenus is undefined", async () => {
      mockStore.state.hiddenMenus = undefined;
      const { setViewTraceBtn, showViewTraceBtn } = useViewTraceAction(gt, searchObj);

      expect(() => setViewTraceBtn(recordWithTraceId)).not.toThrow();
      await flushPromises();

      expect(showViewTraceBtn.value).toBeTruthy();
    });
  });

  describe("setViewTraceBtn — lazy stream loading", () => {
    it("fetches the traces streams the first time the button is shown", async () => {
      const { setViewTraceBtn, filteredTracesStreamOptions } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      expect(mockGetStreams).toHaveBeenCalledWith("traces", false);
      expect(filteredTracesStreamOptions.value).toEqual(["trace-stream1", "trace-stream2"]);
    });

    it("does not refetch once the options are populated", async () => {
      const { setViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();
      expect(mockGetStreams).toHaveBeenCalledTimes(1);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });

    it("does not fetch when the gate fails, even with empty options", async () => {
      mockStore.state.hiddenMenus = new Set(["traces"]);
      const { setViewTraceBtn } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("does not refetch for an org whose stream list came back empty", async () => {
      // The guard latches on a *completed* fetch rather than on
      // `filteredTracesStreamOptions.length`. An org with no traces streams
      // leaves that array empty forever, so the old check re-fetched on every
      // record; this is the case that regressed.
      mockGetStreams.mockResolvedValue({ list: [] });
      const { setViewTraceBtn, filteredTracesStreamOptions } = useViewTraceAction(gt, searchObj);

      setViewTraceBtn(recordWithTraceId);
      await flushPromises();
      setViewTraceBtn(recordWithTraceId);
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      expect(filteredTracesStreamOptions.value).toEqual([]);
    });
  });

  describe("getTracesStreams", () => {
    it("maps the response list to stream names", async () => {
      const { getTracesStreams, tracesStreams } = useViewTraceAction(gt, searchObj);

      await getTracesStreams();
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledWith("traces", false);
      expect(tracesStreams.value).toEqual(["trace-stream1", "trace-stream2"]);
    });

    it("copies the names into the filter options without sharing the array reference", async () => {
      const { getTracesStreams, tracesStreams, filteredTracesStreamOptions } = useViewTraceAction(
        gt,
        searchObj,
      );

      await getTracesStreams();
      await flushPromises();

      expect(filteredTracesStreamOptions.value).toEqual(tracesStreams.value);
      expect(filteredTracesStreamOptions.value).not.toBe(tracesStreams.value);
    });

    it("raises the loading flag while fetching and clears it once resolved", async () => {
      const { getTracesStreams, isTracesStreamsLoading } = useViewTraceAction(gt, searchObj);

      // The call awaits the fetch internally, so the flag is only observable
      // as true before the returned promise settles.
      const pending = getTracesStreams();
      expect(isTracesStreamsLoading.value).toBe(true);

      await pending;
      expect(isTracesStreamsLoading.value).toBe(false);
    });

    it("selects the first stream when nothing is selected yet", async () => {
      const { getTracesStreams } = useViewTraceAction(gt, searchObj);

      await getTracesStreams();
      await flushPromises();

      expect(searchObj.meta.selectedTraceStream).toBe("trace-stream1");
    });

    it("keeps an existing selection instead of overwriting it", async () => {
      searchObj = makeSearchObj("already-chosen-stream");
      const { getTracesStreams } = useViewTraceAction(gt, searchObj);

      await getTracesStreams();
      await flushPromises();

      expect(searchObj.meta.selectedTraceStream).toBe("already-chosen-stream");
    });

    it("handles an empty stream list without throwing", async () => {
      mockGetStreams.mockResolvedValue({ list: [] });
      const { getTracesStreams, tracesStreams, filteredTracesStreamOptions } = useViewTraceAction(
        gt,
        searchObj,
      );

      await getTracesStreams();
      await flushPromises();

      expect(tracesStreams.value).toEqual([]);
      expect(filteredTracesStreamOptions.value).toEqual([]);
      // Nothing to select, so the existing (empty) selection is left alone.
      // Assigning `undefined` here used to make the *next* call throw on
      // `selectedTraceStream.length`.
      expect(searchObj.meta.selectedTraceStream).toBe("");
    });

    it("does not throw and leaves loading false when the fetch rejects", async () => {
      mockGetStreams.mockRejectedValue(new Error("Fetch failed"));
      const { getTracesStreams, isTracesStreamsLoading, tracesStreams } = useViewTraceAction(
        gt,
        searchObj,
      );

      await expect(getTracesStreams()).resolves.toBeUndefined();
      await flushPromises();

      expect(isTracesStreamsLoading.value).toBe(false);
      expect(tracesStreams.value).toEqual([]);
      expect(searchObj.meta.selectedTraceStream).toBe("");
    });

    it("does not throw when getStreams throws synchronously", async () => {
      mockGetStreams.mockImplementation(() => {
        throw new Error("boom");
      });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const { getTracesStreams, isTracesStreamsLoading } = useViewTraceAction(gt, searchObj);

      await expect(getTracesStreams()).resolves.toBeUndefined();

      expect(isTracesStreamsLoading.value).toBe(false);
      expect(consoleError).toHaveBeenCalledWith("Failed to get traces streams", expect.any(Error));
    });
  });

  describe("filterStreamFn", () => {
    const seedStreams = (streams: string[]) => {
      const action = useViewTraceAction(gt, searchObj);
      action.tracesStreams.value = streams;
      return action;
    };

    it("keeps only the streams matching the term", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams([
        "trace-stream1",
        "trace-stream2",
        "other-stream",
      ]);

      filterStreamFn("trace");

      expect(filteredTracesStreamOptions.value).toEqual(["trace-stream1", "trace-stream2"]);
    });

    it("matches case-insensitively in both directions", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams([
        "Trace-Stream1",
        "trace-stream2",
        "Other-Stream",
      ]);

      filterStreamFn("TRACE");

      expect(filteredTracesStreamOptions.value).toEqual(["Trace-Stream1", "trace-stream2"]);
    });

    it("matches on a substring anywhere in the name", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams([
        "prod-traces",
        "dev-logs",
      ]);

      filterStreamFn("traces");

      expect(filteredTracesStreamOptions.value).toEqual(["prod-traces"]);
    });

    it("returns every stream for an empty term", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams(["stream1", "stream2"]);

      filterStreamFn("");

      expect(filteredTracesStreamOptions.value).toEqual(["stream1", "stream2"]);
    });

    it("returns every stream when called with no argument", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams(["stream1", "stream2"]);

      filterStreamFn();

      expect(filteredTracesStreamOptions.value).toEqual(["stream1", "stream2"]);
    });

    it("returns nothing when no stream matches", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams(["stream1", "stream2"]);

      filterStreamFn("no-such-stream");

      expect(filteredTracesStreamOptions.value).toEqual([]);
    });

    it("narrows further on a second, longer term", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams([
        "trace-stream1",
        "trace-stream2",
        "other-stream",
      ]);

      filterStreamFn("trace");
      filterStreamFn("trace-stream2");

      expect(filteredTracesStreamOptions.value).toEqual(["trace-stream2"]);
    });

    it("filters against the full list, not the previously filtered one", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = seedStreams([
        "trace-stream1",
        "other-stream",
      ]);

      filterStreamFn("trace");
      filterStreamFn("other");

      expect(filteredTracesStreamOptions.value).toEqual(["other-stream"]);
    });

    it("returns nothing when no streams have been loaded", () => {
      const { filterStreamFn, filteredTracesStreamOptions } = useViewTraceAction(gt, searchObj);

      filterStreamFn("trace");

      expect(filteredTracesStreamOptions.value).toEqual([]);
    });
  });
});
