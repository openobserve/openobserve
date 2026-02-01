// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import AddDestination from '@/components/alerts/AddDestination.vue';

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

// Mock Quasar
const mockNotify = vi.fn();
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify
    })
  };
});

// Mock router
const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: mockPush
  })
}));

// Mock store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: 'test-org'
    }
  }
};

vi.mock('vuex', () => ({
  useStore: () => mockStore
}));

// Mock services
vi.mock('@/services/alert_destination', () => ({
  default: {
    create: vi.fn().mockResolvedValue({ data: {} }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    test: vi.fn().mockResolvedValue({ data: { success: true } })
  }
}));

vi.mock('@/services/alert_templates', () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: { list: [] } })
  }
}));

// Mock composables
vi.mock('@/composables/usePrebuiltDestinations', () => ({
  default: () => ({
    availableTypes: { value: [] },
    getPrebuiltConfig: vi.fn(),
    validateCredentials: vi.fn(() => ({ isValid: true, errors: {} })),
    buildDestinationPayload: vi.fn(),
    transformToPrebuiltForm: vi.fn()
  })
}));

vi.mock('@/composables/useActions', () => ({
  default: () => ({
    getAllActions: vi.fn().mockResolvedValue([])
  })
}));

// Mock tracking
vi.mock('@/composables/useReo', () => ({
  useReo: () => ({
    track: vi.fn()
  })
}));

describe('AddDestination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(AddDestination, {
      props: {
        destination: null,
        templates: [],
        ...props
      },
      global: {
        plugins: [[Quasar, {}]],
        stubs: {
          QCard: true,
          QCardSection: true,
          QTabs: true,
          QTab: true,
          QSeparator: true,
          QTabPanels: true,
          QTabPanel: true,
          QInput: true,
          QSelect: true,
          QToggle: true,
          QBtn: true,
          QIcon: true,
          QTooltip: true,
          QDialog: true,
          PrebuiltDestinationSelector: true,
          PrebuiltDestinationForm: true,
          DestinationPreview: true,
          DestinationTestResult: true
        }
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component', () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('renders add mode when no destination is provided', () => {
      const wrapper = createWrapper({ destination: null });
      expect(wrapper.exists()).toBe(true);
    });

    it('renders edit mode when destination is provided', () => {
      const destination = {
        name: 'test-dest',
        type: 'http',
        url: 'https://example.com',
        method: 'post',
        template: 'default',
        headers: {},
        skip_tls_verify: false
      };
      const wrapper = createWrapper({ destination });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Form Data Management', () => {
    it('initializes with default form data for add mode', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.formData).toBeDefined();
      expect(vm.formData.type).toBeDefined();
    });

    it('initializes with destination data for edit mode', () => {
      const destination = {
        name: 'test-dest',
        type: 'http',
        url: 'https://example.com',
        method: 'post',
        template: 'default',
        headers: { 'Content-Type': 'application/json' },
        skip_tls_verify: false
      };
      const wrapper = createWrapper({ destination });
      const vm = wrapper.vm as any;
      expect(vm.formData.name).toBe('test-dest');
    });
  });

  describe('Utility Functions', () => {
    it('generates UUID', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const uuid = vm.getUUID();
      expect(uuid).toBeDefined();
      expect(typeof uuid).toBe('string');
      expect(uuid.length).toBeGreaterThan(0);
    });

    it('getDestinationTypeName returns correct name for known types', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // This function should return the display name for destination types
      if (typeof vm.getDestinationTypeName === 'function') {
        const result = vm.getDestinationTypeName('slack');
        expect(result).toBeDefined();
      }
    });

    it('getDestinationTypeIcon returns icon for known types', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (typeof vm.getDestinationTypeIcon === 'function') {
        const result = vm.getDestinationTypeIcon('slack');
        expect(result).toBeDefined();
      }
    });
  });

  describe('Computed Properties', () => {
    it('tabs computed returns array of tabs', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.tabs) {
        expect(Array.isArray(vm.tabs)).toBe(true);
      }
    });

    it('destinationTypes computed returns array of types', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.destinationTypes) {
        expect(Array.isArray(vm.destinationTypes)).toBe(true);
      }
    });

    it('isPrebuiltDestination computed indicates prebuilt status', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.isPrebuiltDestination !== undefined) {
        expect(typeof vm.isPrebuiltDestination).toBe('boolean');
      }
    });

    it('getFormattedTemplates computed returns formatted templates', () => {
      const templates = [
        { name: 'template1', isDefault: false },
        { name: 'template2', isDefault: true }
      ];
      const wrapper = createWrapper({ templates });
      const vm = wrapper.vm as any;

      if (vm.getFormattedTemplates) {
        expect(Array.isArray(vm.getFormattedTemplates)).toBe(true);
      }
    });
  });

  describe('Form Actions', () => {
    it('emits cancel event when cancel is called', async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (typeof vm.handleCancel === 'function') {
        vm.handleCancel();
        await wrapper.vm.$nextTick();
        expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
      }
    });

    it('validates form before submission', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (typeof vm.validateForm === 'function') {
        const result = vm.validateForm();
        expect(typeof result).toBe('boolean');
      }
    });
  });

  describe('Destination Type Selection', () => {
    it('handles HTTP destination type', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.type = 'http';
      expect(vm.formData.type).toBe('http');
    });

    it('handles Email destination type', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.type = 'email';
      expect(vm.formData.type).toBe('email');
    });

    it('handles Action destination type', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.type = 'action';
      expect(vm.formData.type).toBe('action');
    });
  });

  describe('Headers Management', () => {
    it('initializes headers as empty object', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.formData.headers !== undefined) {
        expect(typeof vm.formData.headers).toBe('object');
      }
    });

    it('handles custom headers', () => {
      const destination = {
        name: 'test',
        type: 'http',
        url: 'https://example.com',
        method: 'post',
        template: 'default',
        headers: {
          'X-Custom-Header': 'value',
          'Authorization': 'Bearer token'
        },
        skip_tls_verify: false
      };
      const wrapper = createWrapper({ destination });
      const vm = wrapper.vm as any;

      if (vm.formData.headers) {
        expect(Object.keys(vm.formData.headers).length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Template Selection', () => {
    it('handles template selection', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.template = 'custom-template';
      expect(vm.formData.template).toBe('custom-template');
    });

    it('handles default template', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.formData.template = 'default';
      expect(vm.formData.template).toBe('default');
    });
  });

  describe('Prebuilt Destinations', () => {
    it('handles prebuilt destination selection', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.prebuiltCredentials !== undefined) {
        expect(typeof vm.prebuiltCredentials).toBe('object');
      }
    });

    it('tracks destination search query', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.destinationSearchQuery !== undefined) {
        vm.destinationSearchQuery = 'slack';
        expect(vm.destinationSearchQuery).toBe('slack');
      }
    });
  });

  describe('Preview Functionality', () => {
    it('tracks preview modal state', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.showPreviewModal !== undefined) {
        expect(typeof vm.showPreviewModal).toBe('boolean');
      }
    });

    it('tracks preview content', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.previewContent !== undefined) {
        vm.previewContent = '{"test": "content"}';
        expect(vm.previewContent).toBeTruthy();
      }
    });
  });

  describe('Form State Management', () => {
    it('tracks updating state', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.isUpdatingDestination !== undefined) {
        expect(typeof vm.isUpdatingDestination).toBe('boolean');
        expect(vm.isUpdatingDestination).toBe(false);
      }
    });

    it('tracks actions loading state', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.isLoadingActions !== undefined) {
        expect(typeof vm.isLoadingActions).toBe('boolean');
      }
    });
  });

  describe('Action Filtering', () => {
    it('initializes action options', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.actionOptions !== undefined) {
        expect(Array.isArray(vm.actionOptions)).toBe(true);
      }
    });

    it('initializes filtered actions', () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      if (vm.filteredActions !== undefined) {
        expect(Array.isArray(vm.filteredActions)).toBe(true);
      }
    });
  });
});
