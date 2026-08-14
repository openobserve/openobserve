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

/**
 * What is worth telling a journey's author about their own recording.
 *
 * These used to be two always-on cards stacked above the step list
 * (`ZeroAssertionNotice.vue`, `TestIdMisconfiguredNotice.vue`). Each computed
 * its own visibility, rendered its own card and owned a `dismissed` ref that
 * died on remount — so the author closed the same banner on every visit and the
 * step list started two cards down the page. The advice was right; the delivery
 * was not.
 *
 * Everything here is a pure derivation over the steps, carrying i18n KEYS rather
 * than text (`I18nKey`, see `types/i18n.ts`). That keeps the module free of Vue
 * and of `useI18n`, so a rule can be tested without mounting anything, and the
 * one surface that renders suggestions decides how they look.
 *
 * Adding a rule is one producer in {@link PRODUCERS} and a template that never
 * changes — which is the property the old design lacked, and the reason two
 * banners were on their way to becoming five.
 */
import type { I18nKey, I18nText } from "@/types/i18n";
import type { BrowserStep } from "@/types/synthetics";
import { getUUIDv7 } from "@/utils/zincutils";

export type JourneySuggestionId = "zero-assertion" | "no-test-attribute";

/** The one thing a suggestion can offer to do on the author's behalf. */
export type JourneySuggestionActionKind = "add-assertion";

export interface JourneySuggestion {
  id: JourneySuggestionId;
  /**
   * Every rule here is advisory. P5.2.4 is explicit that a zero-assertion
   * journey is *accepted* with a warning — nothing in this module may block a
   * save. The field exists so a future rule can raise severity without
   * reshaping the type.
   */
  severity: "warning";
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  /** Interpolation for {@link descriptionKey}, when the message takes any. */
  descriptionParams?: Record<string, string>;
  /** Present only when the fix is genuinely one click. */
  action?: { labelKey: I18nKey; kind: JourneySuggestionActionKind };
}

type SuggestionProducer = (steps: BrowserStep[], testIdAttr: string) => JourneySuggestion | null;

/**
 * "This journey verifies nothing."
 *
 * A journey with no assertion can click its way through a broken application
 * and still report a pass — it proves the steps can be performed, not that the
 * application works. That is the failure mode where a monitor quietly stops
 * noticing anything, which is worse than a monitor that is obviously broken.
 *
 * A warning and not an error (P5.2.4). A monitor that only navigates still
 * proves the site answers, so refusing to save one would be wrong; but the
 * author should have to decline the assertion rather than never be offered it.
 */
const zeroAssertion: SuggestionProducer = (steps) => {
  if (steps.length === 0) return null;
  if (steps.some((s) => s.action === "assert")) return null;

  return {
    id: "zero-assertion",
    severity: "warning",
    titleKey: "synthetics.journey.zeroAssertionTitle",
    descriptionKey: "synthetics.journey.zeroAssertionDescription",
    action: { kind: "add-assertion", labelKey: "synthetics.journey.zeroAssertionAdd" },
  };
};

/**
 * "This recording found no test attributes" — the misconfiguration that is
 * otherwise silent.
 *
 * The recorder selects on ONE configured DOM attribute. Playwright defaults to
 * `data-testid`; O2's own frontend uses `data-test`; a customer may use
 * `data-qa`, `data-cy` or `data-automation-id`. When the configured attribute is
 * not the one the application uses, upstream's generator produces NO
 * `test_attribute` candidates at all and every step quietly degrades to
 * role/text/css — the least stable ranks — with no error anywhere.
 *
 * The signal is unambiguous and cheap: a journey against a page that has test
 * attributes will produce at least one `test_attribute` candidate. Zero across
 * an entire recording means the recorder was looking for the wrong attribute, or
 * the application genuinely has none — and both are worth saying out loud rather
 * than discovering months later when a locator rots.
 *
 * Deliberately not an error: a page really may have no test attributes, and the
 * journey still works. This tells the author what they are trading away, and
 * carries no action, because the fix is to change the attribute and re-record.
 */
const noTestAttribute: SuggestionProducer = (steps, testIdAttr) => {
  // Steps that identify an element at all — a navigate has nothing to find, so
  // its lack of a test attribute is not evidence of anything.
  const locatorSteps = steps.filter((s) => (s.locator?.candidates?.length ?? 0) > 0);
  if (locatorSteps.length === 0) return null;

  const hasTestAttribute = locatorSteps.some((s) =>
    s.locator!.candidates.some((c) => c.kind === "test_attribute"),
  );
  if (hasTestAttribute) return null;

  return {
    id: "no-test-attribute",
    severity: "warning",
    titleKey: "synthetics.journey.testIdMissingTitle",
    descriptionKey: "synthetics.journey.testIdMissingDescription",
    descriptionParams: { attr: testIdAttr },
  };
};

/** Producer order is display order. */
const PRODUCERS: SuggestionProducer[] = [zeroAssertion, noTestAttribute];

export function deriveJourneySuggestions(
  steps: BrowserStep[],
  testIdAttr: string,
): JourneySuggestion[] {
  return PRODUCERS.map((produce) => produce(steps, testIdAttr)).filter(
    (suggestion): suggestion is JourneySuggestion => suggestion !== null,
  );
}

/**
 * The step behind `add-assertion`.
 *
 * P5.2.1 — the assertion is offered, never generated. The recorder cannot know
 * what "correct" means for an application and no vendor pretends otherwise, so
 * the step arrives with the kind chosen and the target left to the author.
 */
export function createSuggestedAssertionStep(name: I18nText): BrowserStep {
  return {
    id: getUUIDv7(true),
    action: "assert",
    name,
    assertion: { kind: "element_visible" },
  };
}
