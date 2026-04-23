import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import OMenu from './Menu.vue'

// Teleport renders to body; stub it so content stays in wrapper
const globalConfig = {
  global: {
    stubs: { Teleport: true },
  },
}

describe('OMenu', () => {
  beforeEach(() => {
    vi.spyOn(window, 'addEventListener')
    vi.spyOn(window, 'removeEventListener')
    vi.spyOn(document, 'addEventListener')
    vi.spyOn(document, 'removeEventListener')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders default slot', () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      slots: { default: '<button>Trigger</button>' },
    })
    expect(wrapper.text()).toContain('Trigger')
  })

  it('is closed by default', () => {
    const wrapper = mount(OMenu, globalConfig)
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('opens when modelValue is true', async () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      props: { modelValue: true },
    })
    await nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  })

  it('emits update:modelValue false when close() is called', async () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      props: { modelValue: true },
    })
    await nextTick()
    ;(wrapper.vm as InstanceType<typeof OMenu>).close()
    await nextTick()
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![emitted!.length - 1]).toEqual([false])
  })

  it('emits update:modelValue true when open() is called', async () => {
    const wrapper = mount(OMenu, globalConfig)
    const fakeEl = document.createElement('button')
    ;(wrapper.vm as InstanceType<typeof OMenu>).open(fakeEl)
    await nextTick()
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([true])
  })

  it('closes on Escape keydown', async () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      props: { modelValue: true },
    })
    await nextTick()
    const panel = wrapper.find('[role="menu"]')
    await panel.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    const all = wrapper.emitted('update:modelValue')!
    expect(all[all.length - 1]).toEqual([false])
  })

  it('has role="menu" on the panel', async () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      props: { modelValue: true },
    })
    await nextTick()
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  })

  it('attaches/detaches event listeners when open state changes', async () => {
    const wrapper = mount(OMenu, globalConfig)
    const fakeEl = document.createElement('button')
    ;(wrapper.vm as InstanceType<typeof OMenu>).open(fakeEl)
    await nextTick()
    expect(document.addEventListener).toHaveBeenCalledWith('click', expect.any(Function), { capture: true })
    ;(wrapper.vm as InstanceType<typeof OMenu>).close()
    await nextTick()
    expect(document.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function), { capture: true })
  })

  it('renders content slot inside panel', async () => {
    const wrapper = mount(OMenu, {
      ...globalConfig,
      props: { modelValue: true },
      slots: { content: '<li>Item one</li>' },
    })
    await nextTick()
    expect(wrapper.find('[role="menu"]').text()).toContain('Item one')
  })

  it('exposes toggle, open, close', () => {
    const wrapper = mount(OMenu, globalConfig)
    const vm = wrapper.vm as InstanceType<typeof OMenu>
    expect(typeof vm.toggle).toBe('function')
    expect(typeof vm.open).toBe('function')
    expect(typeof vm.close).toBe('function')
  })

  describe('show/hide emits', () => {
    it('emits show when opened', async () => {
      const wrapper = mount(OMenu, globalConfig)
      const fakeEl = document.createElement('button')
      ;(wrapper.vm as InstanceType<typeof OMenu>).open(fakeEl)
      await nextTick()
      expect(wrapper.emitted('show')).toHaveLength(1)
    })

    it('emits hide when closed', async () => {
      const wrapper = mount(OMenu, {
        ...globalConfig,
        props: { modelValue: true },
      })
      await nextTick()
      ;(wrapper.vm as InstanceType<typeof OMenu>).close()
      await nextTick()
      expect(wrapper.emitted('hide')).toHaveLength(1)
    })
  })

  describe('submenu mode', () => {
    it('does not attach click-outside listener in submenu mode', async () => {
      const wrapper = mount(OMenu, {
        ...globalConfig,
        props: { submenu: true },
      })
      const fakeEl = document.createElement('div')
      ;(wrapper.vm as InstanceType<typeof OMenu>).open(fakeEl)
      await nextTick()
      expect(document.addEventListener).not.toHaveBeenCalledWith(
        'click', expect.any(Function), { capture: true }
      )
    })

    it('exposes onMouseenter/onMouseleave in default slot scope', () => {
      let slotProps: Record<string, unknown> = {}
      mount(OMenu, {
        ...globalConfig,
        props: { submenu: true },
        slots: {
          default: (props: Record<string, unknown>) => {
            slotProps = props
            return []
          },
        },
      })
      expect(typeof slotProps.onMouseenter).toBe('function')
      expect(typeof slotProps.onMouseleave).toBe('function')
    })
  })

  describe('MenuPosition start/end aliases', () => {
    it('accepts "top end" as anchor without throwing', () => {
      expect(() =>
        mount(OMenu, {
          ...globalConfig,
          props: { anchor: 'top end', self: 'top start', modelValue: false },
        })
      ).not.toThrow()
    })
  })
})
