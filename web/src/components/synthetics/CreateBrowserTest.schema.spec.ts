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
import { makeBrowserCheckSaveSchema } from "./CreateBrowserTest.schema";

const t = (key: string) => key;

function form(journey: unknown[]) {
  return {
    name: "check",
    url: "https://app.test",
    locations: ["us-east"],
    journey,
  };
}

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join("."));
}

describe("makeBrowserCheckSaveSchema journey validation", () => {
  const schema = makeBrowserCheckSaveSchema(t);

  it("should accept a v1 journey whose steps carry selectors", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", selector: "#login" },
      ]),
    );

    expect(result.success).toBe(true);
  });

  // Regression: a check saved as steps_version 2 comes back with no `selector`
  // at all — the element lives in `locator`. Validating on `selector` alone made
  // every v2 check unsaveable the moment it was reopened for editing.
  it("should accept a v2 journey whose steps identify the element by locator", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        {
          id: "2",
          action: "click",
          name: 'Click on internal:testid=[data-test="login-as-internal-user"]',
          locator: {
            candidates: [
              { kind: "test_attribute", value: 'internal:testid=[data-test="login-as-internal-user"]' },
            ],
            user_override: null,
          },
        },
      ]),
    );

    expect(issuePaths(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("should accept a v2 step whose only target is a pinned override", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        {
          id: "2",
          action: "click",
          locator: { candidates: [], user_override: { kind: "css", value: "#login" } },
        },
      ]),
    );

    expect(result.success).toBe(true);
  });

  it("should accept a page-level assertion, which targets no element", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "assert", assertion: { kind: "url_matches", expected: "/home" } },
      ]),
    );

    expect(result.success).toBe(true);
  });

  it("should still reject a step that identifies no element at all", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click" },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.selector");
  });

  it("should still require the first step to navigate", () => {
    const result = schema.safeParse(form([{ id: "1", action: "click", selector: "#login" }]));

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.action");
  });
});
