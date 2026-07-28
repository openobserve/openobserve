// Copyright 2026 OpenObserve Inc.

import type {
  AssertionKind,
  StepAction,
  SelectorType,
  SyntheticCheckType,
} from "@/types/synthetics";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

// ── Action labels (capitalized) ──────────────────────────────────────────
export const ACTION_LABELS: Record<StepAction, string> = {
  navigate: "Navigate",
  click: "Click",
  type: "Type",
  select: "Select",
  press: "Press",
  check: "Check",
  uncheck: "Uncheck",
  upload: "Upload",
  hover: "Hover",
  scroll: "Scroll",
  wait: "Wait",
  assert: "Assert",
  screenshot: "Screenshot",
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
export const SELECTOR_ACTIONS: readonly StepAction[] = [
  "click",
  "type",
  "select",
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
 * Kept in ACTION_LABELS/ACTION_ICONS so existing monitors still RENDER; removed
 * from the picker so no new journey can contain one. Stored monitors keep
 * executing them until migrated (spec Q-10).
 */
export const RETIRED_ACTIONS: readonly StepAction[] = ["hover", "scroll", "wait", "screenshot"];

export function isRetiredAction(action: StepAction): boolean {
  return RETIRED_ACTIONS.includes(action);
}

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
export const actionOptions = (Object.keys(ACTION_LABELS) as StepAction[])
  .filter((a) => !isRetiredAction(a))
  .map((a) => ({
    label: ACTION_LABELS[a],
    value: a,
  }));

// ── Selector type options ────────────────────────────────────────────────
export const SELECTOR_TYPE_OPTIONS: readonly {
  label: string;
  value: SelectorType;
}[] = [
  { label: "CSS", value: "CSS" },
  { label: "XPath", value: "XPath" },
  { label: "Text", value: "Text" },
  { label: "TestID", value: "TestID" },
  { label: "Role", value: "Role" },
];

// ── Value field labels (action-specific) ─────────────────────────────────
export const VALUE_LABELS: Record<string, string> = {
  navigate: "URL",
  type: "Text to type",
  select: "Option",
  press: "Key",
  upload: "File path",
  scroll: "To (px or selector)",
  wait: "Duration (ms)",
};

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
  labelKey: string;
  descKey: string;
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
export const VALUE_TOOLTIP_MAP: Record<string, string> = {
  press: 'Press a keyboard key by its key name, e.g. "Enter", "Tab", "Escape", "ArrowDown".',
  assert: 'Assertion expression, e.g. "text=Hello" or "visible" to check element visibility.',
};
