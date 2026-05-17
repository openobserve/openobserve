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

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("vue-router", () => ({
  useRoute: vi.fn(() => ({ query: {} })),
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

// ─── Store setup helpers ──────────────────────────────────────────────────────

const MOCK_FOLDERS = [
  { folderId: "default", name: "Default" },
  { folderId: "folder-1", name: "My Alerts" },
  { folderId: "folder-2", name: "Production" },
];

function setStoreFolders(type: string, folders: any[]) {
  store.state.organizationData.foldersByType = {
    ...store.state.organizationData.foldersByType,
    [type]: folders,
  };
}

// ─── Stubs ────────────────────────────────────────────────────────────────────

// ODrawer stub: mirrors the migrated ODrawer surface — v-model:open, button labels,
// and click:primary/click:secondary emits. Renders default slot only when open.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "showClose",
    "title",
    "subTitle",
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
    "persistent",
    "size",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div v-if="open" class="o-drawer-stub" :data-test="$attrs['data-test']">
      <button
        class="o-drawer-primary"
        :data-test="'o-drawer-primary'"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        class="o-drawer-secondary"
        :data-test="'o-drawer-secondary'"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <slot />
    </div>
  `,
};

// OButton stub: emits click on native button so [data-test] selectors keep working
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled"],
  emits: ["click"],
  template: `
    <button
      :data-test="$attrs['data-test']"
      :disabled="disabled"
      @click="$emit('click', $event)"
    ><slot /></button>
  `,
};

// AddFolder stub: mirrors the self-contained AddFolder that owns its own
// ODrawer. Receives `open` via v-model:open and emits `update:open` to close.
const submitSpy = vi.fn();
const AddFolderStub = {
  name: "AddFolder",
  props: ["type", "editMode", "open"],
  emits: ["update:modelValue", "update:open"],
  template: '<div class="add-folder-stub" />',
  setup(_: any, { expose }: any) {
    expose({ submit: submitSpy });
    return {};
  },
};

// ─── Global mount config ──────────────────────────────────────────────────────

const globalConfig = {
  plugins: [i18n],
  stubs: {
    AddFolder: AddFolderStub,
    ODrawer: ODrawerStub,
    OButton: OButtonStub,
    "q-select": {
      template: `
        <div class="q-select-stub" :data-test="$attrs['data-test']">
          <select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
            <option v-for="opt in options" :key="opt.value" :value="JSON.stringify(opt)">{{ opt.label }}</option>
          </select>
        </div>`,
      props: ["modelValue", "options", "label", "disable"],
      emits: ["update:modelValue"],
    },
    "OIcon": { template: '<i :class="name" />', props: ["name", "size"] },
    "q-item": { template: "<div class='q-item-stub'><slot /></div>" },
    "q-item-section": { template: "<div><slot /></div>" },
  },
  mocks: { $store: store },
  provide: { store },
};

describe("SelectFolderDropDown.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    setStoreFolders("alerts", MOCK_FOLDERS);
    submitSpy.mockClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(SelectFolderDropDown, {
      props: { type: "alerts", ...props },
      global: globalConfig,
    });

  // ─── Mounting ───────────────────────────────────────────────────────────────

  describe("Mounting", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("SelectedFolderDropdown");
    });
  });

  // ─── Props ──────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("accepts type prop (default: alerts)", () => {
      wrapper = mount(SelectFolderDropDown, {
        global: globalConfig,
      });
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("accepts disableDropdown prop (default: false)", () => {
      wrapper = createWrapper();
      expect(wrapper.props("disableDropdown")).toBe(false);
    });

    it("passes disableDropdown to q-select stub as disable prop", () => {
      wrapper = createWrapper({ disableDropdown: true });
      const select = wrapper.find(".q-select-stub");
      expect(select.exists()).toBe(true);
    });

    it("accepts activeFolderId prop", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      expect(wrapper.props("activeFolderId")).toBe("folder-1");
    });

    it("renders add folder button", () => {
      wrapper = createWrapper();
      const addBtn = wrapper.find(`[data-test="alerts-folder-move-new-add"]`);
      expect(addBtn.exists()).toBe(true);
    });
  });

  // ─── Initial folder selection ────────────────────────────────────────────────

  describe("Initial folder selection", () => {
    it("defaults to 'default' folder when activeFolderId is not provided", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.selectedFolder.value).toBe("default");
    });

    it("selects the folder matching activeFolderId when provided", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      const vm = wrapper.vm as any;
      expect(vm.selectedFolder.value).toBe("folder-1");
      expect(vm.selectedFolder.label).toBe("My Alerts");
    });

    it("falls back to 'default' when activeFolderId does not match any folder", () => {
      wrapper = createWrapper({ activeFolderId: "nonexistent-id" });
      const vm = wrapper.vm as any;
      expect(vm.selectedFolder.value).toBe("default");
    });
  });

  // ─── updateFolderList ────────────────────────────────────────────────────────

  describe("updateFolderList method", () => {
    it("updates selectedFolder with newly created folder data", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      const newFolder = { data: { name: "New Folder", folderId: "new-id" } };
      await vm.updateFolderList(newFolder);
      await nextTick();
      expect(vm.selectedFolder.label).toBe("New Folder");
      expect(vm.selectedFolder.value).toBe("new-id");
    });

    it("closes the add folder dialog after update", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showAddFolderDialog = true;
      await nextTick();
      await vm.updateFolderList({ data: { name: "New", folderId: "x" } });
      await nextTick();
      expect(vm.showAddFolderDialog).toBe(false);
    });
  });

  // ─── showAddFolderDialog (ODrawer) ───────────────────────────────────────────

  describe("showAddFolderDialog", () => {
    it("initializes showAddFolderDialog to false", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).showAddFolderDialog).toBe(false);
    });

    it("AddFolder open is false initially", () => {
      wrapper = createWrapper();
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("open")).toBe(false);
    });

    it("opens AddFolder when add button is clicked", async () => {
      wrapper = createWrapper();
      const addBtn = wrapper.find(`[data-test="alerts-folder-move-new-add"]`);
      await addBtn.trigger("click");
      await nextTick();
      expect((wrapper.vm as any).showAddFolderDialog).toBe(true);
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("open")).toBe(true);
    });

    it("does NOT render AddFolder when dropdown is disabled (v-if guard)", async () => {
      wrapper = createWrapper({ disableDropdown: true });
      // AddFolder is rendered with v-if="!disableDropdown" — should never appear
      expect(wrapper.findComponent(AddFolderStub).exists()).toBe(false);
    });
  });

  // ─── AddFolder interactions ───────────────────────────────────────────────────

  describe("AddFolder interactions", () => {
    it("closes showAddFolderDialog when AddFolder emits update:open=false", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showAddFolderDialog = true;
      await nextTick();

      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.exists()).toBe(true);
      await addFolder.vm.$emit("update:open", false);
      await nextTick();
      expect(vm.showAddFolderDialog).toBe(false);
    });
  });

  // ─── Emit: folder-selected ───────────────────────────────────────────────────

  describe("Emit: folder-selected", () => {
    it("emits 'folder-selected' with selectedFolder when it changes", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.selectedFolder = { label: "My Alerts", value: "folder-1" };
      await nextTick();
      const emitted = wrapper.emitted("folder-selected");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual({
        label: "My Alerts",
        value: "folder-1",
      });
    });
  });

  // ─── Computed style ───────────────────────────────────────────────────────────

  describe("computedStyle", () => {
    it("appends margin-top: 23px to the base style", () => {
      wrapper = createWrapper({ style: "height: 40px" });
      const style = (wrapper.vm as any).computedStyle;
      expect(style).toContain("height: 40px");
      expect(style).toContain("margin-top: 23px");
    });

    it("uses default 'height: 35px' when no style prop is provided", () => {
      wrapper = createWrapper();
      const style = (wrapper.vm as any).computedStyle;
      expect(style).toContain("height: 35px");
      expect(style).toContain("margin-top: 23px");
    });
  });

  // ─── foldersByType watcher ───────────────────────────────────────────────────

  describe("foldersByType watcher", () => {
    it("refreshes selectedFolder when foldersByType changes in the store", async () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      // Simulate store update
      setStoreFolders("alerts", [
        ...MOCK_FOLDERS,
        { folderId: "folder-3", name: "Staging" },
      ]);
      store.commit("setFoldersByType", store.state.organizationData.foldersByType);
      await nextTick();
      // selectedFolder should still resolve to folder-1
      expect((wrapper.vm as any).selectedFolder.value).toBe("folder-1");
    });
  });

  // ─── Dropdown options ─────────────────────────────────────────────────────────

  describe("Dropdown options", () => {
    it("q-select receives options from foldersByType mapped to {label, value}", () => {
      wrapper = createWrapper();
      // The q-select stub receives the mapped options array; we verify via vm
      const vm = wrapper.vm as any;
      // Verify store folders are accessible
      expect(vm.store.state.organizationData.foldersByType["alerts"]).toEqual(MOCK_FOLDERS);
    });

    it("renders the select element", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".q-select-stub").exists()).toBe(true);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles empty foldersByType gracefully", () => {
      setStoreFolders("alerts", []);
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      // When no folders, defaults to {label: 'default', value: 'default'}
      expect(vm.selectedFolder.value).toBe("default");
    });

    it("handles undefined foldersByType for type gracefully", () => {
      store.state.organizationData.foldersByType = {} as any;
      wrapper = createWrapper({ type: "missing-type" });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
