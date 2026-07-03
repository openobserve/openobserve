// Copyright 2026 OpenObserve Inc.

import type {
  BrowserStep,
  SelectorType,
  StepAction,
  WireStep,
} from '@/types/synthetics'
import { getUUIDv7 } from '../uuid'

// Maps the extension's Playwright-flavoured action names onto the UI's StepAction.
// `setInputFiles` has no dedicated UI action and is surfaced as a `type` step.
const ACTION_MAP: Record<string, StepAction> = {
  navigate: 'navigate',
  click: 'click',
  type: 'type',
  press: 'press',
  select: 'select',
  hover: 'hover',
  scroll: 'scroll',
  wait: 'wait',
  waitFor: 'wait',
  assert: 'assert',
  screenshot: 'screenshot',
  setInputFiles: 'type',
}

const SELECTOR_TYPE_MAP: Record<string, SelectorType> = {
  css: 'CSS',
  xpath: 'XPath',
  text: 'Text',
  role: 'Role',
  'data-test': 'TestID',
}

// Inverse of SELECTOR_TYPE_MAP, for building wire steps from manual UI steps.
const WIRE_SELECTOR_TYPE_MAP: Record<SelectorType, WireStep['selector_type']> = {
  CSS: 'css',
  XPath: 'xpath',
  Text: 'text',
  Role: 'role',
  TestID: 'data-test',
}

const DEFAULT_TIMEOUT = 30000

function mapAction(action: string): StepAction {
  const mapped = ACTION_MAP[action]
  if (!mapped) {
    console.warn(`[synthetics] unknown recorded action "${action}", defaulting to click`)
    return 'click'
  }
  return mapped
}

// The UI keeps a single `value` field; pick the right wire field per action.
function mapValue(wire: WireStep, action: StepAction): string | undefined {
  switch (action) {
    case 'navigate':
      return wire.url ?? wire.value
    case 'press':
      return wire.key ?? wire.value
    case 'assert':
      return wire.text ?? wire.value
    default:
      return wire.value
  }
}

/** Convert a single extension {@link WireStep} into the UI-facing {@link BrowserStep}. */
export function mapWireStep(wire: WireStep): BrowserStep {
  const action = mapAction(wire.action);
  const id = getUUIDv7(true);
  return {
    id: id,
    action,
    name: wire.name,
    selector: wire.selector,
    selectorType: wire.selector_type ? SELECTOR_TYPE_MAP[wire.selector_type] : undefined,
    value: mapValue(wire, action),
    timeout: wire.timeout_ms ?? DEFAULT_TIMEOUT,
    code: wire.code || "",
    // Keep the original extension step untouched for replay (full fidelity).
    wire: {
      ...wire,
      id,
    },
  }
}

/** Convert a list of extension wire steps into UI steps. */
export function mapWireSteps(wires: WireStep[]): BrowserStep[] {
  return wires.map(mapWireStep)
}

/**
 * Reverse of {@link mapWireStep}: reconstruct a replayable {@link WireStep} from a
 * lean UI step that has no recorded `wire` (i.e. manually added in the editor).
 * Mirrors the fields the extension's `buildActionFromStep` consumes. Returns
 * `null` for actions the Playwright player can't replay (hover/scroll/wait/screenshot).
 */
export function buildWireFromStep(step: BrowserStep): WireStep | null {
  const base: WireStep = {
    id: step.id,
    action: step.action,
    name: step.name ?? '',
    selector: step.selector,
    selector_type: step.selectorType ? WIRE_SELECTOR_TYPE_MAP[step.selectorType] : undefined,
    timeout_ms: step.timeout ?? DEFAULT_TIMEOUT,
    pageAlias: 'page',
    framePath: [],
  }
  switch (step.action) {
    case 'navigate':
      return { ...base, url: step.value }
    case 'click':
      return base
    case 'type':
      return { ...base, value: step.value }
    case 'press':
      return { ...base, key: step.value }
    case 'select':
      return { ...base, options: step.value ? [step.value] : [] }
    case 'assert':
      // Lean steps can't express assert subtype; default to assertText when a
      // value is present, else assertVisible.
      return step.value !== undefined && step.value !== ''
        ? { ...base, text: step.value }
        : base
    default:
      // hover / scroll / wait / screenshot — not supported by the player.
      return null
  }
}

/**
 * Collect the replayable steps from a journey to send to the extension's replay
 * command. Recorded steps replay verbatim via their preserved `wire`; manual
 * steps are reverse-mapped via {@link buildWireFromStep}. Unsupported manual
 * actions yield `null` and are dropped.
 */
export function journeyToWireSteps(steps: BrowserStep[]): WireStep[] {
  return steps
    .map((s) => s.wire ?? buildWireFromStep(s))
    .filter((w): w is WireStep => w != null)
}

/**
 * Substitute `{{ VAR_NAME }}` placeholders in wire step string fields with
 * actual variable values. Operates on all string fields that could contain
 * variable references (value, url, text, key, selector, name).
 */
export function substituteVariables(step: WireStep, vars: Record<string, string>): WireStep {
  const re = /\{\{\s*(\w+)\s*\}\}/g
  const sub = (s: string | undefined): string | undefined => {
    if (s === undefined || s === null) return s
    return s.replace(re, (_, k: string) => vars[k] ?? '')
  }
  return {
    ...step,
    url: sub(step.url),
    value: sub(step.value),
    text: sub(step.text),
    key: sub(step.key),
    selector: sub(step.selector),
    name: sub(step.name),
  }
}
