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

vi.mock("@/services/gen-ai-agent-mapping.service", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    listAgents: async () => ({ agents: [] }),
    emptyConfig: () => config([]),
  },
  fetchDefaultGenAiAgentMapping: async () => config(["default.agent"]),
}));

vi.mock("@/services/gen-ai-agent-mapping.queries", () => ({
  saveGenAiAgentMappingMutation: () => ({ mutationFn: (body: unknown) => mockSave(body) }),
  clearGenAiAgentRegistryMutation: () => ({ mutationFn: async () => ({}) }),
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
});
