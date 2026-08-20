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

import type { AssertionKind, StepAction, SyntheticCheckType } from "@/types/synthetics";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey, TranslateFn } from "@/types/i18n";

// ── Action labels ────────────────────────────────────────────────────────
export const ACTION_LABEL_KEYS: Record<StepAction, I18nKey> = {
  navigate: "synthetics.journey.actionLabels.navigate",
  click: "synthetics.journey.actionLabels.click",
  type: "synthetics.journey.actionLabels.type",
  select: "synthetics.journey.actionLabels.select",
  press: "synthetics.journey.actionLabels.press",
  check: "synthetics.journey.actionLabels.check",
  uncheck: "synthetics.journey.actionLabels.uncheck",
  upload: "synthetics.journey.actionLabels.upload",
  hover: "synthetics.journey.actionLabels.hover",
  scroll: "synthetics.journey.actionLabels.scroll",
  wait: "synthetics.journey.actionLabels.wait",
  assert: "synthetics.journey.actionLabels.assert",
  screenshot: "synthetics.journey.actionLabels.screenshot",
};

// ── Action icons ─────────────────────────────────────────────────────────
export const ACTION_ICONS: Record<StepAction, IconName> = {
  navigate: "open-in-browser",
  click: "ads-click",
  type: "keyboard",
  select: "checklist",
  press: "keyboard",
  check: "check-box",
  uncheck: "toggle-off",
  upload: "upload-file",
  hover: "touch-app",
  scroll: "swap-vert",
  wait: "hourglass-empty",
  assert: "fact-check",
  screenshot: "photo-camera",
};

// ── Action groups ────────────────────────────────────────────────────────
/**
 * Actions that act on an element and so must name one.
 *
 * Mirrors the server's `V2_ELEMENT_ACTIONS` (`synthetics.rs`). `press` belongs
 * here for that reason: the server requires a locator for it, and while a
 * bundle-less journey could still fall back to the version-1 payload shape the
 * disagreement only cost a silent downgrade. With version 1 gone it would be a
 * 400 at save time instead.
 */
export const SELECTOR_ACTIONS: readonly StepAction[] = [
  "click",
  "type",
  "select",
  "press",
  "check",
  "uncheck",
  "upload",
  "hover",
  "assert",
];

/**
 * Actions whose step carries an author-editable value.
 *
 * `upload` is here because a recorded upload's file path is mapped into
 * `step.value` and saved back out as `files` — omitting it meant the path was
 * stored and replayed but had no input, so an author could neither see it nor
 * change it.
 *
 * `assert` is deliberately absent: BrowserJourneyAssertion owns the expected
 * value for an assert step, and a v2 payload drops `value` on assert
 * (buildV2Steps `v2Value`). A second, generic Expected input took typing and
 * silently discarded it at save.
 */
export const VALUE_ACTIONS: readonly StepAction[] = [
  "navigate",
  "type",
  "select",
  "press",
  "upload",
  "scroll",
  "wait",
];

/**
 * Actions retired from the authoring vocabulary (spec X-9).
 *
 * Upstream Playwright's recorder action model has no counterpart for any of
 * these — `ActionName` in @recorder/actions omits them entirely — so the
 * recorder has never emitted one and the player has never been able to replay
 * one. They entered journeys only through this picker, and the moment an author
 * used one, replay died before step 1.
 *
 * `scroll` additionally carries no information: Playwright scrolls an element
 * into view before acting on it, and the probe silently no-ops the step — a
 * false green. `screenshot` is redundant with the per-run capture setting.
 * `wait` is the hard sleep this whole design exists to remove.
 *
 * Kept in ACTION_LABEL_KEYS/ACTION_ICONS so existing monitors still RENDER; removed
 * from the picker so no new journey can contain one. Stored monitors keep
 * executing them until migrated (spec Q-10).
 */
// `hover` left this list when Playwright 1.56 added a hover action to the
// recorder model: it is captured by the action picker, stored in the v2
// vocabulary and executed by both the probe and the extension player, so it is
// a supported action rather than one that vanishes at save.
export const RETIRED_ACTIONS: readonly StepAction[] = ["scroll", "wait", "screenshot"];

export function isRetiredAction(action: StepAction): boolean {
  return RETIRED_ACTIONS.includes(action);
}

/**
 * Oldest recorder extension this build of the web app knows how to talk to.
 *
 * 0.2.0 is the first build that reports a version in its `getStatus` reply, so
 * an absent version means "older than this" rather than "unknown". Chrome
 * updates the extension independently of when O2 deploys, so without this the
 * two can disagree about the wire with no way to say so — every future wire
 * change would surface as confusing behaviour instead of a message.
 */
export const MIN_EXTENSION_VERSION = "0.2.0";

// ── Assertion kinds (spec P5.1) ──────────────────────────────────────────
/**
 * Closed set, mirroring the server's. The probe FAILS an unknown kind rather
 * than passing it, so a typo that got past the UI would show up as every run
 * failing rather than as an error at save time.
 */
export const ASSERTION_KINDS: readonly AssertionKind[] = [
  "element_visible",
  "element_not_visible",
  "element_text",
  "url_matches",
  "page_title",
  "element_attribute",
];

/** The two visibility kinds ask "is it there?" — there is nothing to compare. */
export function assertionNeedsExpected(kind: AssertionKind): boolean {
  return kind !== "element_visible" && kind !== "element_not_visible";
}

export function assertionNeedsAttribute(kind: AssertionKind): boolean {
  return kind === "element_attribute";
}

/** Kinds that describe the page rather than an element, so they need no locator. */
export function isPageLevelAssertion(kind: AssertionKind): boolean {
  return kind === "url_matches" || kind === "page_title";
}

// ── Action dropdown options ──────────────────────────────────────────────
// Takes t so labels follow the active locale — call it inside a computed.
export const actionOptions = (t: TranslateFn) =>
  (Object.keys(ACTION_LABEL_KEYS) as StepAction[])
    .filter((a) => !isRetiredAction(a))
    .map((a) => ({
      label: t(ACTION_LABEL_KEYS[a]),
      value: a,
    }));

// The selector-type picker (CSS / XPath / Text / TestID / Role) is gone with the
// v1 authoring path: a step names its element with a locator bundle, whose value
// carries its own engine prefix.

// ── Click type (which button, how many clicks) ───────────────────────────
/**
 * The click variants Playwright's action picker offers, as one choice.
 *
 * Storage keeps them as two fields — `button` and `click_count`, which is what
 * `locator.click` takes — but an author thinks "double click", not "one click,
 * count two". Datadog's browser tests present the same pair as a single click
 * type for the same reason.
 */
export type ClickType = "left" | "right" | "middle" | "double";

export const CLICK_TYPE_LABEL_KEYS: Record<ClickType, I18nKey> = {
  left: "synthetics.journey.clickTypes.left",
  right: "synthetics.journey.clickTypes.right",
  middle: "synthetics.journey.clickTypes.middle",
  double: "synthetics.journey.clickTypes.double",
};

/** What each type stores. Left/1 is the absent-field default, so it serialises away. */
export const CLICK_TYPE_VALUES: Record<
  ClickType,
  { button: "left" | "middle" | "right"; clickCount: number }
> = {
  left: { button: "left", clickCount: 1 },
  right: { button: "right", clickCount: 1 },
  middle: { button: "middle", clickCount: 1 },
  double: { button: "left", clickCount: 2 },
};

/**
 * Which click type a stored pair reads as.
 *
 * `button` decides first: a contextmenu event is always one click, so the
 * recorder cannot produce a right double click and a stored right+2 could only
 * arrive through the API. Reading it as "Right click" is the closer of the two
 * approximations — and nothing is rewritten unless the author picks a type.
 */
export function clickTypeOf(button?: string, clickCount?: number): ClickType {
  if (button === "right") return "right";
  if (button === "middle") return "middle";
  return (clickCount ?? 1) >= 2 ? "double" : "left";
}

export const clickTypeOptions = (t: TranslateFn) =>
  (Object.keys(CLICK_TYPE_LABEL_KEYS) as ClickType[]).map((c) => ({
    label: t(CLICK_TYPE_LABEL_KEYS[c]),
    value: c,
  }));

/**
 * What a step's action reads as in a row, including which click it is.
 *
 * A right or double click is a `click` carrying two extra fields, so keying the
 * label on the action alone rendered every one of them as a plain "Click": the
 * fidelity reached storage and the replay, and stopped short of the only place
 * an author looks.
 */
export function stepActionLabelKey(
  action: StepAction,
  button?: string,
  clickCount?: number,
): I18nKey {
  if (action !== "click") return ACTION_LABEL_KEYS[action];
  const type = clickTypeOf(button, clickCount);
  return type === "left" ? ACTION_LABEL_KEYS.click : CLICK_TYPE_LABEL_KEYS[type];
}

// ── Value field labels (action-specific) ─────────────────────────────────
export const VALUE_LABEL_KEYS: Record<string, I18nKey> = {
  navigate: "synthetics.journey.valueLabels.navigate",
  type: "synthetics.journey.valueLabels.type",
  select: "synthetics.journey.valueLabels.select",
  press: "synthetics.journey.valueLabels.press",
  upload: "synthetics.journey.valueLabels.upload",
  scroll: "synthetics.journey.valueLabels.scroll",
  wait: "synthetics.journey.valueLabels.wait",
};

// ── Per-step timeout bounds ──────────────────────────────────────────────
/**
 * Mirrors the server's range check on a step's `timeout_ms` (spec P1.1.3:
 * *"it validates into `100..=60_000`"*).
 *
 * Note the maximum EQUALS the navigate/assert category default
 * (`NAV_ASSERT_TIMEOUT_MS`), so on those two actions an explicit timeout can only
 * ever shorten the step — which is why the editor says so rather than leaving the
 * below-default warning looking like a malfunction (SE-20).
 */
export const MIN_STEP_TIMEOUT_MS = 100;
export const MAX_STEP_TIMEOUT_MS = 60000;

// ── Settle budget (spec P3.3, P3.4.3) ────────────────────────────────────
/** What the probe sleeps for when a legacy `wait` carries no duration. */
export const DEFAULT_SETTLE_BUDGET_MS = 30000;
/** Matches the server-side range check on `settle.budget_ms`. */
export const MIN_SETTLE_BUDGET_MS = 100;
export const MAX_SETTLE_BUDGET_MS = 60000;

// ── Value field widths ───────────────────────────────────────────────────
export const VALUE_WIDTH_MAP: Record<string, string> = {
  wait: "w-50!",
};

// ── Check type picker cards ───────────────────────────────────────────────

export interface CheckTypeCard {
  type: SyntheticCheckType;
  icon: IconName;
  labelKey: I18nKey;
  descKey: I18nKey;
}

export const CHECK_TYPE_CARDS: CheckTypeCard[] = [
  {
    type: "browser",
    icon: "open-in-browser",
    labelKey: "synthetics.newCheck.browser",
    descKey: "synthetics.newCheck.browserDesc",
  },
  {
    type: "http",
    icon: "network-check",
    labelKey: "synthetics.newCheck.http",
    descKey: "synthetics.newCheck.httpDesc",
  },
  {
    type: "tcp",
    icon: "bolt",
    labelKey: "synthetics.newCheck.tcp",
    descKey: "synthetics.newCheck.tcpDesc",
  },
  {
    type: "tls",
    icon: "shield",
    labelKey: "synthetics.newCheck.tls",
    descKey: "synthetics.newCheck.tlsDesc",
  },
  {
    type: "ssh",
    icon: "keyboard",
    labelKey: "synthetics.newCheck.ssh",
    descKey: "synthetics.newCheck.sshDesc",
  },
];

// ── Value field tooltips ─────────────────────────────────────────────────
export const VALUE_TOOLTIP_KEYS: Record<string, I18nKey> = {
  press: "synthetics.journey.valueTooltips.press",
  assert: "synthetics.journey.valueTooltips.assert",
};

// ── Recorder extension ───────────────────────────────────────────────────────

/**
 * Chrome Web Store listing for the OpenObserve Recorder extension — fallback
 * when the backend /config field `synthetics_recorder_extension_url`
 * (`O2_SYNTHETICS_RECORDER_EXTENSION_URL`) is absent or empty.
 */
export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/afhgiecgbpohkbobialnajlphbpcgomo";

/**
 * Query flag CreateBrowserTest writes when entering the extension-setup phase
 * so a mid-setup reload (F5) returns there with the gate fields restored. The
 * checklist's own "refresh this page" action strips it on purpose — after that
 * reload the recorder is connected, so the gate's Record goes straight to
 * recording instead of re-entering setup.
 */
export const SETUP_QUERY_PARAM = "setup";

/**
 * Chrome UI element names referenced by the recorder setup flow — interpolated
 * into i18n strings as params so they stay in English across all locales,
 * matching the actual Chrome browser interface.
 */
export const CHROME_UI_LABELS = {
  allowIncognito: "Allow in Incognito",
  extensionsMenu: "Extensions",
  manageExtension: "Manage extension",
  recorderName: "OpenObserve Recorder",
} as const;

// ── Recorder locator configuration ───────────────────────────────────────────

/**
 * The test-id attribute the recorder selects on, unless a monitor overrides it.
 *
 * `data-test` because that is what OpenObserve's own frontend marks interactive
 * elements with, and self-monitoring is the acceptance test for this feature.
 * Playwright's own default is `data-testid`; sending nothing meant every
 * recording fell back to that, so an O2 page only produced test-attribute
 * candidates because upstream's generator carries a hardcoded fallback list
 * that happens to include `data-test`.
 *
 * An application using anything outside that list — `data-qa`, `data-cy`,
 * `data-pw`, `data-automation-id` — produced no test-attribute candidates at
 * all, and every step silently degraded to role/text/css.
 */
export const DEFAULT_TEST_ID_ATTR = "data-test";
