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

import type { BrowserStep, StepAction } from "@/types/synthetics";
import { RETIRED_ACTIONS } from "@/constants/synthetics";
import { stepIsMissingTarget } from "./stepTarget";

/**
 * The step as it goes on the wire.
 *
 * Deliberately a separate type from {@link BrowserStep}: the server validates
 * steps with `deny_unknown_fields`, so a stray `code`, `selectorType` or
 * `startTime` is a 400, not a harmless extra. Building the payload from an
 * explicit shape rather than by spreading the editor's model is what keeps that
 * from happening by accident.
 */
export interface V2WireStep {
  id: string;
  action: string;
  name?: string;
  url?: string;
  locator?: {
    candidates: Array<{
      kind: string;
      value: string;
      origin?: string;
      from?: Array<{ value: string; relation?: string }>;
    }>;
    author_ordered?: boolean;
  };
  value?: string;
  key?: string;
  button?: "left" | "middle" | "right";
  click_count?: number;
  files?: string[];
  settle?: {
    navigation?: { url_pattern: string };
    responses?: Array<{ url_pattern: string; method?: string; required?: boolean }>;
    observed_duration_ms?: number;
    budget_ms?: number;
  };
  assertion?: { kind: string; expected?: string; attribute?: string };
  optional?: boolean;
  always_run?: boolean;
  timeout_ms?: number;
}

/** UI action name → the v2 vocabulary the server accepts. */
const ACTION_TO_V2: Partial<Record<StepAction, string>> = {
  navigate: "navigate",
  click: "click",
  hover: "hover",
  type: "fill",
  select: "select",
  press: "press",
  check: "check",
  uncheck: "uncheck",
  upload: "upload",
  assert: "assert",
};

/**
 * Whether this action can be stored at all.
 *
 * A retired action has no runner behind it, and an action outside
 * {@link ACTION_TO_V2} has no name the server recognises. Either way the step
 * cannot be built, so the save gate has to say so rather than let
 * {@link buildV2Step} throw at payload time.
 */
export function isStorableAction(action: string): boolean {
  if ((RETIRED_ACTIONS as readonly string[]).includes(action)) return false;
  return !!ACTION_TO_V2[action as StepAction];
}

/**
 * Whether every step of this journey can be stored.
 *
 * All-or-nothing on purpose, and it is now the save gate rather than a version
 * question: a journey that fails this used to fall back to the version-1 payload
 * shape, which silently discarded every locator bundle the recorder captured.
 * With version 1 gone there is nothing to fall back to, so the answer has to
 * reach the author instead — see `makeBrowserCheckSaveSchema`.
 */
export function isSaveableJourney(steps: BrowserStep[]): boolean {
  if (steps.length === 0) return false;
  return steps.every((step) => isStorableAction(step.action) && !stepIsMissingTarget(step));
}

/** The value field a v2 step uses for this action. The UI keeps only one. */
function v2Value(step: BrowserStep): Pick<V2WireStep, "url" | "value" | "key" | "files"> {
  switch (step.action) {
    case "navigate":
      return { url: step.value };
    case "press":
      return { key: step.value };
    case "type":
    case "select":
      return { value: step.value };
    case "upload":
      // The editor keeps a single value, so a manually-added upload carries one
      // path. Dropping it would save a step that uploads nothing.
      return step.value ? { files: [step.value] } : {};
    default:
      return {};
  }
}

/**
 * Build the stored step for one editor step.
 *
 * Every field is copied explicitly rather than spread. That is the point: it is
 * the only way to be sure the payload contains nothing the schema will refuse,
 * and it makes adding a field a deliberate act in both repositories at once.
 */
export function buildV2Step(step: BrowserStep): V2WireStep {
  const action = isStorableAction(step.action) ? ACTION_TO_V2[step.action] : undefined;
  if (!action) {
    throw new Error(
      `step "${step.id}": "${step.action}" cannot be stored. ` +
        `Check isSaveableJourney before building a payload.`,
    );
  }

  const wire: V2WireStep = { id: step.id, action };

  if (step.name) wire.name = step.name;

  // camelCase in the editor, snake_case in storage — this is the only place that
  // boundary is crossed. Both are omitted at their default rather than written
  // explicitly, so a step with no click metadata serialises exactly as it did
  // before these fields existed. That is what lets them ship without a schema
  // version bump.
  if (step.button && step.button !== "left") wire.button = step.button;
  if (step.clickCount && step.clickCount > 1) wire.click_count = step.clickCount;
  Object.assign(wire, v2Value(step));

  if (step.locator?.candidates?.length) {
    wire.locator = {
      // Provenance travels. Without it the editor's work never reaches storage:
      // the save looks fine, and healing later overwrites an authored entry
      // because nothing recorded that a human wrote it.
      candidates: step.locator.candidates.map((c) => ({
        kind: c.kind,
        value: c.value,
        ...(c.origin && { origin: c.origin }),
        ...(c.from?.length && {
          from: c.from.map((p) => ({
            value: p.value,
            ...(p.relation && { relation: p.relation }),
          })),
        }),
      })),
      ...(step.locator.author_ordered && { author_ordered: true }),
    };
  }

  if (step.settle) {
    const settle: NonNullable<V2WireStep["settle"]> = {};
    if (step.settle.navigation)
      settle.navigation = { url_pattern: step.settle.navigation.url_pattern };
    if (step.settle.responses?.length) {
      settle.responses = step.settle.responses.map((r) => ({
        url_pattern: r.url_pattern,
        ...(r.method && { method: r.method }),
        required: r.required ?? false,
      }));
    }
    if (step.settle.observed_duration_ms !== undefined) {
      settle.observed_duration_ms = step.settle.observed_duration_ms;
    }
    if (step.settle.budget_ms !== undefined) settle.budget_ms = step.settle.budget_ms;
    if (Object.keys(settle).length) wire.settle = settle;
  }

  if (step.action === "assert") {
    // Validation requires one, and defaulting here rather than at save time
    // means an author who never opened the assertion editor still gets the
    // step's original meaning — "the element is on screen" — instead of a 400.
    const assertion = step.assertion ?? { kind: "element_visible" as const };
    wire.assertion = {
      kind: assertion.kind,
      ...(assertion.expected !== undefined && { expected: assertion.expected }),
      ...(assertion.attribute !== undefined && { attribute: assertion.attribute }),
    };
  }

  if (step.optional) wire.optional = true;
  if (step.alwaysRun) wire.always_run = true;
  // Only an explicit author choice travels; absence means the runner's default.
  if (step.timeout !== undefined) wire.timeout_ms = step.timeout;

  return wire;
}

export function buildV2Steps(steps: BrowserStep[]): V2WireStep[] {
  return steps.map(buildV2Step);
}
