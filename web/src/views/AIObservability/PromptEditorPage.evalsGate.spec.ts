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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { createStore } from "vuex";
import { RouterView, createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import OForm from "@/lib/forms/Form/OForm.vue";
import llmPromptsService from "@/services/llm-prompts.service";
import onlineEvalsService from "@/services/online-evals.service";
import { byTest } from "@/test/unit/helpers/draftDom";
import { fillField } from "@/test/unit/helpers/fillField";
import PromptEditorPage from "./PromptEditorPage.vue";

vi.mock("@/services/llm-prompts.service", () => ({
  default: {
    get: vi.fn(),
    getVersion: vi.fn(),
    match: vi.fn(),
    create: vi.fn(),
    createVersion: vi.fn(),
  },
}));
vi.mock("@/services/online-evals.service", () => ({
  default: { providers: { list: vi.fn() } },
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

interface FormApi {
  setFieldValue: (field: string, value: unknown) => void;
  handleSubmit: () => Promise<void>;
}

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io" },
    timezone: "UTC",
    zoConfig: {} as Record<string, unknown>,
  },
});

const blank = { render: () => h("div") };
let wrapper: VueWrapper | null = null;

const mountEditor = async (onlineEvalsEnabled: boolean) => {
  store.state.zoConfig = { version: "v1", online_evals_enabled: onlineEvalsEnabled };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/ai/prompts", name: "aiPrompts", component: blank },
      { path: "/ai/prompts/new", name: "aiPromptCreate", component: PromptEditorPage },
      { path: "/ai/playground", name: "aiPlayground", component: blank },
    ],
  });
  await router.push("/ai/prompts/new");
  wrapper = mount(
    { render: () => h(RouterView) },
    { attachTo: document.body, global: { plugins: [router, store, i18n] } },
  );
  await flushPromises();
};

const form = () => (wrapper!.findComponent(OForm).vm as unknown as { form: FormApi }).form;

describe("PromptEditorPage with online evaluations gate", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(llmPromptsService.match).mockResolvedValue([]);
    vi.mocked(llmPromptsService.create).mockResolvedValue({
      prompt: { entityId: "pr-new" },
      version: { entityId: "pr-new", version: 1 },
    } as never);
    vi.mocked(onlineEvalsService.providers.list).mockResolvedValue([
      { name: "openai", availableModels: ["gpt-4o"] },
    ] as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("skips the providers request, hides Playground and saves a typed model when evals are off", async () => {
    await mountEditor(false);

    expect(onlineEvalsService.providers.list).not.toHaveBeenCalled();
    expect(byTest("prompt-editor-test-btn")).toBeNull();

    await fillField("prompt-editor-name", "summarise");
    await fillField("prompt-editor-text", "Summarise {{ doc }}");
    await fillField("prompt-editor-model", "my-custom-model");
    form().setFieldValue("commitMessage", "first");
    await nextTick();
    await form().handleSubmit();
    await flushPromises();

    expect(llmPromptsService.create).toHaveBeenCalledTimes(1);
    const input = vi.mocked(llmPromptsService.create).mock.calls[0][1];
    expect(input.config?.model).toBe("my-custom-model");
  });

  it("loads providers and shows Playground when evals are on", async () => {
    await mountEditor(true);

    expect(onlineEvalsService.providers.list).toHaveBeenCalledWith("test-org");
    expect(byTest("prompt-editor-test-btn")).not.toBeNull();
  });
});
