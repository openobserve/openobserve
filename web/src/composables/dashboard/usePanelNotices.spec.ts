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

import { describe, expect, it } from "vitest";
import { usePanelNotices } from "./usePanelNotices";

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
});
