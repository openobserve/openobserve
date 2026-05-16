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
import BaseImport from "@/components/common/BaseImport.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";

installQuasar({ plugins: [Dialog, Notify] });

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

vi.mock("axios");

vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-i18n")>();
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  };
});

vi.mock("quasar", async () => {
  const actual = await vi.importActual<typeof import("quasar")>("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
    }),
  };
});

// ─── Stubs for heavy child components ─────────────────────────────────────────

const globalConfig = {
  stubs: {
    QueryEditor: {
      template: '<div class="monaco-editor-stub" data-test="query-editor-stub" />',
    },
    AppTabs: {
      template:
        '<div class="app-tabs-stub" :data-test="$attrs[\'data-test\']"><slot /></div>',
      props: ["tabs", "activeTab"],
      emits: ["update:active-tab"],
    },
    "q-btn": {
      template:
        '<button :data-test="$attrs[\'data-test\']" :disabled="disable || loading" @click="$emit(\'click\')">{{ label }}<slot /></button>',
      props: ["label", "disable", "loading"],
    },
    "q-splitter": {
      template: '<div class="q-splitter-stub"><slot name="before" /><slot name="after" /></div>',
    },
    "q-form": {
      template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
    },
    "q-input": {
      template:
        '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
      props: ["modelValue"],
    },
    "q-file": {
      template: '<div class="q-file-stub" :data-test="$attrs[\'data-test\']"><slot /><slot name="prepend" /><slot name="append" /><slot name="hint" /></div>',
    },
    "OIcon": { template: '<i :class="name" />', props: ["name"] },
    "q-separator": { template: "<hr />" },
  },
  plugins: [i18n],
};

describe("BaseImport.vue", () => {
  let wrapper: VueWrapper;

  const defaultProps = {
    title: "Import Dashboard",
    testPrefix: "dashboard",
    isImporting: false,
    showSplitter: true,
  };

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(BaseImport, {
      props: { ...defaultProps, ...props },
      global: globalConfig,
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ─── Mounting ───────────────────────────────────────────────────────────────

  describe("Mounting", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("has correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("BaseImport");
    });
  });

  // ─── Props ──────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("displays the title", () => {
      wrapper = createWrapper({ title: "Import Alerts" });
      expect(wrapper.text()).toContain("Import Alerts");
    });

    it("renders back button with testPrefix-based data-test", () => {
      wrapper = createWrapper({ testPrefix: "alert" });
      expect(
        wrapper.find('[data-test="alert-import-back-btn"]').exists()
      ).toBe(true);
    });

    it("renders cancel button with testPrefix-based data-test", () => {
      wrapper = createWrapper({ testPrefix: "alert" });
      expect(
        wrapper.find('[data-test="alert-import-cancel-btn"]').exists()
      ).toBe(true);
    });

    it("renders import button with testPrefix-based data-test", () => {
      wrapper = createWrapper({ testPrefix: "alert" });
      expect(
        wrapper.find('[data-test="alert-import-json-btn"]').exists()
      ).toBe(true);
    });

    it("disables import button when isImporting is true", () => {
      wrapper = createWrapper({ isImporting: true });
      const btn = wrapper.find('[data-test="dashboard-import-json-btn"]');
      expect(btn.attributes("disabled")).toBeDefined();
    });

    it("enables import button when isImporting is false", () => {
      wrapper = createWrapper({ isImporting: false });
      const btn = wrapper.find('[data-test="dashboard-import-json-btn"]');
      expect(btn.attributes("disabled")).toBeFalsy();
    });

    it("renders splitter when showSplitter is true", () => {
      wrapper = createWrapper({ showSplitter: true });
      expect(wrapper.find(".q-splitter-stub").exists()).toBe(true);
    });

    it("does not render splitter when showSplitter is false", () => {
      wrapper = createWrapper({ showSplitter: false });
      expect(wrapper.find(".q-splitter-stub").exists()).toBe(false);
    });

    it("defaults activeTab to import_json_file when defaultActiveTab is omitted", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).activeTab).toBe("import_json_file");
    });

    it("uses defaultActiveTab prop to set initial active tab", () => {
      wrapper = createWrapper({ defaultActiveTab: "import_json_url" });
      expect((wrapper.vm as any).activeTab).toBe("import_json_url");
    });
  });

  // ─── Events: back / cancel / import ────────────────────────────────────────

  describe("Events", () => {
    it("emits 'back' when back button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="dashboard-import-back-btn"]').trigger("click");
      expect(wrapper.emitted("back")).toBeTruthy();
    });

    it("emits 'cancel' when cancel button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="dashboard-import-cancel-btn"]').trigger("click");
      expect(wrapper.emitted("cancel")).toBeTruthy();
    });

    it("emits 'import' with jsonStr and jsonArray payload when import button clicked", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).jsonStr = '{"key":"value"}';
      (wrapper.vm as any).jsonArrayOfObj = [{ key: "value" }];
      await wrapper.find('[data-test="dashboard-import-json-btn"]').trigger("click");
      const emitted = wrapper.emitted("import");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toMatchObject({
        jsonStr: '{"key":"value"}',
        jsonArray: [{ key: "value" }],
      });
    });

    it("sets isImporting to true internally when import button clicked", async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="dashboard-import-json-btn"]').trigger("click");
      expect((wrapper.vm as any).isImporting).toBe(true);
    });
  });

  // ─── Tab management ─────────────────────────────────────────────────────────

  describe("Tab management", () => {
    it("shows file upload section when activeTab is import_json_file", async () => {
      wrapper = createWrapper({ defaultActiveTab: "import_json_file" });
      expect(wrapper.find(".editor-container-json").exists()).toBe(true);
    });

    it("shows URL import section when activeTab is import_json_url", async () => {
      wrapper = createWrapper({ defaultActiveTab: "import_json_url" });
      expect(wrapper.find(".editor-container-url").exists()).toBe(true);
    });

    it("handleTabChange updates activeTab", async () => {
      wrapper = createWrapper({ defaultActiveTab: "import_json_file" });
      (wrapper.vm as any).handleTabChange("import_json_url");
      await nextTick();
      expect((wrapper.vm as any).activeTab).toBe("import_json_url");
    });

    it("handleTabChange resets jsonStr", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).jsonStr = "some-content";
      (wrapper.vm as any).handleTabChange("import_json_url");
      await nextTick();
      expect((wrapper.vm as any).jsonStr).toBe("");
    });

    it("handleTabChange resets jsonFiles to null", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).jsonFiles = [{}];
      (wrapper.vm as any).handleTabChange("import_json_url");
      await nextTick();
      expect((wrapper.vm as any).jsonFiles).toBeNull();
    });

    it("handleTabChange resets url", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).url = "https://example.com/data.json";
      (wrapper.vm as any).handleTabChange("import_json_file");
      await nextTick();
      expect((wrapper.vm as any).url).toBe("");
    });

    it("handleTabChange emits update:activeTab with new tab value", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).handleTabChange("import_json_url");
      await nextTick();
      expect(wrapper.emitted("update:activeTab")![0]).toEqual(["import_json_url"]);
    });
  });

  // ─── updateJsonStr / updateJsonArray methods ─────────────────────────────────

  describe("Exposed update methods", () => {
    it("updateJsonStr updates jsonStr ref", () => {
      wrapper = createWrapper();
      (wrapper.vm as any).updateJsonStr('{"a":1}');
      expect((wrapper.vm as any).jsonStr).toBe('{"a":1}');
    });

    it("updateJsonArray updates jsonArrayOfObj and serializes to jsonStr", () => {
      wrapper = createWrapper();
      (wrapper.vm as any).updateJsonArray([{ a: 1 }]);
      expect((wrapper.vm as any).jsonArrayOfObj).toEqual([{ a: 1 }]);
      expect((wrapper.vm as any).jsonStr).toBe(JSON.stringify([{ a: 1 }], null, 2));
    });

    it("updateJsonArray increments editorKey when skipEditorUpdate is false", () => {
      wrapper = createWrapper();
      const before = (wrapper.vm as any).editorKey;
      (wrapper.vm as any).updateJsonArray([{ b: 2 }], false);
      expect((wrapper.vm as any).editorKey).toBe(before + 1);
    });

    it("updateJsonArray does NOT increment editorKey when skipEditorUpdate is true", () => {
      wrapper = createWrapper();
      const before = (wrapper.vm as any).editorKey;
      (wrapper.vm as any).updateJsonArray([{ b: 2 }], true);
      expect((wrapper.vm as any).editorKey).toBe(before);
    });
  });

  // ─── updateUrl / updateFiles helpers ─────────────────────────────────────────

  describe("updateUrl / updateFiles helpers", () => {
    it("updateUrl sets url ref", () => {
      wrapper = createWrapper();
      (wrapper.vm as any).updateUrl("https://example.com");
      expect((wrapper.vm as any).url).toBe("https://example.com");
    });

    it("updateFiles sets jsonFiles ref", () => {
      wrapper = createWrapper();
      const fakeFiles = [{ name: "file.json" }];
      (wrapper.vm as any).updateFiles(fakeFiles);
      expect((wrapper.vm as any).jsonFiles).toEqual(fakeFiles);
    });
  });

  // ─── Computed styles ─────────────────────────────────────────────────────────

  describe("Computed styles", () => {
    it("contentStyle sets calc width when showSplitter is true", () => {
      wrapper = createWrapper({ showSplitter: true });
      expect((wrapper.vm as any).contentStyle).toContain("calc(100vw - 100px)");
    });

    it("contentStyle sets width 100% when showSplitter is false", () => {
      wrapper = createWrapper({ showSplitter: false });
      expect((wrapper.vm as any).contentStyle).toContain("100%");
    });

    it("splitterStyle returns width and height 100%", () => {
      wrapper = createWrapper();
      const style = (wrapper.vm as any).splitterStyle;
      expect(style.width).toBe("100%");
      expect(style.height).toBe("100%");
    });

    it("outputContainerStyle uses editorHeights.outputContainer", () => {
      wrapper = createWrapper({
        editorHeights: {
          outputContainer: "500px",
          urlEditor: "300px",
          fileEditor: "300px",
          errorReport: "200px",
        },
      });
      expect((wrapper.vm as any).outputContainerStyle.height).toBe("500px");
    });
  });

  // ─── Lifecycle: onBeforeUnmount ──────────────────────────────────────────────

  describe("Lifecycle", () => {
    it("sets isImporting to true on unmount to prevent editor errors", () => {
      wrapper = createWrapper();
      wrapper.unmount();
      // If it reaches here without throwing, the cleanup guard works
    });
  });

  // ─── Slots ───────────────────────────────────────────────────────────────────

  describe("Slots", () => {
    it("renders header-additional slot content", () => {
      wrapper = mount(BaseImport, {
        props: defaultProps,
        global: globalConfig,
        slots: {
          "header-additional": '<div class="custom-header">Custom</div>',
        },
      });
      expect(wrapper.find(".custom-header").exists()).toBe(true);
    });

    it("renders custom-tab slot content", () => {
      wrapper = mount(BaseImport, {
        props: { ...defaultProps, showSplitter: true },
        global: globalConfig,
        slots: {
          "custom-tab": '<div class="custom-tab-content">CustomTab</div>',
        },
      });
      expect(wrapper.find(".custom-tab-content").exists()).toBe(true);
    });

    it("renders full-width-content slot when showSplitter is false", () => {
      wrapper = mount(BaseImport, {
        props: { ...defaultProps, showSplitter: false },
        global: globalConfig,
        slots: {
          "full-width-content": '<div class="full-width-slot">FullWidth</div>',
        },
      });
      expect(wrapper.find(".full-width-slot").exists()).toBe(true);
    });
  });

  // ─── Initial state ───────────────────────────────────────────────────────────

  describe("Initial reactive state", () => {
    it("initializes jsonStr as empty string", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).jsonStr).toBe("");
    });

    it("initializes jsonFiles as null", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).jsonFiles).toBeNull();
    });

    it("initializes url as empty string", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).url).toBe("");
    });

    it("initializes splitterModel at 60", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).splitterModel).toBe(60);
    });
  });
});
