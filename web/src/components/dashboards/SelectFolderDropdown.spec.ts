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

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

describe("SelectFolderDropdown", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        organizationData: {
          folders: [
            { name: "default", folderId: "default" },
            { name: "Folder 1", folderId: "folder1" },
            { name: "Folder 2", folderId: "folder2" },
          ],
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/dashboards",
          name: "dashboards",
          component: { template: "<div>Dashboards</div>" },
        },
      ],
    });

    router.push("/dashboards");
  });

  it("should render the component", () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render folder dropdown", () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const dropdown = wrapper.find('[data-test="index-dropdown-stream_type"]');
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add folder button", () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-folder-move-new-add"]');
    expect(addButton.exists()).toBe(true);
  });

  it("should open add folder dialog when add button is clicked", async () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-folder-move-new-add"]');
    await addButton.trigger("click");

    expect(wrapper.vm.showAddFolderDialog).toBe(true);
  });

  it("should emit folder-selected when selectedFolder changes", async () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    wrapper.vm.selectedFolder = { label: "Folder 1", value: "folder1" };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("folder-selected")).toBeTruthy();
  });

  it("should select default folder initially", () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm.selectedFolder).toEqual({
      label: "default",
      value: "default",
    });
  });

  it("should select active folder if provided", () => {
    const wrapper = mount(SelectFolderDropdown, {
      props: {
        activeFolderId: "folder1",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm.selectedFolder).toEqual({
      label: "Folder 1",
      value: "folder1",
    });
  });

  it("should update folder list after adding new folder", async () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const newFolder = {
      data: { name: "New Folder", folderId: "newFolder123" },
    };
    await wrapper.vm.updateFolderList(newFolder);

    expect(wrapper.vm.showAddFolderDialog).toBe(false);
    expect(wrapper.vm.selectedFolder).toEqual({
      label: "New Folder",
      value: "newFolder123",
    });
  });

  it("should handle null newFolder data gracefully", async () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const currentFolder = wrapper.vm.selectedFolder;
    await wrapper.vm.updateFolderList(null);

    expect(wrapper.vm.showAddFolderDialog).toBe(false);
    expect(wrapper.vm.selectedFolder).toEqual(currentFolder);
  });

  it("should show folder options from store", () => {
    const wrapper = mount(SelectFolderDropdown, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const folders = store.state.organizationData.folders;
    expect(folders).toHaveLength(3);
    expect(folders[0].name).toBe("default");
  });

  it("should handle activeFolderId as null", () => {
    const wrapper = mount(SelectFolderDropdown, {
      props: {
        activeFolderId: null,
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.vm.selectedFolder.value).toBe("default");
  });
});
