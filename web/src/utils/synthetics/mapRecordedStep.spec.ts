// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from 'vitest'
import type { WireStep } from '@/types/synthetics'
import { mapWireStep, mapWireSteps } from './mapRecordedStep'

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
      id: 's1',
      action: 'navigate',
      name: 'Open login',
      selector: undefined,
      selectorType: undefined,
      value: 'https://app.example.com/login',
      timeout: 10000,
    })
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

  it('should generate an id when the wire step has none', () => {
    const mapped = mapWireStep({ id: '', action: 'click' })
    expect(mapped.id).toMatch(/[0-9a-f-]{36}/)
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
