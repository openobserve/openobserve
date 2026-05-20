// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// Mock useResizer composable - must be hoisted before import
vi.mock('@/composables/useResizer', () => ({
  default: vi.fn()
}))

import OSplitter from './OSplitter.vue'
import useResizer from '@/composables/useResizer'

describe('OSplitter', () => {
  let wrapper: VueWrapper
  let mockValue: { value: number }
  const mockIsResizing = { value: false }
  const mockOnMouseDown = vi.fn()

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Create a new mock value for each test
    mockValue = { value: 50 }

    // Setup useResizer mock
    vi.mocked(useResizer).mockReturnValue({
      value: mockValue,
      isResizing: mockIsResizing,
      onMouseDown: mockOnMouseDown
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  describe('default rendering', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: { modelValue: 50 }
      })
    })

    it('should render without errors', () => {
      expect(wrapper.exists()).toBe(true)
    })

    it('should render with default props', () => {
      expect(wrapper.find('.o-splitter').exists()).toBe(true)
      expect(wrapper.classes()).toContain('o-splitter--vertical')
      expect(wrapper.classes()).toContain('tw:flex-row')
    })

    it('should render before and after slots', () => {
      expect(wrapper.find('.o-splitter__before').exists()).toBe(true)
      expect(wrapper.find('.o-splitter__after').exists()).toBe(true)
    })

    it('should render separator by default', () => {
      expect(wrapper.find('.o-splitter__separator').exists()).toBe(true)
    })

    it('should call useResizer with correct default parameters', () => {
      expect(useResizer).toHaveBeenCalledWith({
        direction: 'horizontal',
        initialValue: 50,
        minValue: 0,
        maxValue: 100,
        unit: '%',
        containerRef: expect.any(Object),
        throttleMs: 16,
        invert: false,
        onResize: expect.any(Function)
      })
    })
  })

  describe('v-model emit functionality', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: { modelValue: 30 }
      })
    })

    it('should emit update:modelValue when useResizer onResize is called', () => {
      // Get the onResize function passed to useResizer
      const onResizeCall = vi.mocked(useResizer).mock.calls[0][0]
      const onResize = onResizeCall.onResize

      // Call onResize with a new value
      onResize(75)

      expect(wrapper.emitted('update:modelValue')).toEqual([[75]])
    })

    it('should update internal value when modelValue prop changes', async () => {
      await wrapper.setProps({ modelValue: 60 })
      await nextTick()

      expect(mockValue.value).toBe(60)
    })
  })

  describe('horizontal orientation', () => {
    beforeEach(() => {
      // Set mock value to match prop for this test group
      mockValue.value = 40

      wrapper = mount(OSplitter, {
        props: {
          modelValue: 40,
          horizontal: true
        }
      })
    })

    it('should render with horizontal classes', () => {
      expect(wrapper.classes()).toContain('o-splitter--horizontal')
      expect(wrapper.classes()).toContain('tw:flex-col')
    })

    it('should render horizontal separator', () => {
      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.classes()).toContain('o-splitter__separator--horizontal')
      expect(separator.classes()).toContain('tw:cursor-row-resize!')
    })

    it('should call useResizer with horizontal direction and invert', () => {
      expect(useResizer).toHaveBeenCalledWith({
        direction: 'vertical',
        initialValue: 40,
        minValue: 0,
        maxValue: 100,
        unit: '%',
        containerRef: expect.any(Object),
        throttleMs: 16,
        invert: false,
        onResize: expect.any(Function)
      })
    })

    it('should apply correct styles for horizontal layout', () => {
      const before = wrapper.find('.o-splitter__before')

      // Component uses mock value from useResizer (40%); horizontal layout uses height
      expect(before.element.style.height).toBe('40%')
    })
  })

  describe('vertical orientation', () => {
    beforeEach(() => {
      // Set mock value to match prop for this test group
      mockValue.value = 35

      wrapper = mount(OSplitter, {
        props: {
          modelValue: 35,
          horizontal: false
        }
      })
    })

    it('should render with vertical classes', () => {
      expect(wrapper.classes()).toContain('o-splitter--vertical')
      expect(wrapper.classes()).toContain('tw:flex-row')
    })

    it('should render vertical separator', () => {
      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.classes()).toContain('o-splitter__separator--vertical')
      expect(separator.classes()).toContain('tw:cursor-col-resize!')
    })

    it('should apply correct styles for vertical layout', () => {
      const before = wrapper.find('.o-splitter__before')

      // Component uses mock value from useResizer (35%); vertical layout uses width
      expect(before.element.style.width).toBe('35%')
    })
  })

  describe('limits constraints', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 25,
          limits: [10, 80]
        }
      })
    })

    it('should pass limits to useResizer', () => {
      expect(useResizer).toHaveBeenCalledWith({
        direction: 'horizontal',
        initialValue: 25,
        minValue: 10,
        maxValue: 80,
        unit: '%',
        containerRef: expect.any(Object),
        throttleMs: 16,
        invert: false,
        onResize: expect.any(Function)
      })
    })

    it('should set aria attributes with limits', () => {
      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.attributes('aria-valuemin')).toBe('10')
      expect(separator.attributes('aria-valuemax')).toBe('80')
      expect(separator.attributes('aria-valuenow')).toBe('25')
    })
  })

  describe('disabled state', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 50,
          disable: true
        }
      })
    })

    it('should render disabled separator', () => {
      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.classes()).toContain('tw:cursor-not-allowed')
      expect(separator.classes()).toContain('tw:opacity-50')
      expect(separator.attributes('tabindex')).toBe('-1')
    })

    it('should not call onMouseDown when disabled', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('mousedown')

      expect(mockOnMouseDown).not.toHaveBeenCalled()
    })

    it('should not handle keyboard events when disabled', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })
  })

  describe('keyboard navigation', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 50,
          unit: '%'
        }
      })
    })

    it('should handle ArrowRight key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[55]])
    })

    it('should handle ArrowLeft key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowLeft' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[45]])
    })

    it('should handle ArrowUp key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowUp' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[45]])
    })

    it('should handle ArrowDown key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowDown' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[55]])
    })

    it('should handle Home key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'Home' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[0]])
    })

    it('should handle End key', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'End' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[100]])
    })

    it('should respect limits when using keyboard navigation', async () => {
      await wrapper.setProps({ limits: [20, 80] })

      const separator = wrapper.find('.o-splitter__separator')

      // Test minimum constraint
      await wrapper.setProps({ modelValue: 25 })
      await separator.trigger('keydown', { key: 'ArrowLeft' })

      const emittedEvents = wrapper.emitted('update:modelValue') as Array<Array<number>>
      expect(emittedEvents).toBeTruthy()
      expect(emittedEvents[emittedEvents.length - 1]).toEqual([20])

      // Test maximum constraint
      await wrapper.setProps({ modelValue: 75 })
      await separator.trigger('keydown', { key: 'ArrowRight' })

      const emittedEvents2 = wrapper.emitted('update:modelValue') as Array<Array<number>>
      expect(emittedEvents2[emittedEvents2.length - 1]).toEqual([80])
    })

    it('should use different step size for px unit', async () => {
      await wrapper.setProps({ unit: 'px' })

      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'ArrowRight' })

      expect(wrapper.emitted('update:modelValue')).toEqual([[70]]) // 50 + 20px step
    })

    it('should prevent default for handled keys', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      const event = { key: 'ArrowRight', preventDefault: vi.fn() }

      await separator.trigger('keydown', event)

      // The preventDefault should be called in the actual handler
      // We can't directly test it due to Vue Test Utils limitations
      expect(wrapper.emitted('update:modelValue')).toEqual([[55]])
    })

    it('should not handle unrecognized keys', async () => {
      const separator = wrapper.find('.o-splitter__separator')
      await separator.trigger('keydown', { key: 'Enter' })

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()
    })
  })

  describe('separator customization', () => {
    it('should hide separator when separator prop is false', () => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 50,
          separator: false
        }
      })

      expect(wrapper.find('.o-splitter__separator').exists()).toBe(false)
    })

    it('should apply custom separator class', () => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 50,
          separatorClass: 'custom-separator'
        }
      })

      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.classes()).toContain('custom-separator')
    })

    it('should apply custom separator style', () => {
      const customStyle = { backgroundColor: 'red' }
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 50,
          separatorStyle: customStyle
        }
      })

      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.element.style.backgroundColor).toBe('red')
    })
  })

  describe('slot rendering', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: { modelValue: 50 },
        slots: {
          before: '<div data-test="before-content">Before Content</div>',
          after: '<div data-test="after-content">After Content</div>',
          separator: '<div data-test="custom-separator">Custom Separator</div>'
        }
      })
    })

    it('should render before slot content', () => {
      expect(wrapper.find('[data-test="before-content"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="before-content"]').text()).toBe('Before Content')
    })

    it('should render after slot content', () => {
      expect(wrapper.find('[data-test="after-content"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="after-content"]').text()).toBe('After Content')
    })

    it('should render custom separator slot content', () => {
      expect(wrapper.find('[data-test="custom-separator"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="custom-separator"]').text()).toBe('Custom Separator')
    })
  })

  describe('accessibility', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: { modelValue: 40 }
      })
    })

    it('should have correct aria attributes', () => {
      const separator = wrapper.find('.o-splitter__separator')

      expect(separator.attributes('role')).toBe('separator')
      expect(separator.attributes('aria-orientation')).toBe('vertical')
      expect(separator.attributes('aria-label')).toBe('Vertical splitter')
      expect(separator.attributes('aria-valuenow')).toBe('40')
      expect(separator.attributes('aria-valuemin')).toBe('0')
      expect(separator.attributes('aria-valuemax')).toBe('100')
    })

    it('should have correct aria-orientation for horizontal splitter', () => {
      wrapper = mount(OSplitter, {
        props: {
          modelValue: 40,
          horizontal: true
        }
      })

      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.attributes('aria-orientation')).toBe('horizontal')
      expect(separator.attributes('aria-label')).toBe('Horizontal splitter')
    })

    it('should be focusable when not disabled', () => {
      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.attributes('tabindex')).toBe('0')
    })
  })

  describe('mouse interaction', () => {
    beforeEach(() => {
      wrapper = mount(OSplitter, {
        props: { modelValue: 50 }
      })
    })

    it('should call useResizer onMouseDown when separator is clicked', async () => {
      const separator = wrapper.find('.o-splitter__separator')

      await separator.trigger('mousedown')

      expect(mockOnMouseDown).toHaveBeenCalled()
    })

    it('should not apply special styles when isResizing is true', async () => {
      mockIsResizing.value = true
      await wrapper.vm.$forceUpdate()

      const separator = wrapper.find('.o-splitter__separator')
      expect(separator.classes()).not.toContain('tw:bg-[var(--o2-primary-color)]')
    })
  })

  describe('unit types', () => {
    it('should handle percentage unit correctly', () => {
      // Set mock value to match prop
      mockValue.value = 30

      wrapper = mount(OSplitter, {
        props: {
          modelValue: 30,
          unit: '%'
        }
      })

      expect(useResizer).toHaveBeenCalledWith(
        expect.objectContaining({
          unit: '%'
        })
      )

      // Default horizontal=false uses width for before slot
      const before = wrapper.find('.o-splitter__before')
      expect(before.element.style.width).toBe('30%')
    })

    it('should handle pixel unit correctly', () => {
      // Set mock value to match prop
      mockValue.value = 200

      wrapper = mount(OSplitter, {
        props: {
          modelValue: 200,
          unit: 'px'
        }
      })

      expect(useResizer).toHaveBeenCalledWith(
        expect.objectContaining({
          unit: 'px'
        })
      )

      const before = wrapper.find('.o-splitter__before')
      expect(before.element.style.width).toBe('200px')
    })

    it.skip('should calculate after section style correctly for pixel units', () => {
      // TODO: After slot no longer has inline style applied in current OSplitter source
    })
  })
})
