// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import PrivateLocations from './PrivateLocations.vue'
import type { PrivateLocation } from './PrivateLocations.vue'

// ── Stubs ──────────────────────────────────────────────────────────────────
const OCardStub = {
  template: '<div class="ocard-stub" :data-test="$attrs[\'data-test\']"><slot /></div>',
}
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')" :data-test="$attrs[\'data-test\']"><slot /></button>',
}
const OIconStub = {
  props: ['name', 'size'],
  template: '<i :data-icon="name" :data-size="size" />',
}
const OCodeBlockStub = {
  props: ['code', 'lang', 'chrome', 'filename'],
  template: '<pre class="codeblock-stub" :data-code="code"><code>{{ code }}</code></pre>',
}

const STUBS = {
  OCard: OCardStub,
  OButton: OButtonStub,
  OIcon: OIconStub,
  OCodeBlock: OCodeBlockStub,
}

function makeLocation(overrides: Partial<PrivateLocation> = {}): PrivateLocation {
  return {
    id: 1,
    name: 'US East Agent',
    region: 'us-east-1',
    status: 'Online',
    monitors: 5,
    workers: 3,
    checks: 120,
    version: '1.2.3',
    lastSeen: '2 minutes ago',
    ...overrides,
  }
}

function mountLocations(props: Record<string, unknown> = {}) {
  return mount(PrivateLocations, {
    props: { locations: [], ...props },
    global: { stubs: STUBS },
  }) as VueWrapper
}

describe('PrivateLocations', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  // ── Initial Render ───────────────────────────────────────────────────────
  describe('initial render', () => {
    it('should mount without errors with empty locations', () => {
      wrapper = mountLocations({ locations: [] })
      expect(wrapper.exists()).toBe(true)
    })

    it('should render the add location card', () => {
      wrapper = mountLocations({ locations: [] })

      const addCard = wrapper.find('[data-test="private-locations-add-card"]')
      expect(addCard.exists()).toBe(true)
      expect(addCard.text()).toContain('Add private location')
    })

    it('should render the get started button in the add card', () => {
      wrapper = mountLocations({ locations: [] })

      const getStartedBtn = wrapper.find('[data-test="private-locations-get-started-btn"]')
      expect(getStartedBtn.exists()).toBe(true)
      expect(getStartedBtn.text()).toBe('Get started')
    })

    it('should render the setup guide section', () => {
      wrapper = mountLocations({ locations: [] })

      expect(wrapper.text()).toContain('Setting up a private location agent')
      expect(wrapper.text()).toContain('Deploy the agent')
      expect(wrapper.text()).toContain('Register the location')
      expect(wrapper.text()).toContain('Assign to monitors')
    })

    it('should render the docker install command code block', () => {
      wrapper = mountLocations({ locations: [] })

      const codeBlock = wrapper.find('.codeblock-stub')
      expect(codeBlock.exists()).toBe(true)
      expect(codeBlock.attributes('data-code')).toContain('docker run -d')
      expect(codeBlock.attributes('data-code')).toContain('openobserve/syn-agent:latest')
    })
  })

  // ── Location Cards ───────────────────────────────────────────────────────
  describe('location cards', () => {
    it('should render location cards for each location', () => {
      const locations = [
        makeLocation({ id: 1, name: 'Agent A' }),
        makeLocation({ id: 2, name: 'Agent B' }),
      ]
      wrapper = mountLocations({ locations })

      const cards = wrapper.findAll('.ocard-stub')
      // Should have 2 location cards + 1 add card = 3
      expect(cards.length).toBe(3)
      expect(wrapper.text()).toContain('Agent A')
      expect(wrapper.text()).toContain('Agent B')
    })

    it('should render location region with location icon', () => {
      wrapper = mountLocations({ locations: [makeLocation({ region: 'us-east-1' })] })

      const regionIcon = wrapper.find('[data-icon="location-on"]')
      expect(regionIcon.exists()).toBe(true)
      expect(wrapper.text()).toContain('us-east-1')
    })

    it('should render online status chip correctly', () => {
      wrapper = mountLocations({ locations: [makeLocation({ status: 'Online' })] })

      expect(wrapper.text()).toContain('Online')
    })

    it('should render offline status chip correctly', () => {
      wrapper = mountLocations({ locations: [makeLocation({ status: 'Offline' })] })

      expect(wrapper.text()).toContain('Offline')
    })

    it('should render version badge', () => {
      wrapper = mountLocations({ locations: [makeLocation({ version: '2.0.1' })] })

      expect(wrapper.text()).toContain('v2.0.1')
    })

    it('should render stats for monitors, workers, and checks', () => {
      wrapper = mountLocations({ locations: [makeLocation({ monitors: 8, workers: 4, checks: 250 })] })

      expect(wrapper.text()).toContain('8')
      expect(wrapper.text()).toContain('4')
      expect(wrapper.text()).toContain('250')
      expect(wrapper.text()).toContain('Monitors')
      expect(wrapper.text()).toContain('Workers')
      expect(wrapper.text()).toContain('Checks/min')
    })

    it('should render last seen info with schedule icon', () => {
      wrapper = mountLocations({ locations: [makeLocation({ lastSeen: '5 minutes ago' })] })

      expect(wrapper.text()).toContain('5 minutes ago')
      const scheduleIcon = wrapper.find('[data-icon="schedule"]')
      expect(scheduleIcon.exists()).toBe(true)
    })

    it('should render edit button per location card', () => {
      wrapper = mountLocations({ locations: [makeLocation()] })

      const editBtn = wrapper.find('[data-test="private-locations-edit-btn"]')
      expect(editBtn.exists()).toBe(true)
    })

    it('should render remove button per location card', () => {
      wrapper = mountLocations({ locations: [makeLocation()] })

      const removeBtn = wrapper.find('[data-test="private-locations-remove-btn"]')
      expect(removeBtn.exists()).toBe(true)
    })
  })
})
