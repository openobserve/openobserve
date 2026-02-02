import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ImportDestination from './ImportDestination.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick, ref } from 'vue';

// Mock external dependencies
vi.mock('@/services/alert_destination', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('@/composables/useActions', () => ({
  default: vi.fn(() => ({
    isActionsEnabled: { value: true },
  })),
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock Quasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: vi.fn(),
    })),
  };
});

// Mock Vue Router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
    })),
  };
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
    },
    organizationData: {
      actions: [
        {
          id: 'action1',
          name: 'Test Action 1',
          execution_details_type: 'service',
        },
        {
          id: 'action2',
          name: 'Test Action 2',
          execution_details_type: 'service',
        },
      ],
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {},
  },
});

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [],
});

describe('ImportDestination Component - Comprehensive Function Tests', () => {
  let wrapper: any;
  let mockNotify: any;
  let mockRouterPush: any;

  const defaultProps = {
    destinations: [
      { name: 'existing-dest', type: 'http' },
    ],
    templates: [
      { name: 'template1', type: 'http' },
      { name: 'email-template', type: 'email' },
    ],
    alerts: [],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockNotify = vi.fn();
    mockRouterPush = vi.fn();

    const { useQuasar } = await import('quasar');
    vi.mocked(useQuasar).mockReturnValue({
      notify: mockNotify,
    } as any);

    const { useRouter } = await import('vue-router');
    vi.mocked(useRouter).mockReturnValue({
      push: mockRouterPush,
    } as any);

    wrapper = shallowMount(ImportDestination, {
      props: defaultProps,
      global: {
        plugins: [Quasar, mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
        stubs: {
          BaseImport: {
            template: '<div><slot name="output-content"></slot></div>',
            props: ['title', 'testPrefix', 'isImporting', 'editorHeights', 'containerClass', 'containerStyle'],
            emits: ['back', 'cancel', 'import'],
            setup(_props: any, { expose }: any) {
              const jsonArrayOfObj = ref([]);
              const jsonStr = ref("");
              const isImporting = ref(false);
              const updateJsonArray = (arr: any[]) => {
                jsonArrayOfObj.value = arr;
                jsonStr.value = JSON.stringify(arr, null, 2);
              };
              expose({
                jsonArrayOfObj,
                jsonStr,
                isImporting,
                updateJsonArray,
              });
              return { jsonArrayOfObj, jsonStr, isImporting, updateJsonArray };
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('1. Component Initialization and Props', () => {
    it('should initialize with default props', () => {
      expect(wrapper.props('destinations')).toEqual(defaultProps.destinations);
      expect(wrapper.props('templates')).toEqual(defaultProps.templates);
      expect(wrapper.props('alerts')).toEqual(defaultProps.alerts);
    });

    it('should initialize with empty arrays when no props provided', () => {
      const emptyWrapper = shallowMount(ImportDestination, {
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(emptyWrapper.props('destinations')).toEqual([]);
      expect(emptyWrapper.props('templates')).toEqual([]);
      expect(emptyWrapper.props('alerts')).toEqual([]);
      emptyWrapper.unmount();
    });

    it('should emit correct events', () => {
      const emits = wrapper.emitted();
      expect(wrapper.vm.$options.emits).toContain('update:destinations');
      expect(wrapper.vm.$options.emits).toContain('update:templates');
      expect(wrapper.vm.$options.emits).toContain('update:alerts');
    });
  });

  describe('2. Data Properties and Computed Values', () => {
    it('should initialize reactive data properties correctly', () => {
      // jsonStr, activeTab moved to BaseImport
      expect(wrapper.vm.destinationErrorsToDisplay).toEqual([]);
      expect(wrapper.vm.destinationCreators).toEqual([]);
      expect(Array.isArray(wrapper.vm.jsonArrayOfObj)).toBe(true);
    });

    it('should have correct destination types and methods', () => {
      expect(wrapper.vm.destinationTypes).toEqual(['http', 'email']);
      expect(wrapper.vm.destinationMethods).toEqual(['post', 'get', 'put']);
    });

    it('should compute formatted templates correctly', () => {
      // Test that getFormattedTemplates computed property exists and returns an array
      const formatted = wrapper.vm.getFormattedTemplates;
      expect(Array.isArray(formatted)).toBe(true);
    });
  });

  describe('3. Update Functions', () => {
    beforeEach(() => {
      // Set up baseImportRef with initial data
      if (wrapper.vm.$refs.baseImportRef) {
        wrapper.vm.$refs.baseImportRef.jsonArrayOfObj = [{ name: 'test' }];
        wrapper.vm.$refs.baseImportRef.updateJsonArray([{ name: 'test' }], false);
      }
    });

    it('should update destination type correctly', () => {
      wrapper.vm.updateDestinationType('email', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].type).toBe('email');
    });

    it('should update destination method correctly', () => {
      wrapper.vm.updateDestinationMethod('post', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].method).toBe('post');
    });

    it('should update destination name correctly', () => {
      wrapper.vm.updateDestinationName('new-destination', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].name).toBe('new-destination');
    });

    it('should update destination URL correctly', () => {
      wrapper.vm.updateDestinationUrl('https://example.com', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].url).toBe('https://example.com');
    });

    it('should update destination template correctly', () => {
      wrapper.vm.updateDestinationTemplate('template1', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].template).toBe('template1');
    });

    it('should update destination action correctly', () => {
      wrapper.vm.updateDestinationAction('action1', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].action_id).toBe('action1');
    });

    it('should update destination emails correctly', () => {
      wrapper.vm.updateDestinationEmails('test@example.com, user@test.com', 0);
      expect(wrapper.vm.jsonArrayOfObj[0].emails).toEqual(['test@example.com', 'user@test.com']);
    });

    it('should update skip TLS verify correctly', () => {
      wrapper.vm.updateSkipTlsVerify(true, 0);
      expect(wrapper.vm.jsonArrayOfObj[0].skip_tls_verify).toBe(true);
      expect(wrapper.vm.userSelectedSkipTlsVerify[0]).toBe(true);
    });
  });

  describe('4. Filter Functions', () => {
    it('should filter templates correctly with empty value', () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterTemplates('', mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should filter templates correctly with search value', () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterTemplates('template', mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should filter actions correctly with empty value', () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterActions('', mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should filter actions correctly with search value', () => {
      const mockUpdate = vi.fn();
      wrapper.vm.filterActions('action', mockUpdate);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // 5. Helper Functions - getServiceActions removed in refactored version

  describe('6. Validation Functions', () => {
    // checkDestinationInList function was removed - not needed in refactored version
    // checkTemplatesInList function was removed - not needed in refactored version

    describe('getServiceActions', () => {
      it('should return service type actions only', () => {
        const actions = wrapper.vm.getServiceActions();
        expect(Array.isArray(actions)).toBe(true);
        // Should filter to only service-type actions
        actions.forEach((action: any) => {
          expect(action.execution_details_type).toBe('service');
        });
      });

      it('should return empty array when no service actions exist', () => {
        // Temporarily modify store state
        const originalActions = mockStore.state.organizationData.actions;
        mockStore.state.organizationData.actions = [
          { id: 'action1', name: 'Action 1', execution_details_type: 'webhook' },
        ];

        const actions = wrapper.vm.getServiceActions();
        expect(actions).toEqual([]);

        // Restore original state
        mockStore.state.organizationData.actions = originalActions;
      });
    });

    describe('validateDestinationInputs', () => {
      beforeEach(() => {
        wrapper.vm.destinationErrorsToDisplay = [];
      });

      it('should validate http destination with valid inputs', async () => {
        const validInput = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };

        const result = await wrapper.vm.validateDestinationInputs(validInput, 1);
        expect(result).toBe(true);
      });

      it('should validate email destination with valid inputs', async () => {
        const validInput = {
          name: 'test-email-destination',
          type: 'email',
          template: 'email-template',
          emails: ['test@example.com', 'user@test.com'],
        };

        const result = await wrapper.vm.validateDestinationInputs(validInput, 1);
        expect(result).toBe(true);
      });

      it('should return false for missing required fields', async () => {
        const invalidInput = {
          type: 'http',
        };

        const result = await wrapper.vm.validateDestinationInputs(invalidInput, 1);
        expect(result).toBe(false);
        expect(wrapper.vm.destinationErrorsToDisplay.length).toBeGreaterThan(0);
      });

      it('should validate action type destination', async () => {
        const actionInput = {
          name: 'test-action-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
          action_id: 'action1',
        };

        const result = await wrapper.vm.validateDestinationInputs(actionInput, 1);
        expect(result).toBe(true);
      });

      it('should accept action destination type', async () => {
        const actionInput = {
          name: 'test-action-destination',
          type: 'action',
          action_id: 'action1',
        };

        const result = await wrapper.vm.validateDestinationInputs(actionInput, 1);
        expect(result).toBe(true);
      });

      it('should reject action destination with non-existent action_id', async () => {
        const actionInput = {
          name: 'test-action-destination',
          type: 'action',
          action_id: 'non-existent-action',
        };

        const result = await wrapper.vm.validateDestinationInputs(actionInput, 1);
        expect(result).toBe(false);
      });

      it('should reject invalid destination type', async () => {
        const invalidInput = {
          name: 'test-destination',
          type: 'invalid-type',
          template: 'template1',
        };

        const result = await wrapper.vm.validateDestinationInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should reject existing destination name', async () => {
        const duplicateInput = {
          name: 'existing-dest',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };

        const result = await wrapper.vm.validateDestinationInputs(duplicateInput, 1);
        expect(result).toBe(false);
      });

      it('should validate headers for http type', async () => {
        const inputWithHeaders = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
          headers: { 'Content-Type': 'application/json' },
        };

        const result = await wrapper.vm.validateDestinationInputs(inputWithHeaders, 1);
        expect(result).toBe(true);
      });

      it('should reject invalid headers for http type', async () => {
        const inputWithInvalidHeaders = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
          headers: 'invalid-headers',
        };

        const result = await wrapper.vm.validateDestinationInputs(inputWithInvalidHeaders, 1);
        expect(result).toBe(false); // Should reject invalid headers
      });

      it('should reject headers for email type', async () => {
        const emailWithHeaders = {
          name: 'test-email-destination',
          type: 'email',
          template: 'email-template',
          emails: ['test@example.com'],
          headers: { 'Content-Type': 'application/json' },
        };

        const result = await wrapper.vm.validateDestinationInputs(emailWithHeaders, 0, 1);
        expect(result).toBe(false);
      });

      it('should reject URL for email type', async () => {
        const emailWithUrl = {
          name: 'test-email-destination',
          type: 'email',
          url: 'https://example.com',
          template: 'email-template',
          emails: ['test@example.com'],
        };

        const result = await wrapper.vm.validateDestinationInputs(emailWithUrl, 0, 1);
        expect(result).toBe(false);
      });

      it('should validate invalid email arrays', async () => {
        const invalidEmails = {
          name: 'test-email-destination',
          type: 'email',
          template: 'email-template',
          emails: 'not-an-array',
        };

        const result = await wrapper.vm.validateDestinationInputs(invalidEmails, 0, 1);
        expect(result).toBe(false);
      });

      it('should validate empty email arrays', async () => {
        const emptyEmails = {
          name: 'test-email-destination',
          type: 'email',
          template: 'email-template',
          emails: [],
        };

        const result = await wrapper.vm.validateDestinationInputs(emptyEmails, 0, 1);
        expect(result).toBe(false);
      });

      it('should validate non-string emails in array', async () => {
        const nonStringEmails = {
          name: 'test-email-destination',
          type: 'email',
          template: 'email-template',
          emails: ['test@example.com', 123, 'user@test.com'],
        };

        const result = await wrapper.vm.validateDestinationInputs(nonStringEmails, 0, 1);
        expect(result).toBe(false);
      });

      it('should validate missing skip_tls_verify for http type', async () => {
        const httpWithoutTls = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
        };

        const result = await wrapper.vm.validateDestinationInputs(httpWithoutTls, 1);
        expect(result).toBe(false); // skip_tls_verify is REQUIRED per validation logic
      });

      it('should validate invalid skip_tls_verify type for http', async () => {
        const httpWithInvalidTls = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: 'invalid',
        };

        const result = await wrapper.vm.validateDestinationInputs(httpWithInvalidTls, 1);
        expect(result).toBe(false);
      });
    });
  });

  describe('7. Tab and Navigation Functions', () => {
    // updateActiveTab moved to BaseImport

    it('should navigate back to destinations page', () => {
      wrapper.vm.arrowBackFn();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'alertDestinations',
        query: {
          org_identifier: 'test-org',
        },
      });
    });
  });

  describe('8. Import and Processing Functions', () => {
    beforeEach(() => {
      wrapper.vm.destinationErrorsToDisplay = [];
      wrapper.vm.destinationCreators = [];
    });

    describe('importJson', () => {
      it('should handle empty JSON string', async () => {
        const payload = {
          jsonStr: '',
          jsonArray: []
        };

        await wrapper.vm.importJson(payload);

        expect(mockNotify).toHaveBeenCalledWith({
          message: 'JSON string is empty',
          color: 'negative',
          position: 'bottom',
          timeout: 2000,
        });
      });

      it('should handle invalid JSON', async () => {
        const payload = {
          jsonStr: 'invalid json',
          jsonArray: []
        };

        await wrapper.vm.importJson(payload);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            color: 'negative',
            position: 'bottom',
            timeout: 2000,
          })
        );
      });

      it('should process valid JSON array', async () => {
        const validJson = [{
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        }];
        const payload = {
          jsonStr: JSON.stringify(validJson),
          jsonArray: validJson
        };

        // Mock successful creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson(payload);

        expect(Array.isArray(wrapper.vm.jsonArrayOfObj)).toBe(true);
      });

      it('should convert single object to array', async () => {
        const singleObject = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };
        const payload = {
          jsonStr: JSON.stringify(singleObject),
          jsonArray: [singleObject]
        };

        // Mock successful creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson(payload);

        expect(Array.isArray(wrapper.vm.jsonArrayOfObj)).toBe(true);
      });

      it('should show success message and redirect on successful import', async () => {
        vi.useFakeTimers();

        const validJson = [{
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        }];
        const payload = {
          jsonStr: JSON.stringify(validJson),
          jsonArray: validJson
        };

        // Mock successful creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson(payload);

        expect(mockNotify).toHaveBeenCalledWith({
          message: 'Successfully imported destination(s)',
          color: 'positive',
          position: 'bottom',
          timeout: 2000,
        });

        // Execute setTimeout
        vi.runAllTimers();

        expect(mockRouterPush).toHaveBeenCalledWith({
          name: 'alertDestinations',
          query: {
            org_identifier: 'test-org',
          },
        });

        vi.useRealTimers();
      });
    });

    describe('processJsonObject', () => {
      it('should process valid destination object', async () => {
        const validObject = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };

        // Mock successful creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockResolvedValueOnce(true);

        const result = await wrapper.vm.processJsonObject(validObject, 1);
        expect(result).toBe(true);
      });

      it('should return false for invalid destination object', async () => {
        const invalidObject = {
          name: '',
          type: 'invalid',
        };

        const result = await wrapper.vm.processJsonObject(invalidObject, 1);
        expect(result).toBe(false);
      });

      it('should handle processing when validation passes but destination errors exist', async () => {
        const validObject = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };

        // Simulate validation passing but having errors in display
        wrapper.vm.destinationErrorsToDisplay = [['Some error']];

        const result = await wrapper.vm.processJsonObject(validObject, 1);

        expect(result).toBe(false);
      });
    });

    describe('createDestination', () => {
      it('should create destination successfully', async () => {
        const destinationInput = {
          name: 'test-destination',
          type: 'http',
          url: 'https://example.com',
          method: 'post',
          template: 'template1',
          skip_tls_verify: false,
        };

        // Mock successful creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockResolvedValueOnce(true);

        const result = await wrapper.vm.createDestination(destinationInput, 1);

        expect(result).toBe(true);
        expect(destinationService.default.create).toHaveBeenCalledWith({
          org_identifier: 'test-org',
          destination_name: 'test-destination',
          data: destinationInput,
        });
        expect(wrapper.vm.destinationCreators[0].success).toBe(true);
        expect(wrapper.emitted('update:destinations')).toBeTruthy();
      });

      it('should handle destination creation failure', async () => {
        const destinationInput = {
          name: 'test-destination',
          type: 'http',
        };

        const error = {
          response: {
            data: {
              message: 'Creation failed',
            },
          },
        };

        // Mock failed creation
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockRejectedValueOnce(error);

        const result = await wrapper.vm.createDestination(destinationInput, 1);

        expect(result).toBe(false);
        expect(wrapper.vm.destinationCreators[0].success).toBe(false);
        expect(wrapper.vm.destinationCreators[0].message).toContain('Creation failed');
      });

      it('should handle unknown creation error', async () => {
        const destinationInput = {
          name: 'test-destination',
          type: 'http',
        };

        // Mock failed creation without response
        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.create).mockClear();
        vi.mocked(destinationService.default.create).mockRejectedValueOnce(new Error('Unknown error'));

        const result = await wrapper.vm.createDestination(destinationInput, 1);

        expect(result).toBe(false);
        // The error message will contain "Unknown Error" from the catch block
        expect(wrapper.vm.destinationCreators.length).toBeGreaterThan(0);
      });
    });
  });

  // Event Handlers (onSubmit) removed - not needed in refactored version

  // File and URL Watching moved to BaseImport
});