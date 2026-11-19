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
import { nextTick, ref } from "vue";
import { panelQueryStreams, panelRangeHours, usePanelNotices } from "./usePanelNotices";

const streamLimitCalls = vi.hoisted(() => [] as Array<() => unknown[]>);
vi.mock("@/composables/useStreamTimeLimits", () => ({
  useStreamTimeLimits: (streams: () => unknown[]) => {
    streamLimitCalls.push(streams);
    return ref({ retentionDays: undefined, queryRangeRestrictionInHour: 24 });
  },
}));

const VRL_ERROR = "error[E203]: syntax error";
const RANGE_CLAMP = "Query duration is modified due to query range restriction of 24 hours";

const diagnostics = (functionErrors: string[]) => ({
  queries: [],
  serverPartial: false,
  rowsCapped: false,
  partialReasons: [],
  functionErrors,
});

describe("usePanelNotices", () => {
  it("keeps a VRL error out of the range warning whichever event arrives first", () => {
    const notices = usePanelNotices(() => "UTC");
    notices.handleResultMetadataUpdate([[{ function_error: [VRL_ERROR, RANGE_CLAMP] }]]);
    expect(notices.maxQueryRangeWarning.value).toContain(VRL_ERROR);

    notices.handlePanelDiagnosticsUpdate(diagnostics([VRL_ERROR]));
    expect(notices.maxQueryRangeWarning.value).toBe(RANGE_CLAMP);
  });

  it("keeps the streaming range clamp on the range warning", () => {
    const streamingClamp =
      "Please be aware that the response is based on partial data \n reached max query range limit";
    const notices = usePanelNotices(() => "UTC");
    notices.handleResultMetadataUpdate([
      [{ is_partial: true, function_error: [streamingClamp], new_start_time: 1, new_end_time: 2 }],
    ]);
    notices.handlePanelDiagnosticsUpdate(diagnostics([]));
    expect(notices.maxQueryRangeWarning.value).toContain("reached max query range limit");
  });

  it("clears the range warning once a fixed function leaves only VRL errors behind", () => {
    const notices = usePanelNotices(() => "UTC");
    notices.handlePanelDiagnosticsUpdate(diagnostics([VRL_ERROR]));
    notices.handleResultMetadataUpdate([[{ function_error: [VRL_ERROR] }]]);
    expect(notices.maxQueryRangeWarning.value).toBe("");
  });

  it("maps diagnostics and the series cap onto the PanelErrorButtons props", () => {
    const notices = usePanelNotices(() => "UTC");
    notices.handlePanelDiagnosticsUpdate({
      ...diagnostics([VRL_ERROR]),
      serverPartial: true,
      rowsCapped: true,
      partialReasons: ["Warn: results are capped to meet default limit"],
    });
    notices.handleSeriesLimitUpdate({ shown: 100, total: 1000, cap: 100 });
    notices.handleSankeyNoticeUpdate({ returnLinks: 2, skippedRows: 1 });

    expect(notices.noticeProps.value).toEqual({
      seriesLimit: { shown: 100, total: 1000, cap: 100 },
      regionJoin: null,
      sankeyNotice: { returnLinks: 2, skippedRows: 1 },
      serverPartial: true,
      rowsCapped: true,
      serverPartialReasons: ["Warn: results are capped to meet default limit"],
      functionErrors: [VRL_ERROR],
      rangeLimitHours: 0,
      rangeOverLimit: false,
    });

    notices.resetNotices();
    expect(notices.noticeProps.value.functionErrors).toEqual([]);
    expect(notices.noticeProps.value.sankeyNotice).toBeNull();
    expect(notices.maxQueryRangeWarning.value).toBe("");
  });

  it("passes the maps region join to PanelErrorButtons and clears it on reset", () => {
    const notices = usePanelNotices(() => "UTC");
    const join = { unmatched: ["us-east-1"], unmatchedTotal: 1 };
    notices.handleRegionJoinUpdate(join);
    expect(notices.noticeProps.value.regionJoin).toEqual(join);

    notices.resetNotices();
    expect(notices.noticeProps.value.regionJoin).toBeNull();
  });

  describe("stream limit on panels the stream clips (B4)", () => {
    const CACHED_CLAMP =
      "Please be aware that the response is based on partial data \n reached max query range limit";
    const STREAMS = [{ name: "default", type: "logs" }];

    it("hands PanelErrorButtons the panel streams' limit for a clamp that names no hours", async () => {
      const notices = usePanelNotices(() => "UTC", { streams: () => STREAMS });
      notices.handleResultMetadataUpdate([[{ is_partial: true, function_error: [CACHED_CLAMP] }]]);
      await nextTick();
      expect(notices.noticeProps.value.rangeLimitHours).toBe(24);
    });

    it("marks a panel whose range is over its streams' limit even when the server says nothing", () => {
      streamLimitCalls.length = 0;
      const hours = ref(7 * 24);
      const notices = usePanelNotices(() => "UTC", {
        streams: () => STREAMS,
        rangeHours: () => hours.value,
      });
      expect(streamLimitCalls.at(-1)?.()).toEqual(STREAMS);
      expect(notices.noticeProps.value.rangeOverLimit).toBe(true);
      hours.value = 24;
      expect(notices.noticeProps.value.rangeOverLimit).toBe(false);
    });

    it("reports no limit for a host that names no streams", () => {
      const notices = usePanelNotices(() => "UTC");
      expect(notices.noticeProps.value.rangeLimitHours).toBe(0);
      expect(notices.noticeProps.value.rangeOverLimit).toBe(false);
    });
  });

  describe("panelQueryStreams / panelRangeHours", () => {
    it("lists the streams of a SQL panel and none for PromQL, whose metrics the limit does not clip", () => {
      const queries = [{ fields: { stream: "default", stream_type: "logs" } }];
      expect(panelQueryStreams({ queryType: "sql", queries })).toEqual([
        { name: "default", type: "logs" },
      ]);
      expect(panelQueryStreams({ queryType: "promql", queries })).toEqual([]);
    });

    it("measures a panel's time window in hours from the dashboard's microsecond Dates", () => {
      const end = new Date(Date.UTC(2026, 10, 17) * 1000);
      const start = new Date(Date.UTC(2026, 10, 10) * 1000);
      expect(panelRangeHours({ start_time: start, end_time: end })).toBe(168);
      expect(panelRangeHours({})).toBe(0);
    });
  });
});
