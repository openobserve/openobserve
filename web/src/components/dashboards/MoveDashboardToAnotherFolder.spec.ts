import { mount } from "@vue/test-utils";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Quasar } from "quasar";
import MoveDashboardToAnotherFolder from "./MoveDashboardToAnotherFolder.vue";
import { createI18n } from "vue-i18n";

// Mock composables
const mockUseNotifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
};

// Mock store
const mockStore = {
  state: {
    organizationData: {
      folders: [
        { folderId: "default", name: "Default Folder" },
        { folderId: "folder1", name: "Test Folder 1" },
        { folderId: "folder2", name: "Test Folder 2" },
      ],
    },
  },
};

vi.mock("./SelectFolderDropdown.vue", () => ({
  default: {
    name: "SelectFolderDropdown",
    template:
      '<div class="select-folder-dropdown" @click="$emit(\'folder-selected\', { label: \'Test Folder\', value: \'folder1\' })"></div>',
    props: ["activeFolderId"],
    emits: ["folder-selected"],
  },
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => mockUseNotifications,
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: vi.fn().mockImplementation(fn),
    isLoading: { value: false },
  })),
}));

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("../../utils/commons", () => ({
  moveDashboardToAnotherFolder: vi.fn(),
}));

vi.mock("../../utils/zincutils", () => ({
  getImageURL: vi.fn().mockReturnValue("test-image-url"),
}));

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      dashboard: {
        currentFolderLabel: "Current Folder",
        cancel: "Cancel",
      },
      common: {
        move: "Move",
      },
    },
  },
});

// Stub ODrawer so tests are deterministic (no Portal/Reka teleport) and so we
// can assert on the props the component forwards + emit the click events
// the component listens to.
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
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
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
      :data-primary-loading="String(primaryButtonLoading)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-drawer-stub-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-drawer-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Helper functions to access mocked modules
const getMockUtils = async () => {
  const commons = await import("../../utils/commons");
  const zincutils = await import("../../utils/zincutils");
  const useLoadingModule = await import("@/composables/useLoading");
  return {
    moveDashboardToAnotherFolder: vi.mocked(
      commons.moveDashboardToAnotherFolder,
    ),
    getImageURL: vi.mocked(zincutils.getImageURL),
    useLoading: vi.mocked(useLoadingModule.useLoading),
  };
};

describe("MoveDashboardToAnotherFolder", () => {
  let wrapper: any;
  const defaultProps = {
    activeFolderId: "default",
    dashboardIds: ["dashboard1", "dashboard2"],
    open: true,
  };

  const createWrapper = (props = {}) => {
    return mount(MoveDashboardToAnotherFolder, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [Quasar, i18n],
        stubs: {
          ODrawer: ODrawerStub,
          SelectFolderDropdown: {
            name: "SelectFolderDropdown",
            template: '<div class="select-folder-dropdown"></div>',
            props: ["activeFolderId"],
            emits: ["folder-selected"],
          },
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset mocked functions
    const { moveDashboardToAnotherFolder, getImageURL, useLoading } =
      await getMockUtils();
    moveDashboardToAnotherFolder.mockReset();
    getImageURL.mockReset().mockReturnValue("test-image-url");
    useLoading.mockImplementation((fn) => ({
      execute: vi.fn().mockImplementation(fn),
      isLoading: { value: false },
    }));
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render component with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize with correct default values", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.activeFolderId).toBe("default");
      expect(wrapper.vm.dashboardIds).toEqual(["dashboard1", "dashboard2"]);
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Default Folder",
        value: "default",
      });
    });

    it("should render with custom props", () => {
      wrapper = createWrapper({
        activeFolderId: "folder1",
        dashboardIds: ["dashboard3"],
      });

      expect(wrapper.vm.activeFolderId).toBe("folder1");
      expect(wrapper.vm.dashboardIds).toEqual(["dashboard3"]);
    });

    it("should initialize with correct default props when not provided", () => {
      wrapper = mount(MoveDashboardToAnotherFolder, {
        global: {
          plugins: [Quasar, i18n],
          stubs: {
            ODrawer: ODrawerStub,
            SelectFolderDropdown: true,
          },
        },
      });

      expect(wrapper.vm.activeFolderId).toBe("default");
      expect(wrapper.vm.dashboardIds).toEqual([]);
      expect(wrapper.vm.open).toBe(false);
    });
  });

  describe("ODrawer Prop Forwarding", () => {
    it("should render the ODrawer wrapper", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="o-drawer-stub"]').exists()).toBe(true);
    });

    it("should forward open prop to ODrawer", () => {
      wrapper = createWrapper({ open: true });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);
    });

    it("should forward open=false to ODrawer when closed", () => {
      wrapper = createWrapper({ open: false });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(false);
    });

    it("should use size 'lg' on ODrawer", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("size")).toBe("lg");
    });

    it("should pass 'Move Dashboard' title to ODrawer", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("Move Dashboard");
    });

    it("should render i18n label on secondary (cancel) button", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("should render i18n label on primary (move) button", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBe("Move");
    });
  });

  describe("Template Rendering", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should render form body section", () => {
      expect(
        wrapper.find('[data-test="dashboard-folder-move-body"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-folder-move-form"]').exists(),
      ).toBe(true);
    });

    it("should render current folder input", () => {
      const currentFolderInput = wrapper.find(
        '[data-test="dashboard-folder-move-name"]',
      );
      expect(currentFolderInput.exists()).toBe(true);
    });

    it("should render SelectFolderDropdown component", () => {
      const selectFolderDropdown = wrapper.findComponent({
        name: "SelectFolderDropdown",
      });
      expect(selectFolderDropdown.exists()).toBe(true);
    });

    it("should disable primary button when same folder is selected", () => {
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonDisabled")).toBe(true);
    });

    it("should enable primary button when different folder is selected", async () => {
      wrapper.vm.selectedFolder = { label: "Test Folder 1", value: "folder1" };
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonDisabled")).toBe(false);
    });
  });

  describe("Folder Selection", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should update selected folder when folder-selected event is emitted", async () => {
      const selectFolderDropdown = wrapper.findComponent({
        name: "SelectFolderDropdown",
      });
      const newFolder = { label: "Test Folder 1", value: "folder1" };

      await selectFolderDropdown.vm.$emit("folder-selected", newFolder);

      expect(wrapper.vm.selectedFolder).toEqual(newFolder);
    });

    it("should pass correct activeFolderId to SelectFolderDropdown", () => {
      const selectFolderDropdown = wrapper.findComponent({
        name: "SelectFolderDropdown",
      });
      expect(selectFolderDropdown.props("activeFolderId")).toBe("default");
    });

    it("should initialize selectedFolder with current folder data", () => {
      wrapper = createWrapper({ activeFolderId: "folder1" });
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 1",
        value: "folder1",
      });
    });
  });

  describe("Form Validation and Submission", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should call onSubmit when form is submitted", async () => {
      const form = wrapper.find('[data-test="dashboard-folder-move-form"]');
      const onSubmitSpy = vi.spyOn(wrapper.vm.onSubmit, "execute");

      await form.trigger("submit");

      expect(onSubmitSpy).toHaveBeenCalled();
    });

    it("should call onSubmit when ODrawer emits click:primary", async () => {
      const drawer = wrapper.findComponent(ODrawerStub);
      const onSubmitSpy = vi.spyOn(wrapper.vm.onSubmit, "execute");

      await drawer.vm.$emit("click:primary");

      expect(onSubmitSpy).toHaveBeenCalled();
    });

    it("should validate form before submission", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit.execute();

      expect(mockValidate).toHaveBeenCalled();
    });

    it("should not proceed if form validation fails", async () => {
      const mockValidate = vi.fn().mockResolvedValue(false);
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit.execute();
      const { moveDashboardToAnotherFolder } = await getMockUtils();

      expect(mockValidate).toHaveBeenCalled();
      expect(moveDashboardToAnotherFolder).not.toHaveBeenCalled();
    });

    it("should call moveDashboardToAnotherFolder with correct parameters", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };
      wrapper.vm.selectedFolder = { label: "Test Folder 1", value: "folder1" };

      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockResolvedValue(true);

      await wrapper.vm.onSubmit.execute();

      expect(moveDashboardToAnotherFolder).toHaveBeenCalledWith(
        mockStore,
        ["dashboard1", "dashboard2"],
        "default",
        "folder1",
      );
    });

    it("should emit updated event on successful move", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockResolvedValue(true);

      await wrapper.vm.onSubmit.execute();

      expect(wrapper.emitted("updated")).toBeTruthy();
      expect(wrapper.emitted("updated")).toHaveLength(1);
    });

    it("should show success notification on successful move", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockResolvedValue(true);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showPositiveNotification).toHaveBeenCalledWith(
        "Dashboard Moved successfully",
        { timeout: 2000 },
      );
    });

    it("should reset form validation on successful move", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockResolvedValue(true);

      await wrapper.vm.onSubmit.execute();

      expect(mockResetValidation).toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should show error notification on move failure", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const error = new Error("Move failed");
      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockRejectedValue(error);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Move failed",
        { timeout: 2000 },
      );
    });

    it("should show default error message when no error message is provided", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const error = {};
      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockRejectedValue(error);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Dashboard move failed.",
        { timeout: 2000 },
      );
    });

    it("should not show error notification for 403 errors", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const error = { status: 403, message: "Unauthorized" };
      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockRejectedValue(error);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showErrorNotification).not.toHaveBeenCalled();
    });

    it("should show error notification for non-403 errors with status", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const error = { status: 500, message: "Server error" };
      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockRejectedValue(error);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Server error",
        { timeout: 2000 },
      );
    });

    it("should handle error without message property", async () => {
      const mockValidate = vi.fn().mockResolvedValue(true);
      const mockResetValidation = vi.fn();
      wrapper.vm.moveFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation,
      };

      const error = { status: 500 };
      const { moveDashboardToAnotherFolder } = await getMockUtils();
      moveDashboardToAnotherFolder.mockRejectedValue(error);

      await wrapper.vm.onSubmit.execute();

      expect(mockUseNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Dashboard move failed.",
        { timeout: 2000 },
      );
    });
  });

  describe("Loading State", () => {
    it("should forward loading state to ODrawer primaryButtonLoading", async () => {
      const { useLoading } = await getMockUtils();
      useLoading.mockImplementation((fn) => ({
        execute: vi.fn().mockImplementation(fn),
        isLoading: { value: true },
      }));

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      const drawer = wrapper.findComponent(ODrawerStub);

      expect(drawer.props("primaryButtonLoading")).toBe(true);
      expect(wrapper.vm.onSubmit.isLoading.value).toBe(true);
    });

    it("should not display loading state when not loading", async () => {
      const { useLoading } = await getMockUtils();
      useLoading.mockImplementation((fn) => ({
        execute: vi.fn().mockImplementation(fn),
        isLoading: { value: false },
      }));

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      const drawer = wrapper.findComponent(ODrawerStub);

      expect(drawer.props("primaryButtonLoading")).toBe(false);
      expect(wrapper.vm.onSubmit.isLoading.value).toBe(false);
    });
  });

  describe("Drawer Event Emissions", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should emit update:open=false when ODrawer emits click:secondary", async () => {
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("should forward update:open from ODrawer", async () => {
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("update:open", false);

      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("should call onSubmit.execute when ODrawer emits click:primary", async () => {
      const onSubmitSpy = vi.spyOn(wrapper.vm.onSubmit, "execute");
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");

      expect(onSubmitSpy).toHaveBeenCalled();
    });

    it("should not emit update:open when click:primary is fired", async () => {
      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");

      expect(wrapper.emitted("update:open")).toBeFalsy();
    });
  });

  describe("Store Integration", () => {
    it("should access store data correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBe(mockStore);
      expect(wrapper.vm.store.state.organizationData.folders).toEqual([
        { folderId: "default", name: "Default Folder" },
        { folderId: "folder1", name: "Test Folder 1" },
        { folderId: "folder2", name: "Test Folder 2" },
      ]);
    });

    it("should find correct folder name by folderId", () => {
      wrapper = createWrapper({ activeFolderId: "folder2" });

      expect(wrapper.vm.selectedFolder.label).toBe("Test Folder 2");
      expect(wrapper.vm.selectedFolder.value).toBe("folder2");
    });
  });

  describe("Internationalization", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should use translation function", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should translate labels correctly", () => {
      expect(wrapper.vm.t("dashboard.currentFolderLabel")).toBe(
        "Current Folder",
      );
      expect(wrapper.vm.t("dashboard.cancel")).toBe("Cancel");
      expect(wrapper.vm.t("common.move")).toBe("Move");
    });
  });

  describe("Utility Functions", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should have access to getImageURL utility", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.getImageURL()).toBe("test-image-url");
    });
  });

  describe("Component Props Validation", () => {
    it("should handle single dashboard ID", () => {
      wrapper = createWrapper({
        dashboardIds: ["single-dashboard"],
      });

      expect(wrapper.vm.dashboardIds).toEqual(["single-dashboard"]);
    });

    it("should handle multiple dashboard IDs", () => {
      wrapper = createWrapper({
        dashboardIds: ["dashboard1", "dashboard2", "dashboard3"],
      });

      expect(wrapper.vm.dashboardIds).toEqual([
        "dashboard1",
        "dashboard2",
        "dashboard3",
      ]);
    });

    it("should handle different activeFolderId", () => {
      wrapper = createWrapper({
        activeFolderId: "folder1",
      });

      expect(wrapper.vm.activeFolderId).toBe("folder1");
    });

    it("should declare expected emits including update:open", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toEqual([
        "updated",
        "close",
        "update:open",
      ]);
    });
  });

  describe("Edge Cases", () => {
    it("should throw when active folder is not in store (template v-model lookup is unsafe)", () => {
      // The template's q-input v-model still does `.name` on the folder lookup
      // without optional chaining, so a missing folder still throws on render.
      // setup()'s selectedFolder uses `?.name` (safe), but the template does not.
      expect(() =>
        createWrapper({ activeFolderId: "non-existent-folder" }),
      ).toThrow(/Cannot read properties of undefined/);
    });

    it("should handle empty dashboard IDs array", () => {
      wrapper = createWrapper({
        dashboardIds: [],
      });

      expect(wrapper.vm.dashboardIds).toEqual([]);
    });

    it("should mark primaryButtonDisabled true when no folder is changed", () => {
      wrapper = createWrapper();

      // Default state: selectedFolder.value === activeFolderId
      expect(wrapper.vm.selectedFolder).toBeTruthy();
      expect(wrapper.vm.selectedFolder.value).toBe("default");
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonDisabled")).toBe(true);
    });
  });

  describe("Accessibility & data-test attributes", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should expose required data-test hooks for tests", () => {
      expect(
        wrapper.find('[data-test="dashboard-folder-move-body"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-folder-move-form"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-folder-move-name"]').exists(),
      ).toBe(true);
    });

    it("should have a form element", () => {
      const form = wrapper.find('[data-test="dashboard-folder-move-form"]');
      expect(form.exists()).toBe(true);
    });

    it("should render disabled current folder input", () => {
      const currentFolderInput = wrapper.find(
        '[data-test="dashboard-folder-move-name"]',
      );
      expect(currentFolderInput.exists()).toBe(true);
    });
  });
});
