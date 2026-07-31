// Copyright 2026 OpenObserve Inc.

import type {
  BrowserStep,
  LocatorCandidate,
  LocatorKind,
  SelectorType,
  StepAction,
} from "@/types/synthetics";
import {
  DEFAULT_SETTLE_BUDGET_MS,
  MAX_SETTLE_BUDGET_MS,
  MIN_SETTLE_BUDGET_MS,
  RETIRED_ACTIONS,
} from "@/constants/synthetics";
import { rankCandidates } from "./locatorStability";

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
  | "action_renamed"
  | "locator_reranked"
  | "sleep_converted";

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
  screenshot: "Screenshots are controlled per run by the capture setting, not per step.",
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
    const kind: LocatorKind = step.selectorType ? SELECTOR_TYPE_TO_KIND[step.selectorType] : "css";
    const candidate: LocatorCandidate = { kind, value: step.selector };
    lifted.locator = { candidates: [candidate], user_override: null };
    changes.push({
      stepId: step.id,
      stepName: name,
      kind: "locator_created",
      detail: `Selector kept as the only ${kind} candidate. Re-record to gain fallbacks.`,
    });
  }

  // Re-rank an EXISTING bundle so journeys recorded before the positional fix
  // benefit without being re-recorded. Ranking on kind alone let a candidate
  // ending in `>> nth=` become the primary while an unambiguous alternative sat
  // below it — the one failure mode that makes a step act on the wrong element
  // and still pass. Reordering is safe by construction: a candidate carrying no
  // positional token resolved to exactly one element at record time, so this
  // only ever promotes better evidence.
  if (step.locator?.candidates?.length) {
    const ranked = rankCandidates(step.locator.candidates);
    const reordered = ranked.some((candidate, i) => candidate !== step.locator!.candidates[i]);
    if (reordered) {
      lifted.locator = { ...step.locator, candidates: ranked };
      changes.push({
        stepId: step.id,
        stepName: name,
        kind: "locator_reranked",
        detail:
          `Primary locator is now ${ranked[0].kind} \`${ranked[0].value}\`. ` +
          `A position-dependent candidate no longer outranks a stable one.`,
      });
    }
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
    // A sleep is not information about the page, but the DURATION an author
    // chose is: it says "this step needs longer than usual". So the sleep step
    // disappears while its budget moves onto the step it was waiting for
    // (P3.4.3). Dropping it outright would silently tighten the journey.
    if (step.action === "wait") {
      const previous = lifted[lifted.length - 1];
      const budget = sleepBudgetMs(step);
      if (previous && budget !== null) {
        previous.settle = { ...previous.settle, budget_ms: budget };
        changes.push({
          stepId: step.id,
          stepName: describe(step),
          kind: "sleep_converted",
          detail: `Removed the ${Math.round(budget / 1000)}s sleep and gave "${describe(previous)}" a ${Math.round(budget / 1000)}s settle budget instead. The run now waits for the page and continues as soon as it is ready, rather than always waiting the full time.`,
        });
        continue;
      }
      // A leading sleep has nothing to attach to: there is no preceding step
      // whose settling it could describe.
      liftStep(step, changes);
      continue;
    }

    const next = liftStep(step, changes);
    if (next) lifted.push(next);
  }

  return { steps: lifted, changes, noop: changes.length === 0 };
}

/**
 * The sleep duration a `wait` step represents, clamped to what a settle budget
 * may be.
 *
 * A `wait` stores its duration in `timeout` (the probe sleeps for that long) but
 * hand-built steps sometimes carry it in `value` instead, so both are read. The
 * runner's own default is used when neither says anything — the same 30s the
 * probe would have slept.
 */
function sleepBudgetMs(step: BrowserStep): number | null {
  const fromValue = Number(step.value);
  const raw = step.timeout ?? (Number.isFinite(fromValue) && fromValue > 0 ? fromValue : undefined);
  const budget = raw ?? DEFAULT_SETTLE_BUDGET_MS;
  if (!Number.isFinite(budget) || budget <= 0) return null;
  return Math.min(Math.max(Math.round(budget), MIN_SETTLE_BUDGET_MS), MAX_SETTLE_BUDGET_MS);
}

/**
 * Whether a journey needs lifting at all — used to decide if the upgrade
 * affordance is worth showing.
 */
export function needsLift(steps: BrowserStep[]): boolean {
  return !liftJourney(steps).noop;
}
