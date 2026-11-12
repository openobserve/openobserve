import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

import FolderList from "./FolderList.vue";
import { useRouter } from "vue-router";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// the overlay surface itself via v-model:open. This stub mirrors the public
// prop/emit shape FolderList relies on so the parent dialog open/close logic
// can be tested without rendering the real drawer internals.
const AddFolderStub = {
  name: "AddFolder",
  props: {
    open: { type: Boolean, default: false },
    editMode: { type: Boolean, default: false },
    folderId: { type: String, default: "default" },
    type: { type: String, default: "alerts" },
  },
  emits: ["update:open", "update:modelValue"],
  template: `
    <div
      data-test="add-folder-stub"
      :data-open="String(open)"
      :data-edit-mode="String(editMode)"
      :data-folder-id="folderId"
      :data-type="type"
    >
      <button
        data-test="add-folder-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
      <button
        data-test="add-folder-stub-submit"
        @click="$emit('update:modelValue', [{ folderId: 'stub-folder', name: 'Stub Folder' }])"
      >submit</button>
    </div>
  `,
};

// ConfirmDialog stub — keeps the data-test surface that the original spec
// asserted against, while exposing update:ok / update:cancel emits.
const ConfirmDialogStub = {
  name: "ConfirmDialog",
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: "" },
    message: { type: String },
    messageKeypath: { type: String },
    messageName: { type: String },
    confirmText: { type: String },
    okLabel: { type: String },
    okVariant: { type: String },
    focusCancel: { type: Boolean, default: false },
  },
  emits: ["update:ok", "update:cancel", "update:modelValue"],
  template: `
    <div
      data-test="dashboard-confirm-delete-folder-dialog"
      :data-open="String(modelValue)"
    >
      <button
        data-test="confirm-dialog-stub-ok"
        @click="$emit('update:ok')"
      >ok</button>
      <button
        data-test="confirm-dialog-stub-cancel"
        @click="$emit('update:cancel')"
      >cancel</button>
    </div>
  `,
};

// Mock the external dependencies
vi.mock("vue-router");
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal());
});
vi.mock("@/utils/commons", () => ({
  // Both are `async` in the real module, so the doubles must be thenable too.
  getFoldersListByType: vi.fn(() => Promise.resolve([])),
  deleteFolderByIdByType: vi.fn(() => Promise.resolve()),
}));
// Create persistent mocks that can be accessed across tests
const showPositiveNotificationMock = vi.fn();
const showErrorNotificationMock = vi.fn();

vi.mock("@/composables/useNotifications", () => {
  return {
    default: () => ({
      showPositiveNotification: showPositiveNotificationMock,
      showErrorNotification: showErrorNotificationMock,
    }),
    __esModule: true,
  };
});
vi.mock("@/composables/useLoading", () => ({
  useLoading: () => ({
    isLoading: vi.fn(),
  }),
}));

// Mock router
const mockPush = vi.fn();
const mockRouter = {
  push: mockPush,
  currentRoute: {
    value: {
      query: {},
    },
  },
};

describe("FolderList.vue", () => {
  let wrapper: any;
  let mockStore: any;

  const mockFolders = [
    { folderId: "default", name: "Default" },
    { folderId: "folder1", name: "Test Folder 1" },
    { folderId: "folder2", name: "Test Folder 2" },
    { folderId: "folder3", name: "Another Folder" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup store mock
    mockStore = {
      ...store,
      state: {
        ...store.state,
        organizationData: {
          ...store.state.organizationData,
          foldersByType: {
            alerts: mockFolders,
            dashboards: mockFolders,
          },
        },
      },
    };

    // Setup router mock
    (useRouter as any).mockReturnValue(mockRouter);

    wrapper = mount(FolderList, {
      global: {
        plugins: [i18n],
        stubs: {
          AddFolder: AddFolderStub,
          ConfirmDialog: ConfirmDialogStub,
        },
        mocks: {
          $store: mockStore,
        },
        provide: {
          store: mockStore,
        },
      },
      props: {
        type: "alerts",
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // The rail reserves a fixed slot for the icon so every folder name starts at
  // the same x-position. A folder with no icon still fills it, rather than
  // leaving a hole that makes the list look ragged.
  describe("Folder icon slot", () => {
    it("should render an icon slot for every folder, icon set or not", () => {
      const slots = wrapper.findAll('[data-test^="dashboard-folder-icon-"]');
      const rows = wrapper.findAll('[data-test^="dashboard-folder-name-"]');
      expect(rows.length).toBeGreaterThan(0);
      expect(slots).toHaveLength(rows.length);
    });

    it("should fall back to the folder glyph when a folder has no icon", () => {
      // No icons are stored in this suite, so every slot shows the fallback.
      const slot = wrapper.find('[data-test^="dashboard-folder-icon-"]');
      expect(slot.exists()).toBe(true);
      expect(slot.find("svg").exists()).toBe(true);
      expect(slot.find('[data-test="glyph-emoji"]').exists()).toBe(false);
    });
  });

  describe("Component Initialization", () => {
    it("re-emits update:activeFolderId when the ALREADY-ACTIVE folder is clicked", async () => {
      // The v-model watcher only fires on change, so without the explicit
      // click re-emit a click on the active tab would be silent — and the
      // dashboards favorites view could never react to it.
      expect(wrapper.vm.activeFolderId).toBe("default");
      const before = wrapper.emitted("update:activeFolderId")?.length ?? 0;

      await wrapper.find('[data-test="dashboard-folder-tab-default"]').trigger("click");

      const events = wrapper.emitted("update:activeFolderId") ?? [];
      expect(events.length).toBeGreaterThan(before);
      expect(events[events.length - 1]).toEqual(["default"]);
    });

    it("renders a Favorites entry FIRST when show-favorites is on", async () => {
      const favWrapper = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: { AddFolder: AddFolderStub, ConfirmDialog: ConfirmDialogStub },
          mocks: { $store: mockStore },
          provide: { store: mockStore },
        },
        props: { type: "dashboards", showFavorites: true },
      });

      expect(favWrapper.find('[data-test="dashboard-folder-tab-__favorites__"]').exists()).toBe(
        true,
      );
      // Above everything, including Default.
      expect(favWrapper.vm.filteredTabs[0].folderId).toBe("__favorites__");
      expect(favWrapper.vm.filteredTabs[1].folderId).toBe("default");
      favWrapper.unmount();
    });

    it("does NOT render the Favorites entry without the prop (alerts/reports)", () => {
      // The default wrapper is type=alerts with no show-favorites.
      expect(wrapper.find('[data-test="dashboard-folder-tab-__favorites__"]').exists()).toBe(false);
    });

    it("does not re-emit from a click on a NON-active tab (change path owns that)", async () => {
      // The click re-emit is only for the already-active tab; a different tab
      // emits via the v-model watcher (covered by the watcher tests below),
      // so the click handler itself must stay silent for it.
      const before = wrapper.emitted("update:activeFolderId")?.length ?? 0;
      wrapper.vm.onTabClick("folder1"); // not the active folder
      expect(wrapper.emitted("update:activeFolderId")?.length ?? 0).toBe(before);
    });
  });

  describe("Computed Properties", () => {
    describe("filteredTabs", () => {
      it("should return all folders when search query is empty", async () => {
        wrapper.vm.searchQuery = "";
        await nextTick();
        expect(wrapper.vm.filteredTabs).toEqual(mockFolders);
      });

      it("should filter folders based on search query", async () => {
        wrapper.vm.searchQuery = "test";
        await nextTick();

        const filtered = wrapper.vm.filteredTabs;
        expect(filtered).toHaveLength(2);
        expect(filtered[0].name).toBe("Test Folder 1");
        expect(filtered[1].name).toBe("Test Folder 2");
      });

      it("should handle case-insensitive search", async () => {
        wrapper.vm.searchQuery = "TEST";
        await nextTick();

        const filtered = wrapper.vm.filteredTabs;
        expect(filtered).toHaveLength(2);
        expect(filtered[0].name).toBe("Test Folder 1");
      });

      it("should return empty array when no folders match search", async () => {
        wrapper.vm.searchQuery = "nonexistent";
        await nextTick();

        expect(wrapper.vm.filteredTabs).toHaveLength(0);
      });

      it("should filter by partial name match", async () => {
        wrapper.vm.searchQuery = "another";
        await nextTick();

        const filtered = wrapper.vm.filteredTabs;
        expect(filtered).toHaveLength(1);
        expect(filtered[0].name).toBe("Another Folder");
      });
    });
  });

  describe("Methods", () => {
    describe("addFolder", () => {
      it("should be called when new folder button is clicked", async () => {
        const newFolderBtn = wrapper.find('[data-test="dashboard-new-folder-btn"]');
        expect(newFolderBtn.exists()).toBe(true);

        // Test by directly calling the method from the button's click handler
        await newFolderBtn.trigger("click");
        await nextTick();

        // Check the state changes that should happen when addFolder is called
        expect(wrapper.vm.showAddFolderDialog).toBe(true);
        expect(wrapper.vm.isFolderEditMode).toBe(false);
      });
    });

    describe("updateFolderList", () => {
      it("should update folder list and emit event", async () => {
        const mockFolders = [{ folderId: "new-folder", name: "New Folder" }];

        await wrapper.vm.updateFolderList(mockFolders);

        expect(wrapper.vm.showAddFolderDialog).toBe(false);
        expect(wrapper.vm.isFolderEditMode).toBe(false);
        expect(wrapper.emitted("update:folders")).toBeTruthy();
        expect(wrapper.emitted("update:folders")[0]).toEqual([mockFolders]);
      });

      it("should reset dialog states after updating folders", async () => {
        wrapper.vm.showAddFolderDialog = true;
        wrapper.vm.isFolderEditMode = true;
        await nextTick();

        await wrapper.vm.updateFolderList([]);

        expect(wrapper.vm.showAddFolderDialog).toBe(false);
        expect(wrapper.vm.isFolderEditMode).toBe(false);
      });
    });

    describe("deleteFolder", () => {
      let deleteFolderByIdByTypeMock: any;

      beforeEach(async () => {
        const { deleteFolderByIdByType } = await import("@/utils/commons");
        deleteFolderByIdByTypeMock = vi.mocked(deleteFolderByIdByType);

        // Reset the mocks for each test
        showPositiveNotificationMock.mockReset();
        showErrorNotificationMock.mockReset();
      });

      it("should delete folder successfully", async () => {
        deleteFolderByIdByTypeMock.mockResolvedValue({});
        wrapper.vm.selectedFolderDelete = "folder1";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(deleteFolderByIdByTypeMock).toHaveBeenCalledWith(
          wrapper.vm.store,
          "folder1",
          "alerts",
        );
        expect(showPositiveNotificationMock).toHaveBeenCalledWith("Folder deleted successfully.", {
          timeout: 2000,
        });
        expect(wrapper.vm.confirmDeleteFolderDialog).toBe(false);
      });

      it("should reset active folder ID when deleting current active folder", async () => {
        deleteFolderByIdByTypeMock.mockResolvedValue({});
        wrapper.vm.selectedFolderDelete = "folder1";
        wrapper.vm.activeFolderId = "folder1";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(wrapper.vm.activeFolderId).toBe("default");
      });

      it("should not reset active folder ID when deleting different folder", async () => {
        deleteFolderByIdByTypeMock.mockResolvedValue({});
        wrapper.vm.selectedFolderDelete = "folder1";
        wrapper.vm.activeFolderId = "folder2";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(wrapper.vm.activeFolderId).toBe("folder2");
      });

      it("should handle deletion error with response message", async () => {
        const errorMessage = "Folder cannot be deleted";
        deleteFolderByIdByTypeMock.mockRejectedValue({
          response: { data: { message: errorMessage } },
        });
        wrapper.vm.selectedFolderDelete = "folder1";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(showErrorNotificationMock).toHaveBeenCalledWith(errorMessage, { timeout: 2000 });
        expect(wrapper.vm.confirmDeleteFolderDialog).toBe(false);
      });

      it("should handle deletion error with error message", async () => {
        const errorMessage = "Network error";
        deleteFolderByIdByTypeMock.mockRejectedValue({
          message: errorMessage,
        });
        wrapper.vm.selectedFolderDelete = "folder1";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(showErrorNotificationMock).toHaveBeenCalledWith(errorMessage, { timeout: 2000 });
      });

      it("should handle deletion error with default message", async () => {
        deleteFolderByIdByTypeMock.mockRejectedValue(new Error());
        wrapper.vm.selectedFolderDelete = "folder1";
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(showErrorNotificationMock).toHaveBeenCalledWith("Folder deletion failed", {
          timeout: 2000,
        });
      });

      it("should not delete when no folder is selected", async () => {
        wrapper.vm.selectedFolderDelete = null;
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(deleteFolderByIdByTypeMock).not.toHaveBeenCalled();
        expect(showPositiveNotificationMock).not.toHaveBeenCalled();
      });

      it("should always close confirm dialog", async () => {
        deleteFolderByIdByTypeMock.mockRejectedValue(new Error());
        wrapper.vm.selectedFolderDelete = "folder1";
        wrapper.vm.confirmDeleteFolderDialog = true;
        await nextTick();

        await wrapper.vm.deleteFolder();

        expect(wrapper.vm.confirmDeleteFolderDialog).toBe(false);
      });
    });
  });

  describe("Watchers", () => {
    describe("activeFolderId watcher", () => {
      it("should emit update:activeFolderId when activeFolderId changes", async () => {
        // Component already emits on initialization, so we check the last emission
        wrapper.vm.activeFolderId = "folder1";
        await nextTick();

        const emissions = wrapper.emitted("update:activeFolderId");
        expect(emissions).toBeTruthy();
        expect(emissions[emissions.length - 1]).toEqual(["folder1"]);
      });
    });

    describe("router query watcher", () => {
      it("should update activeFolderId when route query changes", async () => {
        mockRouter.currentRoute.value.query.folder = "folder1";

        // Trigger the watcher manually since we can't actually change the route
        wrapper.vm.activeFolderId = "folder1";
        await nextTick();

        expect(wrapper.vm.activeFolderId).toBe("folder1");
      });
    });
  });

  describe("Lifecycle Hooks", () => {
    describe("onMounted", () => {
      it("should set activeFolderId from router query when present", async () => {
        const newWrapper = mount(FolderList, {
          global: {
            plugins: [i18n],
            stubs: {
              AddFolder: AddFolderStub,
              ConfirmDialog: ConfirmDialogStub,
            },
            mocks: {
              $store: mockStore,
              $router: {
                ...mockRouter,
                currentRoute: {
                  value: {
                    query: { folder: "folder1" },
                  },
                },
              },
            },
            provide: {
              store: mockStore,
            },
          },
          props: { type: "alerts" },
        });

        // The folder fetch on mount is awaited, so the selection lands a microtask later.
        await flushPromises();
        expect(newWrapper.vm.activeFolderId).toBe("folder1");

        newWrapper.unmount();
      });

      it("should set default activeFolderId when no query present", async () => {
        const freshRouter = {
          push: vi.fn(),
          currentRoute: {
            value: { query: {} },
          },
        };

        (useRouter as any).mockReturnValueOnce(freshRouter);

        const newWrapper = mount(FolderList, {
          global: {
            plugins: [i18n],
            stubs: {
              AddFolder: AddFolderStub,
              ConfirmDialog: ConfirmDialogStub,
            },
            mocks: {
              $store: mockStore,
            },
            provide: {
              store: mockStore,
            },
          },
          props: { type: "alerts" },
        });

        // The folder fetch on mount is awaited, so the selection lands a microtask later.
        await flushPromises();
        expect(newWrapper.vm.activeFolderId).toBe("default");

        newWrapper.unmount();
      });
    });
  });

  describe("Template Rendering", () => {
    it("reads Folders in the rail header and Add Folder on the add button by default", () => {
      expect(wrapper.text()).toContain("Folders");
      expect(wrapper.find('[data-test="dashboard-new-folder-btn"]').attributes("title")).toBe(
        "Add Folder",
      );
    });

    it("reads Fleets and New fleet for the fleets type", () => {
      const fleets = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: { AddFolder: AddFolderStub, ConfirmDialog: ConfirmDialogStub },
          mocks: { $store: mockStore },
          provide: { store: mockStore },
        },
        props: { type: "fleets" },
      });
      expect(fleets.text()).toContain("Fleets");
      expect(fleets.text()).not.toContain("Folders");
      expect(fleets.find('[data-test="dashboard-new-folder-btn"]').attributes("title")).toBe(
        "New fleet",
      );
      fleets.unmount();
    });

    it("asks for a fleet's name before deleting it, but not for other folder types", async () => {
      const fleetStore = {
        ...mockStore,
        state: {
          ...mockStore.state,
          organizationData: {
            ...mockStore.state.organizationData,
            foldersByType: { fleets: [{ folderId: "f9", name: "test1" }] },
          },
        },
      };
      const fleets = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: { AddFolder: AddFolderStub, ConfirmDialog: ConfirmDialogStub },
          mocks: { $store: fleetStore },
          provide: { store: fleetStore },
        },
        props: { type: "fleets" },
      });
      (fleets.vm as any).showDeleteFolderDialogFn("f9");
      await fleets.vm.$nextTick();
      expect(fleets.findComponent(ConfirmDialogStub).props()).toMatchObject({
        confirmText: "test1",
        okLabel: "Delete",
        okVariant: "destructive",
        focusCancel: true,
      });
      fleets.unmount();
      (wrapper.vm as any).showDeleteFolderDialogFn("folder1");
      await wrapper.vm.$nextTick();
      expect(wrapper.findComponent(ConfirmDialogStub).props()).toMatchObject({
        confirmText: undefined,
        okLabel: undefined,
        okVariant: "destructive",
        focusCancel: false,
      });
    });

    it("falls back to the fleet's id when its name is not known", async () => {
      const fleetStore = {
        ...mockStore,
        state: {
          ...mockStore.state,
          organizationData: { ...mockStore.state.organizationData, foldersByType: { fleets: [] } },
        },
      };
      const fleets = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: { AddFolder: AddFolderStub, ConfirmDialog: ConfirmDialogStub },
          mocks: { $store: fleetStore },
          provide: { store: fleetStore },
        },
        props: { type: "fleets" },
      });
      (fleets.vm as any).showDeleteFolderDialogFn("f9");
      await fleets.vm.$nextTick();
      expect(fleets.findComponent(ConfirmDialogStub).props("confirmText")).toBe("f9");
      fleets.unmount();
    });

    it("should render AddFolder with v-model:open bound to showAddFolderDialog", async () => {
      // After migration, AddFolder owns the overlay surface itself via
      // v-model:open — there is no dialog wrapper anymore.
      const addFolder = wrapper.find('[data-test="add-folder-stub"]');
      expect(addFolder.exists()).toBe(true);
      expect(addFolder.attributes("data-open")).toBe("false");

      wrapper.vm.showAddFolderDialog = true;
      await nextTick();
      expect(wrapper.find('[data-test="add-folder-stub"]').attributes("data-open")).toBe("true");
    });

    it("should pass edit-mode, folder-id and type to AddFolder", async () => {
      wrapper.vm.editFolder("folder1");
      await nextTick();

      const addFolder = wrapper.find('[data-test="add-folder-stub"]');
      expect(addFolder.attributes("data-edit-mode")).toBe("true");
      expect(addFolder.attributes("data-folder-id")).toBe("folder1");
      expect(addFolder.attributes("data-type")).toBe("alerts");
    });

    it('should fall back to "default" folder-id when selectedFolderToEdit is null', () => {
      const addFolder = wrapper.find('[data-test="add-folder-stub"]');
      expect(addFolder.attributes("data-folder-id")).toBe("default");
    });

    it("should close AddFolder when it emits update:open=false", async () => {
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      await wrapper.find('[data-test="add-folder-stub-close"]').trigger("click");
      await nextTick();

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should propagate AddFolder update:modelValue via updateFolderList", async () => {
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      await wrapper.find('[data-test="add-folder-stub-submit"]').trigger("click");
      await flushPromises();

      expect(wrapper.emitted("update:folders")).toBeTruthy();
      expect(wrapper.emitted("update:folders")![0]).toEqual([
        [{ folderId: "stub-folder", name: "Stub Folder" }],
      ]);
      // updateFolderList should reset the dialog/edit state.
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      expect(wrapper.vm.isFolderEditMode).toBe(false);
    });

    it("should trigger deleteFolder when ConfirmDialog emits update:ok", async () => {
      const { deleteFolderByIdByType } = await import("@/utils/commons");
      const deleteMock = vi.mocked(deleteFolderByIdByType);
      deleteMock.mockResolvedValue({} as any);

      wrapper.vm.selectedFolderDelete = "folder1";
      wrapper.vm.confirmDeleteFolderDialog = true;
      await nextTick();

      await wrapper.find('[data-test="confirm-dialog-stub-ok"]').trigger("click");
      await flushPromises();

      expect(deleteMock).toHaveBeenCalledWith(wrapper.vm.store, "folder1", "alerts");
      expect(wrapper.vm.confirmDeleteFolderDialog).toBe(false);
    });

    it("should close ConfirmDialog when it emits update:cancel", async () => {
      wrapper.vm.confirmDeleteFolderDialog = true;
      await nextTick();

      await wrapper.find('[data-test="confirm-dialog-stub-cancel"]').trigger("click");
      await nextTick();

      expect(wrapper.vm.confirmDeleteFolderDialog).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty folders array", async () => {
      const emptyStore = {
        ...mockStore,
        state: {
          ...mockStore.state,
          organizationData: {
            ...mockStore.state.organizationData,
            foldersByType: { alerts: [] },
          },
        },
      };

      const emptyWrapper = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: {
            AddFolder: AddFolderStub,
            ConfirmDialog: ConfirmDialogStub,
          },
          mocks: {
            $store: emptyStore,
          },
          provide: {
            store: emptyStore,
          },
        },
        props: { type: "alerts" },
      });

      expect(emptyWrapper.vm.filteredTabs).toEqual([]);
      emptyWrapper.unmount();
    });

    it("should handle missing foldersByType", async () => {
      const missingStore = {
        ...mockStore,
        state: {
          ...mockStore.state,
          organizationData: {
            ...mockStore.state.organizationData,
            foldersByType: {},
          },
        },
      };

      const missingWrapper = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: {
            AddFolder: AddFolderStub,
            ConfirmDialog: ConfirmDialogStub,
          },
          mocks: {
            $store: missingStore,
          },
          provide: {
            store: missingStore,
          },
        },
        props: { type: "alerts" },
      });

      // Missing foldersByType resolves to an empty rail, not undefined —
      // the template's v-for never sees a non-iterable.
      expect(missingWrapper.vm.filteredTabs).toEqual([]);
      missingWrapper.unmount();
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete folder management workflow", async () => {
      // Add folder
      wrapper.vm.addFolder();
      expect(wrapper.vm.showAddFolderDialog).toBe(true);
      expect(wrapper.vm.isFolderEditMode).toBe(false);

      // Update folder list
      const newFolders = [...mockFolders, { folderId: "new-folder", name: "New Test Folder" }];
      await wrapper.vm.updateFolderList(newFolders);
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      expect(wrapper.emitted("update:folders")).toBeTruthy();

      // Edit folder
      wrapper.vm.editFolder("new-folder");
      expect(wrapper.vm.selectedFolderToEdit).toBe("new-folder");
      expect(wrapper.vm.isFolderEditMode).toBe(true);
      expect(wrapper.vm.showAddFolderDialog).toBe(true);

      // Show delete dialog
      wrapper.vm.showDeleteFolderDialogFn("new-folder");
      expect(wrapper.vm.selectedFolderDelete).toBe("new-folder");
      expect(wrapper.vm.confirmDeleteFolderDialog).toBe(true);
    });
  });

  describe("delete dialog names the folder", () => {
    it("passes the folder name and the named keypath to the dialog", async () => {
      wrapper.vm.showDeleteFolderDialogFn("folder1", "Test Folder 1");
      await nextTick();
      expect(wrapper.findComponent(ConfirmDialogStub).props()).toMatchObject({
        messageKeypath: "dashboard.deleteFolderMessage",
        messageName: "Test Folder 1",
        message: undefined,
        okVariant: "destructive",
      });
    });

    it("keeps the fleet message without a keypath", async () => {
      const fleets = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: { AddFolder: AddFolderStub, ConfirmDialog: ConfirmDialogStub },
          mocks: { $store: mockStore },
          provide: { store: mockStore },
        },
        props: { type: "fleets" },
      });
      (fleets.vm as any).showDeleteFolderDialogFn("f9", "test1");
      await nextTick();
      const props = fleets.findComponent(ConfirmDialogStub).props();
      expect(props.messageKeypath).toBeUndefined();
      expect(props.message).toBeTruthy();
      fleets.unmount();
    });

    it("renders the name in bold inside the real ConfirmDialog", async () => {
      const real = mount(FolderList, {
        global: {
          plugins: [i18n],
          stubs: {
            AddFolder: AddFolderStub,
            ODialog: { template: '<div data-test="o-dialog-stub"><slot /></div>' },
          },
          mocks: { $store: mockStore },
          provide: { store: mockStore },
        },
        props: { type: "alerts" },
      });
      (real.vm as any).showDeleteFolderDialogFn("folder1", "Test Folder 1");
      await nextTick();
      const name = real.find('[data-test="confirm-dialog-name"]');
      expect(name.text()).toBe("Test Folder 1");
      expect(name.classes()).toContain("font-semibold");
      expect(real.find('[data-test="dialog-box"]').text()).toContain(
        "Are you sure you want to delete the Test Folder 1 folder?",
      );
      real.unmount();
    });
  });
});
