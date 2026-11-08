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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

vi.mock("@/services/slos", () => ({
  default: { list: vi.fn(), get: vi.fn(), delete: vi.fn(), move: vi.fn(), setEnabled: vi.fn() },
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

async function mountList(tags: string[]) {
  const row = {
    id: "slo-123",
    name: "checkout-availability",
    enabled: true,
    target: 99.9,
    window_secs: 30 * 86400,
    slice_interval_secs: 300,
    tags,
    folder_id: "default",
    status: {
      sli: 99.95,
      error_budget_remaining: 0.6,
      burn_rate: 0.4,
      coverage: 1,
      no_data: false,
    },
  };
  vi.mocked(sloService.list).mockResolvedValue({ data: { list: [row] } } as any);
  const wrapper = mount(SloList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        SelectFolderDropDown: true,
        ODialog: true,
        ExportResourceDialog: true,
        IacRegistryLinks: true,
      },
    },
  });
  await flushPromises();
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

describe("SloList tags cell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    node.innerHTML = "";
  });

  it("collapses what does not fit into +N and keeps the full list in the tooltip", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(60);
    const wrapper = await mountList(["prod", "payments", "tier:1"]);
    const fit = wrapper.find('[data-test="fit-items"]');
    expect(fit.find('[data-test="fit-items-more"]').text()).toBe("+2");
    const tooltip = wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((t) => t.props("content") === "prod, payments, tier:1");
    expect(tooltip).toBeTruthy();
    wrapper.unmount();
  });

  it("shows every tag with no +N when they fit, in truncating chips", async () => {
    const wrapper = await mountList(["prod", "payments", "tier:1"]);
    expect(wrapper.findAll("[data-fit-item] span.truncate").map((s) => s.text())).toEqual([
      "prod",
      "payments",
      "tier:1",
    ]);
    expect(wrapper.find('[data-test="fit-items-more"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders nothing when there are no tags", async () => {
    const wrapper = await mountList([]);
    expect(wrapper.find('[data-test="fit-items"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
