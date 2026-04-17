// Copyright 2026 OpenObserve Inc.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import O2Input from './O2Input.vue'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mountInput(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(O2Input, {
    props,
    slots,
    attachTo: document.body,
  })
}

async function setValue(wrapper: VueWrapper, value: string) {
  const input = wrapper.find('.o2-input__native')
  await input.setValue(value)
  await input.trigger('input')
  await flushPromises()
}

// ─── Rendering ───────────────────────────────────────────────────────────────

describe('O2Input', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  describe('initial render', () => {
    it('should render without errors with no props', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input').exists()).toBe(true)
      expect(wrapper.find('.o2-input__control').exists()).toBe(true)
      expect(wrapper.find('.o2-input__native').exists()).toBe(true)
    })

    it('should render a label when provided', () => {
      wrapper = mountInput({ label: 'Username' })
      const label = wrapper.find('.o2-input__label')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('Username')
    })

    it('should not render a label when not provided', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input__label').exists()).toBe(false)
    })

    it('should set placeholder on native input', () => {
      wrapper = mountInput({ placeholder: 'Enter value' })
      expect(wrapper.find('.o2-input__native').attributes('placeholder')).toBe('Enter value')
    })

    it('should render as textarea when type is textarea', () => {
      wrapper = mountInput({ type: 'textarea' })
      expect(wrapper.find('textarea.o2-input__native').exists()).toBe(true)
      expect(wrapper.find('input.o2-input__native').exists()).toBe(false)
    })

    it('should render as input[type=number] when type is number', () => {
      wrapper = mountInput({ type: 'number' })
      expect(wrapper.find('input[type="number"]').exists()).toBe(true)
    })

    it('should render as input[type=password] when type is password', () => {
      wrapper = mountInput({ type: 'password' })
      expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    })

    it('should apply data-test attribute to the root element', () => {
      wrapper = mountInput({ 'data-test': 'my-input' })
      expect(wrapper.find('[data-test="my-input"]').exists()).toBe(true)
      // data-test should be on root, not native input
      expect(wrapper.find('input[data-test="my-input"]').exists()).toBe(false)
    })

    it('should apply outlined variant class by default', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input--outlined').exists()).toBe(true)
    })

    it('should apply borderless variant class', () => {
      wrapper = mountInput({ variant: 'borderless' })
      expect(wrapper.find('.o2-input--borderless').exists()).toBe(true)
    })

    it('should apply filled variant class', () => {
      wrapper = mountInput({ variant: 'filled' })
      expect(wrapper.find('.o2-input--filled').exists()).toBe(true)
    })

    it('should reflect the initial modelValue in native input', () => {
      wrapper = mountInput({ modelValue: 'hello' })
      expect((wrapper.find('.o2-input__native').element as HTMLInputElement).value).toBe('hello')
    })

    it('should render empty string for null modelValue', () => {
      wrapper = mountInput({ modelValue: null })
      expect((wrapper.find('.o2-input__native').element as HTMLInputElement).value).toBe('')
    })

    it('should render empty string for undefined modelValue', () => {
      wrapper = mountInput({ modelValue: undefined })
      expect((wrapper.find('.o2-input__native').element as HTMLInputElement).value).toBe('')
    })
  })

  // ─── v-model ───────────────────────────────────────────────────────────────

  describe('v-model', () => {
    it('should emit update:modelValue on input', async () => {
      wrapper = mountInput({ modelValue: '' })
      await setValue(wrapper, 'new value')
      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['new value'])
    })

    it('should apply number modifier when modelModifiers.number is true', async () => {
      wrapper = mountInput({ modelValue: 0, modelModifiers: { number: true } })
      await setValue(wrapper, '42')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([42])
    })

    it('should emit null for empty number input with number modifier', async () => {
      wrapper = mountInput({ modelValue: 5, modelModifiers: { number: true } })
      await setValue(wrapper, '')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([null])
    })

    it('should emit null for non-numeric input with number modifier', async () => {
      wrapper = mountInput({ modelValue: 5, modelModifiers: { number: true } })
      await setValue(wrapper, 'abc')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([null])
    })

    it('should apply trim modifier when modelModifiers.trim is true', async () => {
      wrapper = mountInput({ modelValue: '', modelModifiers: { trim: true } })
      await setValue(wrapper, '  trimmed  ')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['trimmed'])
    })

    it('should emit focus event on focus', async () => {
      wrapper = mountInput()
      await wrapper.find('.o2-input__native').trigger('focus')
      expect(wrapper.emitted('focus')).toBeTruthy()
    })

    it('should emit blur event on blur', async () => {
      wrapper = mountInput()
      await wrapper.find('.o2-input__native').trigger('blur')
      expect(wrapper.emitted('blur')).toBeTruthy()
    })

    it('should emit keydown event', async () => {
      wrapper = mountInput()
      await wrapper.find('.o2-input__native').trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('keydown')).toBeTruthy()
    })

    it('should add focused class on focus', async () => {
      wrapper = mountInput()
      await wrapper.find('.o2-input__native').trigger('focus')
      expect(wrapper.find('.o2-input--focused').exists()).toBe(true)
    })

    it('should remove focused class on blur', async () => {
      wrapper = mountInput()
      await wrapper.find('.o2-input__native').trigger('focus')
      await wrapper.find('.o2-input__native').trigger('blur')
      expect(wrapper.find('.o2-input--focused').exists()).toBe(false)
    })
  })

  // ─── Debounce ──────────────────────────────────────────────────────────────

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should debounce emit by specified milliseconds', async () => {
      wrapper = mountInput({ modelValue: '', debounce: 300 })
      const input = wrapper.find('.o2-input__native')
      await input.setValue('typed')
      await input.trigger('input')

      expect(wrapper.emitted('update:modelValue')).toBeFalsy()

      vi.advanceTimersByTime(300)
      await flushPromises()

      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    })

    it('should only emit last value when multiple inputs occur within debounce window', async () => {
      wrapper = mountInput({ modelValue: '', debounce: 200 })
      const input = wrapper.find('.o2-input__native')

      await input.setValue('a')
      await input.trigger('input')
      await input.setValue('ab')
      await input.trigger('input')
      await input.setValue('abc')
      await input.trigger('input')

      vi.advanceTimersByTime(200)
      await flushPromises()

      const emits = wrapper.emitted('update:modelValue')
      expect(emits).toHaveLength(1)
      expect(emits![0]).toEqual(['abc'])
    })
  })

  // ─── Validation ────────────────────────────────────────────────────────────

  describe('validation', () => {
    const required = (val: unknown) => (!!val && String(val).trim().length > 0) || 'Required'

    it('should not show error before user interacts', () => {
      wrapper = mountInput({ modelValue: '', rules: [required] })
      expect(wrapper.find('.o2-input--error').exists()).toBe(false)
      expect(wrapper.find('.o2-input__error-text').exists()).toBe(false)
    })

    it('should show error after validate() is called with invalid value', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required] })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      const valid = exposed.validate()
      await flushPromises()
      expect(valid).toBe(false)
      expect(wrapper.find('.o2-input--error').exists()).toBe(true)
      expect(wrapper.find('.o2-input__error-text').text()).toContain('Required')
    })

    it('should return true from validate() when value passes all rules', async () => {
      wrapper = mountInput({ modelValue: 'hello', rules: [required] })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      const valid = exposed.validate()
      await flushPromises()
      expect(valid).toBe(true)
      expect(wrapper.find('.o2-input--error').exists()).toBe(false)
    })

    it('should show first failing rule error message', async () => {
      const rules = [
        (v: unknown) => !!v || 'Required',
        (v: unknown) => String(v).length >= 3 || 'Min 3 chars',
      ]
      wrapper = mountInput({ modelValue: 'a', rules })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      exposed.validate()
      await flushPromises()
      expect(wrapper.find('.o2-input__error-text').text()).toContain('Min 3 chars')
    })

    it('should validate on input when already dirty', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required] })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      exposed.validate() // mark dirty
      await flushPromises()
      // Now fix the value
      await wrapper.setProps({ modelValue: 'fixed' })
      await setValue(wrapper, 'fixed')
      expect(wrapper.find('.o2-input--error').exists()).toBe(false)
    })

    it('should clear error after resetValidation()', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required] })
      const exposed = wrapper.vm as unknown as {
        validate: () => boolean
        resetValidation: () => void
      }
      exposed.validate()
      await flushPromises()
      expect(wrapper.find('.o2-input--error').exists()).toBe(true)

      exposed.resetValidation()
      await flushPromises()
      expect(wrapper.find('.o2-input--error').exists()).toBe(false)
    })

    it('should not validate on blur when lazyRules is "ondemand"', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required], lazyRules: 'ondemand' })
      await wrapper.find('.o2-input__native').trigger('blur')
      await flushPromises()
      expect(wrapper.find('.o2-input--error').exists()).toBe(false)
    })

    it('should validate on blur when lazyRules is true', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required], lazyRules: true })
      await wrapper.find('.o2-input__native').trigger('blur')
      await flushPromises()
      expect(wrapper.find('.o2-input--error').exists()).toBe(true)
    })

    it('should show error icon by default', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required] })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      exposed.validate()
      await flushPromises()
      expect(wrapper.find('.o2-input__error-icon').exists()).toBe(true)
    })

    it('should hide error icon when noErrorIcon is true', async () => {
      wrapper = mountInput({ modelValue: '', rules: [required], noErrorIcon: true })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      exposed.validate()
      await flushPromises()
      expect(wrapper.find('.o2-input__error-icon').exists()).toBe(false)
    })
  })

  // ─── External error prop ───────────────────────────────────────────────────

  describe('error prop', () => {
    it('should show error state when error=true without rules', () => {
      wrapper = mountInput({ error: true, errorMessage: 'Something went wrong' })
      expect(wrapper.find('.o2-input--error').exists()).toBe(true)
      expect(wrapper.find('.o2-input__error-text').text()).toContain('Something went wrong')
    })

    it('should show error role="alert" for accessibility', () => {
      wrapper = mountInput({ error: true, errorMessage: 'Bad input' })
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    })

    it('should show empty error text when errorMessage not provided', () => {
      wrapper = mountInput({ error: true })
      expect(wrapper.find('.o2-input--error').exists()).toBe(true)
      expect(wrapper.find('.o2-input__error-text').text().trim()).toBe('')
    })
  })

  // ─── Hint ──────────────────────────────────────────────────────────────────

  describe('hint', () => {
    it('should render hint text from prop', () => {
      wrapper = mountInput({ hint: 'Use alphanumeric only' })
      expect(wrapper.find('.o2-input__hint-text').text()).toBe('Use alphanumeric only')
    })

    it('should render hint from slot', () => {
      wrapper = mountInput({}, { hint: '<span>Slot hint text</span>' })
      expect(wrapper.find('.o2-input__hint-text').exists()).toBe(true)
      expect(wrapper.find('.o2-input__hint-text').text()).toContain('Slot hint text')
    })

    it('should prefer error over hint when both present', async () => {
      wrapper = mountInput({ error: true, errorMessage: 'Error!', hint: 'Hint text' })
      expect(wrapper.find('.o2-input__error-text').exists()).toBe(true)
      expect(wrapper.find('.o2-input__hint-text').exists()).toBe(false)
    })
  })

  // ─── Counter ───────────────────────────────────────────────────────────────

  describe('counter', () => {
    it('should show counter when counter=true and maxlength set', () => {
      wrapper = mountInput({ modelValue: 'hi', counter: true, maxlength: 50 })
      expect(wrapper.find('.o2-input__counter').exists()).toBe(true)
      expect(wrapper.find('.o2-input__counter').text()).toBe('2/50')
    })

    it('should not show counter when counter=true but maxlength is not set', () => {
      wrapper = mountInput({ modelValue: 'hi', counter: true })
      expect(wrapper.find('.o2-input__counter').exists()).toBe(false)
    })

    it('should update counter as value changes', async () => {
      wrapper = mountInput({ modelValue: 'hi', counter: true, maxlength: 10 })
      expect(wrapper.find('.o2-input__counter').text()).toBe('2/10')
      await wrapper.setProps({ modelValue: 'hello' })
      expect(wrapper.find('.o2-input__counter').text()).toBe('5/10')
    })
  })

  // ─── Clearable ─────────────────────────────────────────────────────────────

  describe('clearable', () => {
    it('should show clear button when clearable and value present', () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: true })
      expect(wrapper.find('.o2-input__clear').exists()).toBe(true)
    })

    it('should hide clear button when value is empty', () => {
      wrapper = mountInput({ modelValue: '', clearable: true })
      expect(wrapper.find('.o2-input__clear').exists()).toBe(false)
    })

    it('should hide clear button when clearable is false', () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: false })
      expect(wrapper.find('.o2-input__clear').exists()).toBe(false)
    })

    it('should hide clear button when disabled', () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: true, disabled: true })
      expect(wrapper.find('.o2-input__clear').exists()).toBe(false)
    })

    it('should hide clear button when readonly', () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: true, readonly: true })
      expect(wrapper.find('.o2-input__clear').exists()).toBe(false)
    })

    it('should emit empty string on clear for text input', async () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: true })
      await wrapper.find('.o2-input__clear').trigger('click')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([''])
    })

    it('should emit null on clear for number modifier input', async () => {
      wrapper = mountInput({ modelValue: 42, clearable: true, modelModifiers: { number: true } })
      await wrapper.find('.o2-input__clear').trigger('click')
      expect(wrapper.emitted('update:modelValue')![0]).toEqual([null])
    })

    it('clear button should have aria-label', () => {
      wrapper = mountInput({ modelValue: 'hello', clearable: true })
      expect(wrapper.find('.o2-input__clear').attributes('aria-label')).toBe('Clear')
    })
  })

  // ─── Disabled / Readonly ───────────────────────────────────────────────────

  describe('disabled state', () => {
    it('should apply disabled class when disabled', () => {
      wrapper = mountInput({ disabled: true })
      expect(wrapper.find('.o2-input--disabled').exists()).toBe(true)
    })

    it('should set disabled attribute on native input', () => {
      wrapper = mountInput({ disabled: true })
      expect(wrapper.find('.o2-input__native').attributes('disabled')).toBeDefined()
    })

    it('should set readonly attribute on native input', () => {
      wrapper = mountInput({ readonly: true })
      expect(wrapper.find('.o2-input__native').attributes('readonly')).toBeDefined()
    })
  })

  // ─── Loading ───────────────────────────────────────────────────────────────

  describe('loading', () => {
    it('should show spinner when loading is true', () => {
      wrapper = mountInput({ loading: true })
      expect(wrapper.find('.o2-input__spinner').exists()).toBe(true)
    })

    it('should not show spinner when loading is false', () => {
      wrapper = mountInput({ loading: false })
      expect(wrapper.find('.o2-input__spinner').exists()).toBe(false)
    })

    it('spinner should have aria-hidden', () => {
      wrapper = mountInput({ loading: true })
      expect(wrapper.find('.o2-input__spinner').attributes('aria-hidden')).toBe('true')
    })
  })

  // ─── Slots ─────────────────────────────────────────────────────────────────

  describe('slots', () => {
    it('should render prepend slot', () => {
      wrapper = mountInput({}, { prepend: '<span data-test="icon">★</span>' })
      expect(wrapper.find('.o2-input__adornment--pre').exists()).toBe(true)
      expect(wrapper.find('[data-test="icon"]').exists()).toBe(true)
    })

    it('should not render prepend wrapper when slot is empty', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input__adornment--pre').exists()).toBe(false)
    })

    it('should render append slot', () => {
      wrapper = mountInput({}, { append: '<span data-test="append-icon">⌕</span>' })
      expect(wrapper.find('.o2-input__adornment--app').exists()).toBe(true)
      expect(wrapper.find('[data-test="append-icon"]').exists()).toBe(true)
    })

    it('should not render append wrapper when slot is empty', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input__adornment--app').exists()).toBe(false)
    })
  })

  // ─── Bottom space ──────────────────────────────────────────────────────────

  describe('hideBottomSpace', () => {
    it('should render bottom row by default', () => {
      wrapper = mountInput()
      expect(wrapper.find('.o2-input__bottom').exists()).toBe(true)
    })

    it('should hide bottom row when hideBottomSpace is true and no error', () => {
      wrapper = mountInput({ hideBottomSpace: true })
      expect(wrapper.find('.o2-input__bottom').exists()).toBe(false)
    })

    it('should still show error when hideBottomSpace is true and there is an error', async () => {
      wrapper = mountInput({ hideBottomSpace: true, error: true, errorMessage: 'Oops' })
      expect(wrapper.find('.o2-input__bottom').exists()).toBe(true)
      expect(wrapper.find('.o2-input__error-text').exists()).toBe(true)
    })
  })

  // ─── Exposed API ───────────────────────────────────────────────────────────

  describe('exposed API', () => {
    it('should expose validate() method', () => {
      wrapper = mountInput()
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      expect(typeof exposed.validate).toBe('function')
    })

    it('should expose resetValidation() method', () => {
      wrapper = mountInput()
      const exposed = wrapper.vm as unknown as { resetValidation: () => void }
      expect(typeof exposed.resetValidation).toBe('function')
    })

    it('should expose focus() method', () => {
      wrapper = mountInput()
      const exposed = wrapper.vm as unknown as { focus: () => void }
      expect(typeof exposed.focus).toBe('function')
    })

    it('validate() should return true with no rules', () => {
      wrapper = mountInput({ modelValue: '' })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      expect(exposed.validate()).toBe(true)
    })

    it('validate() should return false when value fails a rule', () => {
      wrapper = mountInput({
        modelValue: '',
        rules: [(v: unknown) => !!v || 'Required'],
      })
      const exposed = wrapper.vm as unknown as { validate: () => boolean }
      expect(exposed.validate()).toBe(false)
    })
  })

  // ─── Textarea autogrow ─────────────────────────────────────────────────────

  describe('textarea autogrow', () => {
    it('should render textarea element', () => {
      wrapper = mountInput({ type: 'textarea' })
      expect(wrapper.find('textarea').exists()).toBe(true)
    })

    it('should apply textarea modifier class', () => {
      wrapper = mountInput({ type: 'textarea' })
      expect(wrapper.find('.o2-input--textarea').exists()).toBe(true)
    })
  })

  // ─── Maxlength ─────────────────────────────────────────────────────────────

  describe('maxlength', () => {
    it('should set maxlength attribute on native input', () => {
      wrapper = mountInput({ maxlength: 100 })
      expect(wrapper.find('.o2-input__native').attributes('maxlength')).toBe('100')
    })
  })

  // ─── Tabindex ──────────────────────────────────────────────────────────────

  describe('tabindex', () => {
    it('should set tabindex on native input', () => {
      wrapper = mountInput({ tabindex: 3 })
      expect(wrapper.find('.o2-input__native').attributes('tabindex')).toBe('3')
    })
  })

  // ─── CSS class forwarding ──────────────────────────────────────────────────

  describe('class forwarding', () => {
    it('should apply extra classes to root element', () => {
      wrapper = mount(O2Input, {
        attrs: { class: 'my-custom-class' },
      })
      expect(wrapper.find('.my-custom-class').exists()).toBe(true)
    })
  })
})
