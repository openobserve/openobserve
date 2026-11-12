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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import GenAiAgentMappingSettings from "./GenAiAgentMappingSettings.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import type { GenAiAgentMappingConfig } from "@/services/gen-ai-agent-mapping.service";

const mockGet = vi.fn();
const mockSave = vi.fn();
const mockListAgents = vi.fn();
const mockStripHarness = vi.fn();
const mockSearch = vi.fn();
const mockToast = vi.fn();
const mockGetStream = vi.fn();
/** The part of a `searchService.search` call the tests read. */
type SearchArgs = { query: { query: { sql: string } } };

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    listAgents: (...args: unknown[]) => mockListAgents(...args),
    stripHarness: (...args: unknown[]) => mockStripHarness(...args),
    emptyConfig: () => config([]),
  },
  fetchDefaultGenAiAgentMapping: async () => config(["default.agent"]),
}));

vi.mock("@/services/gen-ai-agent-mapping.queries", () => ({
  saveGenAiAgentMappingMutation: () => ({ mutationFn: (body: unknown) => mockSave(body) }),
  clearGenAiAgentRegistryMutation: () => ({ mutationFn: async () => ({}) }),
}));

vi.mock("@/services/search", () => ({
  default: { search: (...args: unknown[]) => mockSearch(...args) },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: (...args: unknown[]) => mockGetStream(...args) }),
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (...args: unknown[]) => mockToast(...args),
}));

function config(agentNameFields: string[]): GenAiAgentMappingConfig {
  return {
    agent_name_fields: agentNameFields,
    agent_id_fields: [],
    env_fields: [],
    version_fields: [],
    harness_patterns: [],
    session_title: "off",
    attribution_fields: { user: [], feature: [], tenant: [] },
  };
}

async function mountPage() {
  const wrapper = mount(GenAiAgentMappingSettings, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { ODialog: true },
    },
  });
  await flushPromises();
  return wrapper;
}

const saveButton = (wrapper: VueWrapper) =>
  wrapper.find('[data-test="gen-ai-agent-mapping-save-btn"]');

describe("GenAiAgentMappingSettings", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSave.mockReset();
    mockListAgents.mockReset();
    mockListAgents.mockResolvedValue({ agents: [] });
    mockStripHarness.mockReset();
    mockSearch.mockReset();
    mockToast.mockReset();
    mockGetStream.mockReset();
    mockGetStream.mockResolvedValue({
      schema: [{ name: "gen_ai_conversation_id" }, { name: "gen_ai_input_messages" }],
    });
  });

  // Before, a failed read seeded an empty form that Save would write over the stored mapping.
  it("offers no form to save when the mapping cannot be read", async () => {
    mockGet.mockRejectedValue({ response: { status: 500 } });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="gen-ai-agent-mapping-load-error"]').exists()).toBe(true);
    expect(saveButton(wrapper).exists()).toBe(false);
  });

  it("shows the no-access state on a 403", async () => {
    mockGet.mockRejectedValue({ response: { status: 403 } });
    const wrapper = await mountPage();
    expect(wrapper.find('[data-test="gen-ai-agent-mapping-forbidden"]').exists()).toBe(true);
    expect(saveButton(wrapper).exists()).toBe(false);
  });

  it("enables Save only once the form differs from what was read", async () => {
    mockGet.mockResolvedValue(config(["my.agent"]));
    const wrapper = await mountPage();
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();

    await wrapper.find('[data-test="gen-ai-agent-name-fields-input"] input').setValue("other");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();

    await wrapper.find('[data-test="gen-ai-agent-name-fields-input"] input').setValue("my.agent");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  // An org with nothing saved is shown the defaults in effect; that alone is not an edit.
  it("treats the seeded defaults of an unsaved org as clean", async () => {
    mockGet.mockResolvedValue(config([]));
    const wrapper = await mountPage();
    expect(
      (
        wrapper.find('[data-test="gen-ai-agent-name-fields-input"] input')
          .element as HTMLInputElement
      ).value,
    ).toBe("default.agent");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  // Typing in the patterns box keeps the text as typed and saves one pattern per line.
  it("saves harness patterns typed one per line", async () => {
    mockGet.mockResolvedValue({
      ...config(["my.agent"]),
      harness_patterns: [{ agent: "omp", patterns: ["tag environment_context"] }],
    });
    mockSave.mockImplementation(async (body: GenAiAgentMappingConfig) => body);
    const wrapper = await mountPage();
    const textarea = wrapper.find('[data-test="gen-ai-harness-patterns-0"] textarea');

    await textarea.setValue("tag environment_context\n");
    expect((textarea.element as HTMLTextAreaElement).value).toBe("tag environment_context\n");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();

    await textarea.setValue("tag environment_context\n  tag job \n\n");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        harness_patterns: [{ agent: "omp", patterns: ["tag environment_context", "tag job"] }],
      }),
    );
  });

  describe("Test on recent sessions", () => {
    const message = "<env>\nos: linux\n</env>\nreal ask";
    const draft = "regex (?s)<env>.*?</env>";

    async function testDraft() {
      mockGet.mockResolvedValue({
        ...config(["my.agent"]),
        harness_patterns: [{ agent: "omp", patterns: ["tag job"] }],
      });
      const wrapper = await mountPage();
      mockListAgents.mockResolvedValue({
        agents: [{ name: "omp", source_stream: "default", source_stream_type: "traces" }],
      });
      mockSearch.mockResolvedValue({
        data: { hits: [{ input: JSON.stringify([{ role: "user", content: message }]) }] },
      });
      await wrapper.find('[data-test="gen-ai-harness-patterns-0"] textarea').setValue(draft);
      await wrapper.find('[data-test="gen-ai-harness-test-0"]').trigger("click");
      await flushPromises();
      return wrapper;
    }

    // The server runs the draft, so a Rust-only pattern such as `(?s)` matches here as in the list.
    it("runs the draft patterns on the server", async () => {
      mockStripHarness.mockResolvedValue([{ text: "real ask", hidden: 1, only: null }]);
      const wrapper = await testDraft();
      expect(mockStripHarness).toHaveBeenCalledWith(expect.any(String), [draft], [message]);
      const result = wrapper.find('[data-test="gen-ai-harness-result-0"]');
      expect(result.text()).toContain("1 of 1 recent sessions match");
      const [before, after] = result.findAll("pre");
      expect(before.text()).toContain("os: linux");
      expect(after.text()).toBe("real ask");
    });

    it("shows the server's message for a pattern it rejects and drops the earlier result", async () => {
      mockStripHarness.mockResolvedValueOnce([{ text: "real ask", hidden: 1, only: null }]);
      const wrapper = await testDraft();
      expect(wrapper.find('[data-test="gen-ai-harness-result-0"]').exists()).toBe(true);
      const error = "invalid regex in 'regex (': unclosed group";
      mockStripHarness.mockRejectedValueOnce({ response: { data: { message: error } } });
      await wrapper.find('[data-test="gen-ai-harness-test-0"]').trigger("click");
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: error }),
      );
      expect(wrapper.find('[data-test="gen-ai-harness-result-0"]').exists()).toBe(false);
    });

    const omp = "<job>nightly</job>\nomp ask";
    const task = "<job>sub</job>\ntask ask";
    async function mountTwoRows() {
      mockGet.mockResolvedValue({
        ...config(["my.agent"]),
        harness_patterns: [
          { agent: "omp", patterns: ["tag job"] },
          { agent: "task", patterns: ["tag job"] },
        ],
      });
      const wrapper = await mountPage();
      mockListAgents.mockResolvedValue({
        agents: [
          { name: "omp", source_stream: "default", source_stream_type: "traces" },
          { name: "task", source_stream: "default", source_stream_type: "traces" },
        ],
      });
      mockSearch.mockImplementation(async ({ query }: SearchArgs) => ({
        data: {
          hits: [
            {
              input: JSON.stringify([
                { role: "user", content: query.query.sql.includes("'task'") ? task : omp },
              ]),
            },
          ],
        },
      }));
      mockStripHarness.mockImplementation(async (_org: string, _p: string[], texts: string[]) =>
        texts.map((t) => ({ text: t.split("\n")[1], hidden: 1, only: null })),
      );
      return wrapper;
    }
    const runTest = async (wrapper: VueWrapper, i: number) => {
      await wrapper.find(`[data-test="gen-ai-harness-test-${i}"]`).trigger("click");
      await flushPromises();
    };
    const resultText = (wrapper: VueWrapper, i: number) => {
      const result = wrapper.find(`[data-test="gen-ai-harness-result-${i}"]`);
      return result.exists() ? result.text() : null;
    };

    // Results were keyed by row index, so the next row inherited a removed row's result.
    it("keeps a result with its row when another row is removed", async () => {
      const wrapper = await mountTwoRows();
      await runTest(wrapper, 0);
      expect(resultText(wrapper, 0)).toContain("omp ask");
      await wrapper.find('[data-test="gen-ai-harness-remove-0"]').trigger("click");
      expect(resultText(wrapper, 0)).toBeNull();

      await runTest(wrapper, 0);
      expect(resultText(wrapper, 0)).toContain("task ask");
    });

    it("keeps the later row's result when an earlier row is removed", async () => {
      const wrapper = await mountTwoRows();
      await runTest(wrapper, 1);
      await wrapper.find('[data-test="gen-ai-harness-remove-0"]').trigger("click");
      expect(resultText(wrapper, 0)).toContain("task ask");
    });

    it("drops a result once the row's patterns or agent change", async () => {
      const wrapper = await mountTwoRows();
      await runTest(wrapper, 0);
      await runTest(wrapper, 1);
      await wrapper.find('[data-test="gen-ai-harness-defaults-0"]').trigger("click");
      expect(resultText(wrapper, 0)).toBeNull();
      expect(resultText(wrapper, 1)).toContain("task ask");

      const patterns1 = wrapper.find('[data-test="gen-ai-harness-patterns-1"] textarea');
      // Only a blank line added: still the same patterns.
      await patterns1.setValue("tag job\n");
      expect(resultText(wrapper, 1)).toContain("task ask");
      await wrapper.find('[data-test="gen-ai-harness-agent-1"] input').setValue("task2");
      expect(resultText(wrapper, 1)).toBeNull();
    });

    // The query hard-coded gen_ai_conversation_id and took any 15 sessions.
    it("groups by the stream's session column and takes the newest sessions", async () => {
      mockGet.mockResolvedValue({
        ...config(["my.agent"]),
        harness_patterns: [{ agent: "omp", patterns: ["tag job"] }],
      });
      const wrapper = await mountPage();
      mockListAgents.mockResolvedValue({
        agents: [
          { name: "omp", source_stream: "older", source_stream_type: "traces" },
          { name: "omp", source_stream: "newer", source_stream_type: "traces" },
          { name: "omp", source_stream: "no_sessions", source_stream_type: "traces" },
        ],
      });
      mockGetStream.mockImplementation(async (stream: string) => ({
        schema:
          stream === "no_sessions"
            ? [{ name: "gen_ai_input_messages" }]
            : [{ name: "session_id" }, { name: "gen_ai_input_messages" }],
      }));
      const hit = (content: string, lastStart: number) => ({
        input: JSON.stringify([{ role: "user", content }]),
        last_start: lastStart,
      });
      mockSearch.mockImplementation(async ({ query }: SearchArgs) => ({
        data: {
          hits: query.query.sql.includes('"older"') ? [hit("old", 1)] : [hit("new", 2)],
        },
      }));
      mockStripHarness.mockResolvedValue([
        { text: "new", hidden: 0, only: null },
        { text: "old", hidden: 0, only: null },
      ]);
      await runTest(wrapper, 0);

      expect(mockSearch).toHaveBeenCalledTimes(2);
      for (const [{ query }] of mockSearch.mock.calls as [SearchArgs][]) {
        expect(query.query.sql).toContain('GROUP BY "session_id" ORDER BY MAX(start_time) DESC');
        expect(query.query.sql).not.toContain("gen_ai_conversation_id");
      }
      expect(mockStripHarness).toHaveBeenCalledWith(
        expect.any(String),
        ["tag job"],
        ["new", "old"],
      );
      expect(resultText(wrapper, 0)).toContain("0 of 2 recent sessions match");
    });
  });

  // Two rows for one agent saved two rules that the list and Session Detail read differently.
  it("refuses to save two rows for the same agent", async () => {
    mockGet.mockResolvedValue({
      ...config(["my.agent"]),
      harness_patterns: [{ agent: "omp", patterns: ["tag job"] }],
    });
    const wrapper = await mountPage();
    await wrapper.find('[data-test="gen-ai-harness-add-agent"]').trigger("click");
    await wrapper.find('[data-test="gen-ai-harness-agent-1"] input').setValue(" omp ");
    await wrapper.find('[data-test="gen-ai-harness-patterns-1"] textarea').setValue("tag x");
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-test="gen-ai-harness-agent-1"]').text()).toContain(
      "This agent has another row",
    );

    await wrapper.find('[data-test="gen-ai-harness-agent-1"] input').setValue("task");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).not.toContain("This agent has another row");
  });

  it("shows the server's message when save rejects a pattern", async () => {
    mockGet.mockResolvedValue(config(["my.agent"]));
    const error = "invalid regex in 'regex (': unclosed group";
    mockSave.mockRejectedValue({ response: { data: { message: error } } });
    const wrapper = await mountPage();
    await wrapper.find('[data-test="gen-ai-agent-name-fields-input"] input').setValue("other");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: error }),
    );
  });
});
