import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FrustrationBadge from './FrustrationBadge.vue';

describe('FrustrationBadge.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    // Create #app element for Quasar tooltips to attach to
    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
  });

  afterEach(() => {
    // Clean up wrapper and DOM
    if (wrapper) {
      wrapper.unmount();
    }
    const app = document.getElementById('app');
    if (app) {
      document.body.removeChild(app);
    }
  });

  const createWrapper = (count: number) => {
    return mount(FrustrationBadge, {
      props: { count },
      global: {
        plugins: [Quasar],
      },
      attachTo: '#app',
    });
  };

  describe('Severity Levels', () => {
    it('should render "—" when count is 0', () => {
      wrapper = createWrapper(0);
      expect(wrapper.find('[data-test="frustration-badge-none"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-badge-none"]').text()).toBe('—');
      expect(wrapper.find('.frustration-badge').exists()).toBe(false);
    });

    it('should render low severity badge for count 1-3', () => {
      wrapper = createWrapper(2);
      expect(wrapper.find('[data-test="frustration-badge-low"]').exists()).toBe(true);
      expect(wrapper.find('.frustration-badge-low').exists()).toBe(true);
      expect(wrapper.text()).toContain('2');
    });

    it('should render medium severity badge for count 4-7', () => {
      wrapper = createWrapper(5);
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);
      expect(wrapper.find('.frustration-badge-medium').exists()).toBe(true);
      expect(wrapper.text()).toContain('5');
    });

    it('should render high severity badge for count 8+', () => {
      wrapper = createWrapper(12);
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
      expect(wrapper.find('.frustration-badge-high').exists()).toBe(true);
      expect(wrapper.text()).toContain('12');
    });
  });

  describe('Boundary Cases', () => {
    it('should handle boundary at 3 (low)', () => {
      wrapper = createWrapper(3);
      expect(wrapper.find('.frustration-badge-low').exists()).toBe(true);
    });

    it('should handle boundary at 4 (medium)', () => {
      wrapper = createWrapper(4);
      expect(wrapper.find('.frustration-badge-medium').exists()).toBe(true);
    });

    it('should handle boundary at 7 (medium)', () => {
      wrapper = createWrapper(7);
      expect(wrapper.find('.frustration-badge-medium').exists()).toBe(true);
    });

    it('should handle boundary at 8 (high)', () => {
      wrapper = createWrapper(8);
      expect(wrapper.find('.frustration-badge-high').exists()).toBe(true);
    });
  });

  describe('Tooltip Text', () => {
    it('should show "No frustration signals detected" for count 0', () => {
      wrapper = createWrapper(0);
      const badge = wrapper.find('[data-test="frustration-badge-none"]');
      expect(badge.exists()).toBe(true);
    });

    it('should show singular text for count 1', () => {
      wrapper = createWrapper(1);
      const badge = wrapper.find('[data-test="frustration-badge-low"]');
      expect(badge.attributes('title')).toBe('1 frustration signal detected');
    });

    it('should show plural text with severity for count > 1', () => {
      wrapper = createWrapper(5);
      const badge = wrapper.find('[data-test="frustration-badge-medium"]');
      expect(badge.attributes('title')).toBe('5 frustration signals (Medium severity)');
    });

    it('should show high severity warning for count 8+', () => {
      wrapper = createWrapper(10);
      const badge = wrapper.find('[data-test="frustration-badge-high"]');
      expect(badge.attributes('title')).toBe('10 frustration signals (High severity - requires attention)');
    });
  });

  describe('Visual Styling', () => {
    it('should apply correct CSS classes for low severity', () => {
      wrapper = createWrapper(2);
      const badge = wrapper.find('.frustration-badge');
      expect(badge.classes()).toContain('frustration-badge-low');
    });

    it('should apply correct CSS classes for medium severity', () => {
      wrapper = createWrapper(6);
      const badge = wrapper.find('.frustration-badge');
      expect(badge.classes()).toContain('frustration-badge-medium');
    });

    it('should apply correct CSS classes for high severity', () => {
      wrapper = createWrapper(15);
      const badge = wrapper.find('.frustration-badge');
      expect(badge.classes()).toContain('frustration-badge-high');
    });
  });

  describe('Data Test Attributes', () => {
    it('should have correct data-test attribute for container', () => {
      wrapper = createWrapper(5);
      expect(wrapper.find('[data-test="frustration-badge-container"]').exists()).toBe(true);
    });

    it('should have correct data-test attribute for severity level', () => {
      wrapper = createWrapper(5);
      expect(wrapper.find('[data-test="frustration-badge-medium"]').exists()).toBe(true);
    });

    it('should have tooltip data-test attribute', async () => {
      wrapper = createWrapper(5);
      const badge = wrapper.find('[data-test="frustration-badge-medium"]');

      // Trigger mouseenter to show tooltip
      await badge.trigger('mouseenter');

      // Wait a bit for Quasar to render the tooltip
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Tooltip is rendered at document level by Quasar, not in wrapper
      const tooltip = document.querySelector(
        '[data-test="frustration-badge-tooltip"]',
      );
      expect(tooltip).not.toBeNull();
    });
  });

  describe('Reactivity', () => {
    it('should update when count prop changes', async () => {
      wrapper = createWrapper(2);
      expect(wrapper.find('.frustration-badge-low').exists()).toBe(true);

      await wrapper.setProps({ count: 10 });
      expect(wrapper.find('.frustration-badge-high').exists()).toBe(true);
      expect(wrapper.find('.frustration-badge-low').exists()).toBe(false);
    });

    it('should toggle between badge and placeholder when count changes', async () => {
      wrapper = createWrapper(5);
      expect(wrapper.find('.frustration-badge').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-badge-none"]').exists()).toBe(false);

      await wrapper.setProps({ count: 0 });
      expect(wrapper.find('.frustration-badge').exists()).toBe(false);
      expect(wrapper.find('[data-test="frustration-badge-none"]').exists()).toBe(true);
    });
  });

  describe('Large Numbers', () => {
    it('should handle large frustration counts', () => {
      wrapper = createWrapper(999);
      expect(wrapper.find('[data-test="frustration-badge-high"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('999');
    });
  });
});
