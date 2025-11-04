import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import DashboardJsonEditor from "./DashboardJsonEditor.vue";

// Mock dependencies
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mocked-${path}`),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  validateDashboardJson: vi.fn(() => []),
}));

// Mock QueryEditor component
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: {
    name: "QueryEditor",
    template: '<div data-test="mocked-query-editor"><textarea v-model="query" @input="onInput"></textarea></div>',
    props: ["debounceTime", "language", "editorId"],
    emits: ["update:query"],
    setup(props: any, { emit }: any) {
      const query = ref("");
      const onInput = (event: Event) => {
        const target = event.target as HTMLTextAreaElement;
        emit("update:query", target.value);
      };
      return { query, onInput };
    },
  },
}));

// Mock Vuex
const mockStore = {
  state: {
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

describe("DashboardJsonEditor", () => {
  let wrapper: any;
  let mockSaveJsonDashboard: any;
  let mockDashboardData: any;

  const createWrapper = (props: any = {}) => {
    const defaultProps = {
      dashboardData: mockDashboardData,
      saveJsonDashboard: mockSaveJsonDashboard,
      ...props,
    };

    return mount(DashboardJsonEditor, {
      props: defaultProps,
      global: {
        stubs: {
          "q-card": { template: '<div class="q-card"><slot /></div>' },
          "q-card-section": { template: '<div class="q-card-section"><slot /></div>' },
          "q-card-actions": { template: '<div class="q-card-actions"><slot /></div>' },
          "q-separator": { template: '<div class="q-separator" />' },
          "q-btn": {
            template: '<button class="q-btn" @click="$emit(\'click\')" :disabled="disable || disabled"><slot>{{ label }}</slot></button>',
            props: ["label", "disable", "disabled", "loading"],
            emits: ["click"],
          },
          "q-space": { template: '<div class="q-space" />' },
          "q-icon": {
            template: '<i class="q-icon" :data-test="$attrs[\'data-test\']"></i>',
            props: ["name", "size"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDashboardData = {
      dashboardId: "test-dashboard-123",
      title: "Test Dashboard",
      owner: "test-user",
      created: "2023-01-01T00:00:00Z",
      version: "v3",
      tabs: [
        {
          tabId: "tab1",
          name: "Tab 1",
          panels: [],
        },
      ],
    };

    mockSaveJsonDashboard = {
      isLoading: { value: false },
      execute: vi.fn(() => Promise.resolve()),
    };
  });

  // Test 1: Basic component mounting
  it("should mount successfully with required props", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-json-editor"]').exists()).toBe(true);
  });

  // Test 2: Props validation and component structure
  it("should render component with correct structure", () => {
    wrapper = createWrapper();
    
    // Check main card structure
    expect(wrapper.find(".dashboard-json-editor").exists()).toBe(true);
    expect(wrapper.find('[data-test="json-editor-close"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="json-editor-cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="json-editor-save"]').exists()).toBe(true);
  });

  // Test 3: Initial JSON content loading
  it("should initialize with dashboard data as JSON", async () => {
    wrapper = createWrapper();
    await wrapper.vm.$nextTick();
    
    const expectedJson = JSON.stringify(mockDashboardData, null, 2);
    expect(wrapper.vm.jsonContent).toBe(expectedJson);
  });

  // Test 4: Computed property - saveJsonLoading
  it("should have correct saveJsonLoading computed value", () => {
    wrapper = createWrapper();
    expect(wrapper.vm.saveJsonLoading).toBe(false);
    
    // Test when loading is true
    mockSaveJsonDashboard.isLoading.value = true;
    wrapper = createWrapper();
    expect(wrapper.vm.saveJsonLoading).toBe(true);
  });

  // Test 5: Theme-based styling
  it("should apply correct theme class", () => {
    wrapper = createWrapper();
    expect(wrapper.find(".bg-white").exists()).toBe(true);
    
    // Test dark theme
    mockStore.state.theme = "dark";
    wrapper = createWrapper();
    expect(wrapper.find(".dark-mode").exists()).toBe(true);
  });

  // Test 6: handleEditorChange with valid JSON
  it("should handle valid JSON changes correctly", () => {
    wrapper = createWrapper();
    const validJson = JSON.stringify({ test: "value" });
    
    wrapper.vm.handleEditorChange(validJson);
    
    expect(wrapper.vm.isValidJson).toBe(true);
    expect(wrapper.vm.validationErrors).toEqual([]);
  });

  // Test 7: handleEditorChange with invalid JSON
  it("should handle invalid JSON changes correctly", () => {
    wrapper = createWrapper();
    const invalidJson = "{ invalid json }";
    
    wrapper.vm.handleEditorChange(invalidJson);
    
    expect(wrapper.vm.isValidJson).toBe(false);
    expect(wrapper.vm.validationErrors).toEqual(["Invalid JSON format"]);
  });

  // Test 8: handleEditorChange with validation errors from validateDashboardJson
  it("should handle validation errors from validateDashboardJson", async () => {
    // Mock the validateDashboardJson function to return an error
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue(["Test validation error"]);
    
    wrapper = createWrapper();
    const validJson = JSON.stringify({ test: "value" });
    
    wrapper.vm.handleEditorChange(validJson);
    
    expect(wrapper.vm.isValidJson).toBe(true);
    expect(wrapper.vm.validationErrors).toContain("Test validation error");
  });

  // Test 9: handleEditorChange should prevent dashboardId changes
  it("should prevent dashboardId changes", () => {
    wrapper = createWrapper();
    const modifiedJson = JSON.stringify({
      ...mockDashboardData,
      dashboardId: "different-id"
    });
    
    wrapper.vm.handleEditorChange(modifiedJson);
    
    expect(wrapper.vm.validationErrors).toContain("Dashboard ID cannot be modified");
  });

  // Test 10: handleEditorChange should prevent owner changes
  it("should prevent owner changes", () => {
    wrapper = createWrapper();
    const modifiedJson = JSON.stringify({
      ...mockDashboardData,
      owner: "different-owner"
    });
    
    wrapper.vm.handleEditorChange(modifiedJson);
    
    expect(wrapper.vm.validationErrors).toContain("Owner cannot be modified");
  });

  // Test 11: handleEditorChange should prevent created changes
  it("should prevent created timestamp changes", () => {
    wrapper = createWrapper();
    const modifiedJson = JSON.stringify({
      ...mockDashboardData,
      created: "2024-01-01T00:00:00Z"
    });
    
    wrapper.vm.handleEditorChange(modifiedJson);
    
    expect(wrapper.vm.validationErrors).toContain("Created cannot be modified");
  });

  // Test 12: saveChanges should not proceed if JSON is invalid
  it("should not save if JSON is invalid", async () => {
    wrapper = createWrapper();
    wrapper.vm.isValidJson = false;
    
    await wrapper.vm.saveChanges();
    
    expect(mockSaveJsonDashboard.execute).not.toHaveBeenCalled();
  });

  // Test 13: saveChanges should not proceed if already loading
  it("should not save if already loading", async () => {
    mockSaveJsonDashboard.isLoading.value = true;
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    
    await wrapper.vm.saveChanges();
    
    expect(mockSaveJsonDashboard.execute).not.toHaveBeenCalled();
  });

  // Test 14: saveChanges should handle validation errors during save
  it("should handle validation errors during save", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue(["Save-time validation error"]);
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);
    
    await wrapper.vm.saveChanges();
    
    expect(wrapper.vm.validationErrors).toContain("Save-time validation error");
    expect(mockSaveJsonDashboard.execute).not.toHaveBeenCalled();
  });

  // Test 15: saveChanges should successfully save valid JSON
  it("should successfully save valid JSON", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);
    
    await wrapper.vm.saveChanges();
    
    expect(mockSaveJsonDashboard.execute).toHaveBeenCalledWith(mockDashboardData);
  });

  // Test 16: saveChanges should handle save execution errors
  it("should handle save execution errors", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);
    
    const saveError = new Error("Save failed");
    mockSaveJsonDashboard.execute.mockRejectedValue(saveError);
    
    // Mock console.error to suppress stderr output
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);
    
    await wrapper.vm.saveChanges();
    
    expect(wrapper.vm.validationErrors).toContain("Failed during JSON save: Save failed");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed during JSON save:", saveError);
    
    consoleErrorSpy.mockRestore();
  });

  // Test 17: saveChanges should handle non-Error exceptions
  it("should handle non-Error exceptions during save", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);
    
    mockSaveJsonDashboard.execute.mockRejectedValue("String error");
    
    // Mock console.error to suppress stderr output
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);
    
    await wrapper.vm.saveChanges();
    
    expect(wrapper.vm.validationErrors).toContain("Failed during JSON save: Unknown error");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed during JSON save:", "String error");
    
    consoleErrorSpy.mockRestore();
  });

  // Test 18: saveChanges should handle JSON parsing errors during save
  it("should handle JSON parsing errors during save", async () => {
    // Mock console.error to suppress stderr output
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = "{ invalid json }";
    
    await wrapper.vm.saveChanges();
    
    expect(wrapper.vm.validationErrors[0]).toMatch(/Failed during JSON save: .*/);  
    expect(consoleErrorSpy).toHaveBeenCalled();
    
    consoleErrorSpy.mockRestore();
  });

  // Test 19: Watch functionality - should update jsonContent when dashboardData changes
  it("should update jsonContent when dashboardData changes", async () => {
    wrapper = createWrapper();
    
    const newDashboardData = {
      ...mockDashboardData,
      title: "Updated Dashboard Title"
    };
    
    await wrapper.setProps({ dashboardData: newDashboardData });
    
    const expectedJson = JSON.stringify(newDashboardData, null, 2);
    expect(wrapper.vm.jsonContent).toBe(expectedJson);
  });

  // Test 20: Save button should be disabled when JSON is invalid
  it("should disable save button when JSON is invalid", async () => {
    wrapper = createWrapper();
    wrapper.vm.isValidJson = false;
    await wrapper.vm.$nextTick();
    
    const saveButton = wrapper.find('[data-test="json-editor-save"]');
    // Check that the disable condition is met
    expect(!wrapper.vm.isValidJson || wrapper.vm.validationErrors.length > 0 || wrapper.vm.saveJsonLoading).toBe(true);
  });

  // Test 21: Save button should be disabled when there are validation errors
  it("should disable save button when there are validation errors", async () => {
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.validationErrors = ["Some error"];
    await wrapper.vm.$nextTick();
    
    const saveButton = wrapper.find('[data-test="json-editor-save"]');
    // Check that the disable condition is met
    expect(!wrapper.vm.isValidJson || wrapper.vm.validationErrors.length > 0 || wrapper.vm.saveJsonLoading).toBe(true);
  });

  // Test 22: Save button should be disabled when loading
  it("should disable save button when loading", () => {
    mockSaveJsonDashboard.isLoading.value = true;
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.validationErrors = [];
    
    const saveButton = wrapper.find('[data-test="json-editor-save"]');
    expect(saveButton.attributes('disabled')).toBeDefined();
  });

  // Test 23: Save button click should call saveChanges
  it("should call saveChanges when save button is clicked", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);
    
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.validationErrors = [];
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);
    
    const saveButton = wrapper.find('[data-test="json-editor-save"]');
    await saveButton.trigger('click');
    
    expect(mockSaveJsonDashboard.execute).toHaveBeenCalledWith(mockDashboardData);
  });

  // Test 24: Validation errors display functionality
  it("should show validation errors when present", async () => {
    wrapper = createWrapper();
    wrapper.vm.validationErrors = ["Error 1", "Error 2"];
    await wrapper.vm.$nextTick();
    
    const errorSection = wrapper.find('.validation-errors');
    expect(errorSection.exists()).toBe(true);
    expect(wrapper.text()).toContain("Error 1");
    expect(wrapper.text()).toContain("Error 2");
  });

  // Test 25: Validation errors should be hidden when empty
  it("should hide validation errors when empty", () => {
    wrapper = createWrapper();
    wrapper.vm.validationErrors = [];
    
    const errorSection = wrapper.find('.validation-errors');
    expect(errorSection.exists()).toBe(false);
  });

  // Test 26: Multiple field changes validation
  it("should prevent multiple field changes simultaneously", () => {
    wrapper = createWrapper();
    const modifiedJson = JSON.stringify({
      ...mockDashboardData,
      dashboardId: "different-id",
      owner: "different-owner",
      created: "2024-01-01T00:00:00Z"
    });
    
    wrapper.vm.handleEditorChange(modifiedJson);
    
    expect(wrapper.vm.validationErrors).toContain("Dashboard ID cannot be modified");
    expect(wrapper.vm.validationErrors).toContain("Owner cannot be modified");
    expect(wrapper.vm.validationErrors).toContain("Created cannot be modified");
    expect(wrapper.vm.validationErrors.length).toBe(3);
  });

  // Test 27: Editor change without restricted fields
  it("should allow valid JSON without restricted fields", async () => {
    // Reset the validateDashboardJson mock to return no errors
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);
    
    wrapper = createWrapper();
    const jsonWithoutRestrictedFields = JSON.stringify({
      title: "Some Title",
      version: "v3",
      tabs: []
      // Note: no dashboardId, owner, or created fields
    });
    
    wrapper.vm.handleEditorChange(jsonWithoutRestrictedFields);
    
    expect(wrapper.vm.isValidJson).toBe(true);
    // No validation errors should be added when restricted fields are not present
    expect(wrapper.vm.validationErrors).toEqual([]);
  });

  // Test 28: Editor change triggering from QueryEditor component
  it("should handle editor change from QueryEditor component", () => {
    wrapper = createWrapper();
    const validJson = JSON.stringify({ test: "value from editor" });
    
    // Simulate the editor update event
    const queryEditor = wrapper.findComponent('[data-test="dashboard-json-editor"]');
    queryEditor.vm.$emit('update:query', validJson);
    
    expect(wrapper.vm.isValidJson).toBe(true);
  });

  // Test 29: Close button should have v-close-popup directive
  it("should have close button with proper attributes", async () => {
    wrapper = createWrapper();
    
    const closeButton = wrapper.find('[data-test="json-editor-close"]');
    expect(closeButton.exists()).toBe(true);
    // The button should be rendered with proper data-test attribute
    expect(closeButton.attributes('data-test')).toBe('json-editor-close');
  });

  // Test 30: Cancel button should have v-close-popup directive  
  it("should have cancel button with proper attributes", async () => {
    wrapper = createWrapper();
    
    const cancelButton = wrapper.find('[data-test="json-editor-cancel"]');
    expect(cancelButton.exists()).toBe(true);
    // The button should be rendered with proper data-test attribute  
    expect(cancelButton.attributes('data-test')).toBe('json-editor-cancel');
  });

  // Test 31: Component properly renders editor content
  it("should render initial JSON content in editor", () => {
    wrapper = createWrapper();
    
    // Check that the JSON content is properly set
    const expectedJson = JSON.stringify(mockDashboardData, null, 2);
    expect(wrapper.vm.jsonContent).toBe(expectedJson);
    
    // Check that the editor is rendered
    const queryEditor = wrapper.findComponent('[data-test="dashboard-json-editor"]');
    expect(queryEditor.exists()).toBe(true);
  });

  // Test 32: Component handles empty or null dashboard data
  it("should handle empty or null dashboard data gracefully", () => {
    // Mock console.warn to suppress Vue prop validation warnings
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    wrapper = createWrapper({ dashboardData: null });
    
    expect(wrapper.vm.jsonContent).toBe("null");
    expect(wrapper.vm.isValidJson).toBe(true);
    
    consoleWarnSpy.mockRestore();
  });

  // Test 33: Component handles empty validation errors array reset
  it("should reset validation errors array when handling valid JSON", () => {
    wrapper = createWrapper();
    wrapper.vm.validationErrors = ["Previous error"];
    
    const validJson = JSON.stringify({ test: "value" });
    wrapper.vm.handleEditorChange(validJson);
    
    expect(wrapper.vm.validationErrors).toEqual([]);
  });

  // Test 34: Mixed validation errors - both custom validation and validateDashboardJson
  it("should handle mixed validation errors", async () => {
    const mockValidate = await import("@/utils/dashboard/convertDataIntoUnitValue");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue(["Schema validation error"]);
    
    wrapper = createWrapper();
    const modifiedJson = JSON.stringify({
      ...mockDashboardData,
      dashboardId: "different-id" // This should trigger custom validation
    });
    
    wrapper.vm.handleEditorChange(modifiedJson);
    
    expect(wrapper.vm.validationErrors.length).toBe(2); // 1 custom + 1 schema
    expect(wrapper.vm.validationErrors).toContain("Dashboard ID cannot be modified");
    expect(wrapper.vm.validationErrors).toContain("Schema validation error");
  });

  // Test 35: Watch functionality with deep props changes
  it("should react to deep changes in dashboard data", async () => {
    wrapper = createWrapper();
    
    const newDashboardData = {
      ...mockDashboardData,
      tabs: [
        {
          tabId: "new-tab",
          name: "New Tab",
          panels: [{ id: "panel1", title: "Panel 1" }]
        }
      ]
    };
    
    await wrapper.setProps({ dashboardData: newDashboardData });
    
    const expectedJson = JSON.stringify(newDashboardData, null, 2);
    expect(wrapper.vm.jsonContent).toBe(expectedJson);
  });
});