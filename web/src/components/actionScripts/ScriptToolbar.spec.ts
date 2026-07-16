// Copyright 2026 OpenObserve Inc.
//
// Behavior-focused spec for ScriptToolbar.vue after the OForm + Zod migration.
// The old spec asserted removed internals (isValidMethodName / showInputError /
// scriptNameError / onUpdate / addScriptForm). Those are gone — validation now
// lives in ScriptToolbar.schema.ts and is enforced by a REAL <OForm>, so the
// tests below mount the real form and assert behavior:
//   • required + method-name regex gate `save` (schema, not a manual ref),
//   • `update:name` still mirrors the form-owned value back to the parent,
//   • the data-test selectors + back/cancel/fullscreen wiring are preserved.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import ScriptToolbar from '@/components/actionScripts/ScriptToolbar.vue';

// Mock vue-i18n — labels/buttons just echo their key.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// ScriptToolbar calls toggleFullscreen() from @/utils/dom directly — mock at the
// module boundary.
const mockToggleFullscreen = vi.fn();
vi.mock('@/utils/dom', () => ({
  toggleFullscreen: () => mockToggleFullscreen(),
}));

describe('ScriptToolbar.vue', () => {
  let wrapper: VueWrapper;

  const createWrapper = (props = {}) => {
    const defaultProps = { name: 'test_action', disableName: false };

    return mount(ScriptToolbar, {
      props: { ...defaultProps, ...props },
      global: {
        // Real <OForm>/<OFormInput>/<OInput>/<OButton> are mounted (NOT stubbed)
        // so the schema wiring is actually exercised.
        stubs: {
          OIcon: {
            template: '<i class="OIcon-stub" :data-name="name"></i>',
            props: ['name', 'size'],
          },
        },
        directives: {
          // `v-close-popup` is a directive not registered in the unit env.
          'close-popup': {},
        },
      },
    });
  };

  // Drive the form's own submit so the schema runs + the handler is awaited
  // deterministically (a fire-and-forget native submit would not be).
  const submit = async (w: VueWrapper) => {
    await (w.vm as any).form.handleSubmit();
    await flushPromises();
  };

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the toolbar shell + title', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('Add Action');
      const toolbar = wrapper.find('[data-test="add-script-toolbar"]');
      expect(toolbar.exists()).toBe(true);
      expect(toolbar.classes()).toContain('flex');
      expect(toolbar.classes()).toContain('justify-between');
    });

    it('preserves every data-test selector', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-script-back-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-script-name-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-script-fullscreen-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-script-save-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-script-cancel-btn"]').exists()).toBe(true);
    });

    it('seeds the name input from the `name` prop', () => {
      wrapper = createWrapper({ name: 'seeded_name' });
      const input = wrapper.find('[data-test="add-script-name-input"] input');
      expect((input.element as HTMLInputElement).value).toBe('seeded_name');
    });

    it('renders the save button as a submit button', () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-script-save-btn"]');
      expect(saveBtn.attributes('type')).toBe('submit');
    });
  });

  describe('Props', () => {
    it('accepts the required name prop', () => {
      wrapper = createWrapper({ name: 'custom_action' });
      expect(wrapper.props('name')).toBe('custom_action');
    });

    it('defaults disableName to false', () => {
      wrapper = createWrapper();
      expect(wrapper.props('disableName')).toBe(false);
    });

    it('disables + makes the input readonly when disableName is true', () => {
      wrapper = createWrapper({ disableName: true });
      const input = wrapper.find('[data-test="add-script-name-input"] input');
      expect(input.attributes('disabled')).toBeDefined();
      expect(input.attributes('readonly')).toBeDefined();
    });
  });

  describe('Schema validation (real OForm)', () => {
    it('blocks save when the name is empty', async () => {
      wrapper = createWrapper({ name: '' });

      await submit(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('blocks save when the name violates the method-name regex', async () => {
      // Starts with a digit → invalid method name.
      wrapper = createWrapper({ name: '123-bad' });

      await submit(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(false);
      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('emits save when the name is valid', async () => {
      wrapper = createWrapper({ name: 'valid_action' });

      await submit(wrapper);

      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(wrapper.emitted('save')).toBeTruthy();
    });

    it.each([
      'valid_action',
      'ValidAction',
      'action123',
      '_private_action',
      'ACTION_NAME',
    ])('accepts the valid method name %s', async (name) => {
      wrapper = createWrapper({ name });
      await submit(wrapper);
      expect((wrapper.vm as any).form.state.isValid).toBe(true);
    });

    it.each(['123invalid', 'invalid-name', 'invalid name', 'invalid.name', '@invalid'])(
      'rejects the invalid method name %s',
      async (name) => {
        wrapper = createWrapper({ name });
        await submit(wrapper);
        expect((wrapper.vm as any).form.state.isValid).toBe(false);
        expect(wrapper.emitted('save')).toBeFalsy();
      },
    );

    it('does not validate before the first submit (R3)', () => {
      wrapper = createWrapper({ name: '' });
      // No error text rendered until the form is submitted.
      expect(wrapper.find('[data-test="add-script-name-input-error"]').exists()).toBe(false);
    });
  });

  describe('update:name bridge (parent owns the value)', () => {
    it('emits update:name when the form-owned value changes', async () => {
      wrapper = createWrapper({ name: 'old_name' });
      await flushPromises();

      (wrapper.vm as any).form.setFieldValue('name', 'new_name');
      await flushPromises();

      const events = wrapper.emitted('update:name');
      expect(events).toBeTruthy();
      expect(events?.[events.length - 1]).toEqual(['new_name']);
    });

    it('trims surrounding whitespace (parity with the old v-model.trim)', async () => {
      wrapper = createWrapper({ name: '' });
      await flushPromises();

      (wrapper.vm as any).form.setFieldValue('name', '  valid_action  ');
      await flushPromises();

      // Parent (value owner) receives the TRIMMED name, as before the migration.
      const events = wrapper.emitted('update:name') as any[];
      expect(events[events.length - 1]).toEqual(['valid_action']);

      // A whitespace-padded valid name still passes (schema .trim() → was rejected
      // by the method-name regex before the fix).
      await submit(wrapper);
      expect((wrapper.vm as any).form.state.isValid).toBe(true);
      expect(wrapper.emitted('save')).toBeTruthy();
    });
  });

  describe('Event wiring', () => {
    it('emits back when the back button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="add-script-back-btn"]').trigger('click');
      expect(wrapper.emitted('back')).toBeTruthy();
    });

    it('emits cancel when the cancel button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="add-script-cancel-btn"]').trigger('click');
      expect(wrapper.emitted('cancel')).toBeTruthy();
    });

    it('toggles fullscreen when the fullscreen button is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="add-script-fullscreen-btn"]').trigger('click');
      expect(mockToggleFullscreen).toHaveBeenCalled();
    });

    it('does not emit save on a plain button click without submit', async () => {
      // Sanity: clicking cancel/back must never emit save.
      wrapper = createWrapper({ name: 'valid_action' });
      await wrapper.find('[data-test="add-script-cancel-btn"]').trigger('click');
      expect(wrapper.emitted('save')).toBeFalsy();
    });
  });

  describe('Edge cases', () => {
    it('handles a very long action name', async () => {
      const longName = 'a'.repeat(100);
      wrapper = createWrapper({ name: longName });
      await submit(wrapper);
      // Long but valid method name → passes (no length cap in the rule).
      expect((wrapper.vm as any).form.state.isValid).toBe(true);
    });
  });
});
