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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


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
    "OSelect": {
      template: `
        <div class="o-select-stub" :data-test="$attrs['data-test']" :data-disable="String(disabled)">
          <select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
            <option v-for="opt in options" :key="opt.value" :value="JSON.stringify(opt)">{{ opt.label }}</option>
          </select>
        </div>`,
      props: ["modelValue", "options", "label", "disabled"],
      emits: ["update:modelValue"],
    },
    "OIcon": { template: '<i :class="name" />', props: ["name", "size"] },
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

    it("passes disableDropdown to OSelect stub as disable prop", () => {
      wrapper = createWrapper({ disableDropdown: true });
      const select = wrapper.find(".o-select-stub");
      expect(select.exists()).toBe(true);
      expect(select.attributes("data-disable")).toBe("true");
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
      // selectedFolder is a ref<string>, auto-unwrapped to the string value
      expect(vm.selectedFolder).toBe("default");
    });

    it("selects the folder matching activeFolderId when provided", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      const vm = wrapper.vm as any;
      // selectedFolder is a ref<string> — the folder ID string
      expect(vm.selectedFolder).toBe("folder-1");
    });

    it("falls back to 'default' when activeFolderId does not match any folder", () => {
      wrapper = createWrapper({ activeFolderId: "nonexistent-id" });
      const vm = wrapper.vm as any;
      expect(vm.selectedFolder).toBe("default");
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
      // selectedFolder is ref<string> — holds just the folder ID
      expect(vm.selectedFolder).toBe("new-id");
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
      // selectedFolder is ref<string>; setting it triggers the watcher
      // which looks up the folder name from the store and emits { label, value }
      vm.selectedFolder = "folder-1";
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
    it("returns the provided style as-is", () => {
      wrapper = createWrapper({ style: "height: 40px" });
      const style = (wrapper.vm as any).computedStyle;
      expect(style).toContain("height: 40px");
    });

    it("returns empty string when no style prop is provided", () => {
      wrapper = createWrapper();
      const style = (wrapper.vm as any).computedStyle;
      expect(style).toBe("");
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
      expect((wrapper.vm as any).selectedFolder).toBe("folder-1");
    });
  });

  // ─── Dropdown options ─────────────────────────────────────────────────────────

  describe("Dropdown options", () => {
    it("the select receives options from foldersByType mapped to {label, value}", () => {
      wrapper = createWrapper();
      // The select stub receives the mapped options array; we verify via vm
      const vm = wrapper.vm as any;
      // Verify store folders are accessible
      expect(vm.store.state.organizationData.foldersByType["alerts"]).toEqual(MOCK_FOLDERS);
    });

    it("renders the OSelect element", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".o-select-stub").exists()).toBe(true);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles empty foldersByType gracefully", () => {
      setStoreFolders("alerts", []);
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      // When no folders, defaults to 'default'
      expect(vm.selectedFolder).toBe("default");
    });

    it("handles undefined foldersByType for type gracefully", () => {
      store.state.organizationData.foldersByType = {} as any;
      wrapper = createWrapper({ type: "missing-type" });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
