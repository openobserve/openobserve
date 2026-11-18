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
