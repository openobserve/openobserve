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

import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { gt } from "@/types/i18n";
import { sanitizeAlertNamePart, warn } from "../alertPrefill";
import {
  AI_AGENTS_PACK,
  agentToolScope,
  costSql,
  failureRateSql,
  judgeErrorRateSql,
  repeatedToolCallsSql,
  scoresStoppedSql,
} from "../aiAgentsPack";

/** Eval job templates read the evaluator's streams and are scoped by job id. */
export type AiJobAlertKind = "eval_scores_stopped" | "eval_judge_error_rate";
export type AiAlertKind = "failure_rate" | "cost" | "repeated_tool_calls" | AiJobAlertKind;

export interface AiPrefillInput {
  kind: AiAlertKind;
  stream: string;
  /** The agent (and tool) in scope on the page; none = every agent. */
  agent?: string | null;
  tool?: string | null;
  /** The eval job in scope, for the job templates; `jobName` names the alert. */
  jobId?: string | null;
  jobName?: string | null;
}

const isJobKind = (kind: AiAlertKind): kind is AiJobAlertKind => kind.startsWith("eval_");

/** Alert prefill from an AI page, using the pack's SQL and schedule so it agrees with an installed pack. */
export const buildAiPrefill = (input: AiPrefillInput): AlertPrefill => {
  if (isJobKind(input.kind)) return buildJobPrefill(input, input.kind);
  const rule = AI_AGENTS_PACK.find((r) => r.id === input.kind)!;
  const spec = rule.spec!(input.stream);
  const scope = agentToolScope(input.stream, input.agent, input.tool);
  const sql = scope ? scopedSql(input, scope) : spec.sql;
  const subject = [input.agent, input.tool].filter(Boolean).join("_") || input.stream;
  return {
    version: ALERT_PREFILL_VERSION,
    source: "ai",
    sourceLabel: gt(rule.titleKey),
    name: sanitizeAlertNamePart(`${subject}_${input.kind}`, input.kind),
    streamType: "traces",
    streamName: input.stream,
    queryType: "sql",
    sql,
    periodMinutes: spec.periodMinutes,
    frequencyMinutes: spec.frequencyMinutes,
    silenceMinutes: spec.silenceMinutes,
    thresholdShape: "count",
    triggerThreshold: 1,
    triggerOperator: ">=",
    // Without an agent the alert covers the whole stream; it still runs, so say so.
    warnings: input.agent
      ? []
      : [warn(input.kind === "cost" ? "aiAllAgentsByModel" : "aiAllAgents", "info")],
    meta: { kind: input.kind, agent: input.agent ?? null, tool: input.tool ?? null },
  };
};

function scopedSql(input: AiPrefillInput, scope: string): string {
  if (input.kind === "failure_rate") return failureRateSql(input.stream, { scope });
  if (input.kind === "cost") return costSql(input.stream, { scope });
  return repeatedToolCallsSql(input.stream, { scope });
}

/** One job's template: the pack's query narrowed to the job, on the stream the evaluator writes. */
function buildJobPrefill(input: AiPrefillInput, kind: AiJobAlertKind): AlertPrefill {
  const rule = AI_AGENTS_PACK.find((r) => r.id === kind)!;
  const spec = rule.spec!(input.stream);
  const jobId = input.jobId ?? null;
  const sql =
    kind === "eval_scores_stopped" ? scoresStoppedSql({ jobId }) : judgeErrorRateSql({ jobId });
  return {
    version: ALERT_PREFILL_VERSION,
    source: "ai",
    sourceLabel: gt(rule.titleKey),
    name: sanitizeAlertNamePart(`${input.jobName || jobId || "eval_jobs"}_${kind}`, kind),
    streamType: spec.streamType,
    streamName: spec.streamName,
    queryType: "sql",
    sql,
    periodMinutes: spec.periodMinutes,
    frequencyMinutes: spec.frequencyMinutes,
    silenceMinutes: spec.silenceMinutes,
    thresholdShape: "count",
    triggerThreshold: 1,
    triggerOperator: ">=",
    warnings: [],
    meta: { kind, jobId },
  };
}
