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
import { buildServiceEdgePrompt } from "./serviceEdge";

const base = { org: "default", source: "frontend", range: RANGE, timeZone: "UTC" };

describe("buildServiceEdgePrompt", () => {
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
