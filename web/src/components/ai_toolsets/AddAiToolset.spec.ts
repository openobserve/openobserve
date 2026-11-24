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
      prebuilt: vi.fn(),
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
import { queryClient } from "@/composables/query/queryClient";

const PRESETS = [
  {
    id: "dynatrace",
    kind: "mcp",
    label: "Dynatrace",
    revision: 3,
    description: "Dynatrace DQL",
    url_template: "https://{environment}.apps.dynatrace.com/mcp",
    params: [{ name: "environment", label: "Environment ID" }],
    headers: [{ name: "Authorization" }],
    auth: { type: "oauth_client_credentials", token_url: "https://sso.dynatrace.com/token" },
    allowed_tools: ["execute-dql", "query-problems"],
    write_tools: [],
    tool_classes: [{ tool: "execute-dql", class: "logs", args: { query: "^fetch logs" } }],
  },
];
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
    vi.mocked(aiToolsetsService.prebuilt).mockResolvedValue({ data: { presets: PRESETS } } as any);
    queryClient.clear();
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
      expect(wrapper.find('[data-test="ai-toolset-skill-content"]').exists()).toBe(false);
    });

    it("offers MCP servers and skills only", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.kindOptions.map((o: any) => o.value)).toEqual(["mcp", "skill"]);
    });

    it("keeps the Save button enabled (R3 — never disabled to gate validity)", () => {
      wrapper = createWrapper();
      const saveBtn = wrapper.find('[data-test="ai-toolset-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.attributes("disabled")).toBeFalsy();
    });

    it("toggles the visible section off the form-owned kind value", async () => {
      wrapper = createWrapper();
      getForm().setFieldValue("kind", "skill");
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedKind).toBe("skill");
      expect(wrapper.find('[data-test="ai-toolset-skill-content"]').exists()).toBe(true);
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
  });

  describe("form-owned array-field (headers)", () => {
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
          auth: { type: "headers" },
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
        tool_classes: [{ tool: "search_*", class: "logs" }],
        preset: "datadog",
      });
      expect(data).not.toHaveProperty("blocked_tools");
      expect(typeof data.tools_verified_at).toBe("number");
    });

    it("prefills a row without allowed_tools as all allowed, with no write list", async () => {
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
        write: null,
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

    it("starts a new toolset with every tool off", async () => {
      wrapper = createWrapper();
      const form = getForm();
      form.setFieldValue("name", "new-mcp");
      form.setFieldValue("mcp.url", "https://mcp.example.com/mcp");
      await flushPromises();
      await form.handleSubmit();
      await flushPromises();

      const data = vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1].data!;
      expect(data).toMatchObject({ schema: 2, allowed_tools: [] });
      expect(data).not.toHaveProperty("write_tools");
      expect(data).not.toHaveProperty("tools_verified_at");

      vi.mocked(aiToolsetsService.discover).mockResolvedValue({
        data: { tools: DISCOVERED },
      } as any);
      await (wrapper.vm as any).discoverTools();
      await form.handleSubmit();
      await flushPromises();
      expect(vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1].data).toMatchObject({
        allowed_tools: [],
        write_tools: [],
      });
    });

    describe("write_tools of a row saved without it", () => {
      const ALLOWED = ["search_logs", "create_monitor"];
      const legacyRow = async (data: Record<string, any> = { allowed_tools: ALLOWED }) => {
        editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30, ...data });
        wrapper = createWrapper();
        await flushPromises();
      };
      const discover = async () => {
        await (wrapper.vm as any).discoverTools();
        await flushPromises();
      };
      const save = async () => {
        getForm().setFieldValue("description", "edited");
        await getForm().handleSubmit();
        await flushPromises();
        return savedData();
      };
      const succeed = () =>
        vi.mocked(aiToolsetsService.discover).mockResolvedValue({
          data: { tools: DISCOVERED },
        } as any);
      const fail = () => vi.mocked(aiToolsetsService.discover).mockRejectedValue(new Error("down"));

      it("stays absent while discovery is pending", async () => {
        vi.mocked(aiToolsetsService.discover).mockReturnValue(new Promise(() => {}) as any);
        await legacyRow();
        void (wrapper.vm as any).discoverTools();
        await flushPromises();
        const data = await save();
        expect(data).not.toHaveProperty("write_tools");
        expect(data.allowed_tools).toEqual(ALLOWED);
      });

      it("stays absent after discovery fails, also once it had succeeded", async () => {
        fail();
        await legacyRow();
        await discover();
        expect(await save()).not.toHaveProperty("write_tools");
        succeed();
        await discover();
        fail();
        await discover();
        expect(await save()).not.toHaveProperty("write_tools");
      });

      it("is what the picker shows after discovery succeeds", async () => {
        succeed();
        await legacyRow();
        await discover();
        expect((await save()).write_tools).toEqual(["create_monitor"]);
      });

      it("is written once the admin sets a tool, without discovery", async () => {
        fail();
        await legacyRow();
        await discover();
        await wrapper.find('[data-test="ai-toolset-typed-tool"] input').setValue("run_query");
        await wrapper.find('[data-test="ai-toolset-typed-tool-add"]').trigger("click");
        await flushPromises();
        const data = await save();
        expect(data.allowed_tools).toEqual([...ALLOWED, "run_query"]);
        expect(data.write_tools).toEqual(ALLOWED);

        succeed();
        await discover();
        expect((await save()).write_tools).toEqual(ALLOWED);
        await stateButton("search_logs", "allowed").trigger("click");
        expect((await save()).write_tools).toEqual(["create_monitor"]);
      });

      it("drops a stale discovery's lists when the URL changes, even in the same tick", async () => {
        succeed();
        await legacyRow({});
        await discover();
        expect(picker().props("lists").allowed).toEqual(ALLOWED);
        getForm().setFieldValue("mcp.url", "https://b.example.com/mcp");
        const submitted = getForm().handleSubmit();
        await submitted;
        await flushPromises();
        for (const data of [savedData(), await save()]) {
          expect(data).not.toHaveProperty("write_tools");
          expect(data).not.toHaveProperty("allowed_tools");
        }
      });

      it("keeps the admin's choice when the URL changes", async () => {
        succeed();
        await legacyRow();
        await discover();
        await stateButton("search_logs", "write").trigger("click");
        getForm().setFieldValue("mcp.url", "https://b.example.com/mcp");
        await flushPromises();
        expect((await save()).write_tools).toEqual(["create_monitor", "search_logs"]);
      });

      it.each([
        ["no allowlist", {}],
        ["an allowlist of *", { allowed_tools: ["*"] }],
        ["a glob in the allowlist", { allowed_tools: ["search_*", "create_monitor"] }],
      ])("stays absent after discovery succeeds with %s", async (_label, row) => {
        succeed();
        await legacyRow(row);
        await discover();
        expect(await save()).not.toHaveProperty("write_tools");
      });

      it("keeps a glob's unseen matches refused once the admin sets a tool", async () => {
        succeed();
        await legacyRow({ allowed_tools: ["search_*", "create_monitor"] });
        await discover();
        await stateButton("create_monitor", "allowed").trigger("click");
        const data = await save();
        expect(data.allowed_tools).toEqual(["search_*", "create_monitor"]);
        expect(data.write_tools).toEqual(["search_*"]);
      });

      it("isn't copied into the form when an unrelated entry is removed", async () => {
        succeed();
        await legacyRow({ allowed_tools: ALLOWED, blocked_tools: ["delete_*"] });
        await discover();
        const entry = wrapper.find('[data-test="ai-toolset-other-blocked-delete_*"]');
        await entry.find("button").trigger("click");
        await flushPromises();
        expect(getForm().state.values.mcp.blocked_tools).toEqual([]);
        expect(getForm().state.values.mcp.write_tools).toBeNull();
        fail();
        await discover();
        expect(await save()).not.toHaveProperty("write_tools");
      });

      it("keeps a stored empty list", async () => {
        fail();
        await legacyRow({ allowed_tools: ALLOWED, write_tools: [] });
        expect((await save()).write_tools).toEqual([]);
      });
    });

    it("voids a verified result when only the timeout changes", async () => {
      editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30, allowed_tools: [] });
      wrapper = createWrapper();
      await flushPromises();
      await (wrapper.vm as any).discoverTools();
      await flushPromises();
      getForm().setFieldValue("mcp.timeout_seconds", "5");
      await getForm().handleSubmit();
      await flushPromises();
      expect(savedData()).not.toHaveProperty("tools_verified_at");
    });

    it("runs one discovery when Refresh comes before the pending one", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        editRecord({ url: "https://mcp.example.com/mcp", timeout_seconds: 30, allowed_tools: [] });
        wrapper = createWrapper();
        await flushPromises();
        await wrapper.find('[data-test="ai-toolset-tools-refresh"]').trigger("click");
        await flushPromises();
        vi.advanceTimersByTime(2000);
        await flushPromises();
        expect(aiToolsetsService.discover).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("masks credentials, URLs and the discovery error in session replay", async () => {
      const message = "401 for https://mcp.example.com/mcp?key=s3cret";
      vi.mocked(aiToolsetsService.discover).mockRejectedValue({
        response: { status: 400, data: { message } },
      });
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();
      getForm().setFieldValue("mcp.headers[0].value", "Bearer t");
      await wrapper.find('[data-test="ai-toolset-preset-tools-customize"]').trigger("click");
      await (wrapper.vm as any).discoverTools();
      await flushPromises();
      for (const selector of [
        '[name="mcp.headers[0].value"]',
        '[data-test="ai-toolset-client-secret-field"]',
        '[data-test="ai-toolset-token-url-field"]',
        '[data-test="ai-toolset-mcp-url-field"]',
        '[data-test="ai-toolset-preset-param-environment"]',
        '[data-test="ai-toolset-tools-error"]',
      ]) {
        const element = wrapper.find(selector).element as HTMLElement;
        expect(element.closest('[data-o2-privacy="mask"]'), selector).not.toBeNull();
      }
    });
  });

  describe("OAuth client credentials", () => {
    const URL = "https://mcp.example.com/mcp";
    const AUTH = {
      type: "oauth_client_credentials",
      token_url: "https://sso.example.com/token",
      client_id: "svc",
      client_secret: "***",
      scope: "read",
      client_auth: "body",
      extra_params: { resource: "urn:x" },
    };

    const newToolset = async (values: Record<string, unknown>) => {
      wrapper = createWrapper();
      await flushPromises();
      const all = { name: "oauth-mcp", "mcp.url": URL, ...values };
      Object.entries(all).forEach(([field, value]) => getForm().setFieldValue(field, value));
      await flushPromises();
    };

    const editRow = async (data: Record<string, any>) => {
      mockQuery = { action: "edit", id: "tool-1" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: {
          id: "tool-1",
          name: "oauth-mcp",
          kind: "mcp",
          data: { url: URL, allowed_tools: [], write_tools: [], ...data },
        },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
    };

    const submit = async () => {
      await getForm().handleSubmit();
      await flushPromises();
    };

    const discover = async () => {
      vi.mocked(aiToolsetsService.discover).mockClear();
      await wrapper.vm.discoverTools();
      await flushPromises();
      return vi.mocked(aiToolsetsService.discover).mock.calls.at(-1)?.[1] as any;
    };

    const created = () => vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1].data!;
    const updated = () => vi.mocked(aiToolsetsService.update).mock.calls.at(-1)![2].data!;

    const filled = {
      "mcp.auth.token_url": " https://sso.example.com/token ",
      "mcp.auth.client_id": " svc ",
      "mcp.auth.client_secret": "s3cret",
    };

    it.each([
      ["all fields are empty", {}],
      ["only the token URL is filled", { "mcp.auth.token_url": "https://sso.example.com/token" }],
    ])("sends no auth when %s", async (_label, values) => {
      await newToolset(values);
      await submit();
      expect(aiToolsetsService.create).toHaveBeenCalledTimes(1);
      expect(created()).not.toHaveProperty("auth");
    });

    it("groups the fields under their heading and help line", () => {
      wrapper = createWrapper();
      const group = wrapper.find('[data-test="ai-toolset-oauth"]');
      const textOf = (attribute: string) => group.find(`#${group.attributes(attribute)}`).text();
      expect(group.attributes("role")).toBe("group");
      expect(textOf("aria-labelledby")).toContain("OAuth client credentials");
      expect(textOf("aria-describedby")).toContain("Fill in the client ID");
      expect(group.findAllComponents(OFormInput)).toHaveLength(4);
    });

    it("sends the filled fields, without an empty scope", async () => {
      await newToolset(filled);
      await submit();
      expect(created().auth).toEqual({
        type: "oauth_client_credentials",
        token_url: "https://sso.example.com/token",
        client_id: "svc",
        client_secret: "s3cret",
      });
    });

    it("drops an empty Authorization row, and shows an error on a filled one", async () => {
      const rows = (value: string) => [
        { key: "X-Tenant", value: "t", visible: false },
        { key: "Authorization", value, visible: false },
      ];
      await newToolset({ ...filled, "mcp.headers": rows("Bearer t") });
      await submit();
      expect(aiToolsetsService.create).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Remove the Authorization header");

      getForm().setFieldValue("mcp.headers", rows(""));
      await submit();
      expect(created().headers).toEqual({ "X-Tenant": "t" });
    });

    it("shows each missing field's error and masks the secret until it is revealed", async () => {
      await newToolset({ "mcp.auth.client_id": "svc" });
      await submit();
      expect(aiToolsetsService.create).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="ai-toolset-token-url-error"]').text()).toContain(
        "Token URL is required",
      );
      expect(wrapper.find('[data-test="ai-toolset-client-secret-error"]').text()).toContain(
        "Client secret is required",
      );
      const secret = () => wrapper.find('[data-test="ai-toolset-client-secret-field"]');
      expect(secret().attributes("type")).toBe("password");
      await wrapper.find('[data-test="ai-toolset-client-secret-reveal"]').trigger("click");
      expect(secret().attributes("type")).toBe("text");
    });

    it("sends a stored secret back unchanged and keeps the auth keys it doesn't edit", async () => {
      await editRow({ auth: AUTH });
      expect(getForm().state.values.mcp.auth).toMatchObject({ client_secret: "***" });
      getForm().setFieldValue("mcp.auth.scope", "read write");
      await submit();
      expect(updated().auth).toEqual({ ...AUTH, scope: "read write" });
    });

    it("drops the stored auth when every field is cleared", async () => {
      await editRow({ auth: AUTH });
      for (const field of ["token_url", "client_id", "client_secret", "scope"]) {
        getForm().setFieldValue(`mcp.auth.${field}`, "");
      }
      expect((await discover()).overrides.auth).toEqual({ type: "headers" });
      await submit();
      expect(updated()).not.toHaveProperty("auth");
    });

    it("saves an unrelated edit of a toolset replicated without its secret", async () => {
      await editRow({ auth: { ...AUTH, client_secret: "" } });
      expect(await discover()).toBeUndefined();
      getForm().setFieldValue("description", "edited");
      getForm().setFieldValue("mcp.url", `${URL}?v=2`);
      getForm().setFieldValue("mcp.allowed_tools", ["search"]);
      await submit();
      expect(updated().auth).toEqual({ ...AUTH, client_secret: "" });
    });

    it.each([
      ["the token URL", { "mcp.auth.token_url": "https://sso.example.com/v2/token" }],
      ["the client ID", { "mcp.auth.client_id": "other" }],
      ["the scope", { "mcp.auth.scope": "read write" }],
      ["the URL's origin", { "mcp.url": "https://other.example.com/mcp" }],
    ])("asks for a replicated toolset's secret once %s is edited", async (_label, values) => {
      await editRow({ auth: { ...AUTH, client_secret: "" } });
      Object.entries(values).forEach(([field, value]) => getForm().setFieldValue(field, value));
      await submit();
      expect(aiToolsetsService.update).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Client secret is required");
    });

    it("asks for a stored secret that the admin clears", async () => {
      await editRow({ auth: AUTH });
      getForm().setFieldValue("mcp.auth.client_secret", "");
      await submit();
      expect(aiToolsetsService.update).not.toHaveBeenCalled();
    });

    it("discovers a saved toolset with its auth, and one without auth as headers only", async () => {
      await editRow({ auth: AUTH });
      expect(await discover()).toEqual({
        id: "tool-1",
        overrides: { url: URL, headers: {}, timeout_seconds: 30, auth: AUTH },
      });
      wrapper.unmount();
      await editRow({ headers: { "X-Key": "***" } });
      expect((await discover()).overrides.auth).toEqual({ type: "headers" });
    });

    it("discovers an unsaved toolset with its auth", async () => {
      await newToolset(filled);
      expect(await discover()).toEqual({
        url: URL,
        headers: {},
        timeout_seconds: 30,
        auth: {
          type: "oauth_client_credentials",
          token_url: "https://sso.example.com/token",
          client_id: "svc",
          client_secret: "s3cret",
        },
      });
    });

    it.each([
      ["no client secret", { "mcp.auth.client_secret": "" }],
      ["no client ID", { "mcp.auth.client_id": "" }],
      ["an http token URL", { "mcp.auth.token_url": "http://sso.example.com/token" }],
    ])("doesn't discover with %s", async (_label, values) => {
      await newToolset({ ...filled, ...values });
      expect(await discover()).toBeUndefined();
    });

    it("shows the token endpoint's error and drops a verified result when the secret changes", async () => {
      await newToolset(filled);
      await discover();
      expect(wrapper.vm.discoveryStatus).toBe("ok");
      getForm().setFieldValue("mcp.auth.client_secret", "other");
      await flushPromises();
      expect(wrapper.vm.discoveryStatus).toBe("idle");

      const message = "invalid_client: the client secret is wrong";
      vi.mocked(aiToolsetsService.discover).mockRejectedValueOnce({
        response: { status: 400, data: { code: "discovery_failed", message } },
      });
      await wrapper.vm.discoverTools();
      await flushPromises();
      expect(wrapper.find('[data-test="ai-toolset-tools-error"]').text()).toContain(message);
      await submit();
      expect(created()).not.toHaveProperty("tools_verified_at");
    });

    it("prefills a preset's token URL, which alone leaves the toolset on headers", async () => {
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();
      expect(getForm().state.values.mcp.auth.token_url).toBe("https://sso.dynatrace.com/token");
      getForm().setFieldValue("mcp.headers[0].value", "Bearer t");
      await submit();
      expect(created()).not.toHaveProperty("auth");
      expect(created().headers).toEqual({ Authorization: "Bearer t" });
    });

    it("uses a preset with client credentials, leaving its empty Authorization row out", async () => {
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();
      getForm().setFieldValue("mcp.url", URL);
      getForm().setFieldValue("mcp.auth.client_id", "svc");
      getForm().setFieldValue("mcp.auth.client_secret", "s3cret");
      await flushPromises();
      expect(await discover()).toMatchObject({ url: URL, headers: {} });
      await submit();
      expect(created().headers).toEqual({});
      expect(created().auth.token_url).toBe("https://sso.dynatrace.com/token");
    });
  });

  describe("presets from the server", () => {
    it("offers the region-only switch on a super cluster and saves it", async () => {
      store.state.zoConfig.super_cluster_enabled = true;
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="ai-toolset-region-only"]').exists()).toBe(true);
      getForm().setFieldValue("name", "dt-eu");
      getForm().setFieldValue("region_only", true);
      getForm().setFieldValue("mcp.headers[0].value", "Bearer t");
      await getForm().handleSubmit();
      await flushPromises();
      const body = vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1];
      expect(body.region_only).toBe(true);
      store.state.zoConfig.super_cluster_enabled = false;
    });

    it("fills an MCP toolset from a preset and stores the preset with its tool classes", async () => {
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();

      expect(aiToolsetsService.prebuilt).toHaveBeenCalledWith("test-org");
      expect(wrapper.find('[data-test="ai-toolset-preset-tools"]').text()).toContain(
        "Preset tools (2)",
      );
      const env = wrapper.find('[data-test="ai-toolset-preset-param-environment"]');
      await env.setValue("abc12345");
      await flushPromises();
      expect(getForm().state.values.mcp.url).toBe("https://abc12345.apps.dynatrace.com/mcp");

      getForm().setFieldValue("mcp.headers[0].value", "Bearer t");
      await getForm().handleSubmit();
      await flushPromises();
      const body = vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1];
      expect(body).toMatchObject({ name: "dynatrace", kind: "mcp", description: "Dynatrace DQL" });
      expect(body.data).toMatchObject({
        url: "https://abc12345.apps.dynatrace.com/mcp",
        headers: { Authorization: "Bearer t" },
        allowed_tools: ["execute-dql", "query-problems"],
        write_tools: [],
        tool_classes: PRESETS[0].tool_classes,
        preset: { id: "dynatrace", revision: 3 },
      });
      expect(JSON.stringify(body.data.preset)).not.toContain("abc12345");

      await wrapper.find('[data-test="ai-toolset-preset-tools-customize"]').trigger("click");
      expect(wrapper.find('[data-test="ai-toolset-tool-picker"]').exists()).toBe(true);
    });

    it("leaves write_tools absent for a preset that has none", async () => {
      const { write_tools: _write, ...preset } = PRESETS[0];
      vi.mocked(aiToolsetsService.prebuilt).mockResolvedValue({
        data: { presets: [preset] },
      } as any);
      mockQuery = { action: "add", preset: "dynatrace" };
      wrapper = createWrapper();
      await flushPromises();
      getForm().setFieldValue("mcp.headers[0].value", "Bearer t");
      await getForm().handleSubmit();
      await flushPromises();
      const body = vi.mocked(aiToolsetsService.create).mock.calls.at(-1)![1];
      expect(body.data).not.toHaveProperty("write_tools");
    });

    it("drops a URL copy that older preset metadata held, so no draft or save keeps it", async () => {
      mockQuery = { action: "edit", id: "tool-9" };
      vi.mocked(aiToolsetsService.get).mockResolvedValue({
        data: {
          id: "tool-9",
          name: "grafana",
          kind: "mcp",
          description: "",
          data: {
            url: "https://g.example/mcp?token=s3cret",
            allowed_tools: [],
            write_tools: [],
            preset: {
              id: "grafana",
              revision: 1,
              params: { url: "https://g.example/mcp?token=s3cret" },
            },
          },
        },
      } as any);
      wrapper = createWrapper();
      await flushPromises();
      expect(getForm().state.values.mcp.extra.preset).toEqual({ id: "grafana", revision: 1 });
      await getForm().handleSubmit();
      await flushPromises();
      const sent = vi.mocked(aiToolsetsService.update).mock.calls.at(-1)![2].data!;
      expect(sent.preset).toEqual({ id: "grafana", revision: 1 });
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
