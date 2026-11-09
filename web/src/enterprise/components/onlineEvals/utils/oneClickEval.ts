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

import type { EvalJobPayload } from "@/services/online-evals.service";
import type { CompletionWindowDefaults } from "./completionWindow";
import { DEFAULT_BUDGET_ACTION, DEFAULT_DAILY_BUDGET_USD } from "./evalSpend";

/** Built-in catalog judges the one-click dialog offers (AIO-23), in order. */
export const ONE_CLICK_JUDGES = ["hallucination", "answer_relevance", "helpfulness", "toxicity"];

/** Trace-scope system variables: the root LLM call's input and output. */
export const ONE_CLICK_MAPPING = { input: "{{input}}", output: "{{output}}" } as const;

/** SQL WHERE body of the one-click job's filter, for the traffic estimate. */
export function oneClickWhere(agent: string | null): string {
  return agent ? `gen_ai_agent_name = '${agent.replace(/'/g, "''")}'` : "";
}

/** A sampled, trace-scoped job for one agent (or the whole stream). */
export function buildOneClickJob(opts: {
  agent: string | null;
  stream: string;
  scorerIds: string[];
  judgeNames: string[];
  rate: number;
  completion: CompletionWindowDefaults;
}): EvalJobPayload {
  const subject = opts.agent || opts.stream;
  return {
    name: `${subject} ${opts.judgeNames.join(", ")}`,
    description: `One-click evaluation of ${subject}`,
    stream: opts.stream,
    streamType: "traces",
    targetScope: "trace",
    filterCondition: opts.agent
      ? {
          version: 2,
          conditions: {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                column: "gen_ai_agent_name",
                operator: "=",
                value: opts.agent,
                values: [],
                logicalOperator: "AND",
              },
            ],
          },
        }
      : { type: "all" },
    scorers: opts.scorerIds.map((id) => ({ id, version: null })),
    inputMapping: Object.fromEntries(opts.scorerIds.map((id) => [id, { ...ONE_CLICK_MAPPING }])),
    spanSelectors: [],
    spanSelectorBindings: {},
    traceConfig: {
      idleWindowSecs: opts.completion.idleWindowSecs,
      maxAgeSecs: opts.completion.maxAgeSecs,
      endSignal: null,
    },
    sessionConfig: null,
    samplingMode: "rate",
    samplingValue: opts.rate,
    // The same default budget every new job starts with (AIO-24).
    budget: { dailyUsd: DEFAULT_DAILY_BUDGET_USD, onReach: DEFAULT_BUDGET_ACTION },
  };
}
