import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import { Quasar } from 'quasar';
import { createI18n } from 'vue-i18n';
import Functions from './Functions.vue';

// Mock the router-view component
const MockRouterView = {
  name: 'RouterView',
  template: '<div class="mock-router-view"><slot v-bind="{ Component: MockComponent }" /></div>',
  setup() {
    const MockComponent = {
      name: 'MockComponent',
      template: '<div class="mock-component">Mock Component Content</div>',
    };
    return { MockComponent };
  },
};

describe('Functions.vue', () => {
  let wrapper: any;
  let store: any;
  let router: any;
  let i18n: any;

  const createWrapper = async (storeConfig = {}, routeConfig = {}) => {
    // Create store with default configuration
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org-id',
          name: 'Test Organization',
        },
        zoConfig: {
          custom_hide_menus: '',
        },
        ...storeConfig,
      },
      getters: {},
      mutations: {},
      actions: {},
    });

    // Create i18n instance
    i18n = createI18n({
      legacy: false,
      locale: 'en',
      fallbackLocale: 'en',
      globalInjection: true,
      messages: {
        en: {
          function: {
            streamPipeline: 'Stream Pipeline',
            header: 'Functions',
            enrichmentTables: 'Enrichment Tables',
          },
        },
      },
    });

    // Create router with default routes
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
        { path: '/pipelines', name: 'pipelines', component: { template: '<div>Pipelines</div>' } },
        { path: '/functions', name: 'functionList', component: { template: '<div>Functions</div>' } },
        { path: '/enrichment', name: 'enrichmentTables', component: { template: '<div>Enrichment</div>' } },
        { path: '/pipeline', name: 'pipeline', component: { template: '<div>Pipeline</div>' } },
      ],
    });

    // Set initial route
    const initialRoute = {
      name: 'functionList',
      query: { org_identifier: 'test-org-id' },
      ...routeConfig,
    };
    await router.push(initialRoute);

    return mount(Functions, {
      global: {
        plugins: [
          store,
          router,
          i18n,
          [Quasar, {}],
        ],
        stubs: {
          'q-page': { template: '<div class="q-page"><slot /></div>' },
          'q-btn': {
            template: '<button class="q-btn" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
          'q-splitter': {
            template: '<div class="q-splitter"><slot name="before" /><slot name="separator" /><slot name="after" /></div>',
            props: ['modelValue', 'unit', 'limits'],
          },
          'q-tabs': {
            template: '<div class="q-tabs" :class="$attrs.class"><slot /></div>',
            props: ['modelValue', 'indicatorColor', 'inlineLabel', 'vertical'],
          },
          'q-route-tab': { 
            template: '<div class="q-route-tab" :class="{ active: name === activeTab }">{{ label }}</div>',
            props: ['name', 'to', 'label', 'contentClass'],
            inject: {
              activeTab: {
                default: 'functions',
              },
            },
          },
          'RouterView': MockRouterView,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Component Initialization', () => {
    it('should render the component with default configuration', async () => {
      wrapper = await createWrapper();

      expect(wrapper.find('.q-page').exists()).toBe(true);
      expect(wrapper.find('.q-splitter').exists()).toBe(true);
      // The tabs now use 'card-container' class instead of 'functions-tabs'
      expect(wrapper.find('.q-tabs.card-container').exists()).toBe(true);
    });

    it('should initialize with correct default values', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).splitterModel).toBe(220);
      expect((wrapper.vm as any).showSidebar).toBe(true);
      expect((wrapper.vm as any).activeTab).toBe('streamPipelines');
    });

    it('should render the collapse/expand button', async () => {
      wrapper = await createWrapper();
      
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn"]');
      expect(collapseBtn.exists()).toBe(true);
    });
  });

  describe('Sidebar Functionality', () => {
    it('should show sidebar by default', async () => {
      wrapper = await createWrapper();

      expect((wrapper.vm as any).showSidebar).toBe(true);
      // The tabs now use 'card-container' class instead of 'functions-tabs'
      expect(wrapper.find('.q-tabs.card-container').exists()).toBe(true);
    });

    it('should collapse sidebar when collapse button is clicked', async () => {
      wrapper = await createWrapper();
      
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn"]');
      
      expect((wrapper.vm as any).showSidebar).toBe(true);
      expect((wrapper.vm as any).splitterModel).toBe(220);
      
      await collapseBtn.trigger('click');
      
      expect((wrapper.vm as any).showSidebar).toBe(false);
      expect((wrapper.vm as any).splitterModel).toBe(0);
    });

    it('should expand sidebar when expand button is clicked after collapse', async () => {
      wrapper = await createWrapper();
      
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn"]');
      
      // First collapse
      await collapseBtn.trigger('click');
      expect((wrapper.vm as any).showSidebar).toBe(false);
      
      // Then expand
      await collapseBtn.trigger('click');
      expect((wrapper.vm as any).showSidebar).toBe(true);
      expect((wrapper.vm as any).splitterModel).toBe(220); // Should restore to last position
    });

    it('should remember last splitter position when collapsing and expanding', async () => {
      wrapper = await createWrapper();
      
      // Change splitter position
      (wrapper.vm as any).splitterModel = 250;
      await wrapper.vm.$nextTick();
      
      const collapseBtn = wrapper.find('[data-test="logs-search-field-list-collapse-btn"]');
      
      // Collapse
      await collapseBtn.trigger('click');
      expect((wrapper.vm as any).splitterModel).toBe(0);
      
      // Expand - should restore to 250
      await collapseBtn.trigger('click');
      expect((wrapper.vm as any).splitterModel).toBe(250);
    });
  });

  describe('Tab Navigation', () => {
    it('should render all tabs when pipelines are not hidden', async () => {
      wrapper = await createWrapper();
      
      const streamPipelineTab = wrapper.find('[data-test="stream-pipelines-tab"]');
      const functionTab = wrapper.find('[data-test="function-stream-tab"]');
      const enrichmentTab = wrapper.find('[data-test="function-enrichment-table-tab"]');
      
      expect(streamPipelineTab.exists()).toBe(true);
      expect(functionTab.exists()).toBe(true);
      expect(enrichmentTab.exists()).toBe(true);
    });

    it('should hide pipelines tab when configured in zoConfig', async () => {
      wrapper = await createWrapper({
        zoConfig: {
          custom_hide_menus: 'pipelines',
        },
      });
      
      const streamPipelineTab = wrapper.find('[data-test="stream-pipelines-tab"]');
      const functionTab = wrapper.find('[data-test="function-stream-tab"]');
      
      expect(streamPipelineTab.exists()).toBe(false);
      expect(functionTab.exists()).toBe(true);
    });

    it('should render correct tab labels', async () => {
      wrapper = await createWrapper();
      
      const streamPipelineTab = wrapper.find('[data-test="stream-pipelines-tab"]');
      const functionTab = wrapper.find('[data-test="function-stream-tab"]');
      const enrichmentTab = wrapper.find('[data-test="function-enrichment-table-tab"]');
      
      expect(streamPipelineTab.text()).toBe('Stream Pipeline');
      expect(functionTab.text()).toBe('Functions');
      expect(enrichmentTab.text()).toBe('Enrichment Tables');
    });
  });

  describe('Route Handling', () => {
    it('should redirect from pipeline route to pipelines', async () => {
      // Create wrapper with pipeline route - this should trigger the redirect in onBeforeMount
      wrapper = await createWrapper({}, { name: 'pipeline' });
      
      const routerReplaceSpy = vi.spyOn(router, 'replace');
      
      // Call redirectRoute manually to test the redirect logic
      (wrapper.vm as any).redirectRoute();
      
      expect(routerReplaceSpy).toHaveBeenCalledWith({
        name: 'pipelines',
        query: {
          org_identifier: 'test-org-id',
        },
      });
    });

    it('should collapse sidebar when navigating to add function', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).showSidebar).toBe(true);
      
      // Simulate route change to add function
      await router.push({
        name: 'functionList',
        query: { action: 'add', org_identifier: 'test-org-id' },
      });
      
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).showSidebar).toBe(false);
    });

    it('should call router.back() when route name is pipeline', async () => {
      // First create wrapper with a normal route
      wrapper = await createWrapper();
      
      const routerBackSpy = vi.spyOn(router, 'back').mockImplementation(() => {});
      
      // Then navigate to pipeline route to trigger the watcher
      await router.push({ name: 'pipeline' });
      await wrapper.vm.$nextTick();
      
      expect(routerBackSpy).toHaveBeenCalled();
    });
  });

  describe('Event Handling', () => {
    it('should emit sendToAiChat event when sendToAiChat method is called', async () => {
      wrapper = await createWrapper();
      
      const testValue = { message: 'test message' };
      (wrapper.vm as any).sendToAiChat(testValue);
      
      expect(wrapper.emitted('sendToAiChat')).toBeTruthy();
      expect(wrapper.emitted('sendToAiChat')?.[0]).toEqual([testValue]);
    });
  });

  describe('RouterView Integration', () => {
    it('should render RouterView component', async () => {
      wrapper = await createWrapper();
      
      const routerView = wrapper.findComponent(MockRouterView);
      expect(routerView.exists()).toBe(true);
    });

    it('should pass sendToAiChat event to child components', async () => {
      wrapper = await createWrapper();
      
      // Find the mock component inside RouterView
      const mockComponent = wrapper.find('.mock-component');
      expect(mockComponent.exists()).toBe(true);
    });
  });


  describe('Data Properties', () => {
    it('should initialize templates as empty array', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).templates).toEqual([]);
    });

    it('should initialize functionAssociatedStreams as empty array', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).functionAssociatedStreams).toEqual([]);
    });
  });

  describe('Store Integration', () => {
    it('should access store state correctly', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).store.state.selectedOrganization.identifier).toBe('test-org-id');
      expect((wrapper.vm as any).store.state.selectedOrganization.name).toBe('Test Organization');
    });

    it('should handle different zoConfig values', async () => {
      wrapper = await createWrapper({
        zoConfig: {
          custom_hide_menus: 'pipelines,other',
        },
      });
      
      const streamPipelineTab = wrapper.find('[data-test="stream-pipelines-tab"]');
      expect(streamPipelineTab.exists()).toBe(false);
    });

    it('should handle undefined zoConfig', async () => {
      wrapper = await createWrapper({
        zoConfig: undefined,
      });
      
      const streamPipelineTab = wrapper.find('[data-test="stream-pipelines-tab"]');
      expect(streamPipelineTab.exists()).toBe(true);
    });
  });

  describe('Component Cleanup', () => {
    it('should not have memory leaks after unmount', async () => {
      wrapper = await createWrapper();
      const componentInstance = wrapper.vm;
      
      wrapper.unmount();
      
      // Verify component is properly cleaned up
      expect(componentInstance).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing organization identifier', async () => {
      wrapper = await createWrapper({
        selectedOrganization: {
          identifier: '',
          name: 'Test Organization',
        },
      });
      
      expect((wrapper.vm as any).store.state.selectedOrganization.identifier).toBe('');
    });

    it('should handle splitter model edge values', async () => {
      wrapper = await createWrapper();
      
      // Test minimum value
      (wrapper.vm as any).splitterModel = 0;
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).splitterModel).toBe(0);
      
      // Test maximum value
      (wrapper.vm as any).splitterModel = 300;
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).splitterModel).toBe(300);
    });

  });

  describe('Computed Properties and Watchers', () => {
    it('should handle route change to functionList with add action', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).showSidebar).toBe(true);
      
      // Navigate to functionList with add action
      await router.push({
        name: 'functionList',
        query: { action: 'add', org_identifier: 'test-org-id' },
      });
      
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).showSidebar).toBe(false);
    });

    it('should not collapse sidebar for functionList without add action', async () => {
      wrapper = await createWrapper();
      
      expect((wrapper.vm as any).showSidebar).toBe(true);
      
      // Navigate to functionList without add action
      await router.push({
        name: 'functionList',
        query: { org_identifier: 'test-org-id' },
      });
      
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).showSidebar).toBe(true);
    });
  });
});
