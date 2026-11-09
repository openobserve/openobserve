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

import { describe, it, expect } from "vitest";
import { traceIssues } from "./traceIssues";

const call = (i: number, tool: string, error = false) => ({
  span_id: `s${i}`,
  start_time: i,
  gen_ai_operation_name: "execute_tool",
  gen_ai_tool_name: tool,
  span_status: error ? "ERROR" : "UNSET",
});

describe("issues on one trace (AIO-33)", () => {
  it("raises one issue per tool, with the chip on the last call", () => {
    // 12 web_search calls, 9 failing: both rules match, one issue.
    const spans = [
      ...Array.from({ length: 12 }, (_, i) => call(12 - i, "web_search", i < 9)),
      call(20, "fetch", false),
      { span_id: "root", gen_ai_operation_name: "invoke_agent" },
    ];
    const [issue, ...rest] = traceIssues(spans);
    expect(rest).toHaveLength(0);
    expect(issue).toMatchObject({
      rule: "repeated_tool_calls",
      tool: "web_search",
      calls: 12,
      errors: 9,
      threshold: 10,
      lastSpanId: "s12",
    });
    expect(issue.evidence[0]).toBe("s1");
  });

  it("flags failing calls below the loop threshold, and a clean trace has none", () => {
    const failing = [call(1, "db", true), call(2, "db", true), call(3, "db", true), call(4, "db")];
    expect(traceIssues(failing)).toEqual([
      expect.objectContaining({
        rule: "repeated_failing_tool_calls",
        evidence: ["s1", "s2", "s3"],
        lastSpanId: "s3",
      }),
    ]);
    expect(traceIssues([call(1, "db"), call(2, "db", true)])).toEqual([]);
  });
});
