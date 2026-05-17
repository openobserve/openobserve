// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mount, VueWrapper, flushPromises } from '@vue/test-utils'
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin'

import OSplitter from './OSplitter.vue'

installQuasar()

describe('OSplitter', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    wrapper = mount(OSplitter, {
      props: { modelValue: 50 }
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  it('should render with default props', () => {
    expect(wrapper.exists()).toBe(true)
  })
})
