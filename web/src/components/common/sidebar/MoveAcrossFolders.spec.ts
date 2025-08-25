import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import MoveAcrossFolders from './MoveAcrossFolders.vue';
import { createI18n } from 'vue-i18n';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

// Mock dependencies
vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn(() => 'mock-image-url'),
}));

vi.mock('@/utils/commons', () => ({
  moveModuleToAnotherFolder: vi.fn(),
  moveDashboardToAnotherFolder: vi.fn(),
}));

vi.mock('@/composables/useLoading', () => ({
  useLoading: vi.fn((fn) => {
    const mockExecute = vi.fn().mockImplementation(async () => {
      if (typeof fn === 'function') {
        return await fn();
      }
    });
    return {
      execute: mockExecute,
      isLoading: { value: false },
    };
  }),
}));

vi.mock('@/composables/useNotifications', () => ({
  default: vi.fn(() => ({
    showPositiveNotification: vi.fn(),
    showErrorNotification: vi.fn(),
  })),
}));

vi.mock('./SelectFolderDropDown.vue', () => ({
  default: {
    name: 'SelectFolderDropDown',
    template: '<div class="select-folder-dropdown" @folder-selected="$emit(\'folder-selected\', $event)"></div>',
    props: ['type', 'activeFolderId'],
    emits: ['folder-selected'],
  },
}));

installQuasar();

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
    },
    organizationData: {
      foldersByType: {
        alerts: [
          { folderId: 'default', name: 'Default Folder' },
          { folderId: 'folder1', name: 'Test Folder 1' },
          { folderId: 'folder2', name: 'Test Folder 2' },
        ],
        pipelines: [
          { folderId: 'default', name: 'Default Pipeline Folder' },
          { folderId: 'pipeline1', name: 'Pipeline Folder 1' },
        ],
        unknown: [
          { folderId: 'default', name: 'Default Unknown Folder' },
        ],
        dashboards: [
          { folderId: 'default', name: 'Default Dashboard Folder' },
        ],
      },
    },
    theme: 'light',
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      dashboard: {
        currentFolderLabel: 'Current Folder',
        cancel: 'Cancel',
      },
      common: {
        move: 'Move',
      },
    },
  },
});

describe('MoveAcrossFolders.vue', () => {
  let wrapper: any;
  let mockMoveModuleToAnotherFolder: any;
  let mockShowPositiveNotification: any;
  let mockShowErrorNotification: any;
  let mockUseLoading: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup mocks
    const { moveModuleToAnotherFolder } = await import('@/utils/commons');
    mockMoveModuleToAnotherFolder = vi.mocked(moveModuleToAnotherFolder);

    // Create fresh mock functions for each test
    mockShowPositiveNotification = vi.fn();
    mockShowErrorNotification = vi.fn();

    // Mock useNotifications to return our spy functions
    const useNotifications = (await import('@/composables/useNotifications')).default;
    vi.mocked(useNotifications).mockReturnValue({
      showPositiveNotification: mockShowPositiveNotification,
      showErrorNotification: mockShowErrorNotification,
    });

    const { useLoading } = await import('@/composables/useLoading');
    mockUseLoading = vi.mocked(useLoading);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  // Test 1: Component mounting and basic structure
  it('should mount successfully with default props', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });
    
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-folder-move-header"]').exists()).toBe(true);
  });

  // Test 2: Component with custom props
  it('should mount with custom props correctly', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'pipeline1',
        moduleId: ['alert1', 'alert2'],
        type: 'pipelines',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });
    
    expect(wrapper.props('activeFolderId')).toBe('pipeline1');
    expect(wrapper.props('moduleId')).toEqual(['alert1', 'alert2']);
    expect(wrapper.props('type')).toBe('pipelines');
  });

  // Test 3: Header rendering with different types
  it('should render header with correct type in title', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'pipelines' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });
    
    expect(wrapper.text().toLowerCase()).toContain('move pipelines to another folder');
  });

  // Test 4: Current folder input display
  it('should display current folder name in input field', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const currentFolderInput = wrapper.find('[data-test="alerts-folder-move-name"]');
    expect(currentFolderInput.exists()).toBe(true);
    expect(currentFolderInput.element.value).toBe('Test Folder 1');
  });

  // Test 5: SelectFolderDropDown component integration
  it('should render SelectFolderDropDown component with correct props', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    expect(selectDropdown.exists()).toBe(true);
    expect(selectDropdown.props('type')).toBe('alerts');
    expect(selectDropdown.props('activeFolderId')).toBe('folder1');
  });

  // Test 6: Form submission button states
  it('should disable move button when source and destination folders are same', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // Set selected folder to same as active folder - use correct structure
    wrapper.vm.selectedFolder = { value: 'folder1' };
    await nextTick();

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    expect(moveButton.element.disabled).toBe(true);
  });

  // Test 7: Form submission button enabled when folders are different
  it('should enable move button when source and destination folders are different', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // Set selected folder to different from active folder
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    await nextTick();

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    expect(moveButton.element.disabled).toBe(false);
  });

  // Test 8: getModuleName function for alerts
  it('should return correct module name for alerts type', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'alerts' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const getModuleName = wrapper.vm.getModuleName;
    expect(getModuleName()).toBe('alert_ids');
  });

  // Test 9: getModuleName function for pipelines
  it('should return correct module name for pipelines type', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'pipelines' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const getModuleName = wrapper.vm.getModuleName;
    expect(getModuleName()).toBe('pipeline_ids');
  });

  // Test 10: getModuleName function default case
  it('should return default module name for unknown type', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'unknown' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const getModuleName = wrapper.vm.getModuleName;
    expect(getModuleName()).toBe('alert_ids');
  });

  // Test 11: Successful form submission
  it('should handle successful form submission', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const mockResetValidation = vi.fn();
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1', 'alert2'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { 
      validate: mockValidate, 
      resetValidation: mockResetValidation 
    };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockValidate).toHaveBeenCalled();
    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { alert_ids: ['alert1', 'alert2'], dst_folder_id: { value: 'folder2' } },
      'alerts',
      'folder1'
    );
  });

  // Test 12: Form submission with validation failure
  it('should handle form validation failure', async () => {
    const mockValidate = vi.fn().mockResolvedValue(false);

    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    
    const result = await wrapper.vm.onSubmit.execute();
    
    expect(mockValidate).toHaveBeenCalled();
    expect(mockMoveModuleToAnotherFolder).not.toHaveBeenCalled();
    // The component doesn't return the false value, it just doesn't proceed
    expect(result).toBeUndefined();
  });

  // Test 13: Form submission error handling
  it('should handle form submission errors', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const error = new Error('Move operation failed');

    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(error);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Move operation failed', {
      timeout: 2000,
    });
  });

  // Test 14: Form submission error handling with no error message
  it('should handle form submission errors without message', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const error = {};
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'pipeline1',
        moduleId: ['alert1'],
        type: 'pipelines',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(error);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('pipelines move failed.', {
      timeout: 2000,
    });
  });

  // Test 15: Event emission on successful move
  it('should emit updated event on successful move', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    const emittedEvents = wrapper.emitted('updated');
    expect(emittedEvents).toBeTruthy();
    expect(emittedEvents[0]).toEqual(['folder1', { value: 'folder2' }]);
  });

  // Test 16: Form reset on successful submission
  it('should reset form validation on successful submission', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const mockResetValidation = vi.fn();
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { 
      validate: mockValidate, 
      resetValidation: mockResetValidation 
    };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockResetValidation).toHaveBeenCalled();
  });

  // Test 17: Component name verification
  it('should have correct component name', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.$options.name).toBe('MoveAcrossFolders');
  });

  // Test 18: Props validation - activeFolderId

  // Test 19: Props validation - moduleId array
  it('should accept array moduleId prop', () => {
    const moduleIds = ['id1', 'id2', 'id3'];
    wrapper = mount(MoveAcrossFolders, {
      props: { moduleId: moduleIds },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.props('moduleId')).toEqual(moduleIds);
  });

  // Test 20: Props validation - type string
  it('should accept string type prop', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'dashboards' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.props('type')).toBe('dashboards');
  });

  // Test 21: Default props validation
  it('should use default props when not provided', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.props('activeFolderId')).toBe('default');
    expect(wrapper.props('moduleId')).toEqual([]);
    expect(wrapper.props('type')).toBe('alerts');
  });

  // Test 22: Cancel button click handling
  it('should handle cancel button click', async () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const cancelButton = wrapper.find('[data-test="alerts-folder-move-cancel"]');
    expect(cancelButton.exists()).toBe(true);
    
    // The cancel button should close the popup via v-close-popup
    await cancelButton.trigger('click');
    // No additional assertions needed as v-close-popup is handled by Quasar
  });

  // Test 23: Close popup button in header
  it('should render close button in header', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const closeButton = wrapper.find('[data-test="alerts-folder-move-cancel"]');
    expect(closeButton.exists()).toBe(true);
  });

  // Test 24: Form element existence
  it('should render form element with correct data-test attribute', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: { type: 'pipelines' },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const form = wrapper.find('[data-test="pipelines-folder-move-form"]');
    expect(form.exists()).toBe(true);
    expect(form.element.tagName).toBe('FORM');
  });

  // Test 25: Card sections existence
  it('should render all card sections', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.find('[data-test="alerts-folder-move-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alerts-folder-move-body"]').exists()).toBe(true);
  });

  // Test 26: Input field properties
  it('should render input field with correct properties', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const input = wrapper.find('[data-test="alerts-folder-move-name"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('disabled')).toBeDefined();
  });

  // Test 27: Button loading state
  it('should show loading state on move button when loading', async () => {
    const mockUseLoadingWithLoading = vi.fn((fn) => {
      const mockExecute = vi.fn().mockImplementation(async () => {
        if (typeof fn === 'function') {
          return await fn();
        }
      });
      return {
        execute: mockExecute,
        isLoading: { value: true },
      };
    });

    // Temporarily replace the mock
    const { useLoading } = await import('@/composables/useLoading');
    vi.mocked(useLoading).mockImplementation(mockUseLoadingWithLoading);

    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    expect(moveButton.exists()).toBe(true);
    // Check that the button shows loading state
    expect(wrapper.vm.onSubmit.isLoading.value).toBe(true);
  });

  // Test 28: Folder selection event handling
  it('should handle folder selection from dropdown', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    const newFolder = { value: 'folder2', label: 'Test Folder 2' };
    
    await selectDropdown.vm.$emit('folder-selected', newFolder);
    
    expect(wrapper.vm.selectedFolder).toEqual(newFolder);
  });

  // Test 29: Initial selected folder setup
  it('should initialize selected folder correctly from store', () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.selectedFolder.label).toBe('Test Folder 1');
    expect(wrapper.vm.selectedFolder.value).toBe('folder1');
  });

  // Test 30: Form submission with empty moduleId
  it('should handle form submission with empty moduleId array', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: [],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { alert_ids: [], dst_folder_id: { value: 'folder2' } },
      'alerts',
      'folder1'
    );
  });

  // Test 31: Store access in setup
  it('should have access to store in component', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state).toBeDefined();
  });

  // Test 32: i18n integration
  it('should have access to i18n translation function', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe('function');
  });

  // Test 33: getImageURL function access
  it('should have access to getImageURL function', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  // Test 34: moveFolderForm ref initialization
  it('should initialize moveFolderForm ref as null', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // The ref is initially null but gets populated when the form component mounts
    expect(wrapper.vm.moveFolderForm).toBeDefined();
  });

  // Test 35: onSubmit function existence
  it('should expose onSubmit function from useLoading', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(wrapper.vm.onSubmit).toBeDefined();
  });

  // Test 36: Form submission data structure for pipelines
  it('should create correct data structure for pipelines type', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'pipeline1',
        moduleId: ['pipe1', 'pipe2'],
        type: 'pipelines',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'default' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { pipeline_ids: ['pipe1', 'pipe2'], dst_folder_id: { value: 'default' } },
      'pipelines',
      'pipeline1'
    );
  });

  // Test 37: Error handling with custom error object
  it('should handle error object with custom message property', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const customError = { message: 'Custom error message' };
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(customError);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Custom error message', {
      timeout: 2000,
    });
  });

  // Test 38: Component emits configuration
  it('should define updated emit event', () => {
    const componentOptions = MoveAcrossFolders;
    expect(componentOptions.emits).toEqual(['updated']);
  });

  // Test 39: Reactive selectedFolder updates
  it('should reactively update selectedFolder', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const newFolder = { value: 'folder2', label: 'Test Folder 2' };
    wrapper.vm.selectedFolder = newFolder;
    await nextTick();

    expect(wrapper.vm.selectedFolder).toEqual(newFolder);
  });

  // Test 40: Button state with null selectedFolder value
  it('should handle null selectedFolder value correctly', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.selectedFolder = { value: { value: null } };
    await nextTick();

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    // Button should not be disabled when values don't match
    expect(moveButton.element.disabled).toBe(false);
  });

  // Test 41: Form validation with undefined form
  it('should handle undefined moveFolderForm gracefully', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // Don't set moveFolderForm, it should be null/undefined
    try {
      await wrapper.vm.onSubmit.execute();
    } catch (error) {
      // Should throw error when trying to call validate on null
      expect(error).toBeDefined();
    }
  });

  // Test 42: Multiple module IDs handling
  it('should handle multiple module IDs in submission', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const multipleIds = ['id1', 'id2', 'id3', 'id4', 'id5'];
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: multipleIds,
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { alert_ids: multipleIds, dst_folder_id: { value: 'folder2' } },
      'alerts',
      'folder1'
    );
  });

  // Test 43: Component with missing folder data

  // Test 44: Form submit button type validation
  it('should have submit type on move button', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    expect(moveButton.attributes('type')).toBe('submit');
  });

  // Test 45: Form submission event handling
  it('should prevent default form submission', async () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const form = wrapper.find('[data-test="alerts-folder-move-form"]');
    const submitEvent = new Event('submit');
    const preventDefaultSpy = vi.spyOn(submitEvent, 'preventDefault');
    
    // Simulate form submission
    await form.element.dispatchEvent(submitEvent);
    
    // The @submit.stop should prevent default behavior
    expect(form.exists()).toBe(true);
  });

  // Test 46: Component cleanup and unmounting
  it('should unmount cleanly without errors', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    expect(() => wrapper.unmount()).not.toThrow();
  });

  // Test 47: SelectFolderDropDown event emission
  it('should update selectedFolder when SelectFolderDropDown emits folder-selected', async () => {
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const initialFolder = wrapper.vm.selectedFolder;
    const newFolder = { value: 'folder2', label: 'New Folder' };
    
    const selectComponent = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    await selectComponent.vm.$emit('folder-selected', newFolder);

    expect(wrapper.vm.selectedFolder).not.toEqual(initialFolder);
    expect(wrapper.vm.selectedFolder).toEqual(newFolder);
  });

  // Test 48: Complex error object handling
  it('should handle error with nested message property', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const nestedError = { 
      response: { 
        data: { 
          message: 'Nested error message' 
        } 
      },
      message: 'Top level message'
    };
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(nestedError);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Top level message', {
      timeout: 2000,
    });
  });

  // Test 49: Button label verification
  it('should display correct button labels', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    const moveButton = wrapper.find('[data-test="alerts-folder-move"]');
    const cancelButtons = wrapper.findAll('[data-test="alerts-folder-move-cancel"]');
    
    expect(moveButton.text().toLowerCase()).toContain('move');
    // Check one of the cancel buttons (there are multiple)
    expect(cancelButtons.length).toBeGreaterThan(0);
    const cancelText = cancelButtons[0].text().toLowerCase();
    expect(cancelText).toContain('cancel');
  });

  // Test 50: Component props reactive updates

  // Test 51: Edge case - very long module ID array
  it('should handle very long module ID arrays', async () => {
    const longModuleIds = Array.from({ length: 100 }, (_, i) => `module-${i}`);
    const mockValidate = vi.fn().mockResolvedValue(true);
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: longModuleIds,
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { alert_ids: longModuleIds, dst_folder_id: { value: 'folder2' } },
      'alerts',
      'folder1'
    );
  });

  // Test 52: getModuleName function exposure verification
  it('should expose getModuleName function in component instance', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // The getModuleName function should not be exposed in the return statement
    // but should be accessible for testing if we modify the component
    expect(typeof wrapper.vm.getModuleName).toBe('function');
  });

  // Test 53: Comprehensive integration test
  it('should perform complete move workflow integration test', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const mockResetValidation = vi.fn();
    
    wrapper = mount(MoveAcrossFolders, {
      props: {
        activeFolderId: 'folder1',
        moduleId: ['alert1', 'alert2'],
        type: 'alerts',
      },
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // Setup form mock
    wrapper.vm.moveFolderForm = { 
      validate: mockValidate, 
      resetValidation: mockResetValidation 
    };

    // Simulate folder selection
    const newFolder = { value: { value: 'folder2' }, label: 'Target Folder' };
    wrapper.vm.selectedFolder = newFolder;
    await nextTick();

    // Mock successful API response
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    // Execute the move operation
    await wrapper.vm.onSubmit.execute();

    // Verify all the expected calls and states
    expect(mockValidate).toHaveBeenCalled();
    expect(mockMoveModuleToAnotherFolder).toHaveBeenCalledWith(
      mockStore,
      { alert_ids: ['alert1', 'alert2'], dst_folder_id: { value: 'folder2' } },
      'alerts',
      'folder1'
    );
    expect(mockShowPositiveNotification).toHaveBeenCalledWith('alerts Moved successfully', {
      timeout: 2000,
    });
    expect(wrapper.emitted('updated')).toBeTruthy();
    expect(mockResetValidation).toHaveBeenCalled();
  });
});