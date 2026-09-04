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
//
// Behaviour tests for AddAiToolset — mounts the REAL <OForm> (NOT a stub) and
// drives the form's own submit so the Zod schema actually runs. This is what
// catches the Options-API "schema not returned from setup() → :schema undefined
// → always valid" bug (AddToDashboard/AddRegexPattern). We assert the schema —
// not a manual guard — gates an empty/invalid submit, and that valid input
// saves.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

// Mutable route query the mocked router reads (create-mode by default).
let mockQuery: Record<string, any> = {};

vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      currentRoute: { value: { query: mockQuery } },
      push: vi.fn(),
    })),
  };
});

vi.mock("@/services/ai_toolsets", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import aiToolsetsService from "@/services/ai_toolsets";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const QueryEditorStub = {
  name: "QueryEditor",
  props: ["query", "editorId", "language"],
  emits: ["update:query"],
  template: '<div class="query-editor-stub" />',
};

describe("AddAiToolset", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    store.state.selectedOrganization = { identifier: "test-org" } as any;
    vi.mocked(aiToolsetsService.create).mockResolvedValue({ data: {} } as any);
    vi.mocked(aiToolsetsService.update).mockResolvedValue({ data: {} } as any);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () =>
    mount(AddAiToolset, {
      global: {
        plugins: [i18n, store],
        stubs: { QueryEditor: QueryEditorStub },
      },
    });

  // Convenience: the headless TanStack form created in setup() (useOForm) and
  // handed to <OForm :form>. Returned from setup, so it's on wrapper.vm.form.
  const getForm = () => (wrapper.vm as any).form;

  describe("rendering", () => {
    it("renders name, kind and description fields with their data-test ids", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="ai-toolset-name-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-toolset-kind-select"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-toolset-description-input"]').exists()).toBe(true);
    });

    it("shows the MCP section by default (kind = mcp)", () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="ai-toolset-mcp-url"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-toolset-cli-command"]').exists()).toBe(false);
    });

    it("keeps the Save button enabled (R3 — never disabled to gate validity)", () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="ai-toolset-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.attributes("disabled")).toBeFalsy();
    });

    it("toggles the visible section off the form-owned kind value", async () => {
      wrapper = createWrapper();
      getForm().setFieldValue("kind", "cli");
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedKind).toBe("cli");
      expect(wrapper.find('[data-test="ai-toolset-cli-command"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-toolset-mcp-url"]').exists()).toBe(false);
    });
  });

  describe("schema wiring (real OForm)", () => {
    it("blocks submit and does not save when required fields are empty", async () => {
      wrapper = createWrapper();

      await getForm().handleSubmit();
      await flushPromises();

      expect(getForm().state.isValid).toBe(false);
      expect(aiToolsetsService.create).not.toHaveBeenCalled();
    });

    it("saves an mcp toolset when name + url are valid", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "valid_name-1");
      form.setFieldValue("mcp.url", "https://api.example.com/mcp/");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(getForm().state.isValid).toBe(true);
      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          name: "valid_name-1",
          kind: "mcp",
          data: expect.objectContaining({
            url: "https://api.example.com/mcp/",
            timeout_seconds: 30,
          }),
        }),
      );
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("restored name rules (BEFORE baseline)", () => {
    it("does not save when the name has invalid characters", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "bad name!");
      form.setFieldValue("mcp.url", "https://x.test/mcp");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).not.toHaveBeenCalled();
    });

    it("does not save when the name exceeds 256 characters", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "a".repeat(257));
      form.setFieldValue("mcp.url", "https://x.test/mcp");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).not.toHaveBeenCalled();
    });
  });

  describe("kind-conditional requireds", () => {
    it("blocks an mcp toolset with no url", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "valid");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).not.toHaveBeenCalled();
    });

    it("blocks a cli toolset with no command, then saves once command is set", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "cli");
      form.setFieldValue("name", "valid");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();
      expect(aiToolsetsService.create).not.toHaveBeenCalled();

      form.setFieldValue("cli.command", "kubectl");
      await flushPromises();
      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          kind: "cli",
          data: expect.objectContaining({ command: "kubectl" }),
        }),
      );
    });
  });

  describe("form-owned array-fields (headers / env / cred)", () => {
    it("adds a header row through the form API and mirrors it for the v-for", async () => {
      wrapper = createWrapper();
      wrapper.vm.addHeader();
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.mcpHeaders.length).toBe(1);
      expect(getForm().state.values.mcp.headers).toHaveLength(1);
    });

    it("saves non-empty header rows in the mcp payload", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "valid");
      form.setFieldValue("mcp.url", "https://x.test/mcp");
      form.setFieldValue("mcp.headers", [
        { key: "Authorization", value: "Bearer abc", visible: false },
        { key: "", value: "", visible: false }, // blank row dropped on save
      ]);
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          data: expect.objectContaining({
            headers: { Authorization: "Bearer abc" },
          }),
        }),
      );
    });

    it("removes the correct header row through the form API", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("mcp.headers", [
        { key: "A", value: "1", visible: false },
        { key: "B", value: "2", visible: false },
      ]);
      await flushPromises();

      wrapper.vm.removeHeader(0);
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(getForm().state.values.mcp.headers).toHaveLength(1);
      expect(getForm().state.values.mcp.headers[0].key).toBe("B");
      expect(wrapper.vm.mcpHeaders).toHaveLength(1);
    });

    it("toggles a header's password-visibility flag on the form", async () => {
      wrapper = createWrapper();
      wrapper.vm.addHeader();
      await flushPromises();

      wrapper.vm.toggleHeaderVisible(0);
      await flushPromises();
      expect(getForm().state.values.mcp.headers[0].visible).toBe(true);
    });

    it("saves cli env + credential files (cred value bridged from Monaco)", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "cli");
      form.setFieldValue("name", "valid");
      form.setFieldValue("cli.command", "kubectl");
      form.setFieldValue("cli.env", [{ key: "GH_TOKEN", value: "secret", visible: false }]);
      form.setFieldValue("cli.credFiles", [{ key: "KUBECONFIG", value: "" }]);
      await flushPromises();
      // The Monaco editor bridges its value into the form.
      wrapper.vm.setCredValue(0, "apiVersion: v1");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          data: expect.objectContaining({
            env: { GH_TOKEN: "secret" },
            credential_files: { KUBECONFIG: "apiVersion: v1" },
          }),
        }),
      );
    });
  });

  // The non-negotiable field-array gate (START-HERE ① / brief §2): build >=3
  // rows, delete a NON-last row, and assert the RENDERED inputs (each
  // OFormInput -> OInput model-value), NOT just form.state.values. A stable-id
  // :key would leave the form DATA correct but the INPUTS shifted/blank, so a
  // data-only assertion passes while the UI is broken; this reads the rendered
  // values to prove the index-based :key keeps each row bound to its position.
  describe("field-array delete gate (rendered inputs)", () => {
    // Rendered key-input values for an array, in DOM order, e.g. namePrefix
    // "mcp.headers" → reads every `mcp.headers[i].key` OInput's model-value.
    // Matched with startsWith/endsWith (not a RegExp built from a string) so
    // there is no escaping to get wrong — `${prefix}[` ... `].key` pins it to
    // an indexed `key` field of exactly this array.
    const renderedKeys = (namePrefix: string): string[] =>
      wrapper
        .findAllComponents(OFormInput)
        .filter((c: any) => {
          const name = String(c.props("name"));
          return name.startsWith(`${namePrefix}[`) && name.endsWith("].key");
        })
        .map((c: any) => c.findComponent(OInput).props("modelValue"));

    it("keeps mcp.headers inputs in sync after deleting a NON-last row", async () => {
      wrapper = createWrapper();
      getForm().setFieldValue("mcp.headers", [
        { key: "AAA", value: "1", visible: false },
        { key: "BBB", value: "2", visible: false },
        { key: "CCC", value: "3", visible: false },
      ]);
      await flushPromises();
      await wrapper.vm.$nextTick();
      expect(renderedKeys("mcp.headers")).toEqual(["AAA", "BBB", "CCC"]);

      wrapper.vm.removeHeader(1); // delete the MIDDLE (non-last) row
      await flushPromises();
      await wrapper.vm.$nextTick();

      // RENDERED inputs must shift, not just form.state.values.
      expect(renderedKeys("mcp.headers")).toEqual(["AAA", "CCC"]);
      expect(getForm().state.values.mcp.headers.map((h: any) => h.key)).toEqual(["AAA", "CCC"]);
    });

    it("keeps cli.env inputs in sync after deleting a NON-last row", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "cli");
      form.setFieldValue("cli.env", [
        { key: "E_AAA", value: "1", visible: false },
        { key: "E_BBB", value: "2", visible: false },
        { key: "E_CCC", value: "3", visible: false },
      ]);
      await flushPromises();
      await wrapper.vm.$nextTick();
      expect(renderedKeys("cli.env")).toEqual(["E_AAA", "E_BBB", "E_CCC"]);

      wrapper.vm.removeEnvVar(1); // delete the MIDDLE (non-last) row
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(renderedKeys("cli.env")).toEqual(["E_AAA", "E_CCC"]);
    });

    it("keeps cli.credFiles inputs in sync after deleting a NON-last row", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "cli");
      form.setFieldValue("cli.credFiles", [
        { key: "C_AAA", value: "" },
        { key: "C_BBB", value: "" },
        { key: "C_CCC", value: "" },
      ]);
      await flushPromises();
      await wrapper.vm.$nextTick();
      expect(renderedKeys("cli.credFiles")).toEqual(["C_AAA", "C_BBB", "C_CCC"]);

      wrapper.vm.removeCredFile(1); // delete the MIDDLE (non-last) row
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(renderedKeys("cli.credFiles")).toEqual(["C_AAA", "C_CCC"]);
    });
  });

  describe("skill content (Monaco bridged into the form)", () => {
    it("blocks save when skill content is empty (schema gates it)", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "skill");
      form.setFieldValue("name", "valid");
      await flushPromises();

      // Empty skill content now fails the schema (superRefine), so the form is
      // invalid, @submit never fires, and the inline error shows after submit.
      await form.handleSubmit();
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(getForm().state.isValid).toBe(false);
      expect(aiToolsetsService.create).not.toHaveBeenCalled();
      expect(wrapper.vm.skillContentError).toBe(true);
    });

    it("saves a skill toolset once content is bridged in from Monaco", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("kind", "skill");
      form.setFieldValue("name", "valid");
      // The Monaco editor bridges its value into the form (skill.content).
      wrapper.vm.setSkillContent("# My skill");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(getForm().state.isValid).toBe(true);
      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          kind: "skill",
          data: { content: "# My skill" },
        }),
      );
      expect(wrapper.vm.skillContentError).toBe(false);
    });
  });

  describe("edit mode (async prefill via form.reset)", () => {
    it("loads the record and prefills the form when action=edit", async () => {
      mockQuery = { action: "edit", id: "tool-1" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: {
          id: "tool-1",
          name: "existing_tool",
          kind: "mcp",
          description: "an existing toolset",
          data: { url: "https://edit.example.com/mcp/", timeout_seconds: 60 },
        },
      } as any);

      wrapper = createWrapper();
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isEditing).toBe(true);
      const values = getForm().state.values;
      expect(values.name).toBe("existing_tool");
      expect(values.kind).toBe("mcp");
      expect(values.description).toBe("an existing toolset");
      expect(values.mcp.url).toBe("https://edit.example.com/mcp/");
      expect(values.mcp.timeout_seconds).toBe(60);
    });

    it("updates (not creates) when saving in edit mode", async () => {
      mockQuery = { action: "edit", id: "tool-1" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: {
          id: "tool-1",
          name: "existing_tool",
          kind: "mcp",
          description: "",
          data: { url: "https://edit.example.com/mcp/", timeout_seconds: 60 },
        },
      } as any);

      wrapper = createWrapper();
      await flushPromises();

      await getForm().handleSubmit();
      await flushPromises();

      expect(aiToolsetsService.update).toHaveBeenCalledWith(
        "test-org",
        "tool-1",
        expect.objectContaining({
          data: expect.objectContaining({
            url: "https://edit.example.com/mcp/",
          }),
        }),
      );
      expect(aiToolsetsService.create).not.toHaveBeenCalled();
    });
  });
});
