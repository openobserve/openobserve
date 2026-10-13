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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { useSearchAround } from "./searchAround";
import { useLogsAutoRun } from "./logsAutoRun";

const searchAroundMock = vi.hoisted(() => vi.fn());
const searchObj = vi.hoisted(() => ({ value: null as any }));

vi.mock("@/services/search", () => ({
  default: { search_around: searchAroundMock },
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: searchObj.value, notificationMsg: { value: "" } }),
}));

vi.mock("@/composables/useLogs/logsUtils", () => ({
  logsUtils: () => ({
    fnParsedSQL: () => ({ columns: [], from: [{ table: "stream1" }], where: {} }),
    fnUnparsedSQL: () => 'SELECT * FROM "stream1"',
    addTraceId: vi.fn(),
    removeTraceId: vi.fn(),
    shouldAddFunctionToSearch: () => false,
  }),
}));

vi.mock("@/composables/useLogs/useStreamFields", () => ({
  default: () => ({
    extractFields: vi.fn(),
    updateGridColumns: vi.fn(),
    filterHitsColumns: vi.fn(),
  }),
}));

vi.mock("@/composables/useLogs/useHistogram", () => ({
  default: () => ({
    generateHistogramData: vi.fn(),
    generateHistogramSkeleton: vi.fn(),
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

const buildSearchObj = (selectedStream: string[], sqlMode = false) => ({
  organizationIdentifier: "default",
  loading: false,
  loadingProgressPercentage: 0,
  meta: { sqlMode, quickMode: false, showHistogram: false },
  data: {
    query: "",
    errorCode: 0,
    functionError: "",
    tempFunctionContent: "",
    stream: {
      selectedStream,
      streamType: "logs",
      missingStreamMultiStreamFilter: [],
      interestingFieldList: [],
      selectedStreamFields: [],
    },
    histogram: { chartParams: { title: "", titleParts: null } },
    searchAround: { histogramHide: false },
    queryResults: {},
  },
});

const TestComponent = defineComponent({
  setup() {
    return { ...useSearchAround() };
  },
  template: "<div></div>",
});

const decodeSql = (sql: string) => atob(sql.replace(/-/g, "+").replace(/_/g, "/"));

describe("useSearchAround", () => {
  let wrapper: any;

  beforeEach(() => {
    searchAroundMock.mockResolvedValue({
      data: { from: 0, scan_size: 1, took: 1, hits: [{ _timestamp: 1 }, { _timestamp: 2 }] },
    });
  });

  const run = async (selectedStream: string[], body: any, sqlMode = false) => {
    searchObj.value = buildSearchObj(selectedStream, sqlMode);
    wrapper = mount(TestComponent, { global: { plugins: [i18n] } });
    wrapper.vm.searchAroundData({ key: "1700000000000000", size: 10, body });
    await flushPromises();
    return searchAroundMock.mock.calls[0][0];
  };

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("searches around the hit's own stream when several streams are selected", async () => {
    const body = { _timestamp: 1700000000000000, _stream_name: "stream2" };
    const request = await run(["stream1", "stream2"], body);

    expect(request.index).toBe("stream2");
    expect(request.is_multistream).toBe(false);
    expect(request.body).toBe(body);
    expect(request.query_context).toHaveLength(1);
    expect(decodeSql(request.query_context[0])).toContain('FROM "stream2"');
  });

  it("uses the hit's stream in SQL mode too", async () => {
    const request = await run(
      ["stream1", "stream2"],
      { _timestamp: 1700000000000000, _stream_name: "stream2" },
      true,
    );

    expect(request.index).toBe("stream2");
    expect(request.is_multistream).toBe(false);
    expect(request.query_context).toEqual([b64EncodeUnicode('SELECT * FROM "stream2"')]);
  });

  it("tags the returned hits with the hit's stream name", async () => {
    await run(["stream1", "stream2"], { _timestamp: 1700000000000000, _stream_name: "stream2" });

    expect(searchObj.value.data.queryResults.hits).toEqual([
      { _timestamp: 1, _stream_name: "stream2" },
      { _timestamp: 2, _stream_name: "stream2" },
    ]);
  });

  describe("cancellation aborts the HTTP request (F4)", () => {
    const startPending = async () => {
      searchAroundMock.mockReturnValue(new Promise(() => undefined));
      await run(["stream1"], { _timestamp: 1700000000000000 });
      const signal: AbortSignal | undefined = searchAroundMock.mock.calls[0][0].signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
      return signal as AbortSignal;
    };

    it("aborts the in-flight request when the user cancels", async () => {
      const signal = await startPending();
      useLogsAutoRun().engine.cancelGeneration(null, { cause: "user" });
      expect(signal.aborted).toBe(true);
    });

    it("aborts the in-flight request when a new run replaces it", async () => {
      const signal = await startPending();
      useLogsAutoRun().engine.newGeneration({
        lane: "grid",
        kind: "explicit",
        reason: "run",
        op: "full",
        signature: useLogsAutoRun().readSignature(),
      });
      expect(signal.aborted).toBe(true);
    });

    it("leaves the page untouched when the aborted request rejects", async () => {
      let reject: (error: unknown) => void = () => undefined;
      searchAroundMock.mockReturnValue(
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
      );
      await run(["stream1"], { _timestamp: 1700000000000000 });
      useLogsAutoRun().engine.cancelGeneration(null, { cause: "user" });
      reject(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      await flushPromises();
      expect(searchObj.value.data.errorMsg).toBeUndefined();
    });
  });

  describe("error state (L-25)", () => {
    it("shows the server error and its trace id on a 4xx", async () => {
      searchAroundMock.mockRejectedValue({
        response: { data: { error: "bad key", error_detail: "detail", trace_id: "t-1", code: 0 } },
        request: { status: 404 },
      });
      await run(["stream1"], { _timestamp: 1700000000000000 });
      expect(searchObj.value.data.errorMsg).toContain("bad key");
      expect(searchObj.value.data.errorMsg).toContain("TraceID:t-1");
      expect(searchObj.value.data.errorDetail).toBe("detail");
      expect(searchObj.value.loading).toBe(false);
    });

    it("shows the server message for a 400", async () => {
      searchAroundMock.mockRejectedValue({
        response: { data: { error: "x", message: "invalid sql", code: 0 } },
        request: { status: 400 },
      });
      await run(["stream1"], { _timestamp: 1700000000000000 });
      expect(searchObj.value.data.errorMsg).toBe("invalid sql");
    });

    it("shows a network error without a response", async () => {
      searchAroundMock.mockRejectedValue({ message: "Network Error", trace_id: "t-2" });
      await run(["stream1"], { _timestamp: 1700000000000000 });
      expect(searchObj.value.data.errorMsg).toContain("Network Error");
      expect(searchObj.value.data.errorMsg).toContain("TraceID:t-2");
    });
  });

  it("appends a later page of around hits to the current results", async () => {
    searchObj.value = buildSearchObj(["stream1"]);
    searchObj.value.data.queryResults = {
      from: 0,
      scan_size: 1,
      took: 1,
      hits: [{ _timestamp: 9 }],
    };
    searchAroundMock.mockResolvedValue({
      data: { from: 10, scan_size: 2, took: 3, hits: [{ _timestamp: 1 }] },
    });
    wrapper = mount(TestComponent, { global: { plugins: [i18n] } });
    wrapper.vm.searchAroundData({ key: "1", size: 10, body: { _timestamp: 1 } });
    await flushPromises();
    expect(searchObj.value.data.queryResults).toMatchObject({
      from: 10,
      scan_size: 3,
      took: 4,
      hits: [{ _timestamp: 9 }, { _timestamp: 1 }],
    });
  });

  it("keeps the single-stream request unchanged", async () => {
    const request = await run(["stream1"], { _timestamp: 1700000000000000 });

    expect(request.index).toBe("stream1");
    expect(request.is_multistream).toBe(false);
    expect(decodeSql(request.query_context[0])).toContain('FROM "stream1"');
    expect(searchObj.value.data.queryResults.hits).toEqual([{ _timestamp: 1 }, { _timestamp: 2 }]);
  });
});
