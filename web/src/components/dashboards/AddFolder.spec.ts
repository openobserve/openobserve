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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AddFolder from "./AddFolder.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";

installQuasar();

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

  it("should expose submit method", () => {
    const wrapper = createWrapper();

    expect(typeof wrapper.vm.submit).toBe("function");
  });

  it("should expose onSubmit loading state", () => {
    const wrapper = createWrapper();

    expect(wrapper.vm.onSubmit).toBeDefined();
    expect(wrapper.vm.onSubmit.isLoading).toBeDefined();
  });

  it("should initialize with empty folder data in create mode", () => {
    const wrapper = createWrapper({ editMode: false });

    expect(wrapper.vm.folderData.name).toBe("");
    expect(wrapper.vm.folderData.description).toBe("");
    expect(wrapper.vm.folderData.folderId).toBe("");
  });

  it("should initialize with existing folder data in edit mode", () => {
    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    expect(wrapper.vm.folderData.name).toBe("Test Folder");
    expect(wrapper.vm.folderData.description).toBe("Test description");
  });

  it("should update folder name when input changes", async () => {
    const wrapper = createWrapper();

    const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
    await nameInput.setValue("My New Folder");

    expect(wrapper.vm.folderData.name).toBe("My New Folder");
  });

  it("should update folder description when input changes", async () => {
    const wrapper = createWrapper();

    const descInput = wrapper.find(
      '[data-test="dashboard-folder-add-description"]',
    );
    await descInput.setValue("My folder description");

    expect(wrapper.vm.folderData.description).toBe("My folder description");
  });

  it("should emit update:modelValue on successful folder creation", async () => {
    const wrapper = createWrapper({ editMode: false });

    wrapper.vm.folderData.name = "Test Folder";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should emit update:modelValue on successful folder update in edit mode", async () => {
    const wrapper = createWrapper({ editMode: true, folderId: "folder1" });

    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should not emit update:modelValue when name is empty (validation fails)", async () => {
    const wrapper = createWrapper();

    wrapper.vm.folderData.name = "";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should not emit update:modelValue when name is whitespace-only", async () => {
    const wrapper = createWrapper();

    wrapper.vm.folderData.name = "   ";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should accept whitespace-trimmed name", () => {
    const wrapper = createWrapper();

    wrapper.vm.folderData.name = "  Valid Name  ";
    expect(wrapper.vm.folderData.name.trim()).toBe("Valid Name");
  });

  it("should handle folder creation error gracefully", async () => {
    const commons = await import("@/utils/commons");
    (commons.createFolder as any).mockRejectedValueOnce(
      new Error("Folder creation failed"),
    );

    const wrapper = createWrapper({ editMode: false });

    wrapper.vm.folderData.name = "Valid Folder";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
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

    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("submit() should trigger onSubmit.execute", async () => {
    const wrapper = createWrapper({ editMode: false });

    wrapper.vm.folderData.name = "Programmatic Folder";
    await flushPromises();

    await wrapper.vm.submit();
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should reset folder data after successful creation", async () => {
    const wrapper = createWrapper({ editMode: false });

    wrapper.vm.folderData.name = "Folder To Reset";
    wrapper.vm.folderData.description = "desc";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.vm.folderData.name).toBe("");
    expect(wrapper.vm.folderData.description).toBe("");
    expect(wrapper.vm.folderData.folderId).toBe("");
  });
});
