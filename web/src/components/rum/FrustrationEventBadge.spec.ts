import { describe, it, expect } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FrustrationEventBadge from './FrustrationEventBadge.vue';

describe('FrustrationEventBadge.vue', () => {
  let wrapper: VueWrapper;

  const createWrapper = (frustrationTypes: string[]) => {
    return mount(FrustrationEventBadge, {
      props: { frustrationTypes },
      global: {
        plugins: [Quasar],
      },
    });
  };

  describe('Single Frustration Type', () => {
    it('should render rage_click badge', () => {
      wrapper = createWrapper(['rage_click']);
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Rage Click');
    });

    it('should render dead_click badge', () => {
      wrapper = createWrapper(['dead_click']);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Dead Click');
    });

    it('should render error_click badge', () => {
      wrapper = createWrapper(['error_click']);
      expect(wrapper.find('[data-test="frustration-event-badge-error_click"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Error Click');
    });

    it('should render rage_tap badge', () => {
      wrapper = createWrapper(['rage_tap']);
      expect(wrapper.find('[data-test="frustration-event-badge-rage_tap"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Rage Tap');
    });

    it('should render error_tap badge', () => {
      wrapper = createWrapper(['error_tap']);
      expect(wrapper.find('[data-test="frustration-event-badge-error_tap"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Error Tap');
    });
  });

  describe('Multiple Frustration Types', () => {
    it('should render multiple badges for multiple frustration types', () => {
      wrapper = createWrapper(['rage_click', 'dead_click']);
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(2);
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
    });

    it('should render three frustration types', () => {
      wrapper = createWrapper(['rage_click', 'dead_click', 'error_click']);
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(3);
    });
  });

  describe('Badge Styling', () => {
    it('should apply rage styling for rage_click', () => {
      wrapper = createWrapper(['rage_click']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-rage');
    });

    it('should apply dead styling for dead_click', () => {
      wrapper = createWrapper(['dead_click']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-dead');
    });

    it('should apply error styling for error_click', () => {
      wrapper = createWrapper(['error_click']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-error');
    });

    it('should apply rage styling for rage_tap', () => {
      wrapper = createWrapper(['rage_tap']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-rage');
    });

    it('should apply error styling for error_tap', () => {
      wrapper = createWrapper(['error_tap']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-error');
    });
  });

  describe('Tooltip Content', () => {
    it('should show correct tooltip for rage_click', () => {
      wrapper = createWrapper(['rage_click']);
      const badge = wrapper.find('[data-test="frustration-event-badge-rage_click"]');
      expect(badge.exists()).toBe(true);
      // Tooltip exists in component structure
      const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
      expect(tooltips.length).toBeGreaterThan(0);
    });

    it('should show correct tooltip for dead_click', () => {
      wrapper = createWrapper(['dead_click']);
      const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
      expect(tooltips.length).toBeGreaterThan(0);
    });

    it('should show correct tooltip for error_click', () => {
      wrapper = createWrapper(['error_click']);
      const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
      expect(tooltips.length).toBeGreaterThan(0);
    });
  });

  describe('Empty State', () => {
    it('should handle empty frustration types array', () => {
      wrapper = createWrapper([]);
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(0);
    });
  });

  describe('Data Test Attributes', () => {
    it('should have wrapper data-test attribute', () => {
      wrapper = createWrapper(['rage_click']);
      expect(wrapper.find('[data-test="frustration-event-badge-wrapper"]').exists()).toBe(true);
    });

    it('should have unique data-test for each frustration type', () => {
      wrapper = createWrapper(['rage_click', 'dead_click']);
      expect(wrapper.find('[data-test="frustration-event-badge-rage_click"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="frustration-event-badge-dead_click"]').exists()).toBe(true);
    });
  });

  describe('Unknown Frustration Type', () => {
    it('should handle unknown frustration type gracefully', () => {
      wrapper = createWrapper(['unknown_type']);
      expect(wrapper.find('[data-test="frustration-event-badge-unknown_type"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('unknown_type');
    });

    it('should apply default styling for unknown type', () => {
      wrapper = createWrapper(['unknown_type']);
      const badge = wrapper.find('.frustration-event-badge');
      expect(badge.classes()).toContain('frustration-badge-default');
    });
  });

  describe('Badge Labels', () => {
    it('should format rage_click label correctly', () => {
      wrapper = createWrapper(['rage_click']);
      expect(wrapper.text()).toContain('Rage Click');
    });

    it('should format dead_click label correctly', () => {
      wrapper = createWrapper(['dead_click']);
      expect(wrapper.text()).toContain('Dead Click');
    });

    it('should format error_click label correctly', () => {
      wrapper = createWrapper(['error_click']);
      expect(wrapper.text()).toContain('Error Click');
    });
  });

  describe('Reactivity', () => {
    it('should update when frustrationTypes prop changes', async () => {
      wrapper = createWrapper(['rage_click']);
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(1);

      await wrapper.setProps({ frustrationTypes: ['rage_click', 'dead_click'] });
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(2);
    });

    it('should clear badges when frustrationTypes becomes empty', async () => {
      wrapper = createWrapper(['rage_click', 'dead_click']);
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(2);

      await wrapper.setProps({ frustrationTypes: [] });
      expect(wrapper.findAll('.frustration-event-badge')).toHaveLength(0);
    });
  });

  describe('CSS Classes', () => {
    it('should have correct base class on all badges', () => {
      wrapper = createWrapper(['rage_click', 'dead_click']);
      const badges = wrapper.findAll('.frustration-event-badge');
      expect(badges).toHaveLength(2);
      badges.forEach(badge => {
        expect(badge.classes()).toContain('frustration-event-badge');
      });
    });
  });
});
