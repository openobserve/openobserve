// Copyright 2023 OpenObserve Inc.
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

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        organizationData: {
          folders: [
            { folderId: "folder1", name: "Test Folder", description: "Test description" },
          ],
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display new folder title when not in edit mode", () => {
    const wrapper = mount(AddFolder, {
      props: {
        editMode: false,
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("New Folder");
  });

  it("should display update folder title when in edit mode", () => {
    const wrapper = mount(AddFolder, {
      props: {
        editMode: true,
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.text()).toContain("Update Folder");
  });

  it("should render name input field", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
    expect(nameInput.exists()).toBe(true);
  });

  it("should render description input field", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
    expect(descInput.exists()).toBe(true);
  });

  it("should render cancel button", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const cancelButton = wrapper.find('[data-test="dashboard-folder-add-cancel"]');
    expect(cancelButton.exists()).toBe(true);
  });

  it("should render save button", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const saveButton = wrapper.find('[data-test="dashboard-folder-add-save"]');
    expect(saveButton.exists()).toBe(true);
  });

  it("should disable save button when name is empty", async () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    wrapper.vm.folderData.name = "";
    await wrapper.vm.$nextTick();

    const saveButton = wrapper.find('[data-test="dashboard-folder-add-save"]');
    const qBtn = saveButton.findComponent({ name: "QBtn" });
    expect(qBtn.props("disable")).toBe(true);
  });

  it("should enable save button when name is provided", async () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    wrapper.vm.folderData.name = "Valid Folder Name";
    await wrapper.vm.$nextTick();

    const saveButton = wrapper.find('[data-test="dashboard-folder-add-save"]');
    expect(saveButton.attributes("disable")).toBeUndefined();
  });

  it("should initialize with empty folder data in create mode", () => {
    const wrapper = mount(AddFolder, {
      props: {
        editMode: false,
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.folderData.name).toBe("");
    expect(wrapper.vm.folderData.description).toBe("");
  });

  it("should initialize with existing folder data in edit mode", () => {
    const wrapper = mount(AddFolder, {
      props: {
        editMode: true,
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.vm.folderData.name).toBe("Test Folder");
    expect(wrapper.vm.folderData.description).toBe("Test description");
  });

  it("should update folder name when input changes", async () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
    await nameInput.setValue("My New Folder");

    expect(wrapper.vm.folderData.name).toBe("My New Folder");
  });

  it("should update folder description when input changes", async () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
    await descInput.setValue("My folder description");

    expect(wrapper.vm.folderData.description).toBe("My folder description");
  });

  it("should emit update:modelValue on successful folder creation", async () => {
    const wrapper = mount(AddFolder, {
      props: {
        editMode: false,
      },
      global: {
        plugins: [i18n, store],
      },
    });

    wrapper.vm.folderData.name = "Test Folder";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("update:modelValue")).toBeTruthy();
  });

  it("should validate that name is required", async () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    wrapper.vm.folderData.name = "";
    await flushPromises();

    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    // Form validation should prevent submission
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should accept whitespace-trimmed name", () => {
    const wrapper = mount(AddFolder, {
      global: {
        plugins: [i18n, store],
      },
    });

    wrapper.vm.folderData.name = "  Valid Name  ";
    expect(wrapper.vm.folderData.name.trim()).toBe("Valid Name");
  });
});
