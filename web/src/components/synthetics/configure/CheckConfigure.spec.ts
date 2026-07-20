// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import { mockMonitorHttp } from '@/test/unit/mockData/synthetics'

// ── Mock vue-i18n ─────────────────────────────────────────────────────────
vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}))

import CheckConfigure from './CheckConfigure.vue'
import type { BrowserCheck } from '@/types/synthetics'

// ── Child Component Stubs ─────────────────────────────────────────────────
const CheckDetailsStub = {
  props: ['check', 'folders', 'validationErrors', 'targetLabel', 'targetPlaceholder'],
  emits: ['update:check'],
  template: '<div class="check-details-stub" :data-test="$attrs[\'data-test\']" :data-url="check.url"><slot /></div>',
}
const CheckAuthNetworkStub = {
  props: ['check'],
  emits: ['update:check'],
  template: '<div class="check-auth-network-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckScheduleStub = {
  props: ['check'],
  emits: ['update:check'],
  template: '<div class="check-schedule-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckAlertsStub = {
  props: ['check', 'destinations'],
  emits: ['update:check', 'refresh:destinations'],
  template: '<div class="check-alerts-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckLocationsStub = {
  props: ['check', 'locations'],
  emits: ['update:check'],
  template: '<div class="check-locations-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckBrowserDevicesStub = {
  props: ['check', 'browsers', 'devices'],
  emits: ['update:check'],
  template: '<div class="check-browser-devices-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckRUMStub = {
  props: ['check', 'checkType'],
  emits: ['update:check'],
  template: '<div class="check-rum-stub" :data-test="$attrs[\'data-test\']" />',
}
const CheckCaptureStub = {
  props: ['check'],
  emits: ['update:check'],
  template: '<div class="check-capture-stub" :data-test="$attrs[\'data-test\']" />',
}

const STUBS = {
  CheckDetails: CheckDetailsStub,
  CheckAuthNetwork: CheckAuthNetworkStub,
  CheckSchedule: CheckScheduleStub,
  CheckAlerts: CheckAlertsStub,
  CheckLocations: CheckLocationsStub,
  CheckBrowserDevices: CheckBrowserDevicesStub,
  CheckRUM: CheckRUMStub,
  CheckCapture: CheckCaptureStub,
}

function mountConfigure(props: Record<string, unknown> = {}) {
  return mount(CheckConfigure, {
    props: { check: { ...mockMonitorHttp }, ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('CheckConfigure', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  // ── Initial Render ───────────────────────────────────────────────────────
  describe('initial render', () => {
    beforeEach(() => {
      wrapper = mountConfigure()
    })

    it('should mount without errors', () => {
      expect(wrapper.exists()).toBe(true)
    })

    it('should render CheckDetails child component', () => {
      const details = wrapper.find('[data-test="synthetics-check-configure-details"]')
      expect(details.exists()).toBe(true)
    })

    it('should render CheckAuthNetwork for browser check type', () => {
      const authNetwork = wrapper.find('[data-test="synthetics-check-configure-auth-network"]')
      expect(authNetwork.exists()).toBe(true)
    })

    it('should render CheckSchedule child component', () => {
      const schedule = wrapper.find('[data-test="synthetics-check-configure-schedule"]')
      expect(schedule.exists()).toBe(true)
    })

    it('should render CheckAlerts child component', () => {
      const alerts = wrapper.find('[data-test="synthetics-check-configure-alerts"]')
      expect(alerts.exists()).toBe(true)
    })

    it('should render CheckLocations child component', () => {
      const locations = wrapper.find('[data-test="synthetics-check-configure-locations"]')
      expect(locations.exists()).toBe(true)
    })

    it('should render CheckBrowserDevices for browser check type', () => {
      const browserDevices = wrapper.find('[data-test="synthetics-check-configure-browser-devices"]')
      expect(browserDevices.exists()).toBe(true)
    })

    it('should render CheckCapture for browser check type', () => {
      const capture = wrapper.find('[data-test="synthetics-check-configure-capture"]')
      expect(capture.exists()).toBe(true)
    })
  })

  // ── Check Prop Passing ───────────────────────────────────────────────────
  describe('check prop passing', () => {
    it('should pass check prop to CheckDetails', () => {
      const check = { ...mockMonitorHttp, url: 'https://custom-test.com/health' }
      wrapper = mountConfigure({ check })

      const details = wrapper.find('[data-test="synthetics-check-configure-details"]')
      expect(details.attributes('data-url')).toBe('https://custom-test.com/health')
    })
  })

  // ── Emit Events ──────────────────────────────────────────────────────────
  describe('emit events', () => {
    it('should emit update:check when CheckDetails emits update:check', async () => {
      wrapper = mountConfigure()

      const details = wrapper.findComponent(CheckDetailsStub)
      await details.vm.$emit('update:check', { ...mockMonitorHttp, name: 'Updated' })
      await flushPromises()

      expect(wrapper.emitted('update:check')).toBeTruthy()
      expect(wrapper.emitted('update:check')?.[0][0]).toEqual({
        ...mockMonitorHttp,
        name: 'Updated',
      })
    })

    it('should emit refresh:destinations when CheckAlerts emits refresh:destinations', async () => {
      wrapper = mountConfigure()

      const alerts = wrapper.findComponent(CheckAlertsStub)
      await alerts.vm.$emit('refresh:destinations')
      await flushPromises()

      expect(wrapper.emitted('refresh:destinations')).toBeTruthy()
    })
  })

  // ── checkType Variations ─────────────────────────────────────────────────
  describe('checkType variations', () => {
    it('should hide CheckAuthNetwork for tcp check type', () => {
      wrapper = mountConfigure({ checkType: 'tcp', check: { ...mockMonitorHttp } })

      const authNetwork = wrapper.find('.check-auth-network-stub')
      expect(authNetwork.exists()).toBe(false)
    })

    it('should hide CheckAuthNetwork for tls check type', () => {
      wrapper = mountConfigure({ checkType: 'tls', check: { ...mockMonitorHttp } })

      const authNetwork = wrapper.find('.check-auth-network-stub')
      expect(authNetwork.exists()).toBe(false)
    })

    it('should hide CheckAuthNetwork for ssh check type', () => {
      wrapper = mountConfigure({ checkType: 'ssh', check: { ...mockMonitorHttp } })

      const authNetwork = wrapper.find('.check-auth-network-stub')
      expect(authNetwork.exists()).toBe(false)
    })

    it('should hide CheckBrowserDevices for http check type', () => {
      wrapper = mountConfigure({ checkType: 'http', check: { ...mockMonitorHttp } })

      const browserDevices = wrapper.find('.check-browser-devices-stub')
      expect(browserDevices.exists()).toBe(false)
    })

    it('should hide CheckCapture for http check type', () => {
      wrapper = mountConfigure({ checkType: 'http', check: { ...mockMonitorHttp } })

      const capture = wrapper.find('.check-capture-stub')
      expect(capture.exists()).toBe(false)
    })

    it('should show CheckAuthNetwork for api check type', () => {
      wrapper = mountConfigure({ checkType: 'api', check: { ...mockMonitorHttp } })

      const authNetwork = wrapper.find('[data-test="synthetics-check-configure-auth-network"]')
      expect(authNetwork.exists()).toBe(true)
    })
  })

  // ── Optional Props ───────────────────────────────────────────────────────
  describe('optional props', () => {
    it('should accept and pass folders prop to CheckDetails', () => {
      const folders = [
        { folderId: 'f1', name: 'Production', description: 'Prod folder' },
      ]
      wrapper = mountConfigure({ folders })

      const details = wrapper.findComponent(CheckDetailsStub)
      expect(details.props('folders')).toEqual(folders)
    })

    it('should accept and pass destinations to CheckAlerts', () => {
      const destinations = ['dest-1', 'dest-2']
      wrapper = mountConfigure({ destinations })

      const alerts = wrapper.findComponent(CheckAlertsStub)
      expect(alerts.props('destinations')).toEqual(destinations)
    })

    it('should accept and pass validationErrors to CheckDetails', () => {
      const validationErrors = { url: 'URL is required', name: 'Name is required' }
      wrapper = mountConfigure({ validationErrors })

      const details = wrapper.findComponent(CheckDetailsStub)
      expect(details.props('validationErrors')).toEqual(validationErrors)
    })
  })

  // ── Computed targetLabel ─────────────────────────────────────────────────
  describe('target label computed', () => {
    it('should pass host target label for tcp check type', () => {
      wrapper = mountConfigure({ checkType: 'tcp', check: { ...mockMonitorHttp } })

      const details = wrapper.findComponent(CheckDetailsStub)
      expect(details.props('targetLabel')).toBe('synthetics.checkDetails.hostTarget')
    })

    it('should pass URL target label for http check type', () => {
      wrapper = mountConfigure({ checkType: 'http', check: { ...mockMonitorHttp } })

      const details = wrapper.findComponent(CheckDetailsStub)
      expect(details.props('targetLabel')).toBe('synthetics.checkDetails.urlTarget')
    })

    it('should pass undefined targetLabel for browser check type', () => {
      wrapper = mountConfigure({ checkType: 'browser', check: { ...mockMonitorHttp } })

      const details = wrapper.findComponent(CheckDetailsStub)
      expect(details.props('targetLabel')).toBeUndefined()
    })
  })
})
