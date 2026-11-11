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
import { buildOneClickJob, oneClickWhere } from "./oneClickEval";

const completion = { idleWindowSecs: 30, maxAgeSecs: 1800 };

describe("buildOneClickJob", () => {
  it("samples the agent's traces and maps the root LLM input and output", () => {
    const job: any = buildOneClickJob({
      agent: "research-agent",
      stream: "default",
      scorers: [{ id: "sc1", variables: ["input", "output"] }],
      judgeNames: ["hallucination"],
      rate: 0.1,
      completion,
    });
    expect(job).toMatchObject({ targetScope: "trace", samplingMode: "rate", samplingValue: 0.1 });
    expect(job.filterCondition.conditions.conditions[0]).toMatchObject({
      column: "gen_ai_agent_name",
      operator: "=",
      value: "research-agent",
    });
    expect(job.inputMapping).toEqual({ sc1: { input: "{{input}}", output: "{{output}}" } });
    expect(job.traceConfig).toEqual({ idleWindowSecs: 30, maxAgeSecs: 1800, endSignal: null });
    expect(job.budget).toEqual({ dailyUsd: 5, onReach: "pause" });
  });

  // Toxicity reads only {{output}}; an input mapping showed it as "2 variables".
  it("maps only the variables each scorer's template uses", () => {
    const job: any = buildOneClickJob({
      agent: null,
      stream: "llm",
      scorers: [
        { id: "tox", variables: ["output"] },
        { id: "hal", variables: ["input", "output", "context"] },
      ],
      judgeNames: ["toxicity", "hallucination"],
      rate: 1,
      completion,
    });
    expect(job.inputMapping).toEqual({
      tox: { output: "{{output}}" },
      hal: { input: "{{input}}", output: "{{output}}" },
    });
  });

  it("covers the whole stream without an agent", () => {
    const job: any = buildOneClickJob({
      agent: null,
      stream: "llm",
      scorers: [],
      judgeNames: [],
      rate: 1,
      completion,
    });
    expect(job.filterCondition).toEqual({ type: "all" });
  });
});

describe("oneClickWhere", () => {
  it("filters the estimate to the agent, quoting the name", () => {
    expect(oneClickWhere("bob's-agent")).toBe("gen_ai_agent_name = 'bob''s-agent'");
  });

  it("counts the whole stream without an agent", () => {
    expect(oneClickWhere(null)).toBe("");
  });
});
