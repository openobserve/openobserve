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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { pipelineHistoryQuery } from "./pipelines.queries";
import pipelines from "./pipelines";

vi.mock("./pipelines", () => ({
  default: { getPipelineHistory: vi.fn().mockResolvedValue({ data: { list: [] } }) },
}));

const ORG = "test-org";
// 5 s past a minute boundary, in microseconds, so +20 s stays inside the same bucket.
const END_US = 1_700_000_045_000_000;
const START_US = END_US - 5 * 60 * 1_000_000;
const params = { pipeline_id: "p1", start_time: String(START_US), end_time: String(END_US) };

describe("pipelineHistoryQuery", () => {
  beforeEach(() => {
    vi.mocked(pipelines.getPipelineHistory).mockClear();
  });

  it("buckets the window in the key so two opens inside the same minute share one entry", () => {
    const first = pipelineHistoryQuery(ORG, params);
    const second = pipelineHistoryQuery(ORG, {
      ...params,
      start_time: String(START_US + 20_000_000),
      end_time: String(END_US + 20_000_000),
    });
    expect(first.queryKey).toEqual(second.queryKey);
  });

  it("requests the caller's exact window — a bucketed end hides the current minute's runs", async () => {
    const options = pipelineHistoryQuery(ORG, params);
    await (options.queryFn as any)();
    expect(pipelines.getPipelineHistory).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ start_time: String(START_US), end_time: String(END_US) }),
    );
  });
});
