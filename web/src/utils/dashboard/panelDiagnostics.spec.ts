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
import {
  omitFunctionErrorMessages,
  summarizePanelDiagnostics,
  summarizeQueryDiagnostics,
} from "./panelDiagnostics";
import { usePanelSearchHandlers } from "@/composables/dashboard/usePanelSearchHandlers";

const RANGE_CLAMP = "Query duration is modified due to query range restriction of 24 hours";
const VRL_ERROR = "function error: parse_json failed: unable to parse json";

describe("summarizeQueryDiagnostics", () => {
  it("sums took, scan size and scanned records over partitions", () => {
    const result = summarizeQueryDiagnostics(
      [
        { took: 400, scan_size: 120, scan_records: 1000, result_cache_ratio: 100 },
        { took: 840, scan_size: 220, scan_records: 2000, result_cache_ratio: 60 },
      ],
      { rows: [{}, {}, {}] },
    );
    expect(result).toMatchObject({
      took: 1240,
      scanSizeMb: 340,
      scanRecords: 3000,
      rowsReturned: 3,
      cacheRatio: 80,
      serverPartial: false,
    });
  });

  it("leaves values the server did not report undefined instead of zero", () => {
    const result = summarizeQueryDiagnostics([{ step: 15000000, trace_id: "t1" }], {
      queryType: "promql",
      rows: { resultType: "matrix", result: [{}, {}] },
    });
    expect(result.took).toBeUndefined();
    expect(result.scanSizeMb).toBeUndefined();
    expect(result.scanRecords).toBeUndefined();
    expect(result.cacheRatio).toBeUndefined();
    expect(result.rowsReturned).toBeUndefined();
    expect(result.seriesReturned).toBe(2);
  });

  it("flags server partial results when any partition is partial", () => {
    const result = summarizeQueryDiagnostics([{ is_partial: false }, { is_partial: true }]);
    expect(result.serverPartial).toBe(true);
  });

  it("keeps the server reason for a partial partition and dedupes it", () => {
    const reason = "Please be aware that the response is based on partial data";
    const result = summarizeQueryDiagnostics([
      { is_partial: true, function_error: [reason] },
      { is_partial: true, function_error: [reason] },
    ]);
    expect(result.serverPartial).toBe(true);
    expect(result.partialReasons).toEqual([reason]);
    expect(result.functionErrors).toEqual([]);
  });

  it("does not call a range clamp partial, since the range warning already explains it", () => {
    const result = summarizeQueryDiagnostics([
      { is_partial: true, function_error: [RANGE_CLAMP], new_start_time: 1, new_end_time: 2 },
    ]);
    expect(result.serverPartial).toBe(false);
    expect(result.partialReasons).toEqual([]);
    expect(result.functionErrors).toEqual([]);
  });

  it("recognises the streaming range clamp, which rides on the partial-data notice", () => {
    const streamingClamp =
      "Please be aware that the response is based on partial data \n reached max query range limit";
    const result = summarizeQueryDiagnostics(
      [{ is_partial: true, function_error: [streamingClamp], new_start_time: 1, new_end_time: 2 }],
      { queryHasFunction: true },
    );
    expect(result.serverPartial).toBe(false);
    expect(result.partialReasons).toEqual([]);
    expect(result.functionErrors).toEqual([]);
  });

  it("treats messages on a query with a VRL function as function errors, deduped", () => {
    const result = summarizeQueryDiagnostics(
      [{ function_error: [VRL_ERROR] }, { function_error: [VRL_ERROR, RANGE_CLAMP] }],
      { queryHasFunction: true },
    );
    expect(result.functionErrors).toEqual([VRL_ERROR]);
  });

  it("does not report a partial flag that a function failure already explains", () => {
    const result = summarizeQueryDiagnostics([{ is_partial: true, function_error: [VRL_ERROR] }], {
      queryHasFunction: true,
    });
    expect(result.serverPartial).toBe(false);
    expect(result.functionErrors).toEqual([VRL_ERROR]);
  });

  it("accepts a string function_error and an object-shaped entry", () => {
    const result = summarizeQueryDiagnostics(
      { took: 5, function_error: VRL_ERROR },
      { queryHasFunction: true },
    );
    expect(result.took).toBe(5);
    expect(result.functionErrors).toEqual([VRL_ERROR]);
  });
});

describe("summarizePanelDiagnostics", () => {
  it("summarises each query and unions the notices across queries", () => {
    const result = summarizePanelDiagnostics({
      resultMetaData: [
        [{ took: 10, function_error: [VRL_ERROR] }],
        [{ took: 20, is_partial: true }],
      ],
      data: [[{}], [{}, {}]],
      queryHasFunction: (index) => index === 0,
    });
    expect(result.queries).toHaveLength(2);
    expect(result.queries[1].rowsReturned).toBe(2);
    expect(result.functionErrors).toEqual([VRL_ERROR]);
    expect(result.serverPartial).toBe(true);
  });

  it("returns an empty summary for missing metadata", () => {
    expect(summarizePanelDiagnostics({ resultMetaData: undefined })).toEqual({
      queries: [],
      serverPartial: false,
      rowsCapped: false,
      partialReasons: [],
      functionErrors: [],
    });
  });

  it("marks the panel rows capped when the server hit its row limit", () => {
    const capped = [
      {
        is_partial: true,
        total: 1000,
        function_error: [
          "Warn: results are capped to meet default limit",
          "Please be aware that the response is based on partial data",
        ],
      },
    ];
    const result = summarizePanelDiagnostics({
      resultMetaData: [capped],
      queryHasFunction: () => true,
    });
    expect(result.rowsCapped).toBe(true);
    expect(result.serverPartial).toBe(true);
    expect(result.functionErrors).toEqual([]);
    expect(result.partialReasons).toContain("Warn: results are capped to meet default limit");
  });

  it("merges the partitions the streaming handlers store for a query", () => {
    const state: any = {
      data: [],
      resultMetaData: [],
      loading: true,
      errorDetail: { message: "", code: "" },
      metadata: { queries: [{ startTime: 0, endTime: 10 }] },
    };
    const { handleSearchResponse } = usePanelSearchHandlers({
      state,
      processApiError: vi.fn(),
      saveCurrentStateToCache: vi.fn(),
      loadData: vi.fn(),
      removeTraceId: vi.fn(),
    });
    const payload = { meta: { currentQueryIndex: 0 } };
    handleSearchResponse(payload, {
      type: "search_response_metadata",
      content: { results: { took: 100, scan_size: 10, scan_records: 50, is_partial: false } },
    });
    handleSearchResponse(payload, {
      type: "search_response_metadata",
      content: { results: { took: 200, scan_size: 30, scan_records: 70, is_partial: true } },
    });
    state.data[0] = [{}, {}, {}, {}];

    const summary = summarizePanelDiagnostics({
      resultMetaData: state.resultMetaData,
      data: state.data,
    });

    expect(summary.queries[0]).toMatchObject({
      took: 300,
      scanSizeMb: 40,
      scanRecords: 120,
      rowsReturned: 4,
      serverPartial: true,
    });
  });
});

describe("omitFunctionErrorMessages", () => {
  it("drops only the routed messages and leaves the range clamp for the legacy warning", () => {
    const metadata = [[{ function_error: [VRL_ERROR, RANGE_CLAMP], took: 1 }]];
    const result = omitFunctionErrorMessages(metadata, [VRL_ERROR]);
    expect(result[0][0].function_error).toEqual([RANGE_CLAMP]);
    expect(result[0][0].took).toBe(1);
    expect(metadata[0][0].function_error).toHaveLength(2);
  });

  it("clears function_error when nothing is left", () => {
    const result = omitFunctionErrorMessages([[{ function_error: [VRL_ERROR] }]], [VRL_ERROR]);
    expect(result[0][0].function_error).toBeUndefined();
  });

  it("returns the input untouched when there is nothing to omit", () => {
    const metadata = [[{ function_error: [VRL_ERROR] }]];
    expect(omitFunctionErrorMessages(metadata, [])).toBe(metadata);
  });
});

describe("summarizePanelDiagnostics with sparse PromQL metadata", () => {
  it("summarises holes as empty queries instead of crashing", () => {
    const resultMetaData: unknown[] = [];
    resultMetaData[1] = [{ took: 20, is_partial: true }];
    const result = summarizePanelDiagnostics({ resultMetaData, queryType: "promql" });
    expect(result.queries).toHaveLength(2);
    expect(result.queries[0].partialReasons).toEqual([]);
    expect(result.queries[0].functionErrors).toEqual([]);
    expect(result.serverPartial).toBe(true);
  });
});
