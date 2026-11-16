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

import { stepsOf } from "@/composables/assistant/evidence";
import type { ContentBlock } from "@/ts/interfaces/chat";
import { gt, raw } from "@/types/i18n";

import { queryFragments, stepLine, stepVerb } from "./evidenceText";

// The trail line as the producer leaves it, from the tool_result shapes the server sends.
const lineOf = (block: Partial<ContentBlock>) =>
  stepLine(
    stepsOf(
      { role: "assistant", content: raw(""), contentBlocks: [{ type: "tool_call", ...block }] },
      "acme",
    )[0],
    gt,
  );

describe("stepLine / stepVerb", () => {
  it("reads a CLI step's exit code and stdout and stderr line counts from its summary", () => {
    const summary = { return_code: 1, stdout_lines: 4, stderr_lines: 2 } as any;
    expect(
      lineOf({
        tool: "cli_kubectl",
        callArgs: { command: "kubectl get pods" },
        stepState: "done",
        summary,
      }),
    ).toBe("Ran kubectl get pods · exit 1 · 4 lines · stderr 2 lines");
  });

  it("leaves out an empty stderr and counts stdout lines from the response", () => {
    expect(
      lineOf({
        tool: "cli_ls",
        callArgs: { command: "ls" },
        stepState: "done",
        result: { exitCode: 0, stdout: "a\nb\n" },
        summary: { stderr_lines: 0 } as any,
      }),
    ).toBe("Ran ls · exit 0 · 2 lines");
  });

  it("counts a VRL test's input events", () => {
    const summary = { input_count: 3 } as any;
    expect(lineOf({ tool: "testFunction", stepState: "done", summary })).toBe(
      "Ran test function · 3 input events",
    );
  });

  it("names a CLI step by its command, falling back to the tool", () => {
    const [step] = stepsOf(
      {
        role: "assistant",
        content: raw(""),
        contentBlocks: [{ type: "tool_call", tool: "cli_exec", stepState: "done" }],
      },
      "acme",
    );
    expect(stepVerb(step, gt)).toBe("Ran cli_exec");
    expect(stepVerb({ ...step, command: "df -h" }, gt)).toBe("Ran df -h");
  });

  it("shows a failed step's error after its head", () => {
    expect(
      lineOf({ tool: "o2_GetAlert", stepState: "failed", resultMessage: "alert not found" }),
    ).toBe("Get alert failed · alert not found");
  });

  it("says an interrupted step stopped before it finished", () => {
    expect(lineOf({ tool: "o2_StreamList", call_id: "c" })).toBe(
      "Listed streams · stopped before it finished",
    );
  });
});

describe("queryFragments", () => {
  it("shows what tells each query from its siblings, verbatim", () => {
    expect(
      queryFragments([
        "SELECT status, count(*) FROM app_logs WHERE service='cart' AND status>=500 GROUP BY status",
        "SELECT msg, count(*) FROM app_logs WHERE service='cart' AND msg LIKE '%redis%'",
        "SELECT region, count(*) FROM app_logs WHERE service='cart' AND status>=500 GROUP BY region",
        "SELECT count(*) FROM app_logs WHERE service='redis'",
        "SELECT p99(latency) FROM app_logs WHERE service='cart'",
      ]),
    ).toEqual([
      "status>=500 GROUP BY status",
      "msg LIKE '%redis%'",
      "status>=500 GROUP BY region",
      "service='redis'",
      "p99(latency)",
    ]);
  });

  it("keeps a lone query's whole filter, and an AND inside quotes or brackets", () => {
    expect(queryFragments(["SELECT * FROM t WHERE a=1 AND b=2"])).toEqual(["a=1 AND b=2"]);
    expect(queryFragments(["SELECT * FROM t WHERE (a AND b) AND msg='x AND y'"])).toEqual([
      "(a AND b) AND msg='x AND y'",
    ]);
  });

  it("drops the row cap, which tells no two queries apart", () => {
    expect(
      queryFragments([
        "SELECT count(*) FROM a WHERE level='error' ORDER BY x LIMIT 100",
        "SELECT count(*) FROM b LIMIT 100 OFFSET 20",
      ]),
    ).toEqual(["level='error' ORDER BY x", "count(*)"]);
  });

  it("leaves text it cannot read as SQL alone", () => {
    expect(queryFragments(["rate(http_requests_total[5m])"])).toEqual([
      "rate(http_requests_total[5m])",
    ]);
  });
});
