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

// Pagination survives a round trip to add/edit/detail and back — same class of bug as Dashboards/Alerts/Templates/Destinations. OTable is mounted for real, so the full TanStack restore mechanism is reachable here, not just the URL-sync half.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/services/slos", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
    move: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock("@/services/alerts", () => ({
  default: { list_by_slo: vi.fn() },
}));

import SloList from "@/views/slos/SloList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const sloRow = (overrides: Record<string, any> = {}) => ({
  id: `slo-${overrides.name ?? "row"}`,
  name: "checkout-availability",
  enabled: true,
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  tags: [],
  folder_id: "default",
  status: {
    sli: 99.95,
    error_budget_remaining: 0.6,
    burn_rate: 0.4,
    coverage: 1,
    no_data: false,
  },
  ...overrides,
});

const manyRows = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    sloRow({ id: `slo-${i}`, name: `slo-${String(i).padStart(3, "0")}` }),
  );

async function mountList() {
  const wrapper = mount(SloList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        SelectFolderDropDown: true,
      },
    },
  });
  await flushPromises();
  // Real macrotask wait: the restore runs in a setTimeout(0), after TanStack's own deferred microtask reset — flushPromises() alone only drains microtasks.
  await new Promise((r) => setTimeout(r, 50));
  await flushPromises();
  return wrapper;
}

describe("SloList pagination persistence", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (router as any).currentRoute.value.query = {};
  });

  afterEach(() => {
    wrapper?.unmount();
    (router as any).currentRoute.value.query = {};
    vi.restoreAllMocks();
  });

  it("seeds currentPage from the URL's page query param", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: manyRows(30) } } as any);
    (router as any).currentRoute.value.query = { page: "2" };
    wrapper = await mountList();

    expect((wrapper.vm as any).currentPage).toBe(2);
  });

  it("defaults currentPage to 1 when no page query param is present", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    wrapper = await mountList();

    expect((wrapper.vm as any).currentPage).toBe(1);
  });

  it("restores the TanStack table's own page index once loading finishes", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: manyRows(30) } } as any);
    (router as any).currentRoute.value.query = { page: "2" };
    wrapper = await mountList();

    // 25 rows/page (SloList's fixed page size) × 30 rows → page 2 exists.
    expect((wrapper.vm as any).oTableRef.table.getState().pagination.pageIndex).toBe(1);
  });

  it("onPageChange updates currentPage and replaces the URL, preserving other query params", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { org_identifier: "test-org" };
    wrapper = await mountList();
    const replaceSpy = vi
      .spyOn(router, "replace")
      .mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted: the shared router's own async effects can touch query between mount and this call.
    (router as any).currentRoute.value.query = { org_identifier: "test-org" };

    (wrapper.vm as any).onPageChange(3);

    expect((wrapper.vm as any).currentPage).toBe(3);
    expect(replaceSpy).toHaveBeenCalledWith({
      query: { org_identifier: "test-org", page: "3" },
    });
  });

  it("onPageChange is a no-op on the URL when the page hasn't actually changed", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { page: "1" };
    wrapper = await mountList();
    const replaceSpy = vi
      .spyOn(router, "replace")
      .mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted for the same reason as the test above.
    (router as any).currentRoute.value.query = { page: "1" };

    (wrapper.vm as any).onPageChange(1);

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("goToNew preserves the page (and other) query params when opening the add form", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };
    wrapper = await mountList();
    // No call-through: this targets a different route, and a real navigation resolving async would leave the shared router's query mutated for the next test.
    const pushSpy = vi.spyOn(router, "push").mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted: the shared router's own async effects can touch query between mount and this call.
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };

    (wrapper.vm as any).goToNew();

    const pushed = pushSpy.mock.calls[0][0] as any;
    expect(pushed.name).toBe("addSlo");
    expect(pushed.query.page).toBe("3");
    expect(pushed.query.folder).toBe("team-a");
  });

  it("goToEdit preserves the page (and other) query params when opening the edit form", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };
    wrapper = await mountList();
    // No call-through: this targets a different route, and a real navigation resolving async would leave the shared router's query mutated for the next test.
    const pushSpy = vi.spyOn(router, "push").mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted: the shared router's own async effects can touch query between mount and this call.
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };

    (wrapper.vm as any).goToEdit(sloRow({ id: "slo-1" }));

    const pushed = pushSpy.mock.calls[0][0] as any;
    expect(pushed.name).toBe("editSlo");
    expect(pushed.params).toEqual({ slo_id: "slo-1" });
    expect(pushed.query.page).toBe("3");
    expect(pushed.query.folder).toBe("team-a");
  });

  it("onRowClick (row navigation to detail) preserves the page query param", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };
    wrapper = await mountList();
    // No call-through: this targets a different route, and a real navigation resolving async would leave the shared router's query mutated for the next test.
    const pushSpy = vi.spyOn(router, "push").mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted: the shared router's own async effects can touch query between mount and this call.
    (router as any).currentRoute.value.query = { page: "3", folder: "team-a" };

    (wrapper.vm as any).onRowClick(sloRow({ id: "slo-1" }));

    const pushed = pushSpy.mock.calls[0][0] as any;
    expect(pushed.name).toBe("sloDetail");
    expect(pushed.params).toEqual({ slo_id: "slo-1" });
    expect(pushed.query.page).toBe("3");
    expect(pushed.query.folder).toBe("team-a");
  });

  it("onFolderChange keeps carrying the page query param (already correct, guarded against regression)", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [sloRow()] } } as any);
    (router as any).currentRoute.value.query = { page: "3" };
    wrapper = await mountList();
    // No call-through: this targets a different route, and a real navigation resolving async would leave the shared router's query mutated for the next test.
    const pushSpy = vi.spyOn(router, "push").mockImplementation((() => Promise.resolve()) as any);
    // Re-asserted: the shared router's own async effects can touch query between mount and this call.
    (router as any).currentRoute.value.query = { page: "3" };

    (wrapper.vm as any).onFolderChange("team-b");

    const pushed = pushSpy.mock.calls[0][0] as any;
    expect(pushed.query.page).toBe("3");
    expect(pushed.query.folder).toBe("team-b");
  });
});
