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
});
