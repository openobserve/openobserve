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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/services/slos", () => ({
  default: { list: vi.fn(), delete: vi.fn(), move: vi.fn(), setEnabled: vi.fn() },
}));
vi.mock("@/services/alerts", () => ({ default: { list_by_slo: vi.fn() } }));

import SloList from "@/views/slos/SloList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";
import { queryClient } from "@/composables/query/queryClient";

async function mountList() {
  const wrapper = mount(SloList, {
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        SelectFolderDropDown: true,
      },
    },
  });
  await flushPromises();
  // OTable holds its skeleton for a minimum time before it shows an empty or forbidden state.
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

describe("SloList license gating", () => {
  let wrapper: any;

  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    (router as any).currentRoute.value.query = {};
  });

  afterEach(() => {
    wrapper?.unmount();
    delete (store.state as any).zoConfig.features;
  });

  it("reads nothing and shows the license state while anomaly_detection is locked", async () => {
    (store.state as any).zoConfig.features = { anomaly_detection: "locked" };
    wrapper = await mountList();

    expect(sloService.list).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="stub-folder-list"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Retry");
  });

  it("shows the license state, not the raw error, when the list is license-denied", async () => {
    vi.mocked(sloService.list).mockRejectedValue({
      response: {
        status: 403,
        data: {
          code: 40001,
          message: "Features not included in your license: anomaly_detection",
          error_detail: "anomaly_detection",
        },
      },
    });
    wrapper = await mountList();

    expect((wrapper.vm as any).forbidden).toEqual(["anomaly_detection"]);
    expect((wrapper.vm as any).error).toBeNull();
    expect(wrapper.text()).not.toContain("Features not included in your license");
  });

  it("reads the list while anomaly_detection is enabled", async () => {
    vi.mocked(sloService.list).mockResolvedValue({ data: { list: [] } } as any);
    wrapper = await mountList();

    expect(sloService.list).toHaveBeenCalled();
    expect(wrapper.find('[data-test="stub-folder-list"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-forbidden"]').exists()).toBe(false);
  });
});
