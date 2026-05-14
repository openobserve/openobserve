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
import InlineSelectFolderDropdown from "@/components/common/sidebar/InlineSelectFolderDropdown.vue";
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
  } as any;
}

// ─── Stubs ────────────────────────────────────────────────────────────────────

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
      :data-show-close="String(showClose)"
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

// Stub AddFolder: mirrors the self-contained AddFolder that owns its own
// ODrawer. Receives `open` via v-model:open and emits `update:open` to close.
const addFolderSubmitSpy = vi.fn();
const AddFolderStub = {
  name: "AddFolder",
  props: ["type", "editMode", "open"],
  emits: ["update:modelValue", "update:open"],
  template: `<div data-test="add-folder-stub"></div>`,
  setup() {
    return { submit: addFolderSubmitSpy };
  },
};

// Stub OButton so the add-folder button is a plain HTML button we can click.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "title"],
  emits: ["click"],
  template: `<button data-test="o-button-stub" :title="title" @click="$emit('click')"><slot /></button>`,
};

// ─── Global mount config ──────────────────────────────────────────────────────

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    ODrawer: ODrawerStub,
    AddFolder: AddFolderStub,
    OButton: OButtonStub,
    "q-select": {
      template: `
        <div class="q-select-stub" :data-disable="String(disable)">
          <select
            :value="modelValue"
            @change="$emit('update:modelValue', $event.target.value)"
          >
            <option
              v-for="opt in options"
              :key="opt.value"
              :value="opt.value"
            >{{ opt.label }}</option>
          </select>
        </div>`,
      props: ["modelValue", "options", "disable"],
      emits: ["update:modelValue"],
    },
    "q-icon": { template: '<i :class="name" />', props: ["name", "size"] },
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InlineSelectFolderDropdown.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    setStoreFolders("alerts", MOCK_FOLDERS);
    addFolderSubmitSpy.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(InlineSelectFolderDropdown, {
      props,
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
      expect(wrapper.vm.$options.name).toBe("InlineSelectFolderDropdown");
    });

    it("renders the q-select", () => {
      wrapper = createWrapper();
      expect(wrapper.find(".q-select-stub").exists()).toBe(true);
    });
  });

  // ─── Props ──────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("defaults modelValue to 'default'", () => {
      wrapper = createWrapper();
      expect(wrapper.props("modelValue")).toBe("default");
    });

    it("defaults type to 'alerts'", () => {
      wrapper = createWrapper();
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("defaults disable to false", () => {
      wrapper = createWrapper();
      expect(wrapper.props("disable")).toBe(false);
    });

    it("accepts a custom modelValue", () => {
      wrapper = createWrapper({ modelValue: "folder-1" });
      expect(wrapper.props("modelValue")).toBe("folder-1");
    });

    it("accepts a custom type", () => {
      wrapper = createWrapper({ type: "reports" });
      expect(wrapper.props("type")).toBe("reports");
    });

    it("accepts disable=true", () => {
      wrapper = createWrapper({ disable: true });
      expect(wrapper.props("disable")).toBe(true);
    });
  });

  // ─── Conditional rendering: Add Folder button ───────────────────────────────

  describe("Conditional rendering", () => {
    it("renders the add folder button when not disabled", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="o-button-stub"]').exists()).toBe(true);
    });

    it("does NOT render the add folder button when disable=true", () => {
      wrapper = createWrapper({ disable: true });
      expect(wrapper.find('[data-test="o-button-stub"]').exists()).toBe(false);
    });

    it("forwards disable=true to q-select stub", () => {
      wrapper = createWrapper({ disable: true });
      const select = wrapper.find(".q-select-stub");
      expect(select.attributes("data-disable")).toBe("true");
    });

    it("forwards disable=false to q-select stub by default", () => {
      wrapper = createWrapper();
      const select = wrapper.find(".q-select-stub");
      expect(select.attributes("data-disable")).toBe("false");
    });
  });

  // ─── folderOptions ───────────────────────────────────────────────────────────

  describe("folderOptions", () => {
    it("maps store folders to {label, value} options", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.folderOptions).toEqual([
        { label: "Default", value: "default" },
        { label: "My Alerts", value: "folder-1" },
        { label: "Production", value: "folder-2" },
      ]);
    });

    it("returns [] when foldersByType has no entry for the given type", () => {
      setStoreFolders("nonexistent", undefined as any);
      delete (store.state.organizationData.foldersByType as any).nonexistent;
      wrapper = createWrapper({ type: "nonexistent" });
      const vm = wrapper.vm as any;
      expect(vm.folderOptions).toEqual([]);
    });

    it("returns [] when foldersByType[type] is an empty array", () => {
      setStoreFolders("alerts", []);
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.folderOptions).toEqual([]);
    });

    it("reflects store updates reactively", async () => {
      wrapper = createWrapper();
      setStoreFolders("alerts", [{ folderId: "x", name: "X" }]);
      await nextTick();
      const vm = wrapper.vm as any;
      expect(vm.folderOptions).toEqual([{ label: "X", value: "x" }]);
    });
  });

  // ─── showDialog state ────────────────────────────────────────────────────────

  describe("showDialog state", () => {
    it("initializes showDialog to false", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).showDialog).toBe(false);
    });

    it("opens the drawer when the add folder button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="o-button-stub"]').trigger("click");
      expect((wrapper.vm as any).showDialog).toBe(true);
    });

    it("forwards open=true to AddFolder after the add button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="o-button-stub"]').trigger("click");
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("open")).toBe(true);
    });

    it("AddFolder open is false initially", () => {
      wrapper = createWrapper();
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("open")).toBe(false);
    });
  });

  // ─── ODrawer prop forwarding ────────────────────────────────────────────────


  // ─── Drawer slot content (AddFolder) ────────────────────────────────────────

  describe("Drawer slot content", () => {
    it("renders the AddFolder component inside the drawer", () => {
      wrapper = createWrapper();
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.exists()).toBe(true);
    });

    it("forwards type prop to AddFolder", () => {
      wrapper = createWrapper({ type: "reports" });
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("type")).toBe("reports");
    });

    it("forwards editMode=false to AddFolder", () => {
      wrapper = createWrapper();
      const addFolder = wrapper.findComponent(AddFolderStub);
      expect(addFolder.props("editMode")).toBe(false);
    });

    it("closes the drawer when AddFolder emits update:open=false", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).showDialog = true;
      await nextTick();

      const addFolder = wrapper.findComponent(AddFolderStub);
      await addFolder.vm.$emit("update:open", false);

      expect((wrapper.vm as any).showDialog).toBe(false);
    });
  });

  // ─── onFolderAdded ───────────────────────────────────────────────────────────

  describe("onFolderAdded", () => {
    it("closes the drawer after a folder is added", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).showDialog = true;
      await nextTick();

      (wrapper.vm as any).onFolderAdded({
        data: { name: "New Folder", folderId: "new-id" },
      });
      await nextTick();

      expect((wrapper.vm as any).showDialog).toBe(false);
    });

    it("emits 'update:modelValue' with the new folderId", async () => {
      wrapper = createWrapper();

      (wrapper.vm as any).onFolderAdded({
        data: { name: "New Folder", folderId: "new-id" },
      });
      await nextTick();

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(["new-id"]);
    });

    it("does NOT emit 'update:modelValue' when newFolder is null", async () => {
      wrapper = createWrapper();

      (wrapper.vm as any).onFolderAdded(null);
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("does NOT emit 'update:modelValue' when newFolder.data is missing", async () => {
      wrapper = createWrapper();

      (wrapper.vm as any).onFolderAdded({});
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("does NOT emit 'update:modelValue' when newFolder.data.folderId is missing", async () => {
      wrapper = createWrapper();

      (wrapper.vm as any).onFolderAdded({ data: { name: "No id" } });
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("still closes the drawer when newFolder is null", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).showDialog = true;
      await nextTick();

      (wrapper.vm as any).onFolderAdded(null);
      await nextTick();

      expect((wrapper.vm as any).showDialog).toBe(false);
    });

    it("is wired to AddFolder.update:modelValue", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).showDialog = true;
      await nextTick();

      const addFolder = wrapper.findComponent(AddFolderStub);
      await addFolder.vm.$emit("update:modelValue", {
        data: { name: "Brand New", folderId: "brand-new" },
      });

      expect((wrapper.vm as any).showDialog).toBe(false);
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual(["brand-new"]);
    });
  });

  // ─── Emit: update:modelValue from q-select ──────────────────────────────────

  describe("q-select model value", () => {
    it("emits 'update:modelValue' when q-select updates", async () => {
      wrapper = createWrapper();

      const select = wrapper.find(".q-select-stub select");
      // Set the option value, then trigger change
      (select.element as HTMLSelectElement).value = "folder-1";
      await select.trigger("change");

      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["folder-1"]);
    });

    it("passes the modelValue prop down to q-select", () => {
      wrapper = createWrapper({ modelValue: "folder-2" });
      const select = wrapper.find(".q-select-stub select");
      expect((select.element as HTMLSelectElement).value).toBe("folder-2");
    });
  });

  // ─── onMounted side effect ──────────────────────────────────────────────────

  describe("onMounted", () => {
    it("calls getFoldersListByType with the store and the type prop", async () => {
      const { getFoldersListByType } = await import("@/utils/commons");
      wrapper = createWrapper({ type: "alerts" });
      await nextTick();
      expect(getFoldersListByType).toHaveBeenCalled();
      expect((getFoldersListByType as any).mock.calls[0][1]).toBe("alerts");
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles undefined foldersByType for type gracefully", () => {
      store.state.organizationData.foldersByType = {} as any;
      wrapper = createWrapper({ type: "missing-type" });
      expect(wrapper.exists()).toBe(true);
      expect((wrapper.vm as any).folderOptions).toEqual([]);
    });
  });
});
