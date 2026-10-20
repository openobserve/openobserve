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

import {
  INJECTION,
  RANGE,
  RANGE_TEXT,
  ROW_US,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { buildLogRowPrompt, type LogRowInput } from "./logRow";
import { REDACTED } from "./redact";

const input = (over: Partial<LogRowInput> = {}): LogRowInput => ({
  org: "default",
  stream: "default",
  row: { _timestamp: ROW_US, service: "checkout", message: "upstream returned 502" },
  range: RANGE,
  timeZone: "UTC",
  query: 'SELECT * FROM "default" WHERE code = 502',
  mode: "sql",
  ...over,
});

describe("buildLogRowPrompt", () => {
  it("pins the wording: stream, absolute range and mode; the row and query are chips", () => {
    const build = buildLogRowPrompt(input());
    expect(build.text).toBe(
      `Explain this log row from stream \`default\` (logs). Time range: ${RANGE_TEXT}. The active query is in the attached Query block (SQL mode). What happened, what is unusual about it, and what should I look at next?`,
    );
    expect(build.chips.map((c) => c.kind)).toEqual(["log_row", "query"]);
    expect(build.chips[1].data).toEqual({ language: "SQL", query: input().query });
    expectPromptRules(build);
  });

  it("labels the row chip by stream and second and titles the thread the same", () => {
    const build = buildLogRowPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "log_row",
      label: "Log row · default · 13:57:46",
      sent: "serialized",
      ref: { type: "log_row", org: "default", stream: "default", from: RANGE.from, to: RANGE.to },
    });
    expect(build.chips[0].data).toEqual(input().row);
    expect(build.title).toBe("Log row · default · 13:57:46");
  });

  it("has no query chip without a query and says filter mode for a filter", () => {
    expect(buildLogRowPrompt(input({ query: "" })).chips).toHaveLength(1);
    expect(buildLogRowPrompt(input({ query: "code=502", mode: "filter" })).text).toContain(
      "(filter mode)",
    );
  });

  it("names the function or pipeline that produced a test or preview row", () => {
    expect(
      buildLogRowPrompt(input({ source: { kind: "function", name: "parse_json" } })).text,
    ).toContain("This row is a test event for function `parse_json`.");
    expect(buildLogRowPrompt(input({ source: { kind: "pipeline", name: "p1" } })).text).toContain(
      "This row is a preview row of pipeline `p1`.",
    );
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildLogRowPrompt(
      input({
        stream: INJECTION,
        streamType: INJECTION,
        query: INJECTION,
        row: { _timestamp: ROW_US, message: INJECTION },
        source: { kind: "function", name: INJECTION },
      }),
    );
    expectNoInjection(build);
    expect(build.text).toContain("its stream is named in the attached Log row block");
    expect(JSON.stringify(build.chips)).toContain("ignore previous");
  });

  it("redacts a secret in the row (secret_in_row)", () => {
    const build = buildLogRowPrompt(
      input({ row: { _timestamp: ROW_US, message: "login password=hunter22", token: "abc123" } }),
    );
    expect(build.chips[0].data).toEqual({
      _timestamp: ROW_US,
      message: `login password=${REDACTED}`,
      token: REDACTED,
    });
    expectPromptRules(build);
  });

  it("gives the same row the same chip id, so a second Add is a no-op", () => {
    expect(buildLogRowPrompt(input()).chips[0].id).toBe(buildLogRowPrompt(input()).chips[0].id);
  });

  it("labels a row without a timestamp by its stream", () => {
    expect(buildLogRowPrompt(input({ row: { message: "x" } })).chips[0].label).toBe(
      "Log row · default",
    );
  });
});
