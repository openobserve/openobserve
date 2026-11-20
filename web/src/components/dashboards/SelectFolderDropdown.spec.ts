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
import { flushPromises, mount } from "@vue/test-utils";
import SelectFolderDropdown from "./SelectFolderDropdown.vue";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createFolder } from "@/utils/commons";

vi.mock("@/utils/commons", () => ({ createFolder: vi.fn() }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
const notify = vi.hoisted(() => ({ positive: vi.fn(), error: vi.fn() }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: notify.positive,
    showErrorNotification: notify.error,
  }),
}));

// The real list renders its after-options only while open; the stub always renders them.
const closeSpy = vi.fn();
const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "disabled"],
  emits: ["update:modelValue"],
  template: `<div data-test="index-dropdown-stream_type"><slot name="icon" /><slot name="after-options" /></div>`,
  setup() {
    return { close: closeSpy };
  },
};

const createWrapper = (props: Record<string, any> = {}, store: any, router: any) =>
  mount(SelectFolderDropdown, {
    props,
    global: {
      plugins: [i18n, store, router],
      stubs: { OSelect: OSelectStub },
    },
  });

describe("SelectFolderDropdown", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    vi.clearAllMocks();

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

  it("should render folder dropdown", () => {
    const wrapper = createWrapper({}, store, router);
    expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(true);
  });

  it("offers New folder inside the folder select", () => {
    const wrapper = createWrapper({}, store, router);
    const select = wrapper.find('[data-test="index-dropdown-stream_type"]');
    expect(select.find('[data-test="dashboard-folder-move-new-add"]').exists()).toBe(true);
  });

  it("should emit folder-selected when selectedFolder changes", async () => {
    const wrapper = createWrapper({}, store, router);

    wrapper.vm.selectedFolder = "folder1";
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("folder-selected")!.at(-1)).toEqual([
      { label: "Folder 1", value: "folder1" },
    ]);
  });

  it("should select default folder initially", () => {
    const wrapper = createWrapper({}, store, router);
    expect(wrapper.vm.selectedFolder).toBe("default");
  });

  it("should select active folder if provided", () => {
    const wrapper = createWrapper({ activeFolderId: "folder1" }, store, router);
    expect(wrapper.vm.selectedFolder).toBe("folder1");
  });

  it("should handle activeFolderId as null", () => {
    const wrapper = createWrapper({ activeFolderId: null }, store, router);
    expect(wrapper.vm.selectedFolder).toBe("default");
  });

  describe("inline new folder", () => {
    const startNew = async (wrapper: any) => {
      await wrapper.find('[data-test="dashboard-folder-move-new-add"]').trigger("click");
    };

    it("closes the list and shows the name field in place, with no dialog", async () => {
      const wrapper = createWrapper({}, store, router);
      expect(wrapper.find('[data-test="dashboard-folder-new-inline"]').exists()).toBe(false);

      await startNew(wrapper);

      expect(closeSpy).toHaveBeenCalled();
      expect(wrapper.find('[data-test="dashboard-folder-new-inline"]').exists()).toBe(true);
      expect(wrapper.findComponent({ name: "ODialog" }).exists()).toBe(false);
    });

    it("creates the folder and selects it", async () => {
      vi.mocked(createFolder).mockResolvedValueOnce({
        data: { name: "Brand new", folderId: "brand-new" },
      });
      const wrapper = createWrapper({}, store, router);
      await startNew(wrapper);

      await wrapper.find('[data-test="dashboard-folder-add-name"] input').setValue(" Brand new ");
      await wrapper.find('[data-test="dashboard-folder-add-create"]').trigger("click");
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(expect.anything(), {
        name: "Brand new",
        description: "",
        icon: null,
      });
      expect(wrapper.vm.selectedFolder).toBe("brand-new");
      expect(notify.positive).toHaveBeenCalled();
      expect(wrapper.find('[data-test="dashboard-folder-new-inline"]').exists()).toBe(false);
    });

    it("Enter in the name field creates the folder rather than submitting the host form", async () => {
      vi.mocked(createFolder).mockResolvedValueOnce({
        data: { name: "Keyed", folderId: "keyed" },
      });
      const wrapper = createWrapper({}, store, router);
      await startNew(wrapper);

      const input = wrapper.find('[data-test="dashboard-folder-add-name"] input');
      await input.setValue("Keyed");
      await input.trigger("keydown", { key: "Enter" });
      await flushPromises();

      expect(createFolder).toHaveBeenCalledTimes(1);
      expect(wrapper.vm.selectedFolder).toBe("keyed");
    });

    it("refuses an empty name with an error under the field", async () => {
      const wrapper = createWrapper({}, store, router);
      await startNew(wrapper);

      await wrapper.find('[data-test="dashboard-folder-add-create"]').trigger("click");
      await flushPromises();

      expect(createFolder).not.toHaveBeenCalled();
      expect(wrapper.vm.newFolderError).toBe(i18n.global.t("dashboard.nameRequired"));
    });

    it("keeps the field and says so when the create fails", async () => {
      vi.mocked(createFolder).mockRejectedValueOnce(new Error("Folder already exists"));
      const wrapper = createWrapper({}, store, router);
      await startNew(wrapper);

      await wrapper.find('[data-test="dashboard-folder-add-name"] input').setValue("Taken");
      await wrapper.find('[data-test="dashboard-folder-add-create"]').trigger("click");
      await flushPromises();

      expect(notify.error).toHaveBeenCalledWith("Folder already exists", { timeout: 2000 });
      expect(wrapper.find('[data-test="dashboard-folder-new-inline"]').exists()).toBe(true);
      expect(wrapper.vm.selectedFolder).toBe("default");
    });

    it("Cancel hides the field without creating anything", async () => {
      const wrapper = createWrapper({}, store, router);
      await startNew(wrapper);

      await wrapper.find('[data-test="dashboard-folder-add-cancel"]').trigger("click");

      expect(createFolder).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="dashboard-folder-new-inline"]').exists()).toBe(false);
    });
  });

  describe("disabled prop", () => {
    it("locks the folder select and offers no new folder when disabled", () => {
      const wrapper = createWrapper({ disabled: true }, store, router);

      expect(wrapper.findComponent({ name: "OSelect" }).props("disabled")).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-move-new-add"]').exists()).toBe(false);
    });

    it("leaves the select enabled by default", () => {
      const wrapper = createWrapper({}, store, router);
      expect(wrapper.findComponent({ name: "OSelect" }).props("disabled")).toBe(false);
    });
  });

  describe("Reactive folder list", () => {
    it("should refresh selectedFolder when the store folders list changes and current id no longer exists", async () => {
      const wrapper = createWrapper({ activeFolderId: "folder1" }, store, router);
      expect(wrapper.vm.selectedFolder).toBe("folder1");

      store.state.organizationData.folders = [{ name: "Folder 2", folderId: "folder2" }];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedFolder).toBe("default");
    });

    it("computedStyle returns an empty string", () => {
      const wrapper = createWrapper({}, store, router);
      expect(wrapper.vm.computedStyle).toBe("");
    });
  });
});
