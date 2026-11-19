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

vi.mock("@/services/ai_toolsets", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      discover: vi.fn(),
    },
  });
});

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
    vi.mocked(aiToolsetsService.discover).mockResolvedValue({ data: { tools: [] } } as any);
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
      form.setFieldValue("name", "valid-name-1");
      form.setFieldValue("mcp.url", "https://api.example.com/mcp/");
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();

      expect(getForm().state.isValid).toBe(true);
      expect(aiToolsetsService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          name: "valid-name-1",
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

    it("does not save when the name exceeds 64 characters", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "a".repeat(65));
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

  describe("MCP tool picker", () => {
    const DISCOVERED = [
      { name: "search_logs", description: "Search", read_only_hint: true },
      { name: "create_monitor", read_only_hint: false },
    ];

    const editRecord = (data: Record<string, any>) => {
      mockQuery = { action: "edit", id: "tool-1" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: { id: "tool-1", name: "dd", kind: "mcp", description: "", data },
      } as any);
    };

    const savedData = () => vi.mocked(aiToolsetsService.update).mock.calls.at(-1)![2].data!;

    const picker = () => wrapper.findComponent({ name: "AiToolsetToolPicker" });

    const stateButton = (tool: string, state: string) =>
      wrapper.find(
        `[data-test="ai-toolset-tool-${tool}"] [data-test="ai-toolset-tool-state-${state}"]`,
      );

    it("discovers an edited toolset by id, keeps unknown keys, sends schema 2 and verifies", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        editRecord({
          url: "https://mcp.example.com/mcp",
          headers: { "DD-API-KEY": "***" },
          timeout_seconds: 30,
          allowed_tools: ["search_logs", "get_*", "gone_tool"],
          write_tools: [],
          rate_limit: { calls: 50, per_seconds: 10 },
          tool_classes: [{ tool: "search_*", class: "logs" }],
          preset: "datadog",
        });
        vi.mocked(aiToolsetsService.discover).mockResolvedValue({
          data: { tools: DISCOVERED },
        } as any);
        wrapper = createWrapper();
        await flushPromises();
        vi.advanceTimersByTime(800);
        await flushPromises();
      } finally {
        vi.useRealTimers();
      }

      expect(aiToolsetsService.discover).toHaveBeenCalledWith("test-org", {
        id: "tool-1",
        overrides: {
          url: "https://mcp.example.com/mcp",
          headers: { "DD-API-KEY": "***" },
          timeout_seconds: 30,
        },
      });
      expect(picker().props("status")).toBe("ok");
      expect(wrapper.find('[data-test="ai-toolset-other-entries"]').text()).toContain("get_*");

      await stateButton("create_monitor", "write").trigger("click");
      await flushPromises();
      await getForm().handleSubmit();
      await flushPromises();

      const data = savedData();
      expect(data).toMatchObject({
        schema: 2,
        url: "https://mcp.example.com/mcp",
        headers: { "DD-API-KEY": "***" },
        allowed_tools: ["search_logs", "get_*", "gone_tool", "create_monitor"],
        write_tools: ["create_monitor"],
        rate_limit: { calls: 50, per_seconds: 10 },
        tool_classes: [{ tool: "search_*", class: "logs" }],
        preset: "datadog",
      });
      expect(data).not.toHaveProperty("blocked_tools");
      expect(typeof data.tools_verified_at).toBe("number");
    });

    it("prefills a row without allowed_tools as all allowed, tagged tools as can change things", async () => {
      editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30 });
      vi.mocked(aiToolsetsService.discover).mockResolvedValue({
        data: { tools: DISCOVERED },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();

      expect(picker().props("lists")).toEqual({
        allowed: ["search_logs", "create_monitor"],
        blocked: null,
        write: ["create_monitor"],
      });
    });

    it("still saves after a failed discovery, without tools_verified_at, with typed tool names", async () => {
      editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30, allowed_tools: [] });
      vi.mocked(aiToolsetsService.discover).mockRejectedValue({
        response: { status: 503, data: { code: "internal_secret_required", message: "no secret" } },
      });
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();

      expect(picker().props("status")).toBe("failed");
      expect(wrapper.find('[data-test="ai-toolset-tools-error"]').text()).toContain("no secret");
      await wrapper.find('[data-test="ai-toolset-typed-tool"] input').setValue("run_query");
      await wrapper.find('[data-test="ai-toolset-typed-tool-add"]').trigger("click");
      await flushPromises();

      await getForm().handleSubmit();
      await flushPromises();
      const data = savedData();
      expect(data.allowed_tools).toEqual(["run_query"]);
      expect(data).not.toHaveProperty("tools_verified_at");
    });

    it("warns when a tool that may write is only Allowed", async () => {
      editRecord({
        url: "https://mcp.example.com/mcp",
        timeout_seconds: 30,
        allowed_tools: [],
        write_tools: [],
      });
      vi.mocked(aiToolsetsService.discover).mockResolvedValue({
        data: { tools: DISCOVERED },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();

      await stateButton("create_monitor", "allowed").trigger("click");
      await flushPromises();
      expect(picker().props("lists").write).toEqual(["create_monitor"]);
      expect(wrapper.find('[data-test="ai-toolset-tool-write-warning"]').exists()).toBe(false);

      await stateButton("create_monitor", "allowed").trigger("click");
      await flushPromises();
      expect(picker().props("lists").write).toEqual([]);
      expect(wrapper.find('[data-test="ai-toolset-tool-write-warning"]').text()).toContain(
        "automatic RCA",
      );
    });

    it("drops a discovery for URL A that answers after the form moved to URL B", async () => {
      const answers: Array<(tools: any[]) => void> = [];
      vi.mocked(aiToolsetsService.discover).mockImplementation(
        () =>
          new Promise((resolve) => answers.push((tools) => resolve({ data: { tools } } as any))),
      );
      editRecord({ url: "https://a.example.com/mcp", timeout_seconds: 30 });
      wrapper = createWrapper();
      await flushPromises();
      const discoverA = (wrapper.vm as any).discoverTools();
      await flushPromises();

      getForm().setFieldValue("mcp.url", "https://b.example.com/mcp");
      await flushPromises();
      expect(picker().props("tools")).toBeNull();
      answers[0]([{ name: "only_on_a" }]);
      await discoverA;
      await flushPromises();
      expect(picker().props("tools")).toBeNull();
      expect(picker().props("lists").allowed).toBeNull();

      const discoverB = (wrapper.vm as any).discoverTools();
      await flushPromises();
      answers[1]([{ name: "on_b", read_only_hint: true }]);
      await discoverB;
      await flushPromises();
      expect(picker().props("tools")).toEqual([{ name: "on_b", read_only_hint: true }]);
      expect(picker().props("lists").allowed).toEqual(["on_b"]);
    });

    it("saves exactly the tools shown as can change things, on a row that had no write_tools", async () => {
      editRecord({
        url: "https://mcp.example.com/mcp",
        timeout_seconds: 30,
        allowed_tools: ["create_monitor"],
      });
      vi.mocked(aiToolsetsService.discover).mockResolvedValue({
        data: { tools: DISCOVERED },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();

      await stateButton("search_logs", "write").trigger("click");
      await flushPromises();
      await getForm().handleSubmit();
      await flushPromises();
      const data = savedData();
      expect(data.allowed_tools).toEqual(["create_monitor", "search_logs"]);
      expect(data.write_tools).toEqual(["create_monitor", "search_logs"]);
    });

    it("drops a result that answers while a header row has a value but no key yet", async () => {
      const answers: Array<(tools: any[]) => void> = [];
      vi.mocked(aiToolsetsService.discover).mockImplementation(
        () =>
          new Promise((resolve) => answers.push((tools) => resolve({ data: { tools } } as any))),
      );
      editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30 });
      wrapper = createWrapper();
      await flushPromises();
      const pending = (wrapper.vm as any).discoverTools();
      await flushPromises();

      getForm().pushFieldValue("mcp.headers", { key: "", value: "secret", visible: false });
      await flushPromises();
      answers[0]([{ name: "without_the_header" }]);
      await pending;
      await flushPromises();
      expect(picker().props("tools")).toBeNull();
      expect(picker().props("lists").allowed).toBeNull();
    });

    it("shows an inline error and adds nothing for a glob typed as a tool name", async () => {
      editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30, allowed_tools: [] });
      vi.mocked(aiToolsetsService.discover).mockRejectedValue({
        response: { status: 503, data: { code: "internal_secret_required", message: "no secret" } },
      });
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();

      await wrapper.find('[data-test="ai-toolset-typed-tool"] input').setValue("*");
      await flushPromises();
      expect(wrapper.find('[data-test="ai-toolset-tool-picker"]').text()).toContain(
        "* isn't allowed here",
      );
      expect(
        wrapper.find('[data-test="ai-toolset-typed-tool-add"]').attributes("disabled"),
      ).toBeDefined();
      await wrapper.find('[data-test="ai-toolset-typed-tool"] input').trigger("keydown.enter");
      await flushPromises();
      expect(picker().props("lists").allowed).toEqual([]);
    });

    it("sends a new toolset's limits and starts with every tool off", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "new-mcp");
      form.setFieldValue("mcp.url", "https://mcp.example.com/mcp");
      form.setFieldValue("mcp.max_calls_per_turn", "10");
      form.setFieldValue("mcp.rate_calls", "50");
      form.setFieldValue("mcp.rate_seconds", "10");
      form.setFieldValue("mcp.max_result_kib", "64");
      await flushPromises();
      await form.handleSubmit();
      await flushPromises();

      const data = vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1].data!;
      expect(data).toMatchObject({
        schema: 2,
        allowed_tools: [],
        write_tools: [],
        max_calls_per_turn: 10,
        rate_limit: { calls: 50, per_seconds: 10 },
        max_result_bytes: 65536,
      });
      expect(data).not.toHaveProperty("tools_verified_at");
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

    it("sends a cleared CLI allowlist as null so the server's merge drops it", async () => {
      mockQuery = { action: "edit", id: "tool-2" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: {
          id: "tool-2",
          name: "kubectl",
          kind: "cli",
          description: "",
          data: { command: "kubectl", allowed_subcommands: ["get", "describe"] },
        },
      } as any);

      wrapper = createWrapper();
      await flushPromises();
      expect(getForm().state.values.cli.allowed_subcommands_raw).toBe("get, describe");
      getForm().setFieldValue("cli.allowed_subcommands_raw", "");
      await flushPromises();

      await getForm().handleSubmit();
      await flushPromises();

      const [, , body] = vi.mocked(aiToolsetsService.update).mock.calls.at(-1)!;
      expect(body.data).toHaveProperty("allowed_subcommands", null);
    });
  });
});
