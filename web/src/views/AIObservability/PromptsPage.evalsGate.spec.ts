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
import { h } from "vue";
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import { queryClient } from "@/composables/query/queryClient";
import llmPromptsService from "@/services/llm-prompts.service";
import PromptsPage from "./PromptsPage.vue";
import PromptDetailDrawer from "./PromptDetailDrawer.vue";

vi.mock("@/services/llm-prompts.service", () => ({
  default: { list: vi.fn(), getSettings: vi.fn(), archive: vi.fn(), get: vi.fn() },
}));
vi.mock("@/utils/commons", () => ({ getFoldersListByType: vi.fn(async () => []) }));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

const store = createStore({
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "me@x.io", role: "admin" },
    timezone: "UTC",
    zoConfig: {} as Record<string, unknown>,
  },
});

let wrapper: VueWrapper | null = null;

const mountPage = async (onlineEvalsEnabled: boolean) => {
  store.state.zoConfig = { version: "v1", online_evals_enabled: onlineEvalsEnabled };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/ai/prompts", name: "aiPrompts", component: { render: () => h("div") } }],
  });
  await router.push("/ai/prompts");
  wrapper = mount(PromptsPage, {
    global: {
      plugins: [router, store],
      stubs: {
        OPageLayout: { template: `<main><slot name="actions" /><slot /></main>` },
        FolderList: true,
        PromptDetailDrawer: true,
        PromptSettingsDrawer: true,
        SelectFolderDropDown: true,
      },
    },
  });
  await flushPromises();
};

const playgroundShown = () => wrapper!.findComponent(PromptDetailDrawer).props("showPlayground");

describe("PromptsPage Playground entry with online evaluations gate", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(llmPromptsService.list).mockResolvedValue([]);
    vi.mocked(llmPromptsService.getSettings).mockResolvedValue({
      protectedLabels: ["production"],
    } as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("hides Playground actions when evals are off", async () => {
    await mountPage(false);
    expect(playgroundShown()).toBe(false);
  });

  it("offers Playground actions when evals are on", async () => {
    await mountPage(true);
    expect(playgroundShown()).toBe(true);
  });

  it("hides Playground actions as soon as evals turn off", async () => {
    await mountPage(true);
    store.state.zoConfig = { version: "v1", online_evals_enabled: false };
    await flushPromises();
    expect(playgroundShown()).toBe(false);
  });
});
