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
// `folderData` mirror and no manual reset on save. Tests drive submit via the
// @submit handler (`vm.onSubmit(value)`); the validated value is the source of
// truth.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddFolder from "./AddFolder.vue";
import i18n from "@/locales";
import { createStore } from "vuex";

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
  template:
    '<input class="o-form-input-stub" :data-test="$attrs[\'data-test\']" />',
  props: ["name", "label", "required"],
};

// Mock the utils functions
vi.mock("@/utils/commons", () => ({
  createFolder: vi.fn().mockResolvedValue({
    data: { folderId: "newFolder123", name: "New Folder" },
  }),
  updateFolder: vi.fn().mockResolvedValue({
    folderId: "folder1",
    name: "Updated Folder",
  }),
}));

// Mock useNotifications
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: vi.fn(),
    showErrorNotification: vi.fn(),
  }),
}));

// Mock analytics
vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

describe("AddFolder", () => {
  let store: any;

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(AddFolder, {
      props,
      global: {
        plugins: [i18n, store],
        stubs: { OForm: OFormStub, OFormInput: OFormInputStub },
      },
    });

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        organizationData: {
          folders: [
            {
              folderId: "folder1",
              name: "Test Folder",
              description: "Test description",
            },
          ],
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = createWrapper();

    expect(wrapper.exists()).toBe(true);
  });

  it("should render name input field", () => {
    const wrapper = createWrapper();

    const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
    expect(nameInput.exists()).toBe(true);
  });

  it("should render description input field", () => {
    const wrapper = createWrapper();

    const descInput = wrapper.find(
      '[data-test="dashboard-folder-add-description"]',
    );
    expect(descInput.exists()).toBe(true);
  });

  it("should expose onSubmit as a plain async handler", () => {
    const wrapper = createWrapper();

    expect(typeof wrapper.vm.onSubmit).toBe("function");
  });

  it("exposes t, schema and onSubmit (no local folderData mirror)", () => {
    const wrapper = createWrapper();
    const vm = wrapper.vm as any;
    expect(vm.t).toBeInstanceOf(Function);
    expect(vm.addFolderSchema).toBeDefined();
    expect(typeof vm.onSubmit).toBe("function");
    // The old local model + form ref were removed (single source of truth).
    expect(vm.folderData).toBeUndefined();
    expect(vm.addFolderForm).toBeUndefined();
  });

  it("seeds blank default-values in create mode", () => {
    const wrapper = createWrapper({ editMode: false });

    const defaults = wrapper.findComponent(OFormStub).props("defaultValues");
    expect(defaults).toEqual({ name: "", description: "" });
  });

  it("seeds the folder's values as default-values in edit mode", () => {
    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    const defaults = wrapper.findComponent(OFormStub).props("defaultValues");
    expect(defaults).toEqual({ name: "Test Folder", description: "Test description" });
  });

  it("falls back to blank default-values when the folder can't be found", () => {
    const wrapper = createWrapper({ editMode: true, folderId: "missing" });

    const defaults = wrapper.findComponent(OFormStub).props("defaultValues");
    expect(defaults).toEqual({ name: "", description: "" });
  });

  it("should emit update:modelValue on successful folder creation", async () => {
    const wrapper = createWrapper({ editMode: false });

    await wrapper.vm.onSubmit({ name: "Test Folder", description: "" });
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should emit update:modelValue on successful folder update in edit mode", async () => {
    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    await wrapper.vm.onSubmit({ name: "Test Folder", description: "Test description" });
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("creates the folder with a trimmed name", async () => {
    const { createFolder } = await import("@/utils/commons");
    const wrapper = createWrapper({ editMode: false });

    await wrapper.vm.onSubmit({ name: "  Valid Name  ", description: "" });
    await flushPromises();

    expect(createFolder).toHaveBeenCalled();
    expect((createFolder as any).mock.calls[0][1].name).toBe("Valid Name");
  });

  it("updates with the prop folderId and emits", async () => {
    const { updateFolder } = await import("@/utils/commons");
    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    await wrapper.vm.onSubmit({ name: "Test Folder", description: "Test description" });
    await flushPromises();

    expect(updateFolder).toHaveBeenCalled();
    expect((updateFolder as any).mock.calls[0][1]).toBe("folder1"); // folderId arg
    const modelEvents = wrapper.emitted("update:modelValue");
    expect(modelEvents![0][0]).toMatchObject({
      folderId: "folder1",
      name: "Test Folder",
    });
  });

  it("valid input submits through the form (@submit → onSubmit) and emits", async () => {
    const wrapper = createWrapper({ editMode: false });

    // Drive the real @submit path: the OForm stub emits `submit` with the
    // validated value, which the parent routes to onSubmit.
    await wrapper.findComponent(OFormStub).vm.$emit("submit", {
      name: "Programmatic Folder",
      description: "",
    });
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should handle folder creation error gracefully", async () => {
    const commons = await import("@/utils/commons");
    (commons.createFolder as any).mockRejectedValueOnce(
      new Error("Folder creation failed"),
    );

    const wrapper = createWrapper({ editMode: false });

    await wrapper.vm.onSubmit({ name: "Valid Folder", description: "" });
    await flushPromises();

    // No update:modelValue should be emitted on failure
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should handle folder update error gracefully", async () => {
    const commons = await import("@/utils/commons");
    (commons.updateFolder as any).mockRejectedValueOnce(
      new Error("Folder updation failed"),
    );

    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    await wrapper.vm.onSubmit({ name: "Test Folder", description: "Test description" });
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });
});
