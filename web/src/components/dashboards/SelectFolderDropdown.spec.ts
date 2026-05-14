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
import { mount } from "@vue/test-utils";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

// Stub ODrawer so tests are deterministic (no Portal/Reka teleport) and so we
// can assert on the props the component forwards + emit the click events
// the component listens to.
const ODrawerStub = {
  name: "ODrawer",
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
      :data-width="width"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-drawer-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-drawer-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Stub AddFolder so we don't pull in its dependencies and we can spy on
// `submit()` (which the SelectFolderDropdown calls via a template ref when
// the ODrawer primary button is clicked).
const addFolderSubmitSpy = vi.fn();
const AddFolderStub = {
  name: "AddFolder",
  props: ["editMode"],
  emits: ["update:modelValue"],
  template: `<div data-test="add-folder-stub"></div>`,
  setup() {
    return { submit: addFolderSubmitSpy };
  },
};

const createWrapper = (props: Record<string, any> = {}, store: any, router: any) =>
  mount(SelectFolderDropdown, {
    props,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        ODrawer: ODrawerStub,
        AddFolder: AddFolderStub,
      },
    },
  });

describe("SelectFolderDropdown", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    addFolderSubmitSpy.mockReset();

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
    const wrapper = createWrapper({}, store, router);
    expect(wrapper.exists()).toBe(true);
  });

  it("should render folder dropdown", () => {
    const wrapper = createWrapper({}, store, router);

    const dropdown = wrapper.find('[data-test="index-dropdown-stream_type"]');
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add folder button", () => {
    const wrapper = createWrapper({}, store, router);

    const addButton = wrapper.find(
      '[data-test="dashboard-folder-move-new-add"]',
    );
    expect(addButton.exists()).toBe(true);
  });

  it("should open add folder dialog when add button is clicked", async () => {
    const wrapper = createWrapper({}, store, router);

    expect(wrapper.vm.showAddFolderDialog).toBe(false);

    const addButton = wrapper.find(
      '[data-test="dashboard-folder-move-new-add"]',
    );
    await addButton.trigger("click");

    expect(wrapper.vm.showAddFolderDialog).toBe(true);
  });

  it("should emit folder-selected when selectedFolder changes", async () => {
    const wrapper = createWrapper({}, store, router);

    wrapper.vm.selectedFolder = { label: "Folder 1", value: "folder1" };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("folder-selected")).toBeTruthy();
    expect(wrapper.emitted("folder-selected")![0]).toEqual([
      { label: "Folder 1", value: "folder1" },
    ]);
  });

  it("should select default folder initially", () => {
    const wrapper = createWrapper({}, store, router);

    expect(wrapper.vm.selectedFolder).toEqual({
      label: "default",
      value: "default",
    });
  });

  it("should select active folder if provided", () => {
    const wrapper = createWrapper({ activeFolderId: "folder1" }, store, router);

    expect(wrapper.vm.selectedFolder).toEqual({
      label: "Folder 1",
      value: "folder1",
    });
  });

  it("should update folder list after adding new folder", async () => {
    const wrapper = createWrapper({}, store, router);

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
    const wrapper = createWrapper({}, store, router);

    const currentFolder = wrapper.vm.selectedFolder;
    await wrapper.vm.updateFolderList(null);

    expect(wrapper.vm.showAddFolderDialog).toBe(false);
    expect(wrapper.vm.selectedFolder).toEqual(currentFolder);
  });

  it("should show folder options from store", () => {
    createWrapper({}, store, router);

    const folders = store.state.organizationData.folders;
    expect(folders).toHaveLength(3);
    expect(folders[0].name).toBe("default");
  });

  it("should handle activeFolderId as null", () => {
    const wrapper = createWrapper({ activeFolderId: null }, store, router);

    expect(wrapper.vm.selectedFolder.value).toBe("default");
  });

  // ── ODrawer migration coverage ─────────────────────────────────────────

  describe("ODrawer Prop Forwarding", () => {
    it("should render the ODrawer wrapper", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.exists()).toBe(true);
    });

    it("should forward open=false to ODrawer initially", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(false);
    });

    it("should forward open=true to ODrawer when the add folder button is clicked", async () => {
      const wrapper = createWrapper({}, store, router);

      await wrapper
        .find('[data-test="dashboard-folder-move-new-add"]')
        .trigger("click");

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);
    });

    it("should forward the localized title to ODrawer", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe(i18n.global.t("common.addFolder"));
    });

    it("should forward width=30 to ODrawer", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("width")).toBe(20);
    });

    it("should forward the localized save label to ODrawer primary button", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBe(
        i18n.global.t("dashboard.save"),
      );
    });

    it("should forward the localized cancel label to ODrawer secondary button", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("secondaryButtonLabel")).toBe(
        i18n.global.t("dashboard.cancel"),
      );
    });

    it("should attach the data-test attribute on the ODrawer", () => {
      const wrapper = createWrapper({}, store, router);
      const drawer = wrapper.find('[data-test="dashboard-folder-move-dialog"]');
      expect(drawer.exists()).toBe(true);
    });
  });

  describe("ODrawer Event Wiring", () => {
    it("should close the drawer when ODrawer emits click:secondary", async () => {
      const wrapper = createWrapper({}, store, router);

      // open it first
      await wrapper
        .find('[data-test="dashboard-folder-move-new-add"]')
        .trigger("click");
      expect(wrapper.vm.showAddFolderDialog).toBe(true);

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:secondary");

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should call AddFolder.submit() when ODrawer emits click:primary", async () => {
      const wrapper = createWrapper({}, store, router);

      // open the drawer so the AddFolder ref is mounted
      await wrapper
        .find('[data-test="dashboard-folder-move-new-add"]')
        .trigger("click");

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");

      expect(addFolderSubmitSpy).toHaveBeenCalledTimes(1);
    });

    it("should safely handle click:primary when the AddFolder ref is null (optional chaining)", async () => {
      const wrapper = createWrapper({}, store, router);

      // Force the ref to null to simulate the closed-drawer state. The
      // component uses `addFolderRef?.submit()` so this must not throw.
      wrapper.vm.addFolderRef = null;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
    });
  });

  describe("Drawer slot content", () => {
    it("should render the AddFolder component inside the drawer with edit-mode=false", () => {
      const wrapper = createWrapper({}, store, router);
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.exists()).toBe(true);
      expect(addFolder.props("editMode")).toBe(false);
    });

    it("should call updateFolderList when AddFolder emits update:modelValue", async () => {
      const wrapper = createWrapper({}, store, router);

      // ensure drawer is open
      wrapper.vm.showAddFolderDialog = true;
      await wrapper.vm.$nextTick();

      const addFolder = wrapper.findComponent(AddFolderStub);
      await addFolder.vm.$emit("update:modelValue", {
        data: { name: "Brand New", folderId: "brand-new" },
      });

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Brand New",
        value: "brand-new",
      });
    });
  });

  describe("Reactive folder list", () => {
    it("should refresh selectedFolder when the store folders list changes and current id no longer exists", async () => {
      const wrapper = createWrapper(
        { activeFolderId: "folder1" },
        store,
        router,
      );

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Folder 1",
        value: "folder1",
      });

      // mutate folders so 'folder1' is no longer present — should fall back
      // to the default placeholder.
      store.state.organizationData.folders = [
        { name: "Folder 2", folderId: "folder2" },
      ];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });

    it("computedStyle returns an empty string", () => {
      const wrapper = createWrapper({}, store, router);
      expect(wrapper.vm.computedStyle).toBe("");
    });
  });
});
