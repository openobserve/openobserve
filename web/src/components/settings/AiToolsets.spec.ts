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
import { flushPromises, mount } from "@vue/test-utils";
import AiToolsets from "./AiToolsets.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import aiToolsetsService from "@/services/ai_toolsets";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";

vi.mock("@/services/ai_toolsets", () => ({
  default: { list: vi.fn(async () => ({ data: { toolsets: [] } })), delete: vi.fn() },
}));

const mountPage = () =>
  mount(AiToolsets, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { AddAiToolset: true, ConfirmDialog: true, OTable: true },
    },
  });

describe("AiToolsets list view state", () => {
  beforeEach(() => resetListViewState());

  it("restores saved search, page size, page and sort", async () => {
    Object.assign(useListViewState("ai-toolsets", {}), {
      filterQuery: "abc",
      pageSize: 50,
      currentPage: 2,
      sortBy: "name",
      sortOrder: "desc",
    });
    const w: any = mountPage();
    await flushPromises();
    expect([
      w.vm.filterQuery,
      w.vm.pageSize,
      w.vm.currentPage,
      w.vm.sortBy,
      w.vm.sortOrder,
    ]).toEqual(["abc", 50, 2, "name", "desc"]);
    w.unmount();
  });

  it("saves changes so they survive unmount", async () => {
    const w: any = mountPage();
    await flushPromises();
    w.vm.filterQuery = "xyz";
    w.vm.pageSize = 100;
    await flushPromises();
    w.unmount();
    expect(useListViewState("ai-toolsets", {})).toMatchObject({
      filterQuery: "xyz",
      pageSize: 100,
    });
  });
});

describe("AiToolsets license lock", () => {
  const mountWithEmpty = () =>
    mount(AiToolsets, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          AddAiToolset: true,
          ConfirmDialog: true,
          OTable: { template: "<div><slot name='empty' /></div>" },
          OEmptyState: { name: "OEmptyState", template: "<div data-test='empty-stub' />" },
        },
      },
    });

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(aiToolsetsService.list).mockClear();
  });

  afterEach(() => {
    store.state.zoConfig.features = {};
  });

  it.each(["ai_toolsets", "ai_assistant"])(
    "requests no toolsets while %s is locked and leaves the dimmed page's table empty",
    async (feature) => {
      store.state.zoConfig.features = { [feature]: "locked" };
      const w = mountWithEmpty();
      await flushPromises();
      expect(aiToolsetsService.list).not.toHaveBeenCalled();
      expect(w.find("[data-test='empty-stub']").exists()).toBe(true);
      await (w.vm as any).refreshData();
      expect(aiToolsetsService.list).not.toHaveBeenCalled();
      w.unmount();
    },
  );

  it("loads the toolsets and keeps the regular empty state when ai_toolsets is enabled", async () => {
    store.state.zoConfig.features = { ai_toolsets: "enabled" };
    const w = mountWithEmpty();
    await flushPromises();
    expect(aiToolsetsService.list).toHaveBeenCalled();
    expect(w.find("[data-test='empty-stub']").exists()).toBe(true);
    w.unmount();
  });
});

describe("AiToolsets delete confirm", () => {
  it("names the toolset and uses a destructive OK button", async () => {
    const w: any = mountPage();
    await flushPromises();
    w.vm.confirmDeleteToolset({ id: "t1", name: "github-tools" });
    await flushPromises();
    const dialog = w.findComponent({ name: "ConfirmDialog" });
    expect(dialog.props("messageKeypath")).toBe("aiToolset.deleteMessage");
    expect(dialog.props("messageName")).toBe("github-tools");
    expect(dialog.props("okVariant")).toBe("destructive");
    w.unmount();
  });
});

describe("AiToolsets rename needed badge", () => {
  afterEach(() => {
    store.state.zoConfig.features = {};
  });

  it("marks only the rows whose normalized name collides", async () => {
    resetListViewState();
    queryClient.clear();
    store.state.zoConfig.features = { ai_toolsets: "enabled" };
    vi.mocked(aiToolsetsService.list).mockResolvedValueOnce({
      data: {
        toolsets: [
          { id: "a", name: "Datadog Prod", kind: "mcp", rename_needed: true },
          { id: "b", name: "datadog-prod", kind: "mcp", rename_needed: true },
          { id: "c", name: "github", kind: "mcp", rename_needed: false },
        ],
      },
    } as any);
    const w = mount(AiToolsets, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          AddAiToolset: true,
          ConfirmDialog: true,
          OTable: {
            props: ["data"],
            template:
              "<div><div v-for='row in data' :key='row.id'><slot name='cell-name' :row='row' /></div></div>",
          },
        },
      },
    });
    await flushPromises();
    const badges = w.findAll("[data-test$='-rename-needed']");
    expect(badges.map((b) => b.attributes("data-test"))).toEqual([
      "ai-toolsets-Datadog Prod-rename-needed",
      "ai-toolsets-datadog-prod-rename-needed",
    ]);
    expect(badges[0].text()).toBe("Rename needed");
    const hint =
      "Another toolset has the same name once normalized; delete and re-create one of them";
    const hints = w.findAllComponents(OTooltip).filter((c) => c.props("content") === hint);
    expect(hints).toHaveLength(2);
    w.unmount();
  });
});

describe("AiToolsets tool badges", () => {
  afterEach(() => {
    store.state.zoConfig.features = {};
  });

  it("shows each MCP row's tool badge and opens the editor at the picker", async () => {
    resetListViewState();
    queryClient.clear();
    store.state.zoConfig.features = { ai_toolsets: "enabled" };
    vi.mocked(aiToolsetsService.list).mockResolvedValueOnce({
      data: {
        toolsets: [
          { id: "a", name: "legacy", kind: "mcp", data: { url: "u" } },
          {
            id: "b",
            name: "empty",
            kind: "mcp",
            data: { allowed_tools: [], tools_verified_at: 1 },
          },
          { id: "c", name: "typed", kind: "mcp", data: { allowed_tools: ["x"] } },
          {
            id: "d",
            name: "ok",
            kind: "mcp",
            data: { allowed_tools: ["x"], tools_verified_at: 1 },
          },
          { id: "e", name: "kube", kind: "cli", data: { command: "kubectl" } },
          {
            id: "f",
            name: "down",
            kind: "mcp",
            data: { allowed_tools: ["x"], tools_verified_at: 1 },
            health: {
              failing_since: Date.now() * 1000 - 600_000_000,
              last_error_at: Date.now() * 1000 - 60_000_000,
              last_error: "401 Unauthorized",
            },
          },
          {
            id: "g",
            name: "stale",
            kind: "mcp",
            data: { allowed_tools: ["x"], tools_verified_at: 1 },
            health: {
              failing_since: 1,
              last_error_at: Date.now() * 1000 - 3_600_000_000,
              last_error: "5xx",
            },
          },
        ],
      },
    } as any);
    const w = mount(AiToolsets, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          AddAiToolset: true,
          ConfirmDialog: true,
          OTable: {
            props: ["data"],
            template:
              "<div><div v-for='row in data' :key='row.id'><slot name='cell-name' :row='row' /></div></div>",
          },
        },
      },
    });
    await flushPromises();

    const badges = w
      .findAll("[data-test*='-badge-']")
      .map((b) => [b.attributes("data-test"), b.text()]);
    expect(badges).toEqual([
      ["ai-toolsets-legacy-badge-allTools", "All tools allowed choose tools"],
      ["ai-toolsets-empty-badge-noTools", "No tools allowed"],
      ["ai-toolsets-typed-badge-notVerified", "Not verified"],
    ]);

    const failing = w.findAll("[data-test$='-failing']");
    expect(failing.map((b) => b.attributes("data-test"))).toEqual(["ai-toolsets-down-failing"]);
    expect(failing[0].text()).toMatch(/^Failing since .+: 401 Unauthorized$/);

    const push = vi.spyOn(router, "push");
    await w.find("[data-test='ai-toolsets-legacy-choose-tools']").trigger("click");
    expect(push).toHaveBeenCalledWith({
      query: expect.objectContaining({ action: "edit", id: "a", section: "tools" }),
    });
    push.mockRestore();
    w.unmount();
  });
});

describe("AiToolsets failing badge", () => {
  afterEach(() => {
    vi.useRealTimers();
    store.state.zoConfig.features = {};
  });

  it("expires while the list stays open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    resetListViewState();
    queryClient.clear();
    store.state.zoConfig.features = { ai_toolsets: "enabled" };
    const nowUs = Date.now() * 1000;
    vi.mocked(aiToolsetsService.list).mockResolvedValueOnce({
      data: {
        toolsets: [
          {
            id: "f",
            name: "down",
            kind: "mcp",
            data: { allowed_tools: ["x"], tools_verified_at: 1 },
            health: {
              failing_since: nowUs - 20 * 60_000_000,
              last_error_at: nowUs - 14 * 60_000_000,
              last_error: "5xx",
            },
          },
        ],
      },
    } as any);
    const w = mount(AiToolsets, {
      global: {
        plugins: [i18n, store, router],
        provide: { store },
        stubs: {
          AddAiToolset: true,
          ConfirmDialog: true,
          OTable: {
            props: ["data"],
            template:
              "<div><div v-for='row in data' :key='row.id'><slot name='cell-name' :row='row' /></div></div>",
          },
        },
      },
    });
    await flushPromises();
    expect(w.find("[data-test='ai-toolsets-down-failing']").exists()).toBe(true);

    vi.advanceTimersByTime(90_000);
    await flushPromises();
    expect(w.find("[data-test='ai-toolsets-down-failing']").exists()).toBe(false);
    w.unmount();
  });
});
