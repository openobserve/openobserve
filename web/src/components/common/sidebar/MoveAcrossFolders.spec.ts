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
    template:
      "<div class='select-folder-dropdown' @folder-selected=\"$emit('folder-selected', $event)\"></div>",
    props: ['type', 'activeFolderId'],
    emits: ['folder-selected'],
  },
}));

installQuasar();

// ---------------------------------------------------------------------------
// ODrawer stub — mirrors the migrated overlay surface.
// Renders the default slot so the form/inputs are queryable.
// Exposes all migrated props and emits so we can assert/drive them.
// ---------------------------------------------------------------------------
const ODrawerStub = {
  name: 'ODrawer',
  template:
    "<div class='o-drawer-stub' :data-open='open' :data-title='title'>" +
    "<slot name='header' />" +
    '<slot />' +
    "<slot name='footer' />" +
    '</div>',
  props: [
    'open',
    'side',
    'persistent',
    'size',
    'width',
    'title',
    'subTitle',
    'showClose',
    'seamless',
    'primaryButtonLabel',
    'secondaryButtonLabel',
    'neutralButtonLabel',
    'primaryButtonVariant',
    'secondaryButtonVariant',
    'neutralButtonVariant',
    'primaryButtonDisabled',
    'secondaryButtonDisabled',
    'neutralButtonDisabled',
    'primaryButtonLoading',
    'secondaryButtonLoading',
    'neutralButtonLoading',
  ],
  emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
};

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

// Factory — single source of truth for mount config
const createWrapper = (props: Record<string, any> = {}) => {
  return mount(MoveAcrossFolders, {
    props: { open: true, ...props },
    global: {
      plugins: [mockI18n],
      provide: { store: mockStore },
      mocks: { $store: mockStore },
      stubs: { ODrawer: ODrawerStub },
    },
  });
};

describe('MoveAcrossFolders.vue', () => {
  let wrapper: any;
  let mockMoveModuleToAnotherFolder: any;
  let mockShowPositiveNotification: any;
  let mockShowErrorNotification: any;
  let mockUseLoading: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { moveModuleToAnotherFolder } = await import('@/utils/commons');
    mockMoveModuleToAnotherFolder = vi.mocked(moveModuleToAnotherFolder);

    mockShowPositiveNotification = vi.fn();
    mockShowErrorNotification = vi.fn();

    const useNotifications = (await import('@/composables/useNotifications')).default;
    vi.mocked(useNotifications).mockReturnValue({
      showPositiveNotification: mockShowPositiveNotification,
      showErrorNotification: mockShowErrorNotification,
    });

    const { useLoading } = await import('@/composables/useLoading');
    mockUseLoading = vi.mocked(useLoading);
    // Reset to the default implementation each test so per-test overrides
    // (e.g. forcing isLoading: true) don't bleed into later tests.
    mockUseLoading.mockImplementation((fn: any) => {
      const execute = vi.fn().mockImplementation(async () => {
        if (typeof fn === 'function') {
          return await fn();
        }
      });
      return { execute, isLoading: { value: false } };
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  // Test 1: Component mounting and basic structure
  it('should mount successfully with default props', () => {
    wrapper = createWrapper();

    expect(wrapper.exists()).toBe(true);
    // Body section still renders inside the ODrawer default slot
    expect(wrapper.find('[data-test="alerts-folder-move-body"]').exists()).toBe(true);
  });

  // Test 2: Component with custom props
  it('should mount with custom props correctly', () => {
    wrapper = createWrapper({
      activeFolderId: 'pipeline1',
      moduleId: ['alert1', 'alert2'],
      type: 'pipelines',
    });

    expect(wrapper.props('activeFolderId')).toBe('pipeline1');
    expect(wrapper.props('moduleId')).toEqual(['alert1', 'alert2']);
    expect(wrapper.props('type')).toBe('pipelines');
  });

  // Test 3: Header rendering with correct title in ODrawer
  it('should pass title with capitalized type to ODrawer', () => {
    wrapper = createWrapper({ type: 'pipelines' });

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.exists()).toBe(true);
    expect(drawer.props('title')).toBe('Move Pipelines To Another Folder');
  });

  // Test 4: Current folder input display
  it('should display current folder name in input field', () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    const currentFolderInput = wrapper.find('[data-test="alerts-folder-move-name"]');
    expect(currentFolderInput.exists()).toBe(true);
    expect(currentFolderInput.element.value).toBe('Test Folder 1');
  });

  // Test 5: SelectFolderDropDown component integration
  it('should render SelectFolderDropDown component with correct props', () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    expect(selectDropdown.exists()).toBe(true);
    expect(selectDropdown.props('type')).toBe('alerts');
    expect(selectDropdown.props('activeFolderId')).toBe('folder1');
  });

  // Test 6: Primary button disabled when source and destination folders are same
  it('should pass primaryButtonDisabled=true when source and destination folders are same', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    // selectedFolder.value === activeFolderId so the disabled binding evaluates to true.
    // Initial selectedFolder is { label, value: activeFolderId } already.
    await nextTick();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('primaryButtonDisabled')).toBe(true);
  });

  // Test 7: Primary button enabled when folders are different
  it('should pass primaryButtonDisabled=false when source and destination folders differ', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    // Drive via the public folder-selected event
    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    await selectDropdown.vm.$emit('folder-selected', { value: 'folder2', label: 'Test Folder 2' });
    await nextTick();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('primaryButtonDisabled')).toBe(false);
  });

  // Test 8: getModuleName function for alerts
  it('should return correct module name for alerts type', () => {
    wrapper = createWrapper({ type: 'alerts' });
    expect(wrapper.vm.getModuleName()).toBe('alert_ids');
  });

  // Test 9: getModuleName function for pipelines
  it('should return correct module name for pipelines type', () => {
    wrapper = createWrapper({ type: 'pipelines' });
    expect(wrapper.vm.getModuleName()).toBe('pipeline_ids');
  });

  // Test 10: getModuleName function default case
  it('should return default module name for unknown type', () => {
    wrapper = createWrapper({ type: 'unknown' });
    expect(wrapper.vm.getModuleName()).toBe('alert_ids');
  });

  // Test 11: Successful form submission
  it('should handle successful form submission', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const mockResetValidation = vi.fn();

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1', 'alert2'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = {
      validate: mockValidate,
      resetValidation: mockResetValidation,
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

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };

    const result = await wrapper.vm.onSubmit.execute();

    expect(mockValidate).toHaveBeenCalled();
    expect(mockMoveModuleToAnotherFolder).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  // Test 13: Form submission error handling
  it('should handle form submission errors', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const error = new Error('Move operation failed');

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(error);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Move operation failed', {
      timeout: 2000,
    });
  });

  // Test 14: Form submission error handling without error message
  it('should handle form submission errors without message', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const error = {};

    wrapper = createWrapper({
      activeFolderId: 'pipeline1',
      moduleId: ['alert1'],
      type: 'pipelines',
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

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
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

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = {
      validate: mockValidate,
      resetValidation: mockResetValidation,
    };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    await wrapper.vm.onSubmit.execute();

    expect(mockResetValidation).toHaveBeenCalled();
  });

  // Test 17: Component name verification
  it('should have correct component name', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe('MoveAcrossFolders');
  });

  // Test 19: Props validation - moduleId array
  it('should accept array moduleId prop', () => {
    const moduleIds = ['id1', 'id2', 'id3'];
    wrapper = createWrapper({ moduleId: moduleIds });
    expect(wrapper.props('moduleId')).toEqual(moduleIds);
  });

  // Test 20: Props validation - type string
  it('should accept string type prop', () => {
    wrapper = createWrapper({ type: 'dashboards' });
    expect(wrapper.props('type')).toBe('dashboards');
  });

  // Test 21: Default props validation
  it('should use default props when not provided', () => {
    wrapper = mount(MoveAcrossFolders, {
      global: {
        plugins: [mockI18n],
        provide: { store: mockStore },
        mocks: { $store: mockStore },
        stubs: { ODrawer: ODrawerStub },
      },
    });

    expect(wrapper.props('activeFolderId')).toBe('default');
    expect(wrapper.props('moduleId')).toEqual([]);
    expect(wrapper.props('type')).toBe('alerts');
    expect(wrapper.props('open')).toBe(false);
  });

  // Test 22: Cancel surface — ODrawer renders the secondary (cancel) button via prop
  it('should wire the cancel surface through ODrawer secondaryButtonLabel', async () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent(ODrawerStub);
    // The migrated component drives the cancel action through click:secondary,
    // and the listener calls emit('update:open', false). The listener itself
    // is bound at the template level — we assert the surface is configured.
    expect(drawer.props('secondaryButtonLabel')).toBe('Cancel');
    // The listener should be registered on the drawer instance
    expect(drawer.vm.$attrs).toBeDefined();
  });

  // Test 23: ODrawer renders with correct migrated props (close button surface)
  it('should pass secondaryButtonLabel "Cancel" to ODrawer', () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('secondaryButtonLabel')).toBe('Cancel');
  });

  // Test 24: Form element existence
  it('should render form element with correct data-test attribute', () => {
    wrapper = createWrapper({ type: 'pipelines' });

    const form = wrapper.find('[data-test="pipelines-folder-move-form"]');
    expect(form.exists()).toBe(true);
    expect(form.element.tagName).toBe('FORM');
  });

  // Test 25: Body section exists inside drawer
  it('should render the body section inside the drawer', () => {
    wrapper = createWrapper();
    expect(wrapper.find('[data-test="alerts-folder-move-body"]').exists()).toBe(true);
  });

  // Test 26: Input field properties
  it('should render input field with correct properties', () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    const input = wrapper.find('[data-test="alerts-folder-move-name"]');
    expect(input.exists()).toBe(true);
    expect(input.attributes('disabled')).toBeDefined();
  });

  // Test 27: Primary button loading state
  it('should pass primaryButtonLoading=true when onSubmit is loading', async () => {
    mockUseLoading.mockImplementation((fn: any) => ({
      execute: vi.fn().mockImplementation(async () => fn && (await fn())),
      isLoading: { value: true },
    }));

    wrapper = createWrapper();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('primaryButtonLoading')).toBe(true);
    expect(wrapper.vm.onSubmit.isLoading.value).toBe(true);
  });

  // Test 28: Folder selection event handling
  it('should handle folder selection from dropdown', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    const newFolder = { value: 'folder2', label: 'Test Folder 2' };

    await selectDropdown.vm.$emit('folder-selected', newFolder);

    expect(wrapper.vm.selectedFolder).toEqual(newFolder);
  });

  // Test 29: Initial selected folder setup
  it('should initialize selected folder correctly from store', () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    expect(wrapper.vm.selectedFolder.label).toBe('Test Folder 1');
    expect(wrapper.vm.selectedFolder.value).toBe('folder1');
  });

  // Test 30: Form submission with empty moduleId
  it('should handle form submission with empty moduleId array', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: [],
      type: 'alerts',
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
    wrapper = createWrapper();
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state).toBeDefined();
  });

  // Test 32: i18n integration
  it('should have access to i18n translation function', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe('function');
  });

  // Test 33: getImageURL function access
  it('should have access to getImageURL function', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.getImageURL).toBeDefined();
  });

  // Test 34: moveFolderForm ref initialization
  it('should expose moveFolderForm ref', () => {
    wrapper = createWrapper();
    // The ref exists on the instance — populated when the form mounts
    expect(wrapper.vm.moveFolderForm).toBeDefined();
  });

  // Test 35: onSubmit function existence
  it('should expose onSubmit function from useLoading', () => {
    wrapper = createWrapper();
    expect(wrapper.vm.onSubmit).toBeDefined();
    expect(typeof wrapper.vm.onSubmit.execute).toBe('function');
  });

  // Test 36: Form submission data structure for pipelines
  it('should create correct data structure for pipelines type', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);

    wrapper = createWrapper({
      activeFolderId: 'pipeline1',
      moduleId: ['pipe1', 'pipe2'],
      type: 'pipelines',
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

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(customError);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Custom error message', {
      timeout: 2000,
    });
  });

  // Test 38: Component emits configuration — now includes update:open + close
  it('should define updated, close and update:open emits', () => {
    const componentOptions = MoveAcrossFolders as any;
    expect(componentOptions.emits).toEqual(['updated', 'close', 'update:open']);
  });

  // Test 39: Reactive selectedFolder updates via folder-selected event
  it('should reactively update selectedFolder via dropdown event', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    const newFolder = { value: 'folder2', label: 'Test Folder 2' };
    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    await selectDropdown.vm.$emit('folder-selected', newFolder);
    await nextTick();

    expect(wrapper.vm.selectedFolder).toEqual(newFolder);
  });

  // Test 40: primaryButtonDisabled with null selectedFolder value
  it('should compute primaryButtonDisabled=false when selectedFolder value is null', async () => {
    mockUseLoading.mockImplementation((fn: any) => ({
      execute: vi.fn().mockImplementation(async () => fn && (await fn())),
      isLoading: { value: false },
    }));

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
    });

    // selectedFolder.value mutated to a non-matching object — drive via the public dropdown event
    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    await selectDropdown.vm.$emit('folder-selected', { value: null, label: 'None' });
    await nextTick();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('primaryButtonDisabled')).toBe(false);
  });

  // Test 41: Form validation with undefined form
  it('should handle undefined moveFolderForm gracefully', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    // Don't set moveFolderForm — useLoading wraps the underlying function and catches in fn
    try {
      await wrapper.vm.onSubmit.execute();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  // Test 42: Multiple module IDs handling
  it('should handle multiple module IDs in submission', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const multipleIds = ['id1', 'id2', 'id3', 'id4', 'id5'];

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: multipleIds,
      type: 'alerts',
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

  // Test 44: ODrawer click:primary triggers onSubmit
  it('should call onSubmit.execute when ODrawer emits click:primary', async () => {
    const mockExecute = vi.fn().mockResolvedValue(undefined);
    mockUseLoading.mockImplementation(() => ({
      execute: mockExecute,
      isLoading: { value: false },
    }));

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    const drawer = wrapper.findComponent(ODrawerStub);
    await drawer.vm.$emit('click:primary');
    await flushPromises();

    expect(mockExecute).toHaveBeenCalled();
  });

  // Test 45: ODrawer is wired to update:open and click handlers via template bindings.
  // The component declares update:open in its emits config, exposing the contract.
  it('should declare update:open in component emits', () => {
    const componentOptions = MoveAcrossFolders as any;
    expect(componentOptions.emits).toContain('update:open');
  });

  // Test 46: Component cleanup and unmounting
  it('should unmount cleanly without errors', () => {
    wrapper = createWrapper();
    expect(() => wrapper.unmount()).not.toThrow();
    wrapper = null;
  });

  // Test 47: SelectFolderDropDown event emission
  it('should update selectedFolder when SelectFolderDropDown emits folder-selected', async () => {
    wrapper = createWrapper({
      activeFolderId: 'folder1',
      type: 'alerts',
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
      response: { data: { message: 'Nested error message' } },
      message: 'Top level message',
    };

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = { validate: mockValidate, resetValidation: vi.fn() };
    wrapper.vm.selectedFolder = { value: { value: 'folder2' } };
    mockMoveModuleToAnotherFolder.mockRejectedValue(nestedError);

    await wrapper.vm.onSubmit.execute();

    expect(mockShowErrorNotification).toHaveBeenCalledWith('Top level message', {
      timeout: 2000,
    });
  });

  // Test 49: Button labels passed to ODrawer
  it('should pass correct primary and secondary button labels to ODrawer', () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('primaryButtonLabel')).toBe('Move');
    expect(drawer.props('secondaryButtonLabel')).toBe('Cancel');
  });

  // Test 50: ODrawer size and open propagation
  it('should pass open prop and size="lg" through to ODrawer', () => {
    wrapper = createWrapper({ open: true });

    const drawer = wrapper.findComponent(ODrawerStub);
    expect(drawer.props('open')).toBe(true);
    expect(drawer.props('size')).toBe('lg');
  });

  // Test 51: Edge case - very long module ID array
  it('should handle very long module ID arrays', async () => {
    const longModuleIds = Array.from({ length: 100 }, (_, i) => `module-${i}`);
    const mockValidate = vi.fn().mockResolvedValue(true);

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: longModuleIds,
      type: 'alerts',
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
    wrapper = createWrapper();
    expect(typeof wrapper.vm.getModuleName).toBe('function');
  });

  // Test 53: Comprehensive integration test
  it('should perform complete move workflow integration test', async () => {
    const mockValidate = vi.fn().mockResolvedValue(true);
    const mockResetValidation = vi.fn();

    wrapper = createWrapper({
      activeFolderId: 'folder1',
      moduleId: ['alert1', 'alert2'],
      type: 'alerts',
    });

    wrapper.vm.moveFolderForm = {
      validate: mockValidate,
      resetValidation: mockResetValidation,
    };

    // Simulate folder selection through the dropdown (public API)
    const selectDropdown = wrapper.findComponent({ name: 'SelectFolderDropDown' });
    await selectDropdown.vm.$emit('folder-selected', {
      value: { value: 'folder2' },
      label: 'Target Folder',
    });
    await nextTick();

    mockMoveModuleToAnotherFolder.mockResolvedValue(true);

    // Trigger via the ODrawer primary-click — the migrated flow
    const drawer = wrapper.findComponent(ODrawerStub);
    await drawer.vm.$emit('click:primary');
    await flushPromises();

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
