// Copyright 2026 OpenObserve Inc.

import type { BrowserStep, StepAction } from "@/types/synthetics";
import { RETIRED_ACTIONS } from "@/constants/synthetics";

/**
 * The version-2 step as it goes on the wire.
 *
 * Deliberately a separate type from {@link BrowserStep}: the server validates v2
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
    candidates: Array<{ kind: string; value: string }>;
    user_override?: { kind: string; value: string } | null;
  };
  value?: string;
  key?: string;
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
  type: "fill",
  select: "select",
  press: "press",
  check: "check",
  uncheck: "uncheck",
  upload: "upload",
  assert: "assert",
};

/** Actions that carry no element and therefore need no locator. */
const PAGE_LEVEL_ASSERTIONS = new Set(["url_matches", "page_title"]);

/**
 * Whether a journey can be stored as version 2.
 *
 * All-or-nothing on purpose. `steps_version` describes the whole `steps` array,
 * so a journey where only some steps carry a locator bundle has no honest
 * version — storing it as v2 would fail validation on the bundle-less steps, and
 * storing it as v1 would silently discard the bundles that were captured. A
 * journey qualifies once every step could be executed by the v2 runner.
 */
export function isV2Journey(steps: BrowserStep[]): boolean {
  if (steps.length === 0) return false;
  return steps.every((step) => {
    if ((RETIRED_ACTIONS as readonly string[]).includes(step.action)) return false;
    if (!ACTION_TO_V2[step.action]) return false;
    if (step.action === "navigate") return true;
    if (step.action === "assert" && PAGE_LEVEL_ASSERTIONS.has(step.assertion?.kind ?? ""))
      return true;
    return !!(step.locator?.candidates?.length || step.locator?.user_override);
  });
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
 * Build the stored v2 step for one editor step.
 *
 * Every field is copied explicitly rather than spread. That is the point: it is
 * the only way to be sure the payload contains nothing the schema will refuse,
 * and it makes adding a field a deliberate act in both repositories at once.
 */
export function buildV2Step(step: BrowserStep): V2WireStep {
  const action = ACTION_TO_V2[step.action];
  if (!action) {
    throw new Error(
      `step "${step.id}": "${step.action}" has no version-2 equivalent. ` +
        `Check isV2Journey before building a version-2 payload.`,
    );
  }

  const wire: V2WireStep = { id: step.id, action };

  if (step.name) wire.name = step.name;
  Object.assign(wire, v2Value(step));

  if (step.locator?.candidates?.length || step.locator?.user_override) {
    wire.locator = {
      candidates: (step.locator.candidates ?? []).map((c) => ({ kind: c.kind, value: c.value })),
      ...(step.locator.user_override && {
        user_override: {
          kind: step.locator.user_override.kind,
          value: step.locator.user_override.value,
        },
      }),
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
