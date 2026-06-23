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
  const action = mapAction(wire.action)
  return {
    id: getUUIDv7(),
    action,
    name: wire.name,
    selector: wire.selector,
    selectorType: wire.selector_type ? SELECTOR_TYPE_MAP[wire.selector_type] : undefined,
    value: mapValue(wire, action),
    timeout: wire.timeout_ms ?? DEFAULT_TIMEOUT,
    code: wire.code || "",
  }
}

/** Convert a list of extension wire steps into UI steps. */
export function mapWireSteps(wires: WireStep[]): BrowserStep[] {
  return wires.map(mapWireStep)
}
