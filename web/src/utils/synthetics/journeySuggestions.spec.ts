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

import { raw } from "@/types/i18n";
import type { BrowserStep } from "@/types/synthetics";

import {
  createSuggestedAssertionStep,
  deriveJourneySuggestions,
  type JourneySuggestion,
} from "./journeySuggestions";

const ATTR = "data-testid";

/** A step that identifies no element — a navigate has nothing to find. */
function plainStep(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return { id: "s1", action: "click", name: "Sign In", ...overrides };
}

/** A step carrying one locator candidate of the given kind. */
function locatedStep(kind: string, id = "s1"): BrowserStep {
  return {
    id,
    action: "click",
    name: "Click",
    locator: { candidates: [{ kind, value: "x" }] },
  } as unknown as BrowserStep;
}

const ids = (suggestions: JourneySuggestion[]) => suggestions.map((s) => s.id);

describe("deriveJourneySuggestions", () => {
  it("says nothing about an empty journey — there is nothing to advise on yet", () => {
    expect(deriveJourneySuggestions([], ATTR)).toEqual([]);
  });

  describe("zero-assertion", () => {
    // A journey with no assertion can click its way through a broken
    // application and still report a pass.
    it("flags a journey that verifies nothing", () => {
      expect(ids(deriveJourneySuggestions([plainStep()], ATTR))).toContain("zero-assertion");
    });

    it("stays quiet once the journey asserts something", () => {
      const steps = [plainStep(), plainStep({ id: "s2", action: "assert" })];
      expect(ids(deriveJourneySuggestions(steps, ATTR))).not.toContain("zero-assertion");
    });

    // P5.2.4 — accepted with a warning, never an error.
    it("is a warning, and offers the assertion as an action", () => {
      const suggestion = deriveJourneySuggestions([plainStep()], ATTR).find(
        (s) => s.id === "zero-assertion",
      );

      expect(suggestion?.severity).toBe("warning");
      expect(suggestion?.action).toEqual({
        kind: "add-assertion",
        labelKey: "synthetics.journey.zeroAssertionAdd",
      });
    });
  });

  describe("no-test-attribute", () => {
    // Upstream's generator emits nothing at test-id rank when the configured
    // attribute is not the one the app uses, and every step silently degrades
    // to role/text/css with no error anywhere.
    it("flags a recording where no step produced a test_attribute candidate", () => {
      const steps = [locatedStep("role"), locatedStep("css", "s2")];
      expect(ids(deriveJourneySuggestions(steps, ATTR))).toContain("no-test-attribute");
    });

    it("stays quiet when any step found a test attribute", () => {
      const steps = [locatedStep("css"), locatedStep("test_attribute", "s2")];
      expect(ids(deriveJourneySuggestions(steps, ATTR))).not.toContain("no-test-attribute");
    });

    // The generator ranks candidates, so a test attribute is not always first —
    // its presence anywhere in a step's list is what proves the attribute matched.
    it("stays quiet when a test attribute is present but outranked within a step", () => {
      const steps = [
        {
          id: "s1",
          action: "click",
          name: "Click",
          locator: {
            candidates: [
              { kind: "css", value: "div.row" },
              { kind: "test_attribute", value: '[data-testid="row"]' },
            ],
          },
        },
      ] as unknown as BrowserStep[];

      expect(ids(deriveJourneySuggestions(steps, ATTR))).not.toContain("no-test-attribute");
    });

    it("is a warning, like every suggestion", () => {
      const suggestion = deriveJourneySuggestions([locatedStep("css")], ATTR).find(
        (s) => s.id === "no-test-attribute",
      );

      expect(suggestion?.severity).toBe("warning");
    });

    it("stays quiet for a journey with no element steps at all", () => {
      // A navigate-only journey has nothing to find; zero test attributes there
      // is not evidence of anything.
      expect(ids(deriveJourneySuggestions([plainStep()], ATTR))).not.toContain("no-test-attribute");
    });

    it("treats an empty candidate list as no element step, not as a missing attribute", () => {
      const steps = [
        { id: "s1", action: "click", name: "Click", locator: { candidates: [] } },
      ] as unknown as BrowserStep[];

      expect(ids(deriveJourneySuggestions(steps, ATTR))).not.toContain("no-test-attribute");
    });

    it("names the attribute that was actually used, so the fix is obvious", () => {
      const suggestion = deriveJourneySuggestions([locatedStep("css")], "data-qa").find(
        (s) => s.id === "no-test-attribute",
      );

      expect(suggestion?.descriptionParams).toEqual({ attr: "data-qa" });
    });

    // The fix is "set the attribute and re-record", which is not one click.
    it("carries no action", () => {
      const suggestion = deriveJourneySuggestions([locatedStep("css")], ATTR).find(
        (s) => s.id === "no-test-attribute",
      );

      expect(suggestion?.action).toBeUndefined();
    });
  });

  it("reports both conditions at once, in a stable order", () => {
    const steps = [locatedStep("css"), locatedStep("role", "s2")];

    expect(ids(deriveJourneySuggestions(steps, ATTR))).toEqual([
      "zero-assertion",
      "no-test-attribute",
    ]);
  });

  it("carries i18n keys rather than translated text, so the module stays free of i18n", () => {
    const suggestions = deriveJourneySuggestions([locatedStep("css")], ATTR);

    expect(suggestions.map((s) => [s.titleKey, s.descriptionKey])).toEqual([
      ["synthetics.journey.zeroAssertionTitle", "synthetics.journey.zeroAssertionDescription"],
      ["synthetics.journey.testIdMissingTitle", "synthetics.journey.testIdMissingDescription"],
    ]);
  });
});

describe("createSuggestedAssertionStep", () => {
  // P5.2.1 — the assertion is offered, never generated. A recorder cannot know
  // what "correct" means for an application, so the step arrives with the kind
  // chosen and the target left to the author.
  it("builds an empty element_visible assertion rather than guessing one", () => {
    const step = createSuggestedAssertionStep(raw("Verify the final page"));

    expect(step.action).toBe("assert");
    expect(step.assertion).toEqual({ kind: "element_visible" });
    expect(step.name).toBe("Verify the final page");
    expect(step.selector).toBeUndefined();
    expect(step.locator).toBeUndefined();
  });

  it("gives every offered step its own id", () => {
    const a = createSuggestedAssertionStep(raw("Verify the final page"));
    const b = createSuggestedAssertionStep(raw("Verify the final page"));

    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("resolves the journey it was offered for", () => {
    const steps = [plainStep()];
    const withAssertion = [...steps, createSuggestedAssertionStep(raw("Verify the final page"))];

    expect(ids(deriveJourneySuggestions(withAssertion, ATTR))).not.toContain("zero-assertion");
  });
});
