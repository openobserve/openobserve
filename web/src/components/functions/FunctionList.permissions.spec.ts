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

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

import i18n from "@/locales";
import { resetListViewState } from "@/composables/useListViewState";
import { flushCanQueue, resetCanCache } from "@/composables/useCan";
import FunctionList from "./FunctionList.vue";

vi.unmock("@/composables/useCan");

const { mockList, mockBulkDelete, checkMock } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockBulkDelete: vi.fn(),
  checkMock: vi.fn(),
}));

vi.mock("@/services/authz", () => ({
  AUTHZ_CHECK_MAX_ITEMS: 500,
  default: { check: checkMock },
}));
vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, isEnterprise: "true", isCloud: "false" } };
});
vi.mock("@/services/jstransform", () => ({
  default: {
    list: mockList,
    delete: vi.fn(),
    bulkDelete: mockBulkDelete,
    getAssociatedPipelines: vi.fn(),
  },
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: vi.fn(() => () => {}) };
});
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "test-org" } } },
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((url: string) => url),
  verifyOrganizationStatus: vi.fn(),
}));
vi.mock("@/composables/useLogs/searchState", () => ({
  default: () => ({ searchObj: { data: { transforms: [] } } }),
}));

// The server answers per item, in request order; this fixture keys off the item itself.
function answerWith(isAllowed: (item: { id: string; action: string }) => boolean) {
  checkMock.mockImplementation(async (_org: string, items: { id: string; action: string }[]) => ({
    data: { enforced: true, results: items.map((item) => ({ allowed: isAllowed(item) })) },
  }));
}

async function mountList() {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      userInfo: { email: "test@example.com" },
      theme: "light",
    },
  });
  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/functions", name: "functionList", component: { template: "<div />" } }],
  });
  await router.push("/functions");
  const wrapper = mount(FunctionList, {
    global: {
      plugins: [i18n, store, router],
      stubs: { AddFunction: true, NoData: true, ConfirmDialog: true },
    },
  });
  await flushPromises();
  // OTable holds its skeleton briefly after loading clears.
  await new Promise((r) => setTimeout(r, 80));
  await flushCanQueue();
  await flushPromises();
  await nextTick();
  return wrapper;
}

describe("FunctionList permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetListViewState();
    resetCanCache();
    sessionStorage.clear();
    mockList.mockResolvedValue({
      data: {
        list: [
          { name: "func1", function: "identity()", params: "", transType: 0 },
          { name: "func2", function: "drop()", params: "", transType: 0 },
        ],
      },
    });
    mockBulkDelete.mockResolvedValue({ data: { successful: ["func1"], unsuccessful: [] } });
  });

  it("turns Edit into a read-only View and hides Delete for a viewer", async () => {
    answerWith(() => false);
    const wrapper = await mountList();

    expect(wrapper.findAll('[data-test="function-list-view-function-btn"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="function-list-edit-function-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="function-list-delete-function-btn"]').exists()).toBe(false);
  });

  it("keeps Edit and Delete for an editor who may do both", async () => {
    answerWith(() => true);
    const wrapper = await mountList();

    expect(wrapper.findAll('[data-test="function-list-edit-function-btn"]')).toHaveLength(2);
    expect(wrapper.findAll('[data-test="function-list-delete-function-btn"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="function-list-view-function-btn"]').exists()).toBe(false);
  });

  it("bulk delete sends only the rows the user may delete and says how many are skipped", async () => {
    answerWith((item) => item.action === "edit" || item.id === "func1");
    const wrapper = await mountList();
    const vm = wrapper.vm as any;

    vm.selectedFunctions = [{ name: "func1" }, { name: "func2" }];
    await flushCanQueue();
    await flushPromises();

    expect(vm.bulkDeleteSplit.allowed.map((f: any) => f.name)).toEqual(["func1"]);
    expect(vm.bulkDeleteSplit.skipped.map((f: any) => f.name)).toEqual(["func2"]);

    const confirm = wrapper
      .findAllComponents({ name: "ConfirmDialog" })
      .find((c) => String(c.attributes("message") ?? "").includes("skipped"));
    expect(confirm?.attributes("message")).toBe("Delete 1 of 2 — 1 skipped (no permission)");
    expect(confirm?.attributes("detail")).toBe("Skipped: func2");

    await vm.bulkDeleteFunctions();
    await flushPromises();
    expect(mockBulkDelete).toHaveBeenCalledWith("test-org", { ids: ["func1"] });
  });
});
