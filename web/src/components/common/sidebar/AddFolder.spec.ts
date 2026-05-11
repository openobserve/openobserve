// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddFolder from "@/components/common/sidebar/AddFolder.vue";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import i18n from "@/locales";

installQuasar({
  plugins: [Dialog, Notify],
});

// ---------------------------------------------------------------------------
// ODrawer stub — mirrors the migrated component's overlay surface.
// Renders the default slot so children are queryable. Exposes the migrated
// props/emits so tests can assert wiring without depending on the real
// ODrawer overlay implementation.
// ---------------------------------------------------------------------------
const ODrawerStub = {
  name: "ODrawer",
  template:
    "<div class='o-drawer-stub' :data-test='$attrs[\"data-test\"]' :data-open='open'>" +
    "<slot name='header' />" +
    "<slot />" +
    "<slot name='footer' />" +
    "</div>",
  props: [
    "open",
    "side",
    "persistent",
    "size",
    "width",
    "title",
    "subTitle",
    "showClose",
    "seamless",
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
};

// Mock all dependencies
vi.mock("@/utils/commons.ts", () => ({
  createFolder: vi.fn(),
  createFolderByType: vi
    .fn()
    .mockResolvedValue({ folderId: "new-folder", name: "New Folder" }),
  updateFolder: vi.fn(),
  updateFolderByType: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/utils/zincutils.ts", () => ({
  getImageURL: vi.fn().mockReturnValue("mock-image-url"),
  useLocalOrganization: vi.fn().mockReturnValue({
    organization: { id: 1, name: "test-org" },
  }),
}));

vi.mock("@/composables/useLoading.ts", () => ({
  useLoading: vi.fn().mockImplementation((fn) => ({
    execute: fn,
    isLoading: { value: false },
  })),
}));

const showPositiveNotification = vi.fn();
const showErrorNotification = vi.fn();

vi.mock("@/composables/useNotifications.ts", () => ({
  default: vi.fn().mockReturnValue({
    showPositiveNotification: (...args: unknown[]) =>
      showPositiveNotification(...args),
    showErrorNotification: (...args: unknown[]) =>
      showErrorNotification(...args),
  }),
}));

describe("AddFolder.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    // Setup store data
    store.state.organizationData.foldersByType = {
      alerts: [
        {
          folderId: "folder-1",
          name: "Test Folder",
          description: "Test Description",
        },
        {
          folderId: "folder-2",
          name: "Another Folder",
          description: "Another Description",
        },
      ],
      dashboards: [
        {
          folderId: "dash-folder-1",
          name: "Dashboard Folder",
          description: "Dashboard Description",
        },
      ],
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    return mount(AddFolder, {
      props: {
        open: true,
        folderId: "default",
        editMode: false,
        type: "alerts",
        ...props,
      },
      global: {
        plugins: [i18n],
        mocks: {
          $store: store,
        },
        provide: {
          store: store,
        },
        stubs: {
          ODrawer: ODrawerStub,
        },
      },
    });
  };

  describe("Component Tests", () => {
    it("should render the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CommonAddFolder");
    });

    it("should initialize with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.props("folderId")).toBe("default");
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("should declare update:modelValue event", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update:modelValue");
    });

    it("should declare update:open event", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update:open");
    });

    it("should initialize folderData with default values in create mode", () => {
      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;
      expect(vm.folderData.folderId).toBe("");
      expect(vm.folderData.name).toBe("");
      expect(vm.folderData.description).toBe("");
    });

    it("should initialize folderData with existing data in edit mode", () => {
      wrapper = createWrapper({
        editMode: true,
        folderId: "folder-1",
        type: "alerts",
      });
      const vm = wrapper.vm as any;
      expect(vm.folderData.folderId).toBe("folder-1");
      expect(vm.folderData.name).toBe("Test Folder");
      expect(vm.folderData.description).toBe("Test Description");
    });

    it("should expose all necessary properties", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.t).toBeInstanceOf(Function);
      expect(vm.disableColor).toBeDefined();
      expect(vm.isPwd).toBeDefined();
      expect(vm.folderData).toBeDefined();
      expect(vm.addFolderForm).toBeDefined();
      expect(vm.store).toBeDefined();
      expect(vm.isValidIdentifier).toBeDefined();
      expect(vm.getImageURL).toBeInstanceOf(Function);
      expect(vm.onSubmit).toBeDefined();
      expect(vm.defaultValue).toBeInstanceOf(Function);
      expect(vm.submit).toBeInstanceOf(Function);
    });

    it("should call defaultValue function correctly", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const defaultVal = vm.defaultValue();
      expect(defaultVal).toEqual({
        folderId: "",
        name: "",
        description: "",
      });
    });

    it("should have access to store state", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.store).toBe(store);
      expect(vm.store.state.organizationData).toBeDefined();
    });

    it("should render the ODrawer overlay surface", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-test")).toBe("dashboard-folder-dialog");
    });

    it("should render the form inputs inside the drawer", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-folder-add-name"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-folder-add-description"]').exists(),
      ).toBe(true);
    });

    it("should handle input value changes for name", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.name = "New Name Value";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.name).toBe("New Name Value");
    });

    it("should bind description input correctly", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.description = "New Description Value";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.description).toBe("New Description Value");
    });

    it("should maintain data reactivity for folder name", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.name = "Reactive Name";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.name).toBe("Reactive Name");
    });

    it("should maintain data reactivity for folder description", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.description = "Reactive Description";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.description).toBe("Reactive Description");
    });

    it("should not cause memory leaks on unmount", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.name = "Test";
      vm.folderData.description = "Description";

      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle folderId prop correctly", () => {
      wrapper = createWrapper({ folderId: "test-folder-id" });
      expect(wrapper.props("folderId")).toBe("test-folder-id");
    });

    it("should handle type prop correctly", () => {
      wrapper = createWrapper({ type: "custom-type" });
      expect(wrapper.props("type")).toBe("custom-type");
    });

    it("should use default prop values", () => {
      wrapper = mount(AddFolder, {
        global: {
          plugins: [i18n],
          mocks: { $store: store },
          provide: { store: store },
          stubs: { ODrawer: ODrawerStub },
        },
      });
      expect(wrapper.props("open")).toBe(false);
      expect(wrapper.props("folderId")).toBe("default");
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("should have onSubmit method", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.onSubmit).toBe("object");
      expect(typeof vm.onSubmit.execute).toBe("function");
    });

    it("should have submit method", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.submit).toBe("function");
    });

    it("should have defaultValue method", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.defaultValue).toBe("function");
      expect(vm.defaultValue()).toEqual({
        folderId: "",
        name: "",
        description: "",
      });
    });

    it("should have getImageURL method", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.getImageURL).toBe("function");
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      for (let i = 0; i < 5; i++) {
        vm.folderData.name = `Test ${i}`;
        await wrapper.vm.$nextTick();
      }

      expect(vm.folderData.name).toBe("Test 4");
    });

    it("should handle proper input bindings", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.name = "New Name";
      vm.folderData.description = "New Description";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.name).toBe("New Name");
      expect(vm.folderData.description).toBe("New Description");
    });

    it("should handle empty store foldersByType", () => {
      const originalFolders = store.state.organizationData.foldersByType;
      store.state.organizationData.foldersByType = {};

      wrapper = createWrapper({ editMode: false, type: "missing" });
      expect(wrapper.exists()).toBe(true);

      store.state.organizationData.foldersByType = originalFolders;
    });

    it("should handle missing type gracefully", () => {
      const originalFolders = store.state.organizationData.foldersByType;
      store.state.organizationData.foldersByType = {};

      wrapper = createWrapper({
        editMode: false,
        type: "non-existent",
      });
      expect(wrapper.exists()).toBe(true);

      store.state.organizationData.foldersByType = originalFolders;
    });

    it("should handle component mount and unmount lifecycle", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);

      const vm = wrapper.vm as any;
      vm.folderData.name = "Test Name";

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("should maintain component instance methods", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.defaultValue).toBeDefined();
      expect(vm.onSubmit).toBeDefined();
      expect(vm.getImageURL).toBeDefined();
      expect(vm.t).toBeDefined();
      expect(vm.submit).toBeDefined();
    });

    it("should have proper Vue component structure", () => {
      wrapper = createWrapper();

      expect(wrapper.vm).toBeDefined();
      expect(wrapper.vm.$options).toBeDefined();
      expect(wrapper.vm.$props).toBeDefined();
      expect(wrapper.vm.$emit).toBeDefined();
    });

    it("should maintain state consistency", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const initialState = { ...vm.folderData };
      vm.folderData.name = "Changed Name";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.name).not.toBe(initialState.name);
      expect(vm.folderData.description).toBe(initialState.description);
    });

    it("should handle component re-rendering", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.folderData.name = "Initial Name";
      await wrapper.vm.$nextTick();

      vm.folderData.name = "Updated Name";
      await wrapper.vm.$nextTick();

      expect(vm.folderData.name).toBe("Updated Name");
    });
  });

  describe("ODrawer surface — props, emits, and wiring contract", () => {
    it("forwards the `open` prop from the parent to ODrawer", async () => {
      wrapper = createWrapper({ open: true });

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);

      await wrapper.setProps({ open: false });
      expect(drawer.props("open")).toBe(false);
    });

    it("passes the correct width to ODrawer", () => {
      wrapper = createWrapper();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("width")).toBe(30);
    });

    it("passes the add-folder title to ODrawer when not in edit mode", () => {
      wrapper = createWrapper({ editMode: false });

      const drawer = wrapper.findComponent(ODrawerStub);
      // i18n key resolves; assert it's the create-mode title (non-empty string)
      expect(typeof drawer.props("title")).toBe("string");
      expect(drawer.props("title")).not.toBe("");
    });

    it("passes a different title in edit mode", () => {
      const createMode = createWrapper({ editMode: false });
      const createTitle = createMode
        .findComponent(ODrawerStub)
        .props("title");
      createMode.unmount();

      wrapper = createWrapper({
        editMode: true,
        folderId: "folder-1",
        type: "alerts",
      });
      const editTitle = wrapper.findComponent(ODrawerStub).props("title");

      expect(editTitle).not.toBe(createTitle);
      expect(typeof editTitle).toBe("string");
      expect(editTitle).not.toBe("");
    });

    it("passes the primary and secondary button labels to ODrawer", () => {
      wrapper = createWrapper();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("passes primaryButtonLoading=false when onSubmit is idle", () => {
      wrapper = createWrapper();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLoading")).toBe(false);
    });

    it("re-emits update:open=false when ODrawer emits update:open=false", async () => {
      wrapper = createWrapper({ open: true });

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();

      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("re-emits update:open=true when ODrawer emits update:open=true", async () => {
      wrapper = createWrapper({ open: false });

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("update:open", true);
      await wrapper.vm.$nextTick();

      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([true]);
    });

    it("emits update:open=false when ODrawer emits click:secondary (Cancel)", async () => {
      wrapper = createWrapper({ open: true });

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:secondary");
      await wrapper.vm.$nextTick();

      const events = wrapper.emitted("update:open");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("invokes submit() when ODrawer emits click:primary (Save)", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Stub the form validate so onSubmit.execute resolves cleanly
      vm.addFolderForm = { validate: vi.fn().mockResolvedValue(true) };
      const submitSpy = vi.spyOn(vm, "submit");

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");
      await flushPromises();

      expect(submitSpy).toHaveBeenCalled();
    });
  });

  describe("submit() — create flow", () => {
    it("emits update:modelValue and update:open=false on successful create", async () => {
      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      vm.folderData.name = "  My Folder  ";
      vm.folderData.description = "desc";
      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      const modelEvents = wrapper.emitted("update:modelValue");
      expect(modelEvents).toBeTruthy();
      expect(modelEvents![0][0]).toEqual({
        folderId: "new-folder",
        name: "New Folder",
      });

      const openEvents = wrapper.emitted("update:open");
      expect(openEvents).toBeTruthy();
      expect(openEvents![openEvents!.length - 1]).toEqual([false]);
    });

    it("does nothing when form validation fails", async () => {
      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn(),
      };

      await vm.submit();
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("trims the folder name before creating", async () => {
      const { createFolderByType } = await import("@/utils/commons");
      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      vm.folderData.name = "   Padded Name   ";
      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      expect(createFolderByType).toHaveBeenCalled();
      const callArgs = (createFolderByType as any).mock.calls[0];
      expect(callArgs[1].name).toBe("Padded Name");
    });
  });

  describe("submit() — edit flow", () => {
    it("emits update:modelValue and update:open=false on successful update", async () => {
      wrapper = createWrapper({
        editMode: true,
        folderId: "folder-1",
        type: "alerts",
      });
      const vm = wrapper.vm as any;

      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      const modelEvents = wrapper.emitted("update:modelValue");
      expect(modelEvents).toBeTruthy();
      expect(modelEvents![0][0]).toMatchObject({
        folderId: "folder-1",
        name: "Test Folder",
      });

      const openEvents = wrapper.emitted("update:open");
      expect(openEvents).toBeTruthy();
      expect(openEvents![openEvents!.length - 1]).toEqual([false]);
    });
  });

  describe("submit() — error handling", () => {
    it("does not emit update:open on create failure", async () => {
      const { createFolderByType } = await import("@/utils/commons");
      (createFolderByType as any).mockRejectedValueOnce(
        new Error("create failed"),
      );

      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      vm.folderData.name = "Name";
      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(showErrorNotification).toHaveBeenCalled();
    });

    it("does not emit update:open on update failure", async () => {
      const { updateFolderByType } = await import("@/utils/commons");
      (updateFolderByType as any).mockRejectedValueOnce(
        new Error("update failed"),
      );

      wrapper = createWrapper({
        editMode: true,
        folderId: "folder-1",
        type: "alerts",
      });
      const vm = wrapper.vm as any;

      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(showErrorNotification).toHaveBeenCalled();
    });

    it("uses the server-provided error message when present", async () => {
      const { createFolderByType } = await import("@/utils/commons");
      (createFolderByType as any).mockRejectedValueOnce({
        response: { data: { message: "Server says no" } },
      });

      wrapper = createWrapper({ editMode: false });
      const vm = wrapper.vm as any;

      vm.folderData.name = "Name";
      vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn().mockResolvedValue(undefined),
      };

      await vm.submit();
      await flushPromises();

      expect(showErrorNotification).toHaveBeenCalledWith(
        "Server says no",
        expect.objectContaining({ timeout: 2000 }),
      );
    });
  });
});
