// Copyright 2026 OpenObserve Inc.

import type {
  BrowserStep,
  LocatorCandidate,
  LocatorKind,
  SelectorType,
  StepAction,
} from "@/types/synthetics";
import { RETIRED_ACTIONS } from "@/constants/synthetics";

/**
 * In-place upgrade of a version-1 journey to version 2, without re-recording.
 *
 * Runs client-side (spec Q-3 / D-11): it is a pure `BrowserStep[] -> BrowserStep[]`
 * transform, so the UI can show an author exactly what would change before they
 * commit to it — which is what makes the upgrade previewable without a round
 * trip.
 *
 * Partial benefit by design. A lifted journey gets a one-candidate locator
 * bundle, so it gains the v2 execution path but not fallback resilience; only
 * re-recording produces a real bundle and settle evidence.
 */

/** The recorder's old hardcoded stamp. Nothing else may be assumed about it. */
const RECORDER_STAMPED_TIMEOUT_MS = 10000;

const SELECTOR_TYPE_TO_KIND: Record<SelectorType, LocatorKind> = {
  TestID: "test_attribute",
  Role: "role",
  Text: "text",
  CSS: "css",
  XPath: "xpath",
};

/** Redundant v1 aliases, collapsed onto the v2 vocabulary. */
const ACTION_ALIASES: Partial<Record<string, StepAction>> = {
  type: "type", // UI keeps `type`; the wire/schema name is `fill`
};

export type LiftChangeKind =
  | "locator_created"
  | "timeout_cleared"
  | "step_dropped"
  | "action_renamed";

export interface LiftChange {
  stepId: string;
  stepName: string;
  kind: LiftChangeKind;
  /** Human-readable detail, e.g. why a step was dropped. */
  detail: string;
}

export interface LiftResult {
  steps: BrowserStep[];
  changes: LiftChange[];
  /** True when nothing needed changing — the journey is already v2-shaped. */
  noop: boolean;
}

function describe(step: BrowserStep): string {
  return step.name || step.selector || step.action;
}

/**
 * Why a retired action is dropped rather than translated.
 *
 * None of these exist in Playwright's recorder action model, so none can be
 * expressed as a v2 step. Dropping is the honest outcome, but it is a real
 * behaviour change and must be surfaced in the preview rather than applied
 * quietly — which is why every drop produces a LiftChange.
 */
const DROP_REASONS: Record<string, string> = {
  wait: "Hard sleeps are removed: the runner now waits for the page itself, with a 30s/60s budget per step instead of a fixed delay.",
  scroll:
    "Scrolling carries no information — an element is scrolled into view automatically before it is acted on. This step did nothing at run time.",
  screenshot:
    "Screenshots are controlled per run by the capture setting, not per step.",
  hover:
    "Hover cannot be expressed as a v2 step. If this journey depends on a hover-revealed menu, re-record it instead of lifting.",
};

/**
 * Convert one v1 step. Returns `null` when the step cannot exist in v2.
 */
function liftStep(step: BrowserStep, changes: LiftChange[]): BrowserStep | null {
  const name = describe(step);

  if ((RETIRED_ACTIONS as readonly string[]).includes(step.action)) {
    changes.push({
      stepId: step.id,
      stepName: name,
      kind: "step_dropped",
      detail: DROP_REASONS[step.action] ?? `"${step.action}" is not available in version 2.`,
    });
    return null;
  }

  const lifted: BrowserStep = { ...step };

  // A single selector becomes a one-candidate bundle. Its kind comes from the
  // recorded selector type; an unset type means the selector was authored by
  // hand, and CSS is the only safe assumption.
  if (step.selector && !step.locator) {
    const kind: LocatorKind = step.selectorType
      ? SELECTOR_TYPE_TO_KIND[step.selectorType]
      : "css";
    const candidate: LocatorCandidate = { kind, value: step.selector };
    lifted.locator = { candidates: [candidate], user_override: null };
    changes.push({
      stepId: step.id,
      stepName: name,
      kind: "locator_created",
      detail: `Selector kept as the only ${kind} candidate. Re-record to gain fallbacks.`,
    });
  }

  // Clear the recorder's stamp so the runner's per-category default applies.
  // Only the exact stamped value: any other number was an author's deliberate
  // choice and is preserved. A hand-set 10000 is indistinguishable from the
  // stamp and is cleared too — an acceptable loss, since the runner's default is
  // strictly more generous.
  if (step.timeout === RECORDER_STAMPED_TIMEOUT_MS) {
    delete lifted.timeout;
    changes.push({
      stepId: step.id,
      stepName: name,
      kind: "timeout_cleared",
      detail:
        "Removed the recorder's 10s stamp — the direct cause of the timeout failures. The runner now allows 60s for navigation and assertions, 30s for interactions.",
    });
  }

  const renamed = ACTION_ALIASES[step.action];
  if (renamed && renamed !== step.action) {
    lifted.action = renamed;
    changes.push({
      stepId: step.id,
      stepName: name,
      kind: "action_renamed",
      detail: `"${step.action}" is now "${renamed}".`,
    });
  }

  return lifted;
}

/**
 * Lift a whole journey. Pure — safe to call on every keystroke to drive a
 * preview.
 */
export function liftJourney(steps: BrowserStep[]): LiftResult {
  const changes: LiftChange[] = [];
  const lifted: BrowserStep[] = [];

  for (const step of steps) {
    const next = liftStep(step, changes);
    if (next) lifted.push(next);
  }

  return { steps: lifted, changes, noop: changes.length === 0 };
}

/**
 * Whether a journey needs lifting at all — used to decide if the upgrade
 * affordance is worth showing.
 */
export function needsLift(steps: BrowserStep[]): boolean {
  return !liftJourney(steps).noop;
}
