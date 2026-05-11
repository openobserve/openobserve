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

vi.mock("@/utils/dashboard/panelValidation", () => ({
  validateDashboardJson: vi.fn(() => []),
}));

// Mock QueryEditor component - handle async component wrapper
vi.mock("@/components/CodeQueryEditor.vue", async () => {
  const { defineComponent } = await import("vue");
  const component = defineComponent({
    name: "QueryEditor",
    template: '<div data-test="dashboard-json-editor" class="mocked-query-editor"><textarea v-model="query" @input="onInput"></textarea></div>',
    props: ["debounceTime", "language", "editorId", "query"],
    emits: ["update:query"],
    setup(props: any, { emit }: any) {
      const query = ref(props.query || "");
      const onInput = (event: Event) => {
        const target = event.target as HTMLTextAreaElement;
        emit("update:query", target.value);
      };
      return { query, onInput };
    },
  });

  return {
    default: component,
  };
});

// Mock ODrawer to capture props/emits and expose the default slot
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const { defineComponent } = await import("vue");
  const component = defineComponent({
    name: "ODrawer",
    inheritAttrs: false,
    props: [
      "open",
      "width",
      "title",
      "subTitle",
      "showClose",
      "persistent",
      "size",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "neutralButtonLabel",
      "primaryButtonVariant",
      "secondaryButtonVariant",
      "neutralButtonVariant",
      "primaryButtonDisabled",
      "secondaryButtonDisabled",
      "neutralButtonDisabled",
      "primaryButtonLoading",
      "secondaryButtonLoading",
      "neutralButtonLoading",
    ],
    emits: [
      "update:open",
      "click:primary",
      "click:secondary",
      "click:neutral",
    ],
    template: `
      <div data-test="o-drawer-stub" class="o-drawer-stub">
        <header data-test="o-drawer-header">
          <span data-test="o-drawer-title">{{ title }}</span>
        </header>
        <section data-test="o-drawer-body">
          <slot />
        </section>
        <footer data-test="o-drawer-footer">
          <button
            data-test="o-drawer-secondary"
            :disabled="secondaryButtonDisabled"
            @click="$emit('click:secondary')"
          >{{ secondaryButtonLabel }}</button>
          <button
            data-test="o-drawer-primary"
            :disabled="primaryButtonDisabled"
            @click="$emit('click:primary')"
          >{{ primaryButtonLabel }}</button>
        </footer>
      </div>
    `,
  });
  return { default: component };
});

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
      open: true,
      ...props,
    };

    return mount(DashboardJsonEditor, {
      props: defaultProps,
      global: {
        stubs: {
          // Stub QueryEditor with proper data-test attribute
          "QueryEditor": {
            name: "QueryEditor",
            template: '<div data-test="dashboard-json-editor" class="query-editor"><slot /></div>',
            props: ["debounceTime", "language", "editorId", "query"],
            emits: ["update:query"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset theme to light for each test (some tests mutate this)
    mockStore.state.theme = "light";

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

  // Test 2: Props validation and component structure (now using ODrawer)
  it("should render component with ODrawer wrapper and footer buttons", () => {
    wrapper = createWrapper();

    // ODrawer wrapper exists
    expect(wrapper.find('[data-test="o-drawer-stub"]').exists()).toBe(true);
    // Body contains the json editor container
    expect(wrapper.find(".dashboard-json-editor").exists()).toBe(true);
    // Footer renders both buttons supplied via ODrawer props
    expect(wrapper.find('[data-test="o-drawer-primary"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o-drawer-secondary"]').exists()).toBe(true);
  });

  // Test 2b: ODrawer should receive the expected configuration props
  it("should pass correct props to ODrawer", () => {
    wrapper = createWrapper();
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.exists()).toBe(true);
    expect(drawer.props("open")).toBe(true);
    expect(drawer.props("width")).toBe(70);
    expect(drawer.props("title")).toBe("Edit Dashboard JSON");
    expect(drawer.props("primaryButtonLabel")).toBe("common.save");
    expect(drawer.props("secondaryButtonLabel")).toBe("common.cancel");
    expect(drawer.props("primaryButtonLoading")).toBe(false);
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);

    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);

    await wrapper.vm.saveChanges();

    expect(mockSaveJsonDashboard.execute).toHaveBeenCalledWith(mockDashboardData);
  });

  // Test 16: saveChanges should handle save execution errors
  it("should handle save execution errors", async () => {
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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

  // Test 20: Primary button loading prop should reflect loading state
  it("should propagate loading state to ODrawer primary button", () => {
    mockSaveJsonDashboard.isLoading.value = true;
    wrapper = createWrapper();
    const drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.props("primaryButtonLoading")).toBe(true);
  });

  // Test 21: ODrawer click:primary should trigger saveChanges (success path)
  it("should call saveJsonDashboard.execute when ODrawer emits click:primary", async () => {
    const mockValidate = await import("@/utils/dashboard/panelValidation");
    vi.mocked(mockValidate.validateDashboardJson).mockReturnValue([]);

    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.validationErrors = [];
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    drawer.vm.$emit("click:primary");
    // Wait for the async saveChanges chain
    await wrapper.vm.$nextTick();
    await Promise.resolve();

    expect(mockSaveJsonDashboard.execute).toHaveBeenCalledWith(mockDashboardData);
  });

  // Test 22: ODrawer click:secondary should emit update:open=false
  it("should emit update:open=false when ODrawer emits click:secondary", async () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    drawer.vm.$emit("click:secondary");
    await wrapper.vm.$nextTick();

    const updates = wrapper.emitted("update:open");
    expect(updates).toBeTruthy();
    expect(updates[updates.length - 1]).toEqual([false]);
  });

  // Test 23: ODrawer update:open should bubble up to parent
  it("should re-emit update:open when ODrawer emits update:open", async () => {
    wrapper = createWrapper();

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    drawer.vm.$emit("update:open", false);
    await wrapper.vm.$nextTick();

    const updates = wrapper.emitted("update:open");
    expect(updates).toBeTruthy();
    expect(updates[updates.length - 1]).toEqual([false]);
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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
    const queryEditor = wrapper.findComponent({ name: 'QueryEditor' });
    queryEditor.vm.$emit('update:query', validJson);

    expect(wrapper.vm.isValidJson).toBe(true);
  });

  // Test 29: ODrawer should receive the open prop reactively
  it("should reflect open prop on the ODrawer wrapper", async () => {
    wrapper = createWrapper({ open: false });
    let drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.props("open")).toBe(false);

    await wrapper.setProps({ open: true });
    drawer = wrapper.findComponent({ name: "ODrawer" });
    expect(drawer.props("open")).toBe(true);
  });

  // Test 30: Component should not call execute if saveChanges runs while loading via primary click
  it("should not invoke execute when click:primary fires while loading", async () => {
    mockSaveJsonDashboard.isLoading.value = true;
    wrapper = createWrapper();
    wrapper.vm.isValidJson = true;
    wrapper.vm.jsonContent = JSON.stringify(mockDashboardData);

    const drawer = wrapper.findComponent({ name: "ODrawer" });
    drawer.vm.$emit("click:primary");
    await wrapper.vm.$nextTick();

    expect(mockSaveJsonDashboard.execute).not.toHaveBeenCalled();
  });

  // Test 31: Component properly renders editor content
  it("should render initial JSON content in editor", () => {
    wrapper = createWrapper();

    // Check that the JSON content is properly set
    const expectedJson = JSON.stringify(mockDashboardData, null, 2);
    expect(wrapper.vm.jsonContent).toBe(expectedJson);

    // Check that the editor is rendered
    const queryEditor = wrapper.findComponent({ name: 'QueryEditor' });
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
    const mockValidate = await import("@/utils/dashboard/panelValidation");
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
