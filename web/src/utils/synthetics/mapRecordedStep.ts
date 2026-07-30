// Copyright 2026 OpenObserve Inc.

import type { BrowserStep, SelectorType, StepAction, WireStep } from "@/types/synthetics";
import { getUUIDv7 } from "../uuid";

// Maps the extension's Playwright-flavoured action names onto the UI's StepAction.
// `setInputFiles` has no dedicated UI action and is surfaced as a `type` step.
const ACTION_MAP: Record<string, StepAction> = {
  navigate: "navigate",
  click: "click",
  type: "type",
  // The version-2 wire name for typing. Both map to the UI's `type`.
  fill: "type",
  press: "press",
  select: "select",
  // Version-2 additions: a checkbox interaction is no longer collapsed to a
  // click, which used to make the journey depend on the box's starting state.
  check: "check",
  uncheck: "uncheck",
  upload: "upload",
  hover: "hover",
  scroll: "scroll",
  wait: "wait",
  waitFor: "wait",
  assert: "assert",
  screenshot: "screenshot",
  setInputFiles: "upload",
};

const SELECTOR_TYPE_MAP: Record<string, SelectorType> = {
  css: "CSS",
  xpath: "XPath",
  text: "Text",
  role: "Role",
  "data-test": "TestID",
};

// Inverse of SELECTOR_TYPE_MAP, for building wire steps from manual UI steps.
const WIRE_SELECTOR_TYPE_MAP: Record<SelectorType, WireStep["selector_type"]> = {
  CSS: "css",
  XPath: "xpath",
  Text: "text",
  Role: "role",
  TestID: "data-test",
};

/**
 * Per-action-category timeout defaults owned by the RUNNER, not written into
 * steps. Used here only to show the author what a step will actually get
 * (placeholder text) and to warn when they lower it. See spec P1.2, P1.1.5.
 */
export const NAV_ASSERT_TIMEOUT_MS = 60000;
export const INTERACTION_TIMEOUT_MS = 30000;

/** The timeout this step will get from the runner when none is set explicitly. */
export function defaultTimeoutFor(action: StepAction): number {
  return action === "navigate" || action === "assert"
    ? NAV_ASSERT_TIMEOUT_MS
    : INTERACTION_TIMEOUT_MS;
}

function mapAction(action: string): StepAction {
  const mapped = ACTION_MAP[action];
  if (!mapped) {
    console.warn(`[synthetics] unknown recorded action "${action}", defaulting to click`);
    return "click";
  }
  return mapped;
}

// The UI keeps a single `value` field; pick the right wire field per action.
function mapValue(wire: WireStep, action: StepAction): string | undefined {
  switch (action) {
    case "navigate":
      return wire.url ?? wire.value;
    case "press":
      return wire.key ?? wire.value;
    case "assert":
      return wire.text ?? wire.value;
    case "upload":
      // A recorded upload carries its paths in `files`; the editor shows the
      // first. Reading `value` alone would render the step blank.
      return wire.files?.[0] ?? wire.value;
    case "select":
      // A recorded select carries the chosen option in `options`
      // (actionMapper.ts). Reading `value` alone rendered the Option field
      // blank and then saved that blank back over the recorded choice.
      return wire.options?.[0] ?? wire.value;
    default:
      return wire.value;
  }
}

/**
 * Inverse of {@link mapValue}: write the editor's single `value` back into the
 * wire field this action actually replays from.
 *
 * The editor keeps one `value` per step, but the wire spreads it across
 * `url`/`key`/`text`/`files`/`options`/`value` by action. Patching only
 * `wire.value` — as the editor used to — left the replayed step carrying the
 * *recorded* URL or key while the UI and the saved payload showed the edited
 * one. Save and preview disagreeing about what the step does is worse than
 * either being wrong.
 */
export function applyValueToWire(wire: WireStep, action: StepAction, value: string): WireStep {
  switch (action) {
    case "navigate":
      return { ...wire, url: value };
    case "press":
      return { ...wire, key: value };
    case "assert":
      return { ...wire, text: value };
    case "upload":
      return { ...wire, files: value ? [value] : [] };
    case "select":
      return { ...wire, options: value ? [value] : [] };
    default:
      return { ...wire, value };
  }
}

/**
 * Options for {@link mapWireStep} and {@link mapWireSteps}.
 *
 * `preserveWire` keeps the extension's own step on the result for replay. It is
 * correct for a LIVE recording, whose wire carries fields the version-2 schema
 * has no home for — `options`, `text`, `modifiers`, `button`, `position`,
 * `framePath`.
 *
 * It is wrong when reconstructing from a SAVED monitor. A stored v2 step has none
 * of those, so preserving it shadows {@link buildWireFromStep}, which rebuilds
 * them correctly from the UI fields. That shadowing is why a reloaded `select`
 * replayed as `selectOption([])`: the extension reads `options`, the stored step
 * only has `value`, and `buildWireFromStep`'s correct `options: [value]` was
 * unreachable while `wire` won.
 *
 * Default is off, so the storage path is safe by omission and only live capture
 * has to opt in.
 */
export interface MapWireStepOptions {
  preserveWire?: boolean;
}

/** Convert a single extension {@link WireStep} into the UI-facing {@link BrowserStep}. */
export function mapWireStep(wire: WireStep, opts: MapWireStepOptions = {}): BrowserStep {
  const action = mapAction(wire.action);
  const id = getUUIDv7(true);
  return {
    id: id,
    action,
    name: wire.name,
    selector: wire.selector,
    selectorType: wire.selector_type ? SELECTOR_TYPE_MAP[wire.selector_type] : undefined,
    value: mapValue(wire, action),
    // Undefined means "use the runner's category default" (spec P1.1.2). The
    // recorder no longer stamps a value, and substituting one here would put the
    // guess back — the previous `?? 30000` was unreachable anyway, because the
    // extension always sent 10000.
    timeout: wire.timeout_ms,
    // Version-2 evidence rides through untouched. It is machine-derived and
    // read-only in the editor: the only author channel is pinning a candidate,
    // which keeps the stored list byte-comparable for the healing precondition.
    locator: wire.locator,
    settle: wire.settle,
    assertion: wire.assertion,
    optional: wire.optional,
    alwaysRun: wire.always_run,
    code: wire.code || "",
    // Keep the original extension step untouched for replay (full fidelity) —
    // only when the caller says this wire came from a live recording. See
    // MapWireStepOptions.
    ...(opts.preserveWire ? { wire: { ...wire, id } } : {}),
  };
}

/** Convert a list of extension wire steps into UI steps. */
export function mapWireSteps(wires: WireStep[], opts: MapWireStepOptions = {}): BrowserStep[] {
  return wires.map((w) => mapWireStep(w, opts));
}

/**
 * Reverse of {@link mapWireStep}: reconstruct a replayable {@link WireStep} from a
 * lean UI step that has no recorded `wire` (i.e. manually added in the editor).
 * Mirrors the fields the extension's `buildActionFromStep` consumes.
 *
 * Always returns a wire step. The previous doc claimed it returned `null` for
 * hover/scroll/wait/screenshot, but no branch ever did — which made the
 * `.filter(w => w != null)` in {@link journeyToWireSteps} dead code and left a
 * trap for anyone adding an action. Those four are now RETIRED_ACTIONS: they are
 * still sent for replay, where the extension substitutes a no-op and the result
 * is reported as "not simulated" rather than as a pass. See spec P1.R.2a/P1.R.3.
 */
export function buildWireFromStep(step: BrowserStep): WireStep | null {
  const base: WireStep = {
    id: step.id,
    action: step.action,
    name: step.name ?? "",
    selector: step.selector,
    selector_type: step.selectorType ? WIRE_SELECTOR_TYPE_MAP[step.selectorType] : undefined,
    // Only carry a timeout the author actually set; absence means runner default.
    timeout_ms: step.timeout,
    // Sent back so the preview can report what it cannot simulate (spec P5.S.3)
    // rather than diverging from the probe in silence.
    locator: step.locator,
    settle: step.settle,
    assertion: step.assertion,
    optional: step.optional,
    always_run: step.alwaysRun,
    pageAlias: "page",
    framePath: [],
  };
  switch (step.action) {
    case "navigate":
      return { ...base, url: step.value };
    case "click":
      return base;
    case "type":
      return { ...base, value: step.value };
    case "press":
      return { ...base, key: step.value };
    case "select":
      return { ...base, options: step.value ? [step.value] : [] };
    case "check":
    case "uncheck":
      return base;
    case "upload":
      return { ...base, files: step.value ? [step.value] : [] };
    case "assert": {
      // Lean steps can't express assert subtype; default to assertText when
      // there is something to compare, else assertVisible. The typed assertion
      // is the author's channel now (the generic Expected input was removed as
      // dead — v2 drops `value` on assert), so read `expected` first.
      const expected = step.assertion?.expected ?? step.value;
      return expected !== undefined && expected !== "" ? { ...base, text: expected } : base;
    }
    case "hover":
      return base;
    case "scroll":
      return { ...base, value: step.value };
    case "wait":
      return { ...base, value: step.value };
    case "screenshot":
      return base;
    default:
      // Should never reach here — StepAction is a closed union.
      console.warn(`[synthetics] unknown action "${step.action}", defaulting to click`);
      return { ...base, action: "click" };
  }
}

/**
 * Collect the replayable steps from a journey to send to the extension's replay
 * command. Recorded steps replay verbatim via their preserved `wire`; manual
 * steps are reverse-mapped via {@link buildWireFromStep}. Unsupported manual
 * actions yield `null` and are dropped.
 */
export function journeyToWireSteps(steps: BrowserStep[]): WireStep[] {
  return steps.map((s) => s.wire ?? buildWireFromStep(s)).filter((w): w is WireStep => w != null);
}

/**
 * Substitute `{{ VAR_NAME }}` placeholders in wire step string fields with
 * actual variable values. Operates on all string fields that could contain
 * variable references (value, url, text, key, selector, name).
 */
export function substituteVariables(step: WireStep, vars: Record<string, string>): WireStep {
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  const sub = (s: string | undefined): string | undefined => {
    if (s === undefined || s === null) return s;
    return s.replace(re, (_, k: string) => vars[k] ?? "");
  };
  return {
    ...step,
    url: sub(step.url),
    value: sub(step.value),
    text: sub(step.text),
    key: sub(step.key),
    selector: sub(step.selector),
    name: sub(step.name),
  };
}
