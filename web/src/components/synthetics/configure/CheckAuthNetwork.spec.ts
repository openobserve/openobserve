// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({ t: (key: string) => key })),
}))

vi.mock('@/utils/uuid', () => ({ getUUID: vi.fn(() => 'uuid-123') }))

import CheckAuthNetwork from './CheckAuthNetwork.vue'
import { mockMonitorHttp } from '@/test/unit/mockData/synthetics'

// ── Stubs ───────────────────────────────────────────────────────────────────

const OSwitchStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `<div :data-test="$attrs['data-test']">
    <input type="checkbox" :checked="modelValue" @click="$emit('update:modelValue', !modelValue)" />
    <span>{{ $attrs.label }}</span>
  </div>`,
}

const OInputStub = {
  props: ['modelValue', 'type'],
  emits: ['update:modelValue'],
  template: `<input v-bind="$attrs" :value="modelValue" :type="type || 'text'" @input="$emit('update:modelValue', $event.target.value)" />`,
}

const OButtonStub = {
  props: ['iconLeft', 'iconOnly', 'variant', 'size', 'ariaLabel'],
  emits: ['click'],
  template: `<button v-bind="$attrs" @click="$emit('click')" :aria-label="ariaLabel"><slot /></button>`,
}

const OBadgeStub = {
  props: ['variant', 'size'],
  template: '<span v-bind="$attrs"><slot /></span>',
}

const OIconStub = {
  props: ['name', 'size'],
  template: '<i v-bind="$attrs" />',
}

const OSeparatorStub = {
  template: '<hr />',
}

const OTooltipStub = {
  props: ['content', 'side'],
  template: '<span />',
}

const STUBS = {
  OInput: OInputStub,
  OSwitch: OSwitchStub,
  OButton: OButtonStub,
  OBadge: OBadgeStub,
  OIcon: OIconStub,
  OSeparator: OSeparatorStub,
  OTooltip: OTooltipStub,
}

// ── Mount factory ────────────────────────────────────────────────────────────

function mountCheckAuthNetwork(props: Record<string, unknown> = {}) {
  return mount(CheckAuthNetwork, {
    props: { check: mockMonitorHttp, ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('CheckAuthNetwork', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  describe('initial render', () => {
    beforeEach(() => {
      wrapper = mountCheckAuthNetwork()
    })

    it('should render the component', () => {
      expect(wrapper.exists()).toBe(true)
    })

    it('should render the section title', () => {
      expect(wrapper.text()).toContain('synthetics.authNetwork.title')
    })

    it('should render the optional badge', () => {
      expect(wrapper.text()).toContain('synthetics.authNetwork.optional')
    })

    it('should render the basic auth switch', () => {
      const authSwitch = wrapper.find('[data-test="synthetics-check-auth-network-basic-auth-switch"]')
      expect(authSwitch.exists()).toBe(true)
    })

    it('should not render username/password inputs when auth is disabled', () => {
      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(false)
    })

    it('should render the variables section with add button', () => {
      expect(wrapper.text()).toContain('synthetics.authNetwork.variables')
      expect(wrapper.find('[data-test="synthetics-check-auth-network-add-variable-btn"]').exists()).toBe(true)
    })
  })

  describe('auth toggle', () => {
    it('should show username and password inputs when auth is enabled', async () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined }
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(false)

      const authSwitch = wrapper.find('[data-test="synthetics-check-auth-network-basic-auth-switch"]')
      const checkbox = authSwitch.find('input')
      await checkbox.trigger('click')
      await flushPromises()

      // The component emits update:check; simulate parent updating the prop
      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const updatedCheck = emitted![emitted!.length - 1][0] as any
      await wrapper.setProps({ check: updatedCheck })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(true)
    })

    it('should hide username and password inputs when auth is disabled', async () => {
      const checkWithAuth = { ...mockMonitorHttp, auth: { type: 'basic' as const, username: 'admin', password: 'secret' } }
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(true)

      const authSwitch = wrapper.find('[data-test="synthetics-check-auth-network-basic-auth-switch"]')
      const checkbox = authSwitch.find('input')
      await checkbox.trigger('click')
      await flushPromises()

      // The component emits update:check; simulate parent updating the prop
      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const updatedCheck = emitted![emitted!.length - 1][0] as any
      await wrapper.setProps({ check: updatedCheck })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(false)
    })

    it('should emit update:check with basic auth when toggled on', async () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined }
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth })

      const authSwitch = wrapper.find('[data-test="synthetics-check-auth-network-basic-auth-switch"]')
      const checkbox = authSwitch.find('input')
      await checkbox.trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.auth).toBeDefined()
      expect(last.auth.type).toBe('basic')
      expect(last.auth.username).toBe('')
      expect(last.auth.password).toBe('')
    })

    it('should emit update:check with auth set to undefined when toggled off', async () => {
      const checkWithAuth = { ...mockMonitorHttp, auth: { type: 'basic' as const, username: 'admin', password: 'secret' } }
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth })

      const authSwitch = wrapper.find('[data-test="synthetics-check-auth-network-basic-auth-switch"]')
      const checkbox = authSwitch.find('input')
      await checkbox.trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.auth).toBeUndefined()
    })

    it('should emit update:check with updated username', async () => {
      const checkWithAuth = { ...mockMonitorHttp, auth: { type: 'basic' as const, username: 'admin', password: 'secret' } }
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth })

      const usernameInput = wrapper.find('[data-test="synthetics-check-auth-network-username-input"]')
      await usernameInput.setValue('newuser')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.auth.username).toBe('newuser')
    })

    it('should emit update:check with updated password', async () => {
      const checkWithAuth = { ...mockMonitorHttp, auth: { type: 'basic' as const, username: 'admin', password: 'secret' } }
      wrapper = mountCheckAuthNetwork({ check: checkWithAuth })

      const passwordInput = wrapper.find('[data-test="synthetics-check-auth-network-password-input"]')
      await passwordInput.setValue('newpass')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.auth.password).toBe('newpass')
    })
  })

  describe('variables CRUD', () => {
    it('should add a variable when add button is clicked', async () => {
      wrapper = mountCheckAuthNetwork()

      expect(wrapper.find('[data-test="synthetics-check-auth-network-variable-name-0-input"]').exists()).toBe(false)

      await wrapper.find('[data-test="synthetics-check-auth-network-add-variable-btn"]').trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.variables).toHaveLength(1)
      expect(last.variables[0].id).toBe('uuid-123')
      expect(last.variables[0].name).toBe('')
    })

    it('should remove a variable when remove button is clicked', async () => {
      const checkWithVars = {
        ...mockMonitorHttp,
        variables: [{ id: 'var-1', name: 'API_KEY', value: 'abc123', secure: true, example: '' }],
      }
      wrapper = mountCheckAuthNetwork({ check: checkWithVars })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-variable-name-0-input"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-remove-variable-0-btn"]').exists()).toBe(true)

      await wrapper.find('[data-test="synthetics-check-auth-network-remove-variable-0-btn"]').trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.variables).toHaveLength(0)
    })

    it('should update variable name via input', async () => {
      const checkWithVars = {
        ...mockMonitorHttp,
        variables: [{ id: 'var-1', name: '', value: '', secure: false, example: '' }],
      }
      wrapper = mountCheckAuthNetwork({ check: checkWithVars })

      const nameInput = wrapper.find('[data-test="synthetics-check-auth-network-variable-name-0-input"]')
      await nameInput.setValue('MY_VAR')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.variables[0].name).toBe('MY_VAR')
    })

    it('should update variable value via input', async () => {
      const checkWithVars = {
        ...mockMonitorHttp,
        variables: [{ id: 'var-1', name: '', value: '', secure: false, example: '' }],
      }
      wrapper = mountCheckAuthNetwork({ check: checkWithVars })

      const valueInput = wrapper.find('[data-test="synthetics-check-auth-network-variable-value-0-input"]')
      await valueInput.setValue('secret-value')
      await flushPromises()

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const last = emitted![emitted!.length - 1][0] as any
      expect(last.variables[0].value).toBe('secret-value')
    })

    it('should display summary text with variable count', async () => {
      const checkWithVars = {
        ...mockMonitorHttp,
        variables: [{ id: 'var-1', name: 'V1', value: 'a', secure: false, example: '' }],
      }
      wrapper = mountCheckAuthNetwork({ check: checkWithVars })

      expect(wrapper.text()).toContain('1 variable')
    })

    it('should display summary text with plural variables', async () => {
      const checkWithVars = {
        ...mockMonitorHttp,
        variables: [
          { id: 'var-1', name: 'V1', value: 'a', secure: false, example: '' },
          { id: 'var-2', name: 'V2', value: 'b', secure: false, example: '' },
        ],
      }
      wrapper = mountCheckAuthNetwork({ check: checkWithVars })

      expect(wrapper.text()).toContain('2 variables')
    })
  })

  describe('no auth state', () => {
    it('should not show username or password when check has no auth', () => {
      const checkNoAuth = { ...mockMonitorHttp, auth: undefined }
      wrapper = mountCheckAuthNetwork({ check: checkNoAuth })

      expect(wrapper.find('[data-test="synthetics-check-auth-network-username-input"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="synthetics-check-auth-network-password-input"]').exists()).toBe(false)
    })

    it('should render with empty summary when no variables or headers', () => {
      wrapper = mountCheckAuthNetwork()

      // The summary span is rendered with v-if="summary" — when summary is empty (''),
      // the span itself is not rendered. The word "variable" appears from the i18n
      // section heading key, which is separate from the summary span.
      // Verify the summary does NOT contain the pattern "N variable(s)".
      expect(wrapper.text()).not.toMatch(/\d+ variable/)
      expect(wrapper.text()).not.toMatch(/\d+ header/)
    })
  })
})
