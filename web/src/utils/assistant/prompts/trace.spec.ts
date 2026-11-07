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

import { INJECTION, RANGE, expectNoInjection, expectPromptRules } from "./__fixtures__/prompts";
import { buildTracePrompt, type TraceInput } from "./trace";

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

describe("buildTracePrompt", () => {
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
