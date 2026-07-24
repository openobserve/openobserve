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

// AddFolder is single-source-of-truth: the OForm holds name/description (seeded
// via `:default-values`), and `folderId` comes from the prop. There is no local
// `folderData` mirror, no per-field sync watches, and no manual reset on save —
// the dialog unmounts on close and remounts fresh on open. Tests drive submit
// via the @submit handler (`vm.onSubmit(value)`); the validated value is the
// source of truth.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddFolder from "@/components/common/sidebar/AddFolder.vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// ODialog stub — exposes the migrated overlay props/emits so tests can assert
// wiring without the real overlay. Renders the default slot for queryability.
// ---------------------------------------------------------------------------
const ODialogStub = {
  name: "ODialog",
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
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
};

// OForm stub: renders the form + slot and captures `defaultValues` so prefill
// can be asserted without mounting the real TanStack-powered OForm.
const OFormStub = {
  name: "OForm",
  template: '<form class="o-form-stub" @submit.prevent><slot /></form>',
  props: ["defaultValues", "schema", "greedy"],
  emits: ["submit", "reset"],
};

// OFormInput stub: a basic input so the parent renders without the real wrapper.
const OFormInputStub = {
  name: "OFormInput",
  template: '<input class="o-form-input-stub" :data-test="$attrs[\'data-test\']" />',
  props: ["name", "label", "required"],
};

// Mock all dependencies
vi.mock("@/utils/commons.ts", () => ({
  createFolder: vi.fn(),
  createFolderByType: vi.fn().mockResolvedValue({ folderId: "new-folder", name: "New Folder" }),
  updateFolder: vi.fn(),
  updateFolderByType: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/utils/zincutils.ts", () => ({
  getImageURL: vi.fn().mockReturnValue("mock-image-url"),
  useLocalOrganization: vi.fn().mockReturnValue({
    organization: { id: 1, name: "test-org" },
  }),
}));

const showPositiveNotification = vi.fn();
const showErrorNotification = vi.fn();

vi.mock("@/composables/useNotifications.ts", () => ({
  default: vi.fn().mockReturnValue({
    showPositiveNotification: (...args: unknown[]) => showPositiveNotification(...args),
    showErrorNotification: (...args: unknown[]) => showErrorNotification(...args),
  }),
}));

describe("AddFolder.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    store.state.organizationData.foldersByType = {
      alerts: [
        { folderId: "folder-1", name: "Test Folder", description: "Test Description" },
        { folderId: "folder-2", name: "Another Folder", description: "Another Description" },
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
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) =>
    mount(AddFolder, {
      props: { open: true, folderId: "default", editMode: false, type: "alerts", ...props },
      global: {
        plugins: [i18n],
        mocks: { $store: store },
        provide: { store: store },
        stubs: { ODialog: ODialogStub, OForm: OFormStub, OFormInput: OFormInputStub },
      },
    });

  describe("Component", () => {
    it("renders correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has the correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CommonAddFolder");
    });

    it("initializes with default props", () => {
      wrapper = createWrapper();
      expect(wrapper.props("folderId")).toBe("default");
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("declares update:modelValue and update:open events", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toContain("update:modelValue");
      expect(wrapper.vm.$options.emits).toContain("update:open");
    });

    it("exposes t, schema and onSubmit (no local folderData mirror)", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.t).toBeInstanceOf(Function);
      expect(vm.addFolderSchema).toBeDefined();
      expect(typeof vm.onSubmit).toBe("function");
      // The old local model + form ref were removed (single source of truth).
      expect(vm.folderData).toBeUndefined();
      expect(vm.addFolderForm).toBeUndefined();
    });

    it("has access to store state", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).store).toBe(store);
    });

    it("renders the dialog surface + form inputs", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-test")).toBe("dashboard-folder-dialog");
      expect(wrapper.find('[data-test="dashboard-folder-add-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-description"]').exists()).toBe(true);
    });

    it("seeds blank default-values in create mode", () => {
      wrapper = createWrapper({ editMode: false });
      const defaults = wrapper.findComponent(OFormStub).props("defaultValues");
      expect(defaults).toEqual({ name: "", description: "" });
    });

    it("seeds the folder's values as default-values in edit mode", () => {
      wrapper = createWrapper({ editMode: true, folderId: "folder-1", type: "alerts" });
      const defaults = wrapper.findComponent(OFormStub).props("defaultValues");
      expect(defaults).toEqual({ name: "Test Folder", description: "Test Description" });
    });

    it("handles folderId / type props", () => {
      wrapper = createWrapper({ folderId: "test-folder-id", type: "custom-type" });
      expect(wrapper.props("folderId")).toBe("test-folder-id");
      expect(wrapper.props("type")).toBe("custom-type");
    });

    it("uses default prop values", () => {
      wrapper = mount(AddFolder, {
        global: {
          plugins: [i18n],
          mocks: { $store: store },
          provide: { store: store },
          stubs: { ODialog: ODialogStub, OForm: OFormStub, OFormInput: OFormInputStub },
        },
      });
      expect(wrapper.props("open")).toBe(false);
      expect(wrapper.props("folderId")).toBe("default");
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("does not throw on unmount", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("handles empty/missing store foldersByType in edit mode", () => {
      const original = store.state.organizationData.foldersByType;
      store.state.organizationData.foldersByType = {};
      wrapper = createWrapper({ editMode: true, folderId: "x", type: "missing" });
      expect(wrapper.exists()).toBe(true);
      // Falls back to blank when the folder can't be found.
      expect(wrapper.findComponent(OFormStub).props("defaultValues")).toEqual({
        name: "",
        description: "",
      });
      store.state.organizationData.foldersByType = original;
    });
  });

  describe("Dialog surface — props, emits, wiring", () => {
    it("forwards the `open` prop to the dialog", async () => {
      wrapper = createWrapper({ open: true });
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("open")).toBe(true);
      await wrapper.setProps({ open: false });
      expect(drawer.props("open")).toBe(false);
    });

    it("passes size, labels and form-id", () => {
      wrapper = createWrapper();
      const drawer = wrapper.findComponent(ODialogStub);
      expect(drawer.props("size")).toBe("sm");
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
      expect(drawer.props("formId")).toBe("add-folder-sidebar-form");
    });

    it("uses a different title in edit vs create mode", () => {
      const createMode = createWrapper({ editMode: false });
      const createTitle = createMode.findComponent(ODialogStub).props("title");
      createMode.unmount();
      wrapper = createWrapper({ editMode: true, folderId: "folder-1", type: "alerts" });
      const editTitle = wrapper.findComponent(ODialogStub).props("title");
      expect(typeof createTitle).toBe("string");
      expect(createTitle).not.toBe("");
      expect(editTitle).not.toBe(createTitle);
    });

    it("does not bind primaryButtonLoading (auto Save spinner)", () => {
      wrapper = createWrapper();
      expect(wrapper.findComponent(ODialogStub).props("primaryButtonLoading")).toBeFalsy();
    });

    it("re-emits update:open from the dialog", async () => {
      wrapper = createWrapper({ open: true });
      const drawer = wrapper.findComponent(ODialogStub);
      await drawer.vm.$emit("update:open", false);
      const events = wrapper.emitted("update:open");
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("emits update:open=false on Cancel (click:secondary)", async () => {
      wrapper = createWrapper({ open: true });
      const drawer = wrapper.findComponent(ODialogStub);
      await drawer.vm.$emit("click:secondary");
      const events = wrapper.emitted("update:open");
      expect(events![events!.length - 1]).toEqual([false]);
    });
  });

  describe("onSubmit — create flow", () => {
    it("emits update:modelValue and update:open=false on success", async () => {
      wrapper = createWrapper({ editMode: false });
      await (wrapper.vm as any).onSubmit({ name: "  My Folder  ", description: "desc" });
      await flushPromises();

      const modelEvents = wrapper.emitted("update:modelValue");
      expect(modelEvents![0][0]).toEqual({ folderId: "new-folder", name: "New Folder" });
      const openEvents = wrapper.emitted("update:open");
      expect(openEvents![openEvents!.length - 1]).toEqual([false]);
    });

    it("does not call the API without a submit", async () => {
      wrapper = createWrapper({ editMode: false });
      const { createFolderByType } = await import("@/utils/commons");
      expect(createFolderByType).not.toHaveBeenCalled();
    });

    it("trims the folder name before creating", async () => {
      const { createFolderByType } = await import("@/utils/commons");
      wrapper = createWrapper({ editMode: false });
      await (wrapper.vm as any).onSubmit({ name: "   Padded Name   ", description: "" });
      await flushPromises();
      expect(createFolderByType).toHaveBeenCalled();
      expect((createFolderByType as any).mock.calls[0][1].name).toBe("Padded Name");
    });
  });

  describe("onSubmit — edit flow", () => {
    it("updates with the prop folderId and emits", async () => {
      const { updateFolderByType } = await import("@/utils/commons");
      wrapper = createWrapper({ editMode: true, folderId: "folder-1", type: "alerts" });
      await (wrapper.vm as any).onSubmit({ name: "Test Folder", description: "Test Description" });
      await flushPromises();

      expect(updateFolderByType).toHaveBeenCalled();
      expect((updateFolderByType as any).mock.calls[0][1]).toBe("folder-1"); // folderId arg
      const modelEvents = wrapper.emitted("update:modelValue");
      expect(modelEvents![0][0]).toMatchObject({ folderId: "folder-1", name: "Test Folder" });
      const openEvents = wrapper.emitted("update:open");
      expect(openEvents![openEvents!.length - 1]).toEqual([false]);
    });
  });

  describe("onSubmit — error handling", () => {
    it("does not emit update:open on create failure", async () => {
      const { createFolderByType } = await import("@/utils/commons");
      (createFolderByType as any).mockRejectedValueOnce(new Error("create failed"));
      wrapper = createWrapper({ editMode: false });
      await (wrapper.vm as any).onSubmit({ name: "Name", description: "" });
      await flushPromises();
      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(showErrorNotification).toHaveBeenCalled();
    });

    it("does not emit update:open on update failure", async () => {
      const { updateFolderByType } = await import("@/utils/commons");
      (updateFolderByType as any).mockRejectedValueOnce(new Error("update failed"));
      wrapper = createWrapper({ editMode: true, folderId: "folder-1", type: "alerts" });
      await (wrapper.vm as any).onSubmit({ name: "Test Folder", description: "Test Description" });
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
      await (wrapper.vm as any).onSubmit({ name: "Name", description: "" });
      await flushPromises();
      expect(showErrorNotification).toHaveBeenCalledWith(
        "Server says no",
        expect.objectContaining({ timeout: 2000 }),
      );
    });
  });
});
