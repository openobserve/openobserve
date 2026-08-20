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
import { makeBrowserCheckGateSchema, makeBrowserCheckSaveSchema } from "./CreateBrowserTest.schema";

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

/**
 * The message reported at `path`.
 *
 * Needed wherever two rules guard the same field, because the path alone cannot
 * tell them apart. `url` is the case: the protocol `refine` rejects `""` on its
 * own, so a test that asserts only the path still passes with `min(1)` deleted —
 * and the author loses "URL is required" in favour of "Enter a valid URL".
 */
function issueMessage(
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  path: string,
) {
  return (result.error?.issues ?? []).find((i) => i.path.join(".") === path)?.message;
}

// The monitor-level half of the save schema. `form()` above supplies a valid
// name/url/locations to every journey fixture, so these three rules were the only
// part of the schema no test had ever exercised — and the view spec that would
// otherwise cover them replaces this whole module with a stub schema.
describe("makeBrowserCheckSaveSchema monitor fields", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const valid = { name: "Checkout flow", url: "https://app.test", locations: ["us-east"] };

  it("should reject a check with no name", () => {
    const result = schema.safeParse({ ...valid, name: "", journey: [] });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("name");
  });

  // Asserts the message, not just the path: the protocol `refine` below rejects
  // "" by itself, so a path-only assertion cannot tell "URL is required" from
  // "Enter a valid URL" and would survive `min(1)` being deleted.
  it("should reject a check with no URL, as required rather than invalid", () => {
    const result = schema.safeParse({ ...valid, url: "", journey: [] });

    expect(result.success).toBe(false);
    expect(issueMessage(result, "url")).toBe("synthetics.validation.urlRequired");
  });

  // The rule is the protocol, not merely "parses as a URL" — the probe drives a
  // browser, so a scheme it cannot open is as unusable as a malformed string.
  it("should reject a URL whose protocol is not http or https", () => {
    const result = schema.safeParse({ ...valid, url: "ftp://app.test", journey: [] });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("url");
  });

  it("should reject a URL that does not parse at all", () => {
    const result = schema.safeParse({ ...valid, url: "app.test", journey: [] });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("url");
  });

  it("should accept a plain http URL", () => {
    const result = schema.safeParse({ ...valid, url: "http://app.test", journey: [] });

    expect(issuePaths(result)).toEqual([]);
  });

  // A check with no location is never scheduled anywhere, so it can never run.
  it("should reject a check with no locations", () => {
    const result = schema.safeParse({ ...valid, locations: [], journey: [] });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("locations");
  });
});

// The gate schema decides whether the author may leave the first screen at all.
// It had no test of any kind: the only other reference to it outside the view is
// the view spec's `vi.mock`, which replaces it with `z.string().min(1)` on `url`
// and drops the protocol rule entirely.
describe("makeBrowserCheckGateSchema", () => {
  const schema = makeBrowserCheckGateSchema(t);

  it("should reject a blank name", () => {
    const result = schema.safeParse({ name: "", url: "https://app.test" });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("name");
  });

  it("should reject a blank URL, as required rather than invalid", () => {
    const result = schema.safeParse({ name: "Checkout", url: "" });

    expect(result.success).toBe(false);
    expect(issueMessage(result, "url")).toBe("synthetics.validation.urlRequired");
  });

  // Same protocol rule as the save schema. The gate is what the Record button is
  // disabled behind, so a scheme the recorder cannot open must not pass here
  // either — otherwise the failure surfaces as an extension error much later.
  it("should reject a URL whose protocol is not http or https", () => {
    const result = schema.safeParse({ name: "Checkout", url: "ftp://app.test" });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("url");
  });

  it("should accept a named check with an https URL", () => {
    const result = schema.safeParse({ name: "Checkout", url: "https://app.test" });

    expect(issuePaths(result)).toEqual([]);
  });
});

describe("makeBrowserCheckSaveSchema journey validation", () => {
  const schema = makeBrowserCheckSaveSchema(t);

  // A bare `selector` is the version-1 channel, and version 1 is gone. The
  // element has to be named by the locator bundle, because that is the only
  // thing buildV2Steps puts on the wire — a gate that accepted `selector`
  // would wave through a journey the server then answers with a 400.
  it("should reject a step whose only target is a version-1 selector", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", selector: "#login" },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.selector");
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
          },
        },
      ]),
    );

    expect(issuePaths(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("should accept a step whose target is a locator the author wrote", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        {
          id: "2",
          action: "click",
          locator: {
            candidates: [{ kind: "css", value: "#login", origin: "authored" }],
            author_ordered: true,
          },
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

// Version 1 is retired, so the save gate is the only thing standing between an
// unsaveable journey and a 400 from the server. It used to be silent: an
// unsaveable journey simply fell back to the version-1 payload shape.
describe("makeBrowserCheckSaveSchema version-2 save gate", () => {
  const bundle = { candidates: [{ kind: "css", value: "#go" }] };
  const opened = { id: "1", action: "navigate", value: "https://app.test" };

  it("should reject a journey containing a retired action, naming the step", () => {
    const schema = makeBrowserCheckSaveSchema(t);
    const result = schema.safeParse(
      form([opened, { id: "2", action: "wait", name: "Pause", value: "2000" }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.action");
  });

  it("should name the step and the action in the retired-action message", () => {
    const seen: Record<string, unknown>[] = [];
    const spy = (key: string, params?: Record<string, unknown>) => {
      if (params) seen.push(params);
      return key;
    };
    makeBrowserCheckSaveSchema(spy).safeParse(
      form([opened, { id: "2", action: "wait", name: "Pause here" }]),
    );

    expect(seen).toContainEqual({ step: "Pause here", action: "wait" });
  });

  it("should reject an element step whose locator bundle is empty", () => {
    const schema = makeBrowserCheckSaveSchema(t);
    const result = schema.safeParse(
      form([opened, { id: "2", action: "click", name: "Sign in", locator: { candidates: [] } }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.selector");
  });

  // The opposite of the retired-action message above, and deliberately so. This
  // issue reaches the author only through `setStepFieldErrors`, which renders it
  // on the locator input of the step it names — so naming the step again says it
  // twice inside that step's own row. The step-scoped wording lives on
  // `validation.selectorRequired`, which is the toast.
  it("should not name the step in the missing-target message", () => {
    const seen: string[] = [];
    const spy = (key: string, params?: Record<string, unknown>) => {
      if (!params) seen.push(key);
      return key;
    };
    makeBrowserCheckSaveSchema(spy).safeParse(
      form([opened, { id: "2", action: "click", name: "Sign in", locator: { candidates: [] } }]),
    );

    expect(seen).toContain("synthetics.validation.locatorRequired");
  });

  it("should accept a journey every step of which can be built as version 2", () => {
    const schema = makeBrowserCheckSaveSchema(t);
    const result = schema.safeParse(
      form([opened, { id: "2", action: "click", name: "Sign in", locator: bundle }]),
    );

    expect(issuePaths(result)).toEqual([]);
  });
});

// The step name is the string a failed run displays, and it was optional. Enforced
// by min(1).trim() in this schema rather than a second validation path, matching
// the monitor-level name rule. Recorded steps arrive already named from the
// recorder, so the friction lands on hand-added steps (D10).
describe("makeBrowserCheckSaveSchema step name", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const bundle = { candidates: [{ kind: "css", value: "#go" }] };

  it("should reject a step with a blank name", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", name: "", locator: bundle },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.name");
  });

  it("should reject a whitespace-only name", () => {
    const result = schema.safeParse(
      form([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", name: "   ", locator: bundle },
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
  const bundle = { candidates: [{ kind: "css", value: "#go" }] };
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
      form([opened, { id: "2", action: "type", value: "", locator: bundle }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.value");
  });

  it("should accept a type step that has text", () => {
    const result = schema.safeParse(
      form([opened, { id: "2", action: "type", value: "hunter2", locator: bundle }]),
    );

    expect(result.success).toBe(true);
  });

  it("should reject an assertion kind that needs an expected value but has none", () => {
    const result = schema.safeParse(
      form([
        opened,
        {
          id: "2",
          action: "assert",
          locator: bundle,
          assertion: { kind: "element_text", expected: "" },
        },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.assertion.expected");
  });

  it("should accept a visibility assertion, which needs no expected value", () => {
    const result = schema.safeParse(
      form([
        opened,
        { id: "2", action: "assert", locator: bundle, assertion: { kind: "element_visible" } },
      ]),
    );

    expect(result.success).toBe(true);
  });

  // `element_not_visible` is the second half of `assertionNeedsExpected`'s
  // exemption. Only `element_visible` was covered, so the rule would have kept
  // passing if the exemption had narrowed to one kind.
  it("should accept a not-visible assertion, which needs no expected value", () => {
    const result = schema.safeParse(
      form([
        opened,
        { id: "2", action: "assert", locator: bundle, assertion: { kind: "element_not_visible" } },
      ]),
    );

    expect(result.success).toBe(true);
  });

  it("should reject an attribute assertion with no expected value", () => {
    const result = schema.safeParse(
      form([
        opened,
        {
          id: "2",
          action: "assert",
          locator: bundle,
          assertion: { kind: "element_attribute", attribute: "href", expected: "" },
        },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.assertion.expected");
  });

  // The three rules below all read `.trim()`. Without it a space satisfies the
  // rule while typing nothing, selecting nothing and asserting nothing — the
  // exact false-green each rule exists to prevent.
  it("should reject a type step whose text is only whitespace", () => {
    const result = schema.safeParse(
      form([opened, { id: "2", action: "type", value: "   ", locator: bundle }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.value");
  });

  it("should reject an assertion whose expected value is only whitespace", () => {
    const result = schema.safeParse(
      form([
        opened,
        {
          id: "2",
          action: "assert",
          locator: bundle,
          assertion: { kind: "element_text", expected: "   " },
        },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.assertion.expected");
  });

  // The navigate rule is a regex, not `new URL()` like the monitor-level `url`
  // field. `\S+` is what rejects a URL with a space in it; the protocol group is
  // what rejects a scheme the browser cannot open.
  it("should reject a navigate step whose URL has a non-http protocol", () => {
    const result = schema.safeParse(
      form([{ id: "1", action: "navigate", value: "ftp://app.test" }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });

  it("should reject a navigate step whose URL is only whitespace", () => {
    const result = schema.safeParse(form([{ id: "1", action: "navigate", value: "   " }]));

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });

  // `\S+` — a protocol with no host behind it. Reaches the probe as a navigation
  // to nowhere, and every case above still passes without that part of the regex.
  it("should reject a navigate step that is a bare protocol with no host", () => {
    const result = schema.safeParse(form([{ id: "1", action: "navigate", value: "https://" }]));

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });

  // `$` — trailing junk after the host. Without the anchor the regex matches a
  // prefix and waves through a URL the browser cannot resolve.
  it("should reject a navigate step whose URL contains a space", () => {
    const result = schema.safeParse(
      form([{ id: "1", action: "navigate", value: "https://app.test /login" }]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.0.value");
  });
});

// `page_title` is the second page-level kind. `url_matches` is covered above; if
// `isPageLevelAssertion` ever narrowed to one kind, a legitimate page-title
// assertion would become unsaveable and nothing would have caught it.
describe("makeBrowserCheckSaveSchema page-level assertions", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const opened = { id: "1", action: "navigate", value: "https://app.test" };

  it("should accept a page-title assertion, which targets no element", () => {
    const result = schema.safeParse(
      form([
        opened,
        { id: "2", action: "assert", assertion: { kind: "page_title", expected: "Dashboard" } },
      ]),
    );

    expect(issuePaths(result)).toEqual([]);
  });

  // Page-level or not, the kind still needs its expected value — the exemption
  // is from the locator rule only.
  it("should still require an expected value on a page-title assertion", () => {
    const result = schema.safeParse(
      form([
        opened,
        { id: "2", action: "assert", assertion: { kind: "page_title", expected: "" } },
      ]),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("journey.1.assertion.expected");
  });
});

// `RETIRED_ACTIONS` has four members and only two were covered. The rule is
// `isStorableAction`, which answers for the whole set at once.
describe("makeBrowserCheckSaveSchema retired actions", () => {
  const schema = makeBrowserCheckSaveSchema(t);
  const opened = { id: "1", action: "navigate", value: "https://app.test" };

  // `hover` left this list when Playwright 1.56 added a hover action to the
  // recorder model: it is captured, stored and replayed like any other action.
  // The rest still have no counterpart upstream, so a journey using one cannot
  // be replayed and must not be saved.
  it.each(["scroll", "wait", "screenshot"])(
    "should reject a journey containing the retired action %s",
    (action) => {
      const result = schema.safeParse(
        form([opened, { id: "2", action, name: "Retired step", value: "1" }]),
      );

      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain("journey.1.action");
    },
  );
});
