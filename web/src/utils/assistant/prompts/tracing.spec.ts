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
import { buildTracingQueryPrompt, buildTracingSetupPrompt } from "./tracing";

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

  it("says no filter is set for an empty filter", () => {
    expect(buildTracingQueryPrompt({ ...base, filter: " " }).text).toContain("No filter is set.");
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(
      buildTracingQueryPrompt({ ...base, filter: INJECTION, stream: INJECTION, error: INJECTION }),
    );
  });
});
