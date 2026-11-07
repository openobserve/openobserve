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
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { MAX_SPAN_ATTRIBUTES, buildSpanPrompt, spanHasError, type SpanInput } from "./span";

const input = (over: Partial<SpanInput> = {}): SpanInput => ({
  org: "default",
  traceId: "t1",
  spanId: "s1",
  service: "checkout",
  operation: "POST:/pay",
  durationMs: 812,
  status: "OK",
  parentOperation: "GET:/cart",
  attributes: { "http.method": "POST", "http.status_code": 200 },
  range: RANGE,
  timeZone: "UTC",
  ...over,
});

describe("buildSpanPrompt", () => {
  it("pins the Explain wording; attributes are only in the chip", () => {
    const build = buildSpanPrompt(input(), "explain");
    expect(build.text).toBe(
      `Explain span \`POST:/pay\` in service \`checkout\` (trace \`t1\`, span \`s1\`): 812 ms, status OK, parent \`GET:/cart\`. Its attributes are in the attached Span block. Window ${RANGE_TEXT}. Why is it slow and what should I check next?`,
    );
    expectPromptRules(build);
  });

  it("pins the Troubleshoot wording with the error in the chip", () => {
    const build = buildSpanPrompt(
      input({ status: "ERROR", error: "card declined", attributes: {} }),
      "troubleshoot",
    );
    expect(build.text).toContain("The error is in the attached Span block.");
    expect(build.text).toMatch(/Why did it fail and what should I check next\?$/);
    expect(build.text).not.toContain("card declined");
    expect(build.chips[0].data).toMatchObject({ error: "card declined" });
  });

  it("moves an operation name with spaces into the chip and says so", () => {
    const build = buildSpanPrompt(input({ operation: "SELECT * FROM orders" }), "explain");
    expect(build.text).toContain("Explain this span in service `checkout`");
    expect(build.text).toContain("Its names and its attributes are in the attached Span block.");
  });

  it("strips secret-named attributes and keeps at most 20", () => {
    const attributes: Record<string, unknown> = {
      "auth.token": "x",
      db_password: "y",
      Authorization: "z",
    };
    for (let i = 0; i < 30; i++) attributes[`a${i}`] = i;
    const data = buildSpanPrompt(input({ attributes }), "explain").chips[0].data as {
      attributes: Record<string, unknown>;
    };
    expect(Object.keys(data.attributes)).toHaveLength(MAX_SPAN_ATTRIBUTES);
    expect(Object.keys(data.attributes).some((k) => /token|password|authorization/i.test(k))).toBe(
      false,
    );
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildSpanPrompt(
      input({
        operation: INJECTION,
        service: INJECTION,
        parentOperation: INJECTION,
        traceId: INJECTION,
        spanId: INJECTION,
        status: INJECTION,
        error: INJECTION,
        attributes: { a: INJECTION },
      }),
      "troubleshoot",
    );
    expectNoInjection(build);
  });

  it("detects a failing span by status, message or error attribute", () => {
    expect(spanHasError({ status: "ERROR" })).toBe(true);
    expect(spanHasError({ status: "2" })).toBe(true);
    expect(spanHasError({ error: "x" })).toBe(true);
    expect(spanHasError({ attributes: { "exception.message": "boom" } })).toBe(true);
    expect(spanHasError({ status: "OK", attributes: { "http.status_code": 200 } })).toBe(false);
  });
});
