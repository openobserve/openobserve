import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import AddAlertView from './AddAlertView.vue';
import destinationService from '@/services/alert_destination';

vi.mock('@/services/alert_destination', () => ({
  default: {
    list: vi.fn(),
  },
}));

describe('AddAlertView.vue', () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org',
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/alerts', name: 'alertList', component: { template: '<div>Alerts</div>' } },
      ],
    });
  });

  it('should render AddAlert component when destinations are loaded', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: 'Destination 1' }],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub"></div>',
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.add-alert-stub').exists()).toBe(true);
  });

  it('should fetch destinations on mount', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: 'Destination 1' }],
    } as any);

    mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: true,
        },
      },
    });

    await flushPromises();

    expect(destinationService.list).toHaveBeenCalledWith({
      org_identifier: 'test-org',
      module: 'alert',
    });
  });

  it('should not render AddAlert when destinations are empty', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub"></div>',
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.find('.add-alert-stub').exists()).toBe(false);
  });

  it('should handle getDestinations error', async () => {
    const mockNotify = vi.fn();
    const mockQuasar = {
      notify: mockNotify,
    };

    vi.mocked(destinationService.list).mockRejectedValue(new Error('Network error'));

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: true,
        },
        provide: {
          $q: mockQuasar,
        },
      },
    });

    // Manually inject $q into the component instance
    wrapper.vm.$q = mockQuasar;

    await flushPromises();

    // The component should handle the error gracefully
    // We can verify that destinations list is empty
    expect(wrapper.vm.destinations).toEqual([]);
  });

  it('should navigate to alert list on handleUpdateList', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: 'Destination 1' }],
    } as any);

    const pushSpy = vi.spyOn(router, 'push');

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub" @update:list="$emit(\'update:list\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    wrapper.findComponent({ name: 'AddAlert' }).vm.$emit('update:list');
    await flushPromises();

    expect(pushSpy).toHaveBeenCalledWith({
      name: 'alertList',
      query: {
        org_identifier: 'test-org',
        folder: 'default',
      },
    });
  });

  it('should navigate back on handleCancel', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: 'Destination 1' }],
    } as any);

    const backSpy = vi.spyOn(router, 'back');

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub" @cancel:hideform="$emit(\'cancel:hideform\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    wrapper.findComponent({ name: 'AddAlert' }).vm.$emit('cancel:hideform');
    await flushPromises();

    expect(backSpy).toHaveBeenCalled();
  });

  it('should refresh destinations when event is emitted', async () => {
    vi.mocked(destinationService.list).mockResolvedValue({
      data: [{ id: 1, name: 'Destination 1' }],
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub" @refresh:destinations="$emit(\'refresh:destinations\')"></div>',
          },
        },
      },
    });

    await flushPromises();

    // Clear previous calls
    vi.mocked(destinationService.list).mockClear();

    wrapper.findComponent({ name: 'AddAlert' }).vm.$emit('refresh:destinations');
    await flushPromises();

    expect(destinationService.list).toHaveBeenCalledTimes(1);
  });

  it('should pass correct props to AddAlert', async () => {
    const mockDestinations = [
      { id: 1, name: 'Destination 1' },
      { id: 2, name: 'Destination 2' },
    ];

    vi.mocked(destinationService.list).mockResolvedValue({
      data: mockDestinations,
    } as any);

    const wrapper = mount(AddAlertView, {
      global: {
        plugins: [store, router],
        stubs: {
          AddAlert: {
            name: 'AddAlert',
            template: '<div class="add-alert-stub"></div>',
            props: ['destinations', 'isUpdated'],
          },
        },
      },
    });

    await flushPromises();

    const addAlert = wrapper.findComponent({ name: 'AddAlert' });
    expect(addAlert.props('destinations')).toEqual(mockDestinations);
    expect(addAlert.props('isUpdated')).toBe(false);
  });
});
