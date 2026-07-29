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

// Most journey fixtures below exercise the target and first-step rules, not names,
// so a name is supplied by default — step name is required (D10) and every fixture
// would otherwise trip that rule for reasons unrelated to what it is testing. A
// case that IS about names passes an explicit `name`, which wins over the default.
function form(journey: unknown[]) {
  return {
    name: "check",
    url: "https://app.test",
    locations: ["us-east"],
    journey: journey.map((step) => ({ name: "Step", ...(step as Record<string, unknown>) })),
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
              {
                kind: "test_attribute",
                value: 'internal:testid=[data-test="login-as-internal-user"]',
              },
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

// The step name is the string a failed run displays, and it was optional. Enforced
// by min(1).trim() in this schema rather than a second validation path, matching
// the monitor-level name rule. Recorded steps arrive already named from the
// recorder, so the friction lands on hand-added steps (D10).
describe("makeBrowserCheckSaveSchema step name", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const pin = { candidates: [], user_override: { kind: "css", value: "#go" } };

  it("should reject a step with a blank name", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", name: "", locator: pin },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.name");
  });

  it("should reject a whitespace-only name", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", name: "   ", locator: pin },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.name");
  });

  it("should report the message the editor binds to the field", () => {
    const result = schema.safeParse(
      form([{ id: "1", action: "navigate", value: "https://app.test", name: "" }]),
    );

    const issue = (result as any).error.issues.find(
      (i: { path: PropertyKey[] }) => i.path.join(".") === "journey.0.name",
    );
    expect(issue.message).toBe("synthetics.validation.stepNameRequired");
  });

  it("should accept a recorded journey, which arrives already named", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test", name: "Open app" },
        {
          id: "2",
          action: "click",
          name: 'Click on [data-test="sign-in"]',
          locator: { candidates: [{ kind: "test_attribute", value: '[data-test="sign-in"]' }] },
        },
      ]),
    );

    expect(result.success).toBe(true);
  });
});

// Field-level step rules live in the schema, not in validateJourneySteps, so
// there is one enforcement path and every failure carries a field path the editor
// can bind an inline error to. Before this, validation was save-time and
// toast-only and covered two rules (SE-3).
describe("makeBrowserCheckSaveSchema field-level step rules", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const pin = { candidates: [], user_override: { kind: "css", value: "#go" } };
  const opened = { id: "1", action: "navigate", value: "https://app.test" };

  it("should reject a navigate step whose URL is not http(s)", () => {
    const result = schema.safeParse(form([{ id: "1", action: "navigate", value: "app.test" }]));

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });

  it("should reject a navigate step with no URL at all", () => {
    const result = schema.safeParse(form([{ id: "1", action: "navigate" }]));

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });

  it("should accept a navigate step with a valid URL", () => {
    const result = schema.safeParse(form([opened]));

    expect(result.success).toBe(true);
  });

  // A `type` step with no text types nothing and the run still passes.
  it("should reject a type step with no text", () => {
    const result = schema.safeParse(
      form([opened, { id: "2", action: "type", value: "", locator: pin }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.value");
  });

  it("should accept a type step that has text", () => {
    const result = schema.safeParse(
      form([opened, { id: "2", action: "type", value: "hunter2", locator: pin }]),
    );

    expect(result.success).toBe(true);
  });

  it("should reject an assertion kind that needs an expected value but has none", () => {
    const result = schema.safeParse(
      form([
        opened,
        { id: "2", action: "assert", locator: pin, assertion: { kind: "element_text", expected: "" } },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.assertion.expected");
  });

  it("should accept a visibility assertion, which needs no expected value", () => {
    const result = schema.safeParse(
      form([opened, { id: "2", action: "assert", locator: pin, assertion: { kind: "element_visible" } }]),
    );

    expect(result.success).toBe(true);
  });
});
