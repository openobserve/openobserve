// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import { mockMonitorBrowser, mockCapabilities } from '@/test/unit/mockData/synthetics'

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

import CheckBrowserDevices from './CheckBrowserDevices.vue'

const OIconStub = {
  props: ['name', 'size'],
  template: '<i :data-test="$attrs[\'data-test\']" />',
}

const OCheckboxStub = {
  props: ['modelValue', 'size'],
  emits: ['update:modelValue'],
  methods: {
    handleChange(e: Event) {
      this.$emit('update:modelValue', (e.target as HTMLInputElement).checked)
    },
  },
  template: `<input type="checkbox" :data-test="$attrs['data-test']" :checked="modelValue" @change="handleChange" />`,
}

// Helper: find checkbox by data-test and get its checked state
function checkboxChecked(w: VueWrapper, selector: string): boolean {
  const el = w.find<HTMLInputElement>(selector)
  return el.element.checked
}

describe('CheckBrowserDevices', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  function mountDevices(props: {
    check?: typeof mockMonitorBrowser
    browsers?: string[]
    devices?: { id: string; label: string; width: number; height: number }[]
  } = {}) {
    const { check = mockMonitorBrowser, browsers, devices } = props
    return mount(CheckBrowserDevices, {
      props: {
        check,
        ...(browsers !== undefined ? { browsers } : {}),
        ...(devices !== undefined ? { devices } : {}),
      },
      global: {
        stubs: {
          OIcon: OIconStub,
          OCheckbox: OCheckboxStub,
        },
      },
    })
  }

  describe('initial render', () => {
    beforeEach(() => {
      wrapper = mountDevices({
        browsers: mockCapabilities.browsers,
        devices: mockCapabilities.devices,
      })
    })

    it('should render the component', () => {
      expect(wrapper.exists()).toBe(true)
    })

    it('should render the title', () => {
      expect(wrapper.text()).toContain('synthetics.browserDevices.title')
    })

    it('should render device column headers from provided devices', () => {
      // mockCapabilities.devices has labels: "Laptop Large", "Laptop Small", "Tablet", "Mobile"
      // The i18n mock returns the key as-is, so deviceLabelKey returns:
      //   "Tablet" -> synthesized i18n key, "Mobile" -> synthesized i18n key
      //   "Laptop Large" -> "Laptop Large" (no mapping)
      //   "Laptop Small" -> "Laptop Small" (no mapping)
      expect(wrapper.text()).toContain('synthetics.browserDevices.tablet')
      expect(wrapper.text()).toContain('synthetics.browserDevices.mobile')
      expect(wrapper.text()).toContain('Laptop Large')
      expect(wrapper.text()).toContain('Laptop Small')
    })

    it('should render browser row labels', () => {
      // mockCapabilities.browsers = ['chromium', 'firefox', 'webkit']
      expect(wrapper.text()).toContain('Chromium')
      expect(wrapper.text()).toContain('Firefox')
      expect(wrapper.text()).toContain('Webkit')
    })

    it('should render checkboxes for each browser-device combination', () => {
      // data-test is on the <input> directly (stub puts it there)
      const cell = wrapper.find('[data-test="synthetics-check-browser-devices-cell-chromium-laptop_large"]')
      expect(cell.exists()).toBe(true)
      expect(cell.element.tagName).toBe('INPUT')

      expect(wrapper.find('[data-test="synthetics-check-browser-devices-cell-firefox-laptop_large"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="synthetics-check-browser-devices-cell-webkit-laptop_large"]').exists()).toBe(true)
    })
  })

  describe('with default browsers and devices (no props)', () => {
    it('should use internal defaults when browsers prop is not provided', () => {
      wrapper = mountDevices({ browsers: undefined, devices: undefined })
      expect(wrapper.text()).toContain('Chromium')
      expect(wrapper.text()).toContain('Firefox')
    })

    it('should use internal default devices when devices prop is not provided', () => {
      wrapper = mountDevices({ browsers: undefined, devices: undefined })
      // DEFAULT_DEVICES: Desktop, Tablet, Mobile — all map to i18n keys
      expect(wrapper.text()).toContain('synthetics.browserDevices.desktop')
      expect(wrapper.text()).toContain('synthetics.browserDevices.tablet')
      expect(wrapper.text()).toContain('synthetics.browserDevices.mobile')
    })

    it('should render default checkboxes for chromium+desktop when check.browserDevices uses laptop_large', () => {
      // mockMonitorBrowser.browserDevices has laptop_large, but defaults use 'desktop'
      // The checkbox for chromium+desktop should exist (default devices are used)
      wrapper = mountDevices({ browsers: undefined, devices: undefined })
      const cell = wrapper.find('[data-test="synthetics-check-browser-devices-cell-chromium-desktop"]')
      expect(cell.exists()).toBe(true)

      // chromium+desktop should NOT be checked since browserDevices has laptop_large, not desktop
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-chromium-desktop"]')).toBe(false)

      // The laptop_large device doesn't exist in defaults, so no checkbox for it
      expect(wrapper.find('[data-test="synthetics-check-browser-devices-cell-chromium-laptop_large"]').exists()).toBe(false)
    })
  })

  describe('checkbox state reflects selected browser devices', () => {
    beforeEach(() => {
      wrapper = mountDevices({
        browsers: mockCapabilities.browsers,
        devices: mockCapabilities.devices,
      })
    })

    it('should check checkboxes for devices in browserDevices', () => {
      // mockMonitorBrowser.browserDevices includes chromium+laptop_large and firefox+laptop_large
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-chromium-laptop_large"]')).toBe(true)
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-firefox-laptop_large"]')).toBe(true)
    })

    it('should leave unchecked devices that are not in browserDevices', () => {
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-webkit-laptop_large"]')).toBe(false)
    })
  })

  describe('toggle emit behavior', () => {
    beforeEach(() => {
      wrapper = mountDevices({
        browsers: mockCapabilities.browsers,
        devices: mockCapabilities.devices,
      })
    })

    it('should emit update:check when a new device is checked', async () => {
      // webkit + laptop_large is currently unchecked
      const cell = wrapper.find<HTMLInputElement>('[data-test="synthetics-check-browser-devices-cell-webkit-laptop_large"]')
      expect(cell.element.checked).toBe(false)

      await cell.setValue(true)

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const updatedBrowserDevices = emitted![0][0].browserDevices
      expect(updatedBrowserDevices).toHaveLength(3)
      expect(updatedBrowserDevices).toContainEqual({ browser: 'webkit', device: 'laptop_large' })
    })

    it('should emit update:check when a checked device is unchecked', async () => {
      const cell = wrapper.find<HTMLInputElement>('[data-test="synthetics-check-browser-devices-cell-chromium-laptop_large"]')
      expect(cell.element.checked).toBe(true)

      await cell.setValue(false)

      const emitted = wrapper.emitted('update:check')
      expect(emitted).toBeTruthy()
      const updatedBrowserDevices = emitted![0][0].browserDevices
      expect(updatedBrowserDevices).not.toContainEqual({ browser: 'chromium', device: 'laptop_large' })
      // firefox+laptop_large should remain
      expect(updatedBrowserDevices).toContainEqual({ browser: 'firefox', device: 'laptop_large' })
    })

    it('should prevent unchecking the last remaining device', async () => {
      // Start with only one device selected
      const check = {
        ...mockMonitorBrowser,
        browserDevices: [{ browser: 'chromium', device: 'laptop_large' }],
      }
      wrapper = mountDevices({ check, browsers: mockCapabilities.browsers, devices: mockCapabilities.devices })

      const cell = wrapper.find<HTMLInputElement>('[data-test="synthetics-check-browser-devices-cell-chromium-laptop_large"]')
      expect(cell.element.checked).toBe(true)

      await cell.setValue(false)

      // No emit should happen when trying to uncheck the last device
      expect(wrapper.emitted('update:check')).toBeFalsy()
    })
  })

  describe('empty browserDevices in check', () => {
    it('should leave all checkboxes unchecked when browserDevices is empty array', () => {
      const check = { ...mockMonitorBrowser, browserDevices: [] }
      wrapper = mountDevices({ check, browsers: undefined, devices: undefined })
      // Empty array is not null/undefined, so ?? does not apply defaults — nothing is selected
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-chromium-desktop"]')).toBe(false)
    })


    it('should use default selection when browserDevices is undefined', () => {
      const check = { ...mockMonitorBrowser, browserDevices: undefined }
      wrapper = mountDevices({ check, browsers: undefined, devices: undefined })
      // undefined triggers ?? default [{ browser: 'chromium', device: 'desktop' }]
      expect(checkboxChecked(wrapper, '[data-test="synthetics-check-browser-devices-cell-chromium-desktop"]')).toBe(true)
    })
  })
})
