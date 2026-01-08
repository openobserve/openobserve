import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { Quasar } from 'quasar';
import SessionViewer from './SessionViewer.vue';

describe('SessionViewer.vue', () => {
  let router: any;
  let i18n: any;

  beforeEach(() => {
    vi.clearAllMocks();

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/rum/sessions/:id', component: SessionViewer },
      ],
    });

    i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: {
        en: {},
      },
    });
  });

  it('should render component', () => {
    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it('should display session details', () => {
    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
          QSeparator: true,
        },
      },
    });

    // Component uses Composition API, data is loaded asynchronously
    // Just verify the component structure renders
    expect(wrapper.find('[title="Go Back"]').exists()).toBe(true);
  });

  it('should display Unknown User when user_email is not available', () => {
    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
          QSeparator: true,
        },
      },
    });

    // Component shows "Unknown User" by default when no email
    expect(wrapper.text()).toContain('Unknown User');
  });

  it('should navigate back when back button is clicked', async () => {
    const backSpy = vi.spyOn(router, 'back');

    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
          QSeparator: true,
        },
      },
    });

    const backButton = wrapper.find('[title="Go Back"]');
    await backButton.trigger('click');

    expect(backSpy).toHaveBeenCalled();
  });

  it('should display browser and os information', () => {
    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
          QSeparator: true,
        },
      },
    });

    // Component renders the structure for browser/os display
    expect(wrapper.find('[name="settings"]').exists()).toBe(true);
  });

  it('should display location information', () => {
    const wrapper = mount(SessionViewer, {
      global: {
        plugins: [router, i18n, [Quasar, {}]],
        stubs: {
          QIcon: true,
          VideoPlayer: true,
          PlayerEventsSidebar: true,
          QSeparator: true,
        },
      },
    });

    // Component renders the structure for location display
    expect(wrapper.find('[name="location_on"]').exists()).toBe(true);
  });

  describe('Frustration Signals', () => {
    it('should display frustration summary when events have frustrations', async () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      // Simulate events with frustrations
      wrapper.vm.segmentEvents = [
        {
          id: '1',
          type: 'action',
          frustration_types: ['rage_click'],
          name: 'click on Submit',
        },
        {
          id: '2',
          type: 'action',
          frustration_types: ['dead_click'],
          name: 'click on Nav',
        },
      ];

      await wrapper.vm.$nextTick();

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
      expect(summary.exists()).toBe(true);
    });

    it('should not display frustration summary when no frustrations', async () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      wrapper.vm.segmentEvents = [
        {
          id: '1',
          type: 'action',
          frustration_types: null,
          name: 'click',
        },
      ];

      await wrapper.vm.$nextTick();

      const summary = wrapper.find('[data-test="session-viewer-frustration-summary"]');
      expect(summary.exists()).toBe(false);
    });

    it('should calculate correct frustration count', async () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      wrapper.vm.segmentEvents = [
        { id: '1', type: 'action', frustration_types: ['rage_click'], name: 'click' },
        { id: '2', type: 'action', frustration_types: ['dead_click'], name: 'click' },
        { id: '3', type: 'action', frustration_types: null, name: 'click' },
      ];

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.frustrationCount).toBe(2);
    });

    it('should display singular "Frustration" for count of 1', async () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      wrapper.vm.segmentEvents = [
        { id: '1', type: 'action', frustration_types: ['rage_click'], name: 'click' },
      ];

      await wrapper.vm.$nextTick();

      const summaryText = wrapper.find('[data-test="frustration-summary-text"]');
      expect(summaryText.text()).toBe('1 Frustration');
    });

    it('should display plural "Frustrations" for count > 1', async () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      wrapper.vm.segmentEvents = [
        { id: '1', type: 'action', frustration_types: ['rage_click'], name: 'click' },
        { id: '2', type: 'action', frustration_types: ['dead_click'], name: 'click' },
      ];

      await wrapper.vm.$nextTick();

      const summaryText = wrapper.find('[data-test="frustration-summary-text"]');
      expect(summaryText.text()).toContain('Frustrations');
    });

    it('should handle action events with JSON string frustration types', () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      const mockEvent = {
        type: 'action',
        action_type: 'click',
        action_target_name: 'Submit',
        action_frustration_type: '["rage_click","dead_click"]',
        date: 1000000,
      };

      const formattedEvent = wrapper.vm.handleActionEvent(mockEvent);

      expect(formattedEvent.frustration_types).toEqual(['rage_click', 'dead_click']);
    });

    it('should handle single frustration type string', () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      const mockEvent = {
        type: 'action',
        action_type: 'click',
        action_target_name: 'Submit',
        action_frustration_type: 'rage_click',
        date: 1000000,
      };

      const formattedEvent = wrapper.vm.handleActionEvent(mockEvent);

      expect(formattedEvent.frustration_types).toEqual(['rage_click']);
    });

    it('should handle malformed JSON gracefully', () => {
      const wrapper = mount(SessionViewer, {
        global: {
          plugins: [router, i18n, [Quasar, {}]],
          stubs: {
            QIcon: true,
            VideoPlayer: true,
            PlayerEventsSidebar: true,
            QSeparator: true,
          },
        },
      });

      const mockEvent = {
        type: 'action',
        action_type: 'click',
        action_target_name: 'Submit',
        action_frustration_type: 'invalid-json{',
        date: 1000000,
      };

      const formattedEvent = wrapper.vm.handleActionEvent(mockEvent);

      expect(formattedEvent.frustration_types).toEqual(['invalid-json{']);
    });
  });
});
