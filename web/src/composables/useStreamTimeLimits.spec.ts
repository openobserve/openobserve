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
import { combineStreamTimeLimits } from "./useStreamTimeLimits";

const state = {
  zoConfig: {
    max_query_range: 0,
    resolved_data_retention: { default: 30, logs: 30, metrics: 15, traces: 7, profiles: 3 },
  },
};

describe("stream time limits for the picker", () => {
  it("keeps the longest retention and the smallest query limit across streams", () => {
    const limits = combineStreamTimeLimits(
      [
        { type: "logs", settings: { data_retention: 90, max_query_range: 168 } },
        { type: "logs", settings: { max_query_range: 24 } },
      ],
      state,
    );
    expect(limits).toEqual({ retentionDays: 90, queryRangeRestrictionInHour: 24 });
  });

  it("falls back to the org retention for the stream type and the global query limit", () => {
    const limits = combineStreamTimeLimits([{ type: "traces", settings: {} }], {
      zoConfig: { ...state.zoConfig, max_query_range: 48 },
    });
    expect(limits).toEqual({ retentionDays: 7, queryRangeRestrictionInHour: 48 });
  });

  it("greys nothing while a stream is unknown or kept forever", () => {
    expect(
      combineStreamTimeLimits([{ type: "logs", settings: {} }, null], state).retentionDays,
    ).toBeUndefined();
    expect(
      combineStreamTimeLimits([{ type: "logs", settings: {} }], {
        zoConfig: { resolved_data_retention: { default: 0, logs: 0 } },
      }).retentionDays,
    ).toBeUndefined();
    expect(combineStreamTimeLimits([], state)).toEqual({
      retentionDays: undefined,
      queryRangeRestrictionInHour: 0,
    });
  });
});
