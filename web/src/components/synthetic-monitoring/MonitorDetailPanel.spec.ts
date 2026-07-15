// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import MonitorDetailPanel from './MonitorDetailPanel.vue'

// ── Stubs ──────────────────────────────────────────────────────────────────
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']"><slot /></button>',
}
const OIconStub = {
  props: ['name', 'size'],
  template: '<i :data-icon="name" :data-size="size" />',
}
const OBadgeStub = {
  props: ['variant', 'size'],
  template: '<span class="badge-stub" :data-variant="variant"><slot /></span>',
}

// ODrawer stub that respects :open prop
const ODrawerStub = {
  props: ['open', 'width', 'showClose'],
  emits: ['update:open'],
  template: `
    <div v-if="open" class="odrawer-stub" :data-open="open">
      <div v-if="$slots.header" class="odrawer-header">
        <slot name="header" />
      </div>
      <div v-if="$slots.default" class="odrawer-body">
        <slot />
      </div>
    </div>
  `,
}

const OTabsStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<div class="otabs-stub"><slot /></div>',
}
const OTabStub = {
  props: ['name'],
  template: '<button class="otab-stub" :data-name="name"><slot /></button>',
}
// Always renders all panels for testability (tab switching is OTabs responsibility)
const OTabPanelsStub = {
  props: ['modelValue', 'scroll'],
  template: '<div class="otabpanels-stub"><slot /></div>',
}
const OTabPanelStub = {
  props: ['name'],
  template: '<div class="otabpanel-stub" :data-name="name"><slot /></div>',
}

const STUBS = {
  OButton: OButtonStub,
  OIcon: OIconStub,
  OBadge: OBadgeStub,
  ODrawer: ODrawerStub,
  OTabs: OTabsStub,
  OTab: OTabStub,
  OTabPanels: OTabPanelsStub,
  OTabPanel: OTabPanelStub,
}

// ── Monitor fixture ────────────────────────────────────────────────────────
function makeMonitor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mon-http-1',
    name: 'HTTP Health Check',
    url: 'https://example.com/health',
    type: 'HTTP',
    status: 'Up',
    interval: 'Every 5 min',
    lastCheck: '14:32 UTC',
    locations: ['us-east-1', 'eu-west-1'],
    uptime: 99.8,
    responseTime: '198ms',
    ...overrides,
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(MonitorDetailPanel, {
    props: { monitor: null, ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('MonitorDetailPanel', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  // ── Closed State ─────────────────────────────────────────────────────────
  describe('when monitor is null', () => {
    it('should not render the drawer', () => {
      wrapper = mountPanel({ monitor: null })

      const drawer = wrapper.find('.odrawer-stub')
      expect(drawer.exists()).toBe(false)
    })
  })

  // ── Open State ───────────────────────────────────────────────────────────
  describe('when monitor is provided', () => {
    beforeEach(() => {
      wrapper = mountPanel({ monitor: makeMonitor() })
    })

    it('should render the drawer', () => {
      const drawer = wrapper.find('.odrawer-stub')
      expect(drawer.exists()).toBe(true)
    })

    it('should display the monitor name in the header', () => {
      expect(wrapper.text()).toContain('HTTP Health Check')
    })

    it('should display the monitor URL in the header', () => {
      expect(wrapper.text()).toContain('https://example.com/health')
    })

    it('should display the monitor type badge', () => {
      const badge = wrapper.find('.badge-stub')
      expect(badge.exists()).toBe(true)
      expect(badge.text()).toBe('HTTP')
    })

    it('should display the monitor interval', () => {
      expect(wrapper.text()).toContain('Every 5 min')
    })

    it('should display location count', () => {
      expect(wrapper.text()).toContain('2 locations')
    })

    it('should render all four tabs', () => {
      const tabs = wrapper.findAll('.otab-stub')
      expect(tabs.length).toBe(4)
      expect(tabs[0].attributes('data-name')).toBe('overview')
      expect(tabs[1].attributes('data-name')).toBe('logs')
      expect(tabs[2].attributes('data-name')).toBe('metrics')
      expect(tabs[3].attributes('data-name')).toBe('traces')
    })

    it('should render the close button', () => {
      const closeBtn = wrapper.find('[data-test="monitor-detail-panel-close-btn"]')
      expect(closeBtn.exists()).toBe(true)
    })

    it('should render overview KPIs', () => {
      expect(wrapper.text()).toContain('Uptime 7d')
      expect(wrapper.text()).toContain('Avg Response')
      expect(wrapper.text()).toContain('Status')
    })

    it('should render monitored locations section', () => {
      expect(wrapper.text()).toContain('Monitored Locations')
    })

    it('should render monitor configuration table', () => {
      expect(wrapper.text()).toContain('Monitor Configuration')
    })
  })

  // ── Close Button ─────────────────────────────────────────────────────────
  describe('close button', () => {
    it('should emit close when close button is clicked', async () => {
      wrapper = mountPanel({ monitor: makeMonitor() })

      const closeBtn = wrapper.find('[data-test="monitor-detail-panel-close-btn"]')
      expect(closeBtn.exists()).toBe(true)

      await closeBtn.trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })

  // ── Log Filtering ────────────────────────────────────────────────────────
  describe('log filtering', () => {
    beforeEach(() => {
      wrapper = mountPanel({ monitor: makeMonitor() })
    })

    it('should render ALL filter button', () => {
      const allFilter = wrapper.find('[data-test="monitor-detail-panel-log-filter-all"]')
      expect(allFilter.exists()).toBe(true)
    })

    it('should render ERROR filter button', () => {
      const errorFilter = wrapper.find('[data-test="monitor-detail-panel-log-filter-error"]')
      expect(errorFilter.exists()).toBe(true)
    })

    it('should render WARN filter button', () => {
      const warnFilter = wrapper.find('[data-test="monitor-detail-panel-log-filter-warn"]')
      expect(warnFilter.exists()).toBe(true)
    })

    it('should render INFO filter button', () => {
      const infoFilter = wrapper.find('[data-test="monitor-detail-panel-log-filter-info"]')
      expect(infoFilter.exists()).toBe(true)
    })

    it('should render DEBUG filter button', () => {
      const debugFilter = wrapper.find('[data-test="monitor-detail-panel-log-filter-debug"]')
      expect(debugFilter.exists()).toBe(true)
    })
  })

  // ── Monitor Prop Change ──────────────────────────────────────────────────
  describe('monitor prop change', () => {
    it('should regenerate panel data when monitor changes', async () => {
      wrapper = mountPanel({ monitor: makeMonitor({ name: 'First Monitor' }) })

      expect(wrapper.text()).toContain('First Monitor')

      await wrapper.setProps({ monitor: makeMonitor({ name: 'Second Monitor', id: 'mon-2' }) })
      await flushPromises()

      expect(wrapper.text()).toContain('Second Monitor')
    })

    it('should close when monitor is set to null', async () => {
      wrapper = mountPanel({ monitor: makeMonitor() })

      expect(wrapper.find('.odrawer-stub').exists()).toBe(true)

      await wrapper.setProps({ monitor: null })
      await flushPromises()

      expect(wrapper.find('.odrawer-stub').exists()).toBe(false)
    })
  })

  // ── Status Variations ────────────────────────────────────────────────────
  describe('status variations', () => {
    it('should render with Up status monitor', () => {
      wrapper = mountPanel({ monitor: makeMonitor({ status: 'Up' }) })

      expect(wrapper.text()).toContain('Up')
    })

    it('should render with Down status monitor', () => {
      wrapper = mountPanel({ monitor: makeMonitor({ status: 'Down' }) })

      expect(wrapper.text()).toContain('Down')
    })

    it('should render with Degraded status monitor', () => {
      wrapper = mountPanel({ monitor: makeMonitor({ status: 'Degraded' }) })

      expect(wrapper.text()).toContain('Degraded')
    })

    it('should render mock logs for Up status', () => {
      wrapper = mountPanel({ monitor: makeMonitor({ status: 'Up' }) })

      // Check that logs are generated (INFO level for Up status)
      expect(wrapper.text()).toContain('Health check passed')
    })

    it('should render mock traces', () => {
      wrapper = mountPanel({ monitor: makeMonitor({ status: 'Up' }) })

      expect(wrapper.text()).toContain('spans')
    })
  })
})
