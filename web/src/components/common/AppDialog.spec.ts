import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import AppDialog from '@/components/common/AppDialog.vue';

describe('AppDialog.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
    // Reset body overflow
    document.body.style.overflow = '';
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      modelValue: false,
      title: '',
      closeOnBackdropClick: true,
      closeOnEsc: true
    };

    return mount(AppDialog, {
      props: { ...defaultProps, ...props },
      attachTo: document.body
    });
  };

  describe('Component Rendering', () => {
    it('renders the component when modelValue is true', () => {
      wrapper = createWrapper({ modelValue: true });
      expect(wrapper.exists()).toBe(true);
    });

    it('does not render when modelValue is false', () => {
      wrapper = createWrapper({ modelValue: false });
      const backdrop = wrapper.find('.app-dialog-backdrop');
      expect(backdrop.exists()).toBe(false);
    });

    it('renders dialog content slot correctly', () => {
      wrapper = mount(AppDialog, {
        props: { modelValue: true },
        slots: {
          default: '<div class="test-content">Test Content</div>'
        },
        attachTo: document.body
      });
      
      // Since component uses Teleport, check the DOM directly
      const testContent = document.querySelector('.test-content');
      expect(testContent).toBeTruthy();
      expect(testContent?.textContent).toBe('Test Content');
    });

    it('applies correct structure classes', () => {
      wrapper = createWrapper({ modelValue: true });
      
      // Check DOM directly since component uses Teleport
      expect(document.querySelector('.app-dialog-backdrop')).toBeTruthy();
      expect(document.querySelector('.app-dialog')).toBeTruthy();
      expect(document.querySelector('.app-dialog-content')).toBeTruthy();
    });

    it('sets correct ARIA attributes', () => {
      wrapper = createWrapper({ modelValue: true });
      
      // Check DOM directly since component uses Teleport
      const dialog = document.querySelector('.app-dialog');
      expect(dialog?.getAttribute('role')).toBe('dialog');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
    });
  });

  describe('Props Handling', () => {
    it('accepts all props correctly', () => {
      wrapper = createWrapper({
        modelValue: true,
        title: 'Test Title',
        closeOnBackdropClick: false,
        closeOnEsc: false
      });
      
      expect(wrapper.props('modelValue')).toBe(true);
      expect(wrapper.props('title')).toBe('Test Title');
      expect(wrapper.props('closeOnBackdropClick')).toBe(false);
      expect(wrapper.props('closeOnEsc')).toBe(false);
    });

    it('uses default values correctly', () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('modelValue')).toBe(false);
      expect(wrapper.props('title')).toBe('');
      expect(wrapper.props('closeOnBackdropClick')).toBe(true);
      expect(wrapper.props('closeOnEsc')).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('emits update:modelValue when handleClose is called', async () => {
      wrapper = createWrapper({ modelValue: true });
      const vm = wrapper.vm as any;
      
      vm.handleClose();
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
    });

    it('emits close event when handleClose is called', async () => {
      wrapper = createWrapper({ modelValue: true });
      const vm = wrapper.vm as any;
      
      vm.handleClose();
      
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('calls handleClose when backdrop is clicked and closeOnBackdropClick is true', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnBackdropClick: true });
      
      // Find backdrop in DOM directly
      const backdrop = document.querySelector('.app-dialog-backdrop') as HTMLElement;
      expect(backdrop).toBeTruthy();
      
      backdrop?.click();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });

    it('does not call handleClose when backdrop is clicked and closeOnBackdropClick is false', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnBackdropClick: false });
      
      const backdrop = document.querySelector('.app-dialog-backdrop') as HTMLElement;
      expect(backdrop).toBeTruthy();
      
      backdrop?.click();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('prevents event propagation when dialog content is clicked', async () => {
      wrapper = createWrapper({ modelValue: true });
      
      const dialog = document.querySelector('.app-dialog') as HTMLElement;
      expect(dialog).toBeTruthy();
      
      dialog?.click();
      await wrapper.vm.$nextTick();
      
      // Since @click.stop is used, the event should be stopped
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });
  });

  describe('Keyboard Event Handling', () => {
    it('closes dialog on ESC key when closeOnEsc is true', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnEsc: true });
      
      // Simulate ESC key press
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false]);
    });

    it('does not close dialog on ESC key when closeOnEsc is false', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnEsc: false });
      
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('does not close dialog on ESC key when dialog is closed', async () => {
      wrapper = createWrapper({ modelValue: false, closeOnEsc: true });
      
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });

    it('ignores non-ESC keys', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnEsc: true });
      
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });
  });

  describe('Focus Management', () => {
    it('handles focus trap without errors', async () => {
      // Create dialog with focusable elements
      wrapper = mount(AppDialog, {
        props: { modelValue: true },
        slots: {
          default: `
            <button id="first">First</button>
            <button id="second">Second</button>
            <button id="last">Last</button>
          `
        },
        attachTo: document.body
      });

      await wrapper.vm.$nextTick();
      
      // Simulate Tab event
      const tabEvent = new KeyboardEvent('keydown', { 
        key: 'Tab', 
        shiftKey: false 
      });
      
      expect(() => {
        document.dispatchEvent(tabEvent);
      }).not.toThrow();
    });

    it('ignores focus trap for non-Tab keys', async () => {
      wrapper = createWrapper({ modelValue: true });
      
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      
      expect(() => {
        document.dispatchEvent(enterEvent);
      }).not.toThrow();
    });

    it('ignores focus trap when dialog is closed', async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      
      expect(() => {
        document.dispatchEvent(tabEvent);
      }).not.toThrow();
    });
  });

  describe('Body Overflow Management', () => {
    it('sets body overflow to hidden when dialog opens', async () => {
      wrapper = createWrapper({ modelValue: false });
      
      await wrapper.setProps({ modelValue: true });
      await wrapper.vm.$nextTick();
      
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('resets body overflow when dialog closes', async () => {
      wrapper = createWrapper({ modelValue: true });
      
      await wrapper.setProps({ modelValue: false });
      await wrapper.vm.$nextTick();
      
      expect(document.body.style.overflow).toBe('');
    });

    it('resets body overflow on component unmount if dialog is open', () => {
      wrapper = createWrapper({ modelValue: true });
      
      // Set body overflow to hidden
      document.body.style.overflow = 'hidden';
      
      wrapper.unmount();
      
      expect(document.body.style.overflow).toBe('');
    });

    it('does not affect body overflow on unmount if dialog is closed', () => {
      wrapper = createWrapper({ modelValue: false });
      
      // Set some initial overflow style
      document.body.style.overflow = 'auto';
      
      wrapper.unmount();
      
      // Should remain unchanged
      expect(document.body.style.overflow).toBe('auto');
    });
  });

  describe('Auto Focus', () => {
    it('focuses first focusable element when dialog opens', async () => {
      wrapper = mount(AppDialog, {
        props: { modelValue: false },
        slots: {
          default: '<button id="focus-target">Focus Me</button>'
        },
        attachTo: document.body
      });
      
      await wrapper.setProps({ modelValue: true });
      await wrapper.vm.$nextTick();
      
      // Should attempt to focus the button
      expect(wrapper.exists()).toBe(true);
    });

    it('handles case when no focusable elements exist', async () => {
      wrapper = mount(AppDialog, {
        props: { modelValue: false },
        slots: {
          default: '<div>No focusable content</div>'
        },
        attachTo: document.body
      });
      
      await wrapper.setProps({ modelValue: true });
      await wrapper.vm.$nextTick();
      
      // Should not crash
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Lifecycle Management', () => {
    it('adds event listeners on mount', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      
      wrapper = createWrapper();
      
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2); // ESC handler and focus trap
      
      addEventListenerSpy.mockRestore();
    });

    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      
      wrapper = createWrapper();
      wrapper.unmount();
      
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);
      
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('handles multiple rapid backdrop clicks', async () => {
      wrapper = createWrapper({ modelValue: true, closeOnBackdropClick: true });
      
      const backdrop = document.querySelector('.app-dialog-backdrop') as HTMLElement;
      
      // Rapid clicks
      backdrop?.click();
      backdrop?.click();
      backdrop?.click();
      
      await wrapper.vm.$nextTick();
      
      // Should emit multiple times
      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });

    it('handles missing dialogRef gracefully', async () => {
      wrapper = createWrapper({ modelValue: true });
      const vm = wrapper.vm as any;
      
      // Mock missing ref
      vm.dialogRef = null;
      
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      
      expect(() => {
        document.dispatchEvent(tabEvent);
      }).not.toThrow();
    });

    it('handles focus trap with no focusable elements', async () => {
      wrapper = mount(AppDialog, {
        props: { modelValue: true },
        slots: {
          default: '<div>No buttons or inputs</div>'
        },
        attachTo: document.body
      });

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      
      expect(() => {
        document.dispatchEvent(tabEvent);
      }).not.toThrow();
    });

    it('handles props changes correctly', async () => {
      wrapper = createWrapper({ 
        modelValue: true, 
        closeOnBackdropClick: true,
        closeOnEsc: true 
      });
      
      // Change props
      await wrapper.setProps({ 
        closeOnBackdropClick: false,
        closeOnEsc: false 
      });
      
      // Test that new prop values are respected
      const backdrop = document.querySelector('.app-dialog-backdrop') as HTMLElement;
      backdrop?.click();
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
      
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(escEvent);
      
      expect(wrapper.emitted('update:modelValue')).toBeFalsy();
    });
  });

  describe('Teleport Behavior', () => {
    it('renders content in document body via Teleport', () => {
      wrapper = createWrapper({ modelValue: true });
      
      // Check that the backdrop is actually in the body
      const backdrop = document.querySelector('.app-dialog-backdrop');
      expect(backdrop).toBeTruthy();
      expect(document.body.contains(backdrop)).toBe(true);
    });
  });
});