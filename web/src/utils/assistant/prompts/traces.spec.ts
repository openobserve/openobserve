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
import {
  MAX_SPAN_ATTRIBUTES,
  buildServiceEdgePrompt,
  buildSpanPrompt,
  buildTracePrompt,
  buildTracingQueryPrompt,
  buildTracingSetupPrompt,
  spanHasError,
  type SpanInput,
  type TraceInput,
} from "./traces";

describe("buildSpanPrompt", () => {
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

describe("buildTracePrompt", () => {
  const input = (over: Partial<TraceInput> = {}): TraceInput => ({
    org: "default",
    traceId: "4bf92f3577b34da6",
    service: "checkout",
    spanCount: 42,
    durationMs: 1234.56,
    status: "ERROR",
    startedAt: Date.UTC(2026, 9, 14, 13, 50, 1),
    timeZone: "UTC",
    range: RANGE,
    ...over,
  });

  it("pins the wording with units on every number", () => {
    const build = buildTracePrompt(input());
    expect(build.text).toBe(
      "Explain trace `4bf92f3577b34da6` from service `checkout`: 42 spans, 1,234.6 ms, status ERROR, started 13:50:01 UTC. Where is the time spent and is anything failing?",
    );
    expectPromptRules(build);
  });

  it("chips the trace as `Trace · {service} · {duration} ms` and titles the thread by service", () => {
    const build = buildTracePrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "span",
      label: "Trace · checkout · 1,234.6 ms",
      ref: { type: "trace", id: "4bf92f3577b34da6", from: RANGE.from, to: RANGE.to },
    });
    expect(build.title).toBe("Trace · checkout");
  });

  it("omits every absent fact", () => {
    const build = buildTracePrompt(
      input({
        spanCount: undefined,
        durationMs: undefined,
        status: undefined,
        startedAt: undefined,
      }),
    );
    expect(build.text).toBe(
      "Explain trace `4bf92f3577b34da6` from service `checkout`. Where is the time spent and is anything failing?",
    );
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildTracePrompt(
      input({ traceId: INJECTION, service: INJECTION, status: INJECTION }),
    );
    expectNoInjection(build);
    expect(build.text).toContain("Its id and service are in the attached Span block.");
  });
});

describe("buildTracingSetupPrompt", () => {
  it("is today's Traces no-streams prompt (traces/Index.vue), moved here", () => {
    const build = buildTracingSetupPrompt();
    expect(build.text).toBe(
      "I don't have any trace streams in OpenObserve yet and want to start sending traces. How do I instrument my services to send traces (e.g. via OpenTelemetry / OTLP)?",
    );
    expect(build.title).toBe("Set up tracing");
  });
});

describe("buildTracingQueryPrompt", () => {
  const base = {
    org: "default",
    mode: "spans" as const,
    filter: "service_name = 'checkout'",
    stream: "default",
    range: RANGE,
    timeZone: "UTC",
  };

  it("keeps today's wording with an absolute range; the filter is a chip", () => {
    const build = buildTracingQueryPrompt(base);
    expect(build.text).toBe(
      `The traces query ran successfully but returned no results. I am searching spans. The filter expression is in the attached Query block. It is a WHERE-clause filter, not a full SQL query. Stream: \`default\`. Time range: ${RANGE_TEXT}. Can you help me adjust the filter to get results?`,
    );
    expect(build.chips.map((c) => c.kind)).toEqual(["query"]);
    expectPromptRules(build);
  });

  it("moves the error into a query_error chip as plain text (S10, D10)", () => {
    const build = buildTracingQueryPrompt({ ...base, error: "bad <b>filter</b><br>near 'x'" });
    expect(build.text).toContain("it is in the attached Query error block");
    expect(build.chips[0]).toMatchObject({
      kind: "query_error",
      data: { error: "bad filter near 'x'" },
    });
  });

  it("names an SQL-mode query as SQL and attaches it as an sql Query block", () => {
    const sql = "SELECT * FROM default WHERE service_name = 'checkout'";
    const build = buildTracingQueryPrompt({ ...base, filter: sql, sqlMode: true, error: "boom" });
    expect(build.text).toContain("The SQL query is in the attached Query block.");
    expect(build.text).toContain("Can you help me adjust the query to get results?");
    expect(build.text).not.toContain("WHERE-clause filter");
    expect(build.chips.map((c) => c.kind)).toEqual(["query_error", "query"]);
    expect(build.chips[0]).toMatchObject({ data: { language: "sql" } });
    expect(build.chips[1]).toMatchObject({ data: { language: "sql", query: sql } });
    expectPromptRules(build);
  });

  it("keeps filter language in the chips outside SQL mode", () => {
    const build = buildTracingQueryPrompt({ ...base, error: "boom" });
    expect(build.chips[0]).toMatchObject({ data: { language: "filter" } });
    expect(build.chips[1]).toMatchObject({ data: { language: "filter" } });
  });

  it("says no query is set for an empty SQL-mode editor", () => {
    expect(buildTracingQueryPrompt({ ...base, filter: "", sqlMode: true }).text).toContain(
      "No query is set.",
    );
  });

  it("says no filter is set for an empty filter", () => {
    expect(buildTracingQueryPrompt({ ...base, filter: " " }).text).toContain("No filter is set.");
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(
      buildTracingQueryPrompt({ ...base, filter: INJECTION, stream: INJECTION, error: INJECTION }),
    );
  });
});

describe("buildServiceEdgePrompt", () => {
  const base = { org: "default", source: "frontend", range: RANGE, timeZone: "UTC" };

  it("pins the edge wording: requests, error rate as a percentage, p95 with unit", () => {
    const build = buildServiceEdgePrompt({
      ...base,
      target: "checkout",
      requests: 12_480,
      errorRate: 0.0342,
      p95Ms: 812.4,
    });
    expect(build.text).toBe(
      `Explain the dependency \`frontend\` → \`checkout\` over ${RANGE_TEXT}: 12,480 requests, error rate 3.4 %, p95 812.4 ms. Is it healthy and what should I check?`,
    );
    expect(build.title).toBe("Dependency · frontend → checkout");
    expect(build.chips[0].label).toBe("Service · frontend → checkout");
    expectPromptRules(build);
  });

  it("pins the node wording with inbound and outbound counts", () => {
    expect(buildServiceEdgePrompt({ ...base, inbound: 3, outbound: 5 }).text).toBe(
      `Explain service \`frontend\` over ${RANGE_TEXT}: 3 inbound, 5 outbound calls. Is it healthy and what should I check?`,
    );
  });

  it("omits absent numbers", () => {
    expect(buildServiceEdgePrompt({ ...base, target: "db" }).text).toBe(
      `Explain the dependency \`frontend\` → \`db\` over ${RANGE_TEXT}. Is it healthy and what should I check?`,
    );
  });

  it("keeps a planted service name out of the text (S1)", () => {
    const build = buildServiceEdgePrompt({ ...base, source: INJECTION, target: INJECTION });
    expectNoInjection(build);
    expect(build.text).toContain("the dependency in the attached Report block");
  });
});
