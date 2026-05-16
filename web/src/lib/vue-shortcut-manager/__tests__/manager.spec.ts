import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { ShortcutManager, getManager, resetManager } from '@/lib/vue-shortcut-manager/manager';
import { useShortcut, useShortcuts } from '@/lib/vue-shortcut-manager/composables';

describe('ShortcutManager', () => {
  let manager: ShortcutManager;

  beforeEach(() => {
    resetManager();
    manager = new ShortcutManager();
  });

  it('should register and find shortcuts', () => {
    manager.register({ key: 'ctrl+b', handler: () => {}, description: 'test' });
    const all = manager.getAll();
    expect(all.length).toBe(1);
    expect(all[0].key).toBe('ctrl+b');
  });

  it('should fire handler on matching keydown', () => {
    const handler = vi.fn();
    manager.register({ key: 'ctrl+b', handler, description: 'test' });

    manager.handleKeyDown({
      key: 'b', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should fire handler for escape', () => {
    const handler = vi.fn();
    manager.register({ key: 'escape', handler, description: 'test' });

    manager.handleKeyDown({
      key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should fire handler for meta+b', () => {
    const handler = vi.fn();
    manager.register({ key: 'meta+b', handler, description: 'test' });

    manager.handleKeyDown({
      key: 'b', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('useShortcut composable', () => {
  beforeEach(() => {
    resetManager();
  });

  it('should register shortcut on mount', async () => {
    const handler = vi.fn();
    
    const TestComponent = defineComponent({
      setup() {
        useShortcut('ctrl+b', handler, { description: 'test' });
        return () => h('div', 'test');
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    expect(mgr).toBeTruthy();
    const all = mgr!.getAll();
    expect(all.length).toBe(1);
    expect(all[0].key).toBe('ctrl+b');

    // Simulate keydown
    mgr!.handleKeyDown({
      key: 'b', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);

    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it('should unregister shortcut on unmount', async () => {
    const handler = vi.fn();
    
    const TestComponent = defineComponent({
      setup() {
        useShortcut('ctrl+b', handler, { description: 'test' });
        return () => h('div', 'test');
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    expect(mgr!.getAll().length).toBe(1);

    wrapper.unmount();
    expect(mgr!.getAll().length).toBe(0);
  });
});

describe('useShortcuts composable (multiple)', () => {
  beforeEach(() => {
    resetManager();
  });

  it('should register multiple shortcuts on mount', async () => {
    const escHandler = vi.fn();
    const ctrlBHandler = vi.fn();
    const metaBHandler = vi.fn();
    
    const TestComponent = defineComponent({
      setup() {
        useShortcuts([
          { key: 'escape', handler: escHandler, description: 'Close' },
          { key: 'ctrl+b', handler: ctrlBHandler, description: 'Toggle (ctrl)' },
          { key: 'meta+b', handler: metaBHandler, description: 'Toggle (meta)' },
        ]);
        return () => h('div', 'test');
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    const mgr = getManager();
    expect(mgr!.getAll().length).toBe(3);

    // Test each shortcut
    mgr!.handleKeyDown({
      key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);
    expect(escHandler).toHaveBeenCalledOnce();

    mgr!.handleKeyDown({
      key: 'b', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);
    expect(ctrlBHandler).toHaveBeenCalledOnce();

    mgr!.handleKeyDown({
      key: 'b', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true,
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as any);
    expect(metaBHandler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });

  it('should handle window keydown events via getManager singleton', async () => {
    const handler = vi.fn();
    
    const TestComponent = defineComponent({
      setup() {
        useShortcut('ctrl+b', handler, { description: 'test' });
        return () => h('div', 'test');
      },
    });

    const wrapper = mount(TestComponent);
    await nextTick();

    // Dispatch a real KeyboardEvent on window
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledOnce();

    wrapper.unmount();
  });
});
