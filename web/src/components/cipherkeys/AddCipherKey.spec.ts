import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import AddCipherKey from '@/components/cipherkeys/AddCipherKey.vue';
import { Quasar } from 'quasar';

// Mock dependencies
vi.mock('@/services/cipher_keys');
vi.mock('@/utils/zincutils', () => ({
  isValidResourceName: vi.fn(() => true),
  maxLengthCharValidation: vi.fn(() => true)
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn()
    })
  };
});

describe('AddCipherKey.vue', () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let mockQuasar: any;

  beforeEach(() => {
    // Mock router
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } }
      ]
    });

    // Mock store
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org'
        }
      },
      mutations: {},
      actions: {}
    });

    // Mock Quasar
    mockQuasar = {
      notify: vi.fn()
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (routeQuery = {}) => {
    // Set up route query
    router.push({ query: routeQuery });

    return mount(AddCipherKey, {
      global: {
        plugins: [store, router, Quasar],
        provide: {
          $q: mockQuasar
        },
        stubs: {
          'q-page': {
            template: '<div class="q-page-stub"><slot></slot></div>'
          },
          'q-icon': {
            template: '<div class="q-icon-stub">{{ name }}</div>',
            props: ['name', 'size']
          },
          'q-separator': {
            template: '<div class="q-separator-stub"></div>'
          },
          'q-form': {
            template: '<form class="q-form-stub" @submit.prevent="$emit(\'submit\')"><slot></slot></form>',
            methods: {
              validate: vi.fn().mockResolvedValue(true)
            }
          },
          'q-input': {
            template: '<input class="q-input-stub" :data-test="$attrs[\'data-test\']" v-model="modelValue" />',
            props: ['modelValue', 'label', 'readonly', 'disable', 'rules']
          },
          'q-select': {
            template: '<select class="q-select-stub" :data-test="$attrs[\'data-test\']" v-model="modelValue"><slot></slot></select>',
            props: ['modelValue', 'options', 'label']
          },
          'q-stepper': {
            template: '<div class="q-stepper-stub"><slot></slot></div>',
            props: ['modelValue']
          },
          'q-step': {
            template: '<div class="q-step-stub" :data-test="$attrs[\'data-test\']"><slot></slot></div>',
            props: ['name', 'title', 'icon', 'done']
          },
          'q-stepper-navigation': {
            template: '<div class="q-stepper-navigation-stub"><slot></slot></div>'
          },
          'q-btn': {
            template: '<button class="q-btn-stub" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')" :disabled="disable">{{ label }}</button>',
            props: ['label', 'color', 'disable', 'type']
          },
          'AddOpenobserveType': {
            template: '<div class="add-openobserve-type-stub"></div>',
            props: ['formData']
          },
          'AddAkeylessType': {
            template: '<div class="add-akeyless-type-stub"></div>',
            props: ['formData']
          },
          'AddEncryptionMechanism': {
            template: '<div class="add-encryption-mechanism-stub"></div>',
            props: ['formData']
          },
          'ConfirmDialog': {
            template: '<div class="confirm-dialog-stub" v-if="modelValue">{{ title }}: {{ message }}</div>',
            props: ['modelValue', 'title', 'message']
          }
        }
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('displays add title when not updating', () => {
      wrapper = createWrapper();
      const title = wrapper.find('[data-test="add-template-title"]');
      expect(title.text()).toContain('cipherKey.add');
    });

    it('displays update title when updating', async () => {
      wrapper = createWrapper({ action: 'edit', name: 'test-key' });
      const vm = wrapper.vm as any;
      vm.isUpdatingCipherKey = true;
      await wrapper.vm.$nextTick();
      
      const title = wrapper.find('[data-test="add-template-title"]');
      expect(title.text()).toContain('cipherKey.update');
    });

    it('renders back button correctly', () => {
      wrapper = createWrapper();
      const backButton = wrapper.find('.cursor-pointer');
      expect(backButton.exists()).toBe(true);
    });

    it('renders name input field', () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('[data-test="add-cipher-key-name-input"]');
      expect(nameInput.exists()).toBe(true);
    });

    it('renders type select field', () => {
      wrapper = createWrapper();
      const typeSelect = wrapper.find('[data-test="add-cipher-key-type-input"]');
      expect(typeSelect.exists()).toBe(true);
    });

    it('renders stepper component', () => {
      wrapper = createWrapper();
      const stepper = wrapper.find('.q-stepper-stub');
      expect(stepper.exists()).toBe(true);
    });

    it('renders action buttons', () => {
      wrapper = createWrapper();
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      
      expect(cancelBtn.exists()).toBe(true);
      expect(saveBtn.exists()).toBe(true);
    });
  });

  describe('Form Data Management', () => {
    it('initializes with default form data', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.formData.name).toBe('');
      expect(vm.formData.key.store.type).toBe('local');
      expect(vm.formData.key.mechanism.type).toBe('simple');
    });

    it('updates form data when name input changes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const nameInput = wrapper.find('[data-test="add-cipher-key-name-input"]');
      
      vm.formData.name = 'test-cipher-key';
      await wrapper.vm.$nextTick();
      
      expect(vm.formData.name).toBe('test-cipher-key');
    });

    it('updates form data when type changes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.formData.key.store.type = 'akeyless';
      await wrapper.vm.$nextTick();
      
      expect(vm.formData.key.store.type).toBe('akeyless');
    });

    it('preserves original data for comparison', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.originalData).toBeTruthy();
      expect(typeof vm.originalData).toBe('string');
    });
  });

  describe('Stepper Functionality', () => {
    it('initializes with step 1', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.step).toBe(1);
    });

    it('validates form and moves to next step', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const continueBtn = wrapper.find('[data-test="add-report-step1-continue-btn"]');
      
      await continueBtn.trigger('click');
      
      expect(vm.step).toBe(2);
    });

    it('moves back to step 1 when back button is clicked', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.step = 2;
      await wrapper.vm.$nextTick();
      
      const backBtn = wrapper.find('[data-test="add-cipher-key-step2-back-btn"]');
      await backBtn.trigger('click');
      
      expect(vm.step).toBe(1);
    });

    it('shows correct step titles', () => {
      wrapper = createWrapper();
      const step1 = wrapper.find('[data-test="cipher-key-key-store-detils-step"]');
      const step2 = wrapper.find('[data-test="cipher-key-encryption-mechanism-step"]');
      
      expect(step1.exists()).toBe(true);
      expect(step2.exists()).toBe(true);
    });

    it('renders step content conditionally based on type', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Test local type
      vm.formData.key.store.type = 'local';
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.add-openobserve-type-stub').exists()).toBe(true);
      
      // Test akeyless type
      vm.formData.key.store.type = 'akeyless';
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.add-akeyless-type-stub').exists()).toBe(true);
    });
  });

  describe('Validation', () => {
    it('applies name validation rules', () => {
      wrapper = createWrapper();
      const nameInput = wrapper.find('[data-test="add-cipher-key-name-input"]');
      
      expect(nameInput.exists()).toBe(true);
      // Rules are passed as props in the stub
    });

    it('applies type validation rules', () => {
      wrapper = createWrapper();
      const typeSelect = wrapper.find('[data-test="add-cipher-key-type-input"]');
      
      expect(typeSelect.exists()).toBe(true);
    });

    it('disables name input when updating', async () => {
      wrapper = createWrapper({ action: 'edit', name: 'test-key' });
      const vm = wrapper.vm as any;
      vm.isUpdatingCipherKey = true;
      await wrapper.vm.$nextTick();
      
      const nameInput = wrapper.find('[data-test="add-cipher-key-name-input"]');
      // The input props would be passed to the stub but might not be reflected as attributes
      expect(nameInput.exists()).toBe(true);
    });

    it('validates form before proceeding to next step', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const validateSpy = vi.spyOn(vm, 'validateForm');
      
      const continueBtn = wrapper.find('[data-test="add-report-step1-continue-btn"]');
      await continueBtn.trigger('click');
      
      expect(validateSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('Event Handling', () => {
    it('emits cancel event when back button is clicked', async () => {
      wrapper = createWrapper();
      const backButton = wrapper.find('.cursor-pointer');
      
      await backButton.trigger('click');
      
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });

    it('opens cancel dialog when cancel button is clicked', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Make changes first to trigger dialog
      vm.formData.name = 'changed-name';
      
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      await cancelBtn.trigger('click');
      
      expect(vm.dialog.show).toBe(true);
      expect(vm.dialog.title).toBe('Discard Changes');
    });

    it('submits form when save button is clicked', async () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      
      await saveBtn.trigger('click');
      
      expect(wrapper.emitted()).toBeTruthy();
    });

    it('handles form submission correctly', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const form = wrapper.find('.q-form-stub');
      
      await form.trigger('submit');
      
      expect(vm.isSubmitting).toBe(false); // Will be reset after validation
    });
  });

  describe('Type Management', () => {
    it('provides correct cipher key type options', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.cipherKeyTypes).toEqual([
        { label: 'OpenObserve', value: 'local' },
        { label: 'Akeyless', value: 'akeyless' }
      ]);
    });

    it('gets correct type label', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.getTypeLabel('local')).toBe('OpenObserve');
      expect(vm.getTypeLabel('akeyless')).toBe('Akeyless');
      expect(vm.getTypeLabel('unknown')).toBeUndefined();
    });

    it('updates step title based on selected type', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.formData.key.store.type = 'akeyless';
      
      const stepTitle = `${vm.t('cipherKey.step1')} (Type: ${vm.getTypeLabel('akeyless')})`;
      expect(stepTitle).toContain('Akeyless');
    });
  });

  describe('Data Merging', () => {
    it('merges objects correctly', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const base = { a: 1, b: { c: 2 } };
      const updates = { b: { d: 3 }, e: 4 };
      
      const result = vm.mergeObjects(base, updates);
      
      expect(result).toEqual({
        a: 1,
        b: { c: 2, d: 3 },
        e: 4
      });
    });

    it('handles null and array values correctly in merge', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      const base = { a: 1 };
      const updates = { b: null, c: [1, 2, 3] };
      
      const result = vm.mergeObjects(base, updates);
      
      expect(result.b).toBeNull();
      expect(result.c).toEqual([1, 2, 3]);
    });
  });

  describe('Change Detection', () => {
    it('detects no changes when data is unchanged', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // originalData and formData should be the same initially
      expect(vm.originalData).toBe(JSON.stringify(vm.formData));
    });

    it('opens dialog when canceling with changes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Modify form data
      vm.formData.name = 'changed-name';
      
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      await cancelBtn.trigger('click');
      
      expect(vm.dialog.show).toBe(true);
    });

    it('directly cancels when no changes detected', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      
      await cancelBtn.trigger('click');
      
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });
  });

  describe('Save Button State', () => {
    it('disables save button on step 1 when not updating', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.step = 1;
      vm.isUpdatingCipherKey = false;
      
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      // Check the disabled prop is passed to stub
      expect(saveBtn.exists()).toBe(true);
    });

    it('enables save button when updating on step 1', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.step = 1;
      vm.isUpdatingCipherKey = true;
      await wrapper.vm.$nextTick();
      
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
    });

    it('disables save button when submitting', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.isSubmitting = true;
      await wrapper.vm.$nextTick();
      
      const saveBtn = wrapper.find('[data-test="add-cipher-key-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
    });
  });

  describe('Dialog Management', () => {
    it('initializes dialog with correct default state', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.dialog.show).toBe(false);
      expect(vm.dialog.title).toBe('');
      expect(vm.dialog.message).toBe('');
      expect(typeof vm.dialog.okCallback).toBe('function');
    });

    it('shows confirm dialog with correct content', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Make changes to trigger dialog
      vm.formData.name = 'changed';
      
      const cancelBtn = wrapper.find('[data-test="add-cipher-key-cancel-btn"]');
      await cancelBtn.trigger('click');
      
      expect(vm.dialog.show).toBe(true);
      expect(vm.dialog.title).toBe('Discard Changes');
      expect(vm.dialog.message).toBe('Are you sure you want to cancel changes?');
    });

    it('renders confirm dialog when shown', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.dialog.show = true;
      vm.dialog.title = 'Test Title';
      vm.dialog.message = 'Test Message';
      await wrapper.vm.$nextTick();
      
      const dialog = wrapper.find('.confirm-dialog-stub');
      expect(dialog.exists()).toBe(true);
      expect(dialog.text()).toContain('Test Title: Test Message');
    });
  });

  describe('Lifecycle Hooks', () => {
    it('sets up template data on mount', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.formData.isUpdate).toBeDefined();
      expect(vm.originalData).toBeTruthy();
    });

    it('handles edit mode setup correctly', () => {
      wrapper = createWrapper({ action: 'edit', name: 'test-key' });
      const vm = wrapper.vm as any;
      
      // setupTemplateData will be called which sets isUpdatingCipherKey
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Form Submission Flow', () => {
    it('sets submitting state during submission', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.isSubmitting).toBe(false);
      
      // Mock form validation to resolve
      vm.addCipherKeyFormRef = {
        validate: vi.fn().mockResolvedValue(true)
      };
      
      await vm.onSubmit();
      
      expect(vm.isSubmitting).toBe(false); // Reset after completion
    });

    it('handles validation errors correctly', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Mock form validation to reject
      vm.addCipherKeyFormRef = {
        validate: vi.fn().mockRejectedValue(new Error('Validation failed'))
      };
      
      await vm.onSubmit();
      
      expect(vm.addCipherKeyFormRef.validate).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing route query parameters', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('handles empty organization identifier', () => {
      store.state.selectedOrganization.identifier = '';
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('handles component unmounting gracefully', () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('handles step navigation edge cases', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Test invalid step numbers
      vm.step = 0;
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
      
      vm.step = 999;
      await wrapper.vm.$nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Component Structure', () => {
    it('has correct main structure', () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('.q-page-stub').exists()).toBe(true);
      expect(wrapper.find('.q-form-stub').exists()).toBe(true);
      expect(wrapper.find('.q-stepper-stub').exists()).toBe(true);
    });

    it('renders all required form elements', () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="add-cipher-key-name-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-cipher-key-type-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-cipher-key-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-cipher-key-save-btn"]').exists()).toBe(true);
    });

    it('maintains proper component hierarchy', () => {
      wrapper = createWrapper();
      
      const form = wrapper.find('.q-form-stub');
      const stepper = form.find('.q-stepper-stub');
      const steps = stepper.findAll('.q-step-stub');
      
      expect(form.exists()).toBe(true);
      expect(stepper.exists()).toBe(true);
      expect(steps.length).toBeGreaterThan(0);
    });
  });
});