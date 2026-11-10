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

// Uses the pack's default thresholds; thresholds tuned in the alert are not read back.

import { FAILING_TOOL_MIN_CALLS, REPEATED_TOOL_MIN_CALLS } from "@/utils/alerts/aiAgentsPack";

export type TraceIssueRule = "repeated_tool_calls" | "repeated_failing_tool_calls";

export interface TraceIssue {
  rule: TraceIssueRule;
  /** The calling span's own `gen_ai_agent_name`; null when the spans carry none. */
  agent: string | null;
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
  const groups = new Map<string, { agent: string | null; tool: string; calls: any[] }>();
  for (const s of spans) {
    if (s?.gen_ai_operation_name !== "execute_tool" || !s.gen_ai_tool_name) continue;
    const agent: string | null = s.gen_ai_agent_name || null;
    const key = JSON.stringify([agent, s.gen_ai_tool_name]);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { agent, tool: s.gen_ai_tool_name, calls: [] }));
    g.calls.push(s);
  }
  const issues: TraceIssue[] = [];
  for (const { agent, tool, calls } of groups.values()) {
    calls.sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));
    const failed = calls.filter((s) => s.span_status === "ERROR");
    const repeated = calls.length >= thresholds.calls;
    if (!repeated && failed.length < thresholds.failing) continue;
    const evidence = (repeated ? calls : failed).map((s) => String(s.span_id));
    issues.push({
      rule: repeated ? "repeated_tool_calls" : "repeated_failing_tool_calls",
      agent,
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
