// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from 'vitest'
import type { BrowserStep, WireStep } from '@/types/synthetics'
import { buildWireFromStep, journeyToWireSteps, mapWireStep, mapWireSteps } from './mapRecordedStep'

describe('mapRecordedStep', () => {
  it('should map a navigate wire step using the url as value', () => {
    const wire: WireStep = {
      id: 's1',
      action: 'navigate',
      name: 'Open login',
      url: 'https://app.example.com/login',
      timeout_ms: 10000,
    }
    expect(mapWireStep(wire)).toEqual({
      id: expect.any(String), // mapper assigns a fresh UUID per step
      action: 'navigate',
      name: 'Open login',
      selector: undefined,
      selectorType: undefined,
      value: 'https://app.example.com/login',
      timeout: 10000,
      code: '',
      wire: { ...wire, id: expect.any(String) }, // wire.id is now the step's own UUID
    })
  })

  it('should preserve the original extension step verbatim on wire', () => {
    const wire: WireStep = {
      id: 's4',
      action: 'click',
      selector: '#login-btn',
      selector_type: 'css',
      name: 'Click login',
      timeout_ms: 10000,
      button: 'left',
      modifiers: 2,
      position: { x: 12, y: 34 },
      pageAlias: 'page',
      framePath: [],
      startTime: 1718700003100,
      code: "await page.locator('#login-btn').click();",
    }
    // wire is spread with the step's own UUID assigned to wire.id.
    expect(mapWireStep(wire).wire).toEqual({ ...wire, id: expect.any(String) })
  })

  describe('buildWireFromStep (reverse mapper for manual steps)', () => {
    const lean = (over: Partial<BrowserStep>): BrowserStep =>
      ({ id: 'm1', action: 'click', timeout: 30000, code: '', ...over })

    it('should map a manual navigate step to a wire with url', () => {
      const w = buildWireFromStep(lean({ action: 'navigate', value: 'https://x.test' }))
      expect(w).toMatchObject({ action: 'navigate', url: 'https://x.test', timeout_ms: 30000, pageAlias: 'page', framePath: [] })
    })

    it('should map a manual click step preserving selector + selector_type', () => {
      const w = buildWireFromStep(lean({ action: 'click', selector: '#go', selectorType: 'CSS' }))
      expect(w).toMatchObject({ action: 'click', selector: '#go', selector_type: 'css' })
    })

    it('should map a manual type step value to wire value', () => {
      expect(buildWireFromStep(lean({ action: 'type', selector: '#email', value: 'a@b.c' }))).toMatchObject({ action: 'type', value: 'a@b.c' })
    })

    it('should map a manual press step value to key', () => {
      expect(buildWireFromStep(lean({ action: 'press', selector: '#i', value: 'Enter' }))).toMatchObject({ action: 'press', key: 'Enter' })
    })

    it('should map a manual select step value to a single-item options array', () => {
      expect(buildWireFromStep(lean({ action: 'select', selector: '#s', value: 'opt1' }))).toMatchObject({ action: 'select', options: ['opt1'] })
    })

    it('should map a manual assert step with a value to assert text', () => {
      expect(buildWireFromStep(lean({ action: 'assert', selector: '.h', value: 'Welcome' }))).toMatchObject({ action: 'assert', text: 'Welcome' })
    })

    it.each(['hover', 'scroll', 'wait', 'screenshot'] as const)('should return a valid wire for action %s (previously null)', (action) => {
      const wire = buildWireFromStep(lean({ action }))
      expect(wire).not.toBeNull()
      expect(wire!.action).toBe(action)
    })
  })

  it('should include all steps via journeyToWireSteps (including previously filtered actions)', () => {
    const recorded = mapWireStep({ id: 's1', action: 'navigate', url: 'https://x.test' })
    const manual: BrowserStep = { id: 'm1', action: 'click', selector: '#go', timeout: 30000, code: '' }
    const waitStep: BrowserStep = { id: 'm2', action: 'wait', timeout: 30000, code: '' }
    const hoverStep: BrowserStep = { id: 'm3', action: 'hover', selector: '.el', timeout: 30000, code: '' }

    const wires = journeyToWireSteps([recorded, manual, waitStep, hoverStep])
    expect(wires).toHaveLength(4) // all steps included — no drop on buildWireFromStep
    expect(wires[0]).toBe(recorded.wire) // recorded preserved verbatim
    expect(wires[2]).toMatchObject({ action: 'wait' })
    expect(wires[3]).toMatchObject({ action: 'hover', selector: '.el' })
    expect(wires[1]).toMatchObject({ action: 'click', selector: '#go' })
  })

  it('should map a type wire step with css selector_type to CSS', () => {
    const wire: WireStep = {
      id: 's2',
      action: 'type',
      name: 'Fill #email',
      selector: '#email',
      selector_type: 'css',
      value: 'user@example.com',
      timeout_ms: 10000,
    }
    const mapped = mapWireStep(wire)
    expect(mapped.action).toBe('type')
    expect(mapped.selector).toBe('#email')
    expect(mapped.selectorType).toBe('CSS')
    expect(mapped.value).toBe('user@example.com')
  })

  it('should map a click wire step and map data-test selector_type to TestID', () => {
    const mapped = mapWireStep({
      id: 's3',
      action: 'click',
      selector: 'submit',
      selector_type: 'data-test',
      button: 'left',
    })
    expect(mapped.action).toBe('click')
    expect(mapped.selectorType).toBe('TestID')
  })

  it('should map a press wire step using the key as value', () => {
    const mapped = mapWireStep({ id: 's4', action: 'press', key: 'Enter' })
    expect(mapped.action).toBe('press')
    expect(mapped.value).toBe('Enter')
  })

  it('should map an assert wire step preferring text over value', () => {
    const mapped = mapWireStep({
      id: 's5',
      action: 'assert',
      selector: '.dashboard',
      selector_type: 'css',
      text: 'Welcome',
      value: 'ignored',
    })
    expect(mapped.action).toBe('assert')
    expect(mapped.value).toBe('Welcome')
  })

  it('should map waitFor to the wait action', () => {
    expect(mapWireStep({ id: 's6', action: 'waitFor' }).action).toBe('wait')
  })

  it('should map setInputFiles to the type action', () => {
    expect(mapWireStep({ id: 's7', action: 'setInputFiles' }).action).toBe('type')
  })

  it('should default unknown actions to click and warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mapped = mapWireStep({ id: 's8', action: 'frobnicate' })
    expect(mapped.action).toBe('click')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('should default timeout to 30000 when timeout_ms is absent', () => {
    expect(mapWireStep({ id: 's9', action: 'click' }).timeout).toBe(30000)
  })

  it('should generate a compact UUIDv7 id when the wire step has none', () => {
    const mapped = mapWireStep({ id: '', action: 'click' })
    expect(mapped.id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('should map a list of wire steps preserving order', () => {
    const steps = mapWireSteps([
      { id: 's1', action: 'navigate', url: 'https://x.test' },
      { id: 's2', action: 'click', selector: '#go' },
    ])
    expect(steps).toHaveLength(2)
    expect(steps[0].action).toBe('navigate')
    expect(steps[1].action).toBe('click')
  })
})
