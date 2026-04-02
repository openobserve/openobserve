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

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import JsonEditor from "@/components/common/JsonEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `/mocked/${path}`),
  useLocalOrganization: vi.fn(() => ({ identifier: "default", name: "Default Org" })),
  useLocalCurrentUser: vi.fn(() => ({ email: "test@example.com", name: "Test User" })),
  useLocalTimezone: vi.fn(() => "UTC"),
}));

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true" },
}));

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => ({ pipelineObj: { value: {} } }),
}));

vi.mock("@/types/chat", () => ({}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps = {
  data: { name: "Test", id: "123" },
  title: "JSON Editor Test",
  type: "alerts",
  validationErrors: [] as string[],
  isEditing: false,
};

const globalConfig = {
  plugins: [i18n],
  provide: { store },
  stubs: {
    "query-editor": {
      template:
        '<div class="monaco-editor" data-test="common-json-editor" @update:query="$emit(\'update:query\', $event)"><slot /></div>',
      emits: ["update:query"],
    },
    O2AIChat: {
      template: '<div class="o2-ai-chat"><slot /></div>',
    },
  },
};

describe("JsonEditor", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    store.state.theme = "light";
    store.state.isAiChatEnabled = false;
    store.state.zoConfig = {
      ...store.state.zoConfig,
      sql_mode: false,
      version: "test",
      sql_mode_manual_trigger: false,
      commit_hash: "test",
      build_date: "test",
      default_fts_keys: [],
      show_stream_stats_doc_num: true,
      data_retention_days: true,
      extended_data_retention_days: 30,
      user_defined_schemas_enabled: true,
      super_cluster_enabled: false,
      query_on_stream_selection: false,
      default_functions: [],
      timestamp_column: "_timestamp",
      ai_enabled: true,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const createWrapper = (props: Record<string, any> = {}) =>
    mount(JsonEditor, {
      props: { ...defaultProps, ...props },
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
      expect(wrapper.vm.$options.name).toBe("JsonEditor");
    });

    it("renders the title", () => {
      wrapper = createWrapper({ title: "My JSON Editor" });
      expect(wrapper.text()).toContain("My JSON Editor");
    });
  });

  // ─── Props ──────────────────────────────────────────────────────────────────

  describe("Props", () => {
    it("accepts data, title, and type props", () => {
      wrapper = createWrapper();
      expect(wrapper.props("data")).toEqual({ name: "Test", id: "123" });
      expect(wrapper.props("title")).toBe("JSON Editor Test");
      expect(wrapper.props("type")).toBe("alerts");
    });

    it("defaults validationErrors to empty array", () => {
      wrapper = mount(JsonEditor, {
        props: { data: {}, title: "T", type: "pipelines" },
        global: globalConfig,
      });
      expect(wrapper.props("validationErrors")).toEqual([]);
    });

    it("defaults isEditing to false", () => {
      wrapper = createWrapper();
      expect(wrapper.props("isEditing")).toBe(false);
    });
  });

  // ─── onMounted: jsonContent initialization ───────────────────────────────────

  describe("onMounted", () => {
    it("sets jsonContent to JSON.stringify(data, null, 2) on mount", () => {
      const data = { name: "Alert 1", id: "abc" };
      wrapper = createWrapper({ data });
      expect((wrapper.vm as any).jsonContent).toBe(JSON.stringify(data, null, 2));
    });

    it("stores protected fields for pipelines type on mount", () => {
      const data = { pipeline_id: "p1", org: "myorg", name: "MyPipeline", other: "x" };
      wrapper = createWrapper({ data, type: "pipelines" });
      const storedFields = (wrapper.vm as any).storedFields;
      expect(storedFields.pipeline_id).toBe("p1");
      expect(storedFields.org).toBe("myorg");
      expect(storedFields.name).toBe("MyPipeline");
    });

    it("stores protected fields for alerts type on mount", () => {
      const data = { id: "a1", name: "alert", org_id: "org1", owner: "user" };
      wrapper = createWrapper({ data, type: "alerts" });
      const storedFields = (wrapper.vm as any).storedFields;
      expect(storedFields.id).toBe("a1");
      expect(storedFields.name).toBe("alert");
      expect(storedFields.org_id).toBe("org1");
    });

    it("stores stream-related protected fields for alerts when isEditing=true", () => {
      const data = {
        id: "a1",
        name: "alert",
        org_id: "org",
        stream_name: "logs",
        stream_type: "logs",
        is_real_time: true,
      };
      wrapper = createWrapper({ data, type: "alerts", isEditing: true });
      const storedFields = (wrapper.vm as any).storedFields;
      expect(storedFields.stream_name).toBe("logs");
      expect(storedFields.stream_type).toBe("logs");
      expect(storedFields.is_real_time).toBe(true);
    });

    it("does NOT store stream-related fields for alerts when isEditing=false", () => {
      const data = { id: "a1", stream_name: "logs", stream_type: "logs" };
      wrapper = createWrapper({ data, type: "alerts", isEditing: false });
      const storedFields = (wrapper.vm as any).storedFields;
      expect(storedFields.stream_name).toBeUndefined();
      expect(storedFields.stream_type).toBeUndefined();
    });
  });

  // ─── protectedFields computed ────────────────────────────────────────────────

  describe("protectedFields computed", () => {
    it("returns pipeline_id, org, name for 'pipelines' type", () => {
      wrapper = createWrapper({ type: "pipelines" });
      const fields = (wrapper.vm as any).protectedFields;
      expect(fields).toContain("pipeline_id");
      expect(fields).toContain("org");
      expect(fields).toContain("name");
    });

    it("returns base alert fields for 'alerts' type when isEditing=false", () => {
      wrapper = createWrapper({ type: "alerts", isEditing: false });
      const fields = (wrapper.vm as any).protectedFields;
      expect(fields).toContain("id");
      expect(fields).toContain("name");
      expect(fields).toContain("org_id");
      expect(fields).not.toContain("stream_name");
    });

    it("includes stream fields for 'alerts' type when isEditing=true", () => {
      wrapper = createWrapper({ type: "alerts", isEditing: true });
      const fields = (wrapper.vm as any).protectedFields;
      expect(fields).toContain("stream_name");
      expect(fields).toContain("stream_type");
      expect(fields).toContain("is_real_time");
    });

    it("returns empty array for unknown type", () => {
      wrapper = createWrapper({ type: "unknown" });
      expect((wrapper.vm as any).protectedFields).toEqual([]);
    });
  });

  // ─── handleEditorChange ──────────────────────────────────────────────────────

  describe("handleEditorChange", () => {
    it("updates jsonContent with new valid JSON when no protected fields change", async () => {
      wrapper = createWrapper({ data: { id: "1", name: "a" }, type: "alerts" });
      const newJson = JSON.stringify({ id: "1", name: "a", extra: "new" });
      (wrapper.vm as any).handleEditorChange(newJson);
      await nextTick();
      expect((wrapper.vm as any).jsonContent).toBe(newJson);
    });

    it("adds validation error when protected field is changed", async () => {
      const data = { id: "fixed-id", name: "original" };
      wrapper = createWrapper({ data, type: "alerts" });
      const modified = JSON.stringify({ id: "hacked", name: "original" });
      (wrapper.vm as any).handleEditorChange(modified);
      await nextTick();
      const errors: string[] = (wrapper.vm as any).validationErrors;
      expect(errors.some((e: string) => e.includes("Cannot modify"))).toBe(true);
    });

    it("reverts protected field to its original stored value", async () => {
      const data = { id: "orig-id", name: "orig-name" };
      wrapper = createWrapper({ data, type: "alerts" });
      const modified = JSON.stringify({ id: "changed-id", name: "orig-name" });
      (wrapper.vm as any).handleEditorChange(modified);
      await nextTick();
      const content = JSON.parse((wrapper.vm as any).jsonContent);
      expect(content.id).toBe("orig-id");
    });

    it("adds 'Invalid JSON format' error for malformed JSON", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).handleEditorChange("not-valid-json{{{");
      await nextTick();
      expect((wrapper.vm as any).validationErrors).toContain("Invalid JSON format");
    });

    it("clears previous protected-field errors when JSON is valid and no changes", async () => {
      const data = { id: "1", name: "a" };
      wrapper = createWrapper({ data, type: "alerts" });
      (wrapper.vm as any).validationErrors = [
        "Cannot modify id field directly , will be reverted to the original value",
      ];
      const goodJson = JSON.stringify({ id: "1", name: "a" });
      (wrapper.vm as any).handleEditorChange(goodJson);
      await nextTick();
      const errors: string[] = (wrapper.vm as any).validationErrors;
      expect(errors.some((e: string) => e.startsWith("Cannot modify"))).toBe(false);
    });
  });

  // ─── saveChanges ─────────────────────────────────────────────────────────────

  describe("saveChanges", () => {
    it("emits 'saveJson' with stringified content including stored fields", async () => {
      const data = { id: "a1", name: "alert", org_id: "org" };
      wrapper = createWrapper({ data, type: "alerts" });
      (wrapper.vm as any).saveChanges();
      await nextTick();
      const emitted = wrapper.emitted("saveJson");
      expect(emitted).toBeTruthy();
      const saved = JSON.parse(emitted![0][0] as string);
      expect(saved.id).toBe("a1");
      expect(saved.name).toBe("alert");
    });

    it("merges storedFields back into parsed content on save", async () => {
      const data = { pipeline_id: "p1", org: "myorg", name: "pipeline" };
      wrapper = createWrapper({ data, type: "pipelines" });
      (wrapper.vm as any).jsonContent = JSON.stringify({ pipeline_id: "p1", org: "myorg" });
      (wrapper.vm as any).saveChanges();
      await nextTick();
      const saved = JSON.parse(wrapper.emitted("saveJson")![0][0] as string);
      expect(saved.name).toBe("pipeline"); // restored from storedFields
    });

    it("shows 'Invalid JSON format' error when jsonContent is invalid JSON", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).jsonContent = "{ invalid json }";
      (wrapper.vm as any).saveChanges();
      await nextTick();
      expect((wrapper.vm as any).validationErrors).toContain("Invalid JSON format");
    });

    it("does not emit 'saveJson' when jsonContent is invalid JSON", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).jsonContent = "NOT JSON";
      (wrapper.vm as any).saveChanges();
      await nextTick();
      expect(wrapper.emitted("saveJson")).toBeFalsy();
    });

    it("emits 'saveJson' when save button is clicked", async () => {
      wrapper = createWrapper({ data: { id: "1" }, type: "alerts" });
      const saveBtn = wrapper.find('[data-test="json-editor-save"]');
      await saveBtn.trigger("click");
      expect(wrapper.emitted("saveJson")).toBeTruthy();
    });
  });

  // ─── Validation errors display ───────────────────────────────────────────────

  describe("Validation errors rendering", () => {
    it("shows validation errors section when validationErrors is non-empty", async () => {
      wrapper = createWrapper({ validationErrors: ["Field 'id' is required"] });
      await nextTick();
      expect(wrapper.find(".validation-errors").exists()).toBe(true);
      expect(wrapper.text()).toContain("Field 'id' is required");
    });

    it("hides validation errors section when validationErrors is empty", () => {
      wrapper = createWrapper({ validationErrors: [] });
      expect(wrapper.find(".validation-errors").exists()).toBe(false);
    });

    it("renders multiple validation errors as list items", async () => {
      wrapper = createWrapper({
        validationErrors: ["Error one", "Error two", "Error three"],
      });
      await nextTick();
      const errors = wrapper.findAll(".validation-errors li");
      expect(errors.length).toBe(3);
    });
  });

  // ─── Watch: props.data ───────────────────────────────────────────────────────

  describe("Watch: props.data", () => {
    it("updates jsonContent when props.data changes", async () => {
      wrapper = createWrapper({ data: { name: "old" } });
      await wrapper.setProps({ data: { name: "new" } });
      await nextTick();
      expect((wrapper.vm as any).jsonContent).toBe(JSON.stringify({ name: "new" }, null, 2));
    });

    it("updates storedFields for protected fields when props.data changes", async () => {
      wrapper = createWrapper({ data: { id: "a1", name: "old" }, type: "alerts" });
      await wrapper.setProps({ data: { id: "a2", name: "updated" } });
      await nextTick();
      expect((wrapper.vm as any).storedFields.id).toBe("a2");
    });
  });

  // ─── Watch: props.validationErrors ──────────────────────────────────────────

  describe("Watch: props.validationErrors", () => {
    it("syncs internal validationErrors with prop changes", async () => {
      wrapper = createWrapper({ validationErrors: [] });
      await wrapper.setProps({ validationErrors: ["New error"] });
      await nextTick();
      expect((wrapper.vm as any).validationErrors).toContain("New error");
    });

    it("clears internal errors when prop is set to empty array", async () => {
      wrapper = createWrapper({ validationErrors: ["Some error"] });
      await wrapper.setProps({ validationErrors: [] });
      await nextTick();
      expect((wrapper.vm as any).validationErrors).toEqual([]);
    });
  });

  // ─── toggleAIChat ────────────────────────────────────────────────────────────

  describe("toggleAIChat", () => {
    it("toggles isAiChatEnabled from false to true in store", async () => {
      store.state.isAiChatEnabled = false;
      wrapper = createWrapper();
      (wrapper.vm as any).toggleAIChat();
      await nextTick();
      expect(store.state.isAiChatEnabled).toBe(true);
    });

    it("toggles isAiChatEnabled from true to false in store", async () => {
      store.state.isAiChatEnabled = true;
      wrapper = createWrapper();
      (wrapper.vm as any).toggleAIChat();
      await nextTick();
      expect(store.state.isAiChatEnabled).toBe(false);
    });
  });

  // ─── AI chat conditional rendering ───────────────────────────────────────────

  describe("AI chat conditional rendering", () => {
    it("renders O2AIChat stub when isAiChatEnabled is true", async () => {
      store.state.isAiChatEnabled = true;
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.find(".o2-ai-chat").exists()).toBe(true);
    });

    it("does not render O2AIChat when isAiChatEnabled is false", async () => {
      store.state.isAiChatEnabled = false;
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.find(".o2-ai-chat").exists()).toBe(false);
    });

    it("renders AI toggle button when isEnterprise and ai_enabled", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, ai_enabled: true };
      wrapper = createWrapper();
      const aiBtn = wrapper.find('[data-test="menu-link-ai-item"]');
      expect(aiBtn.exists()).toBe(true);
    });
  });

  // ─── getBtnLogo computed ─────────────────────────────────────────────────────

  describe("getBtnLogo computed", () => {
    it("returns dark AI icon when hovered", async () => {
      wrapper = createWrapper();
      (wrapper.vm as any).isHovered = true;
      await nextTick();
      expect((wrapper.vm as any).getBtnLogo).toContain("ai_icon_dark.svg");
    });

    it("returns dark AI icon when AI chat is enabled", async () => {
      store.state.isAiChatEnabled = true;
      wrapper = createWrapper();
      expect((wrapper.vm as any).getBtnLogo).toContain("ai_icon_dark.svg");
    });

    it("returns dark AI icon for dark theme when not hovered", async () => {
      store.state.theme = "dark";
      store.state.isAiChatEnabled = false;
      wrapper = createWrapper();
      (wrapper.vm as any).isHovered = false;
      await nextTick();
      expect((wrapper.vm as any).getBtnLogo).toContain("ai_icon_dark.svg");
    });

    it("returns light AI icon when not hovered, AI disabled, light theme", async () => {
      store.state.theme = "light";
      store.state.isAiChatEnabled = false;
      wrapper = createWrapper();
      (wrapper.vm as any).isHovered = false;
      await nextTick();
      expect((wrapper.vm as any).getBtnLogo).toContain("ai_icon_gradient.svg");
    });
  });

  // ─── Theme-based CSS class ───────────────────────────────────────────────────

  describe("Theme-based CSS class", () => {
    it("applies 'dark-mode' class on root q-card when theme is dark", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.html()).toContain("dark-mode");
    });

    it("applies 'bg-white' class on root q-card when theme is light", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.html()).toContain("bg-white");
    });
  });

  // ─── Close / Cancel controls ─────────────────────────────────────────────────

  describe("Close / Cancel controls", () => {
    it("renders close icon with data-test attribute", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="json-editor-close"]').exists()).toBe(true);
    });

    it("renders cancel button with data-test attribute", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="json-editor-cancel"]').exists()).toBe(true);
    });
  });

  // ─── Monaco editor stub ───────────────────────────────────────────────────────

  describe("Monaco editor stub", () => {
    it("renders the query-editor stub with data-test", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="common-json-editor"]').exists()).toBe(true);
    });
  });

  // ─── Reactive state ───────────────────────────────────────────────────────────

  describe("Initial reactive state", () => {
    it("initializes isValidJson to true", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).isValidJson).toBe(true);
    });

    it("initializes isHovered to false", () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).isHovered).toBe(false);
    });

    it("initializes storedFields as empty object", () => {
      wrapper = createWrapper({ data: {} });
      expect((wrapper.vm as any).storedFields).toEqual({});
    });
  });
});