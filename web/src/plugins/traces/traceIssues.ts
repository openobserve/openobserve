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

/**
 * Issues on one trace (AIO-33): the ai-agents pack's tool rules run over the
 * trace's loaded spans, so the trace header, the chip on the evidence span and
 * the Issues tab agree with what the alert fires on. One issue per tool: when
 * both rules match, "Repeated tool calls" covers the failing calls too.
 *
 * ponytail: the pack's default thresholds; a threshold tuned in the alert is not
 * read back here. Read it from the installed alert if they drift apart.
 */

import { FAILING_TOOL_MIN_CALLS, REPEATED_TOOL_MIN_CALLS } from "@/utils/alerts/aiAgentsPack";

export type TraceIssueRule = "repeated_tool_calls" | "repeated_failing_tool_calls";

export interface TraceIssue {
  rule: TraceIssueRule;
  tool: string;
  calls: number;
  errors: number;
  threshold: number;
  /** The calls the rule counted, in start order. */
  evidence: string[];
  /** The chip goes on the last evidence span. */
  lastSpanId: string;
}

export function traceIssues(
  spans: any[],
  thresholds = { calls: REPEATED_TOOL_MIN_CALLS, failing: FAILING_TOOL_MIN_CALLS },
): TraceIssue[] {
  const byTool = new Map<string, any[]>();
  for (const s of spans) {
    if (s?.gen_ai_operation_name !== "execute_tool" || !s.gen_ai_tool_name) continue;
    byTool.set(s.gen_ai_tool_name, [...(byTool.get(s.gen_ai_tool_name) ?? []), s]);
  }
  const issues: TraceIssue[] = [];
  for (const [tool, calls] of byTool) {
    calls.sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));
    const failed = calls.filter((s) => s.span_status === "ERROR");
    const repeated = calls.length >= thresholds.calls;
    if (!repeated && failed.length < thresholds.failing) continue;
    const evidence = (repeated ? calls : failed).map((s) => String(s.span_id));
    issues.push({
      rule: repeated ? "repeated_tool_calls" : "repeated_failing_tool_calls",
      tool,
      calls: calls.length,
      errors: failed.length,
      threshold: repeated ? thresholds.calls : thresholds.failing,
      evidence,
      lastSpanId: evidence[evidence.length - 1],
    });
  }
  return issues.sort((a, b) => b.calls - a.calls);
}
