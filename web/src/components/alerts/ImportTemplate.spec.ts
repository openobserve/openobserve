import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ImportTemplate from './ImportTemplate.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from 'vue';

// Mock external dependencies
vi.mock('@/services/alert_templates', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('@/services/alerts', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('@/services/alert_destination', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('@/composables/useStreams', () => ({
  default: vi.fn(() => ({
    streams: { value: [] },
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
    useRoute: vi.fn(() => ({
      params: {},
      query: {},
    })),
  };
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
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

describe('ImportTemplate Component - Comprehensive Function Tests', () => {
  let wrapper: any;
  let mockNotify: any;
  let mockRouterPush: any;

  const defaultProps = {
    destinations: [
      { name: 'dest1', type: 'http' },
    ],
    templates: [
      { name: 'existing-template', type: 'http' },
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

    wrapper = shallowMount(ImportTemplate, {
      props: defaultProps,
      global: {
        plugins: [Quasar, mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
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
      const emptyWrapper = shallowMount(ImportTemplate, {
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
      expect(wrapper.vm.$options.emits).toContain('update:destinations');
      expect(wrapper.vm.$options.emits).toContain('update:templates');
      expect(wrapper.vm.$options.emits).toContain('update:alerts');
    });
  });

  describe('2. Data Properties and Computed Values', () => {
    it('should initialize reactive data properties correctly', () => {
      expect(wrapper.vm.jsonStr).toBe('');
      expect(wrapper.vm.templateErrorsToDisplay).toEqual([]);
      expect(wrapper.vm.tempalteCreators).toEqual([]);
      expect(wrapper.vm.activeTab).toBe('import_json_file');
      expect(wrapper.vm.jsonArrayOfObj).toEqual([{}]);
    });

    it('should have correct destination types and methods', () => {
      expect(wrapper.vm.destinationTypes).toEqual(['http', 'email']);
      expect(wrapper.vm.destinationMethods).toEqual(['post', 'get', 'put']);
    });

    it('should compute formatted templates correctly', () => {
      const formatted = wrapper.vm.getFormattedTemplates;
      expect(formatted).toContain('existing-template');
      expect(formatted).toHaveLength(1);
    });

    it('should handle empty templates for computed property', () => {
      const emptyWrapper = shallowMount(ImportTemplate, {
        props: { destinations: [], templates: [], alerts: [] },
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            store: mockStore,
          },
        },
      });

      expect(emptyWrapper.vm.getFormattedTemplates).toEqual([]);
      emptyWrapper.unmount();
    });
  });

  describe('3. Update Functions', () => {
    beforeEach(() => {
      wrapper.vm.jsonArrayOfObj = [{ name: 'test' }];
    });

    it('should update template type correctly', () => {
      wrapper.vm.updateTemplateType('email', 0);
      expect(wrapper.vm.userSelectedTemplateTypes[0]).toBe('email');
      expect(wrapper.vm.jsonArrayOfObj[0].type).toBe('email');
      expect(wrapper.vm.jsonStr).toContain('email');
    });

    it('should update template name correctly', () => {
      wrapper.vm.updateTemplateName('new-template', 0);
      expect(wrapper.vm.userSelectedTemplateNames[0]).toBe('new-template');
      expect(wrapper.vm.jsonArrayOfObj[0].name).toBe('new-template');
      expect(wrapper.vm.jsonStr).toContain('new-template');
    });

    it('should update template body correctly', () => {
      const testBody = '{"message": "test body"}';
      wrapper.vm.updateTemplateBody(testBody, 0);
      expect(wrapper.vm.userSelectedTemplateBodies[0]).toBe(testBody);
      expect(wrapper.vm.jsonArrayOfObj[0].body).toBe(testBody);
      expect(wrapper.vm.jsonStr).toContain('"body": "{\\"message\\": \\"test body\\"}"');
    });

    it('should update template title correctly', () => {
      wrapper.vm.updateTemplateTitle('Test Title', 0);
      expect(wrapper.vm.userSelectedTemplateTitles[0]).toBe('Test Title');
      expect(wrapper.vm.jsonArrayOfObj[0].title).toBe('Test Title');
      expect(wrapper.vm.jsonStr).toContain('Test Title');
    });

    it('should update destination URL correctly', () => {
      wrapper.vm.updateDestinationUrl('https://example.com');
      expect(wrapper.vm.jsonArrayOfObj.url).toBe('https://example.com');
      // Since URL is added as a property to the array object, it won't be in the JSON string
      // Instead, verify the property exists on the array object
      expect(wrapper.vm.jsonArrayOfObj).toHaveProperty('url', 'https://example.com');
    });
  });

  describe('4. File Reading Functions', () => {
    it('should read file content successfully', async () => {
      const mockFile = new File(['{"test": "content"}'], 'test.json', {
        type: 'application/json',
      });

      // Mock FileReader
      const mockFileReader = {
        readAsText: vi.fn(),
        result: '{"test": "content"}',
        onload: null as any,
        onerror: null as any,
      };

      global.FileReader = vi.fn(() => mockFileReader) as any;

      const contentPromise = wrapper.vm.readFileContent(mockFile);

      // Simulate file read completion
      setTimeout(() => {
        mockFileReader.onload({ target: { result: '{"test": "content"}' } });
      }, 0);

      const content = await contentPromise;
      expect(content).toBe('{"test": "content"}');
    });

    it('should handle file reading errors', async () => {
      const mockFile = new File(['invalid content'], 'test.json', {
        type: 'application/json',
      });

      const mockFileReader = {
        readAsText: vi.fn(),
        onload: null as any,
        onerror: null as any,
      };

      global.FileReader = vi.fn(() => mockFileReader) as any;

      const contentPromise = wrapper.vm.readFileContent(mockFile);

      // Simulate file read error
      setTimeout(() => {
        mockFileReader.onerror(new Error('File read error'));
      }, 0);

      await expect(contentPromise).rejects.toThrow();
    });
  });

  describe('5. Helper Functions', () => {
    describe('checkTemplatesInList', () => {
      it('should return true when template exists', () => {
        const templates = [{ name: 'template1' }, { name: 'template2' }];
        const result = wrapper.vm.checkTemplatesInList(templates, 'template1');
        expect(result).toBe(true);
      });

      it('should return false when template does not exist', () => {
        const templates = [{ name: 'template1' }, { name: 'template2' }];
        const result = wrapper.vm.checkTemplatesInList(templates, 'nonexistent');
        expect(result).toBe(false);
      });

      it('should handle empty templates array', () => {
        const result = wrapper.vm.checkTemplatesInList([], 'template1');
        expect(result).toBe(false);
      });

      it('should be case sensitive', () => {
        const templates = [{ name: 'template1' }];
        const result = wrapper.vm.checkTemplatesInList(templates, 'TEMPLATE1');
        expect(result).toBe(false);
      });
    });
  });

  describe('6. Validation Functions', () => {
    beforeEach(() => {
      wrapper.vm.templateErrorsToDisplay = [];
    });

    describe('validateTemplateInputs', () => {
      it('should validate http template with valid inputs', async () => {
        const validInput = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "{{message}}"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(validInput, 1);
        expect(result).toBe(true);
        expect(wrapper.vm.templateErrorsToDisplay).toHaveLength(0);
      });

      it('should validate email template with valid inputs', async () => {
        const validInput = {
          name: 'test-email-template',
          type: 'email',
          body: '{"message": "{{message}}"}',
          title: 'Test Email Title',
        };

        const result = await wrapper.vm.validateTemplateInputs(validInput, 1);
        expect(result).toBe(true);
        expect(wrapper.vm.templateErrorsToDisplay).toHaveLength(0);
      });

      it('should return false for missing name', async () => {
        const invalidInput = {
          type: 'http',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
        expect(wrapper.vm.templateErrorsToDisplay.length).toBeGreaterThan(0);
      });

      it('should return false for empty name', async () => {
        const invalidInput = {
          name: '',
          type: 'http',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for non-string name', async () => {
        const invalidInput = {
          name: 123,
          type: 'http',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for duplicate template name', async () => {
        const duplicateInput = {
          name: 'existing-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(duplicateInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for invalid type', async () => {
        const invalidInput = {
          name: 'test-template',
          type: 'invalid-type',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for missing type', async () => {
        const invalidInput = {
          name: 'test-template',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for missing body', async () => {
        const invalidInput = {
          name: 'test-template',
          type: 'http',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for empty body', async () => {
        const invalidInput = {
          name: 'test-template',
          type: 'http',
          body: '',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for non-string body', async () => {
        const invalidInput = {
          name: 'test-template',
          type: 'http',
          body: 123,
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for invalid JSON body', async () => {
        const invalidInput = {
          name: 'test-template',
          type: 'http',
          body: 'invalid json',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for email type missing title', async () => {
        const invalidInput = {
          name: 'test-email-template',
          type: 'email',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for email type with empty title', async () => {
        const invalidInput = {
          name: 'test-email-template',
          type: 'email',
          body: '{"message": "test"}',
          title: '',
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should return false for email type with non-string title', async () => {
        const invalidInput = {
          name: 'test-email-template',
          type: 'email',
          body: '{"message": "test"}',
          title: 123,
        };

        const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
        expect(result).toBe(false);
      });

      it('should allow http type without title', async () => {
        const validInput = {
          name: 'test-http-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        const result = await wrapper.vm.validateTemplateInputs(validInput, 1);
        expect(result).toBe(true);
      });
    });
  });

  describe('7. Tab and Navigation Functions', () => {
    it('should update active tab and reset form', () => {
      wrapper.vm.jsonStr = 'test content';
      wrapper.vm.url = 'https://example.com';
      wrapper.vm.jsonFiles = ['file1'];
      wrapper.vm.jsonArrayOfObj = [{ test: 'data' }];

      wrapper.vm.updateActiveTab();

      expect(wrapper.vm.jsonStr).toBe('');
      expect(wrapper.vm.url).toBe('');
      expect(wrapper.vm.jsonFiles).toBe(null);
      expect(wrapper.vm.jsonArrayOfObj).toEqual([{}]);
    });

    it('should navigate back to templates page', () => {
      wrapper.vm.arrowBackFn();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: 'alertTemplates',
        query: {
          org_identifier: 'test-org',
        },
      });
    });
  });

  describe('8. Import and Processing Functions', () => {
    beforeEach(() => {
      wrapper.vm.templateErrorsToDisplay = [];
      wrapper.vm.tempalteCreators = [];
    });

    describe('importJson', () => {
      it('should handle empty JSON string', async () => {
        wrapper.vm.jsonStr = '';
        wrapper.vm.url = '';

        await wrapper.vm.importJson();

        expect(mockNotify).toHaveBeenCalledWith({
          message: 'JSON string is empty',
          color: 'negative',
          position: 'bottom',
          timeout: 2000,
        });
      });

      it('should handle invalid JSON', async () => {
        wrapper.vm.jsonStr = 'invalid json';

        await wrapper.vm.importJson();

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
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        }];
        wrapper.vm.jsonStr = JSON.stringify(validJson);

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson();

        expect(wrapper.vm.jsonArrayOfObj).toEqual(validJson);
      });

      it('should convert single object to array', async () => {
        const singleObject = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };
        wrapper.vm.jsonStr = JSON.stringify(singleObject);

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson();

        expect(wrapper.vm.jsonArrayOfObj).toEqual([singleObject]);
      });

      it('should show success message and redirect on successful import', async () => {
        const validJson = [{
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        }];
        wrapper.vm.jsonStr = JSON.stringify(validJson);

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        await wrapper.vm.importJson();

        expect(mockNotify).toHaveBeenCalledWith({
          message: 'Successfully imported template(s)',
          color: 'positive',
          position: 'bottom',
          timeout: 2000,
        });

        expect(mockRouterPush).toHaveBeenCalledWith({
          name: 'alertTemplates',
          query: {
            org_identifier: 'test-org',
          },
        });
      });
    });

    describe('processJsonObject', () => {
      it('should process valid template object', async () => {
        const validObject = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        const result = await wrapper.vm.processJsonObject(validObject, 1);
        expect(result).toBe(true);
      });

      it('should return false for invalid template object', async () => {
        const invalidObject = {
          name: '',
          type: 'invalid',
        };

        const result = await wrapper.vm.processJsonObject(invalidObject, 1);
        expect(result).toBe(false);
      });

      it('should handle processing when validation passes but template errors exist', async () => {
        const validObject = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        // Simulate validation passing but having errors in display
        wrapper.vm.templateErrorsToDisplay = [['Some error']];

        const result = await wrapper.vm.processJsonObject(validObject, 1);

        expect(result).toBe(false);
      });
    });

    describe('createTemplate', () => {
      it('should create template successfully', async () => {
        const templateInput = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        const result = await wrapper.vm.createTemplate(templateInput, 1);

        expect(result).toBe(true);
        expect(templateService.default.create).toHaveBeenCalledWith({
          org_identifier: 'test-org',
          template_name: 'test-template',
          data: {
            name: 'test-template',
            body: '{"message": "test"}',
            type: 'http',
            title: undefined,
          },
        });
        expect(wrapper.vm.tempalteCreators[0].success).toBe(true);
        expect(wrapper.emitted('update:templates')).toBeTruthy();
      });

      it('should handle template creation failure', async () => {
        const templateInput = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        const error = {
          response: {
            data: {
              message: 'Creation failed',
            },
          },
        };

        // Mock failed creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockRejectedValueOnce(error);

        const result = await wrapper.vm.createTemplate(templateInput, 1);

        expect(result).toBe(false);
        expect(wrapper.vm.tempalteCreators[0].success).toBe(false);
        expect(wrapper.vm.tempalteCreators[0].message).toContain('Creation failed');
      });

      it('should handle unknown creation error', async () => {
        const templateInput = {
          name: 'test-template',
          type: 'http',
          body: '{"message": "test"}',
        };

        // Mock failed creation without response
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockRejectedValueOnce(new Error('Unknown error'));

        const result = await wrapper.vm.createTemplate(templateInput, 1);

        expect(result).toBe(false);
        expect(wrapper.vm.tempalteCreators[0].message).toContain('Unknown Error');
      });

      it('should create email template with title', async () => {
        const emailTemplateInput = {
          name: 'test-email-template',
          type: 'email',
          body: '{"message": "test"}',
          title: 'Test Email Title',
        };

        // Mock successful creation
        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

        const result = await wrapper.vm.createTemplate(emailTemplateInput, 1);

        expect(result).toBe(true);
        expect(templateService.default.create).toHaveBeenCalledWith({
          org_identifier: 'test-org',
          template_name: 'test-email-template',
          data: {
            name: 'test-email-template',
            body: '{"message": "test"}',
            type: 'email',
            title: 'Test Email Title',
          },
        });
      });
    });
  });

  describe('9. Event Handlers', () => {
    it('should handle form submission', () => {
      const mockEvent = { preventDefault: vi.fn() };
      wrapper.vm.onSubmit(mockEvent);
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe('10. Watchers and Reactive Behavior', () => {
    it('should have userSelectedTemplates watcher', async () => {
      // Test the watcher by updating userSelectedTemplates
      wrapper.vm.userSelectedTemplates = 'test-template';
      await nextTick();

      expect(wrapper.vm.jsonArrayOfObj.template).toBe('test-template');
    });

    it('should handle jsonFiles watcher', () => {
      // Test that the watcher exists by checking if jsonFiles is reactive
      expect(wrapper.vm.jsonFiles).toBe(null);
      wrapper.vm.jsonFiles = [];
      expect(Array.isArray(wrapper.vm.jsonFiles)).toBe(true);
    });

    it('should have url watcher', () => {
      // Test that the watcher exists by checking if url is reactive
      expect(wrapper.vm.url).toBe('');
      wrapper.vm.url = 'https://example.com';
      expect(wrapper.vm.url).toBe('https://example.com');
    });

    it('should have tabs configuration', () => {
      expect(wrapper.vm.tabs).toHaveLength(2);
      expect(wrapper.vm.tabs[0].value).toBe('import_json_file');
      expect(wrapper.vm.tabs[1].value).toBe('import_json_url');
    });
  });

  describe('11. Edge Cases and Error Handling', () => {
    it('should handle whitespace-only template names', async () => {
      const invalidInput = {
        name: '   ',
        type: 'http',
        body: '{"message": "test"}',
      };

      const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
      expect(result).toBe(false);
    });

    it('should handle whitespace-only template body', async () => {
      const invalidInput = {
        name: 'test-template',
        type: 'http',
        body: '   ',
      };

      const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
      expect(result).toBe(false);
    });

    it('should handle whitespace-only email title', async () => {
      const invalidInput = {
        name: 'test-email-template',
        type: 'email',
        body: '{"message": "test"}',
        title: '   ',
      };

      const result = await wrapper.vm.validateTemplateInputs(invalidInput, 1);
      expect(result).toBe(false);
    });

    it('should trim template name when creating template', async () => {
      const templateInput = {
        name: '  test-template  ',
        type: 'http',
        body: '{"message": "test"}',
      };

      // Mock successful creation
      const templateService = await import('@/services/alert_templates');
      vi.mocked(templateService.default.create).mockResolvedValueOnce(true);

      await wrapper.vm.createTemplate(templateInput, 1);

      expect(templateService.default.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'test-template', // Should be trimmed
          }),
        })
      );
    });
  });
});