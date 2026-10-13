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
import { flushPromises, mount } from "@vue/test-utils";
import LlmProvidersSettings from "./LlmProvidersSettings.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";

vi.mock("@/services/online-evals.service.queries", () => ({
  providersQuery: (org: string) => ({
    queryKey: ["llm-providers-spec", org],
    queryFn: async () => [],
  }),
  deleteProviderMutation: () => ({ mutationFn: async () => ({}) }),
}));

const mountPage = () =>
  mount(LlmProvidersSettings, {
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: { ProviderFormPage: true, ConfirmDialog: true, OTable: true },
    },
  });

describe("LlmProvidersSettings list view state", () => {
  beforeEach(() => resetListViewState());

  it("restores saved search, page size, page and sort", async () => {
    Object.assign(useListViewState("llm-providers", {}), {
      searchQuery: "abc",
      pageSize: 50,
      currentPage: 2,
      sortBy: "name",
      sortOrder: "desc",
    });
    const w: any = mountPage();
    await flushPromises();
    expect([
      w.vm.searchQuery,
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
    w.vm.searchQuery = "xyz";
    w.vm.pageSize = 100;
    await flushPromises();
    w.unmount();
    expect(useListViewState("llm-providers", {})).toMatchObject({
      searchQuery: "xyz",
      pageSize: 100,
    });
  });
});
