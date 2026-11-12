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
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsPermalinkDrawer from "@/plugins/logs/LogsPermalinkDrawer.vue";
import { searchResultMounts, sharedLineRecord } from "@/composables/useLogs/useLogPermalink";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/plugins/logs/DetailTable.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "DetailTable",
    emits: ["search:timeboxed", "search:aroundwindow"],
    setup(_, { emit }) {
      return () =>
        h("div", [
          h("button", {
            "data-test": "stub-around-window",
            onClick: () => emit("search:aroundwindow", { startUs: 1, endUs: 2 }),
          }),
          h("button", {
            "data-test": "stub-timeboxed",
            onClick: () => emit("search:timeboxed", { key: 5, size: 10, body: { a: 1 } }),
          }),
        ]);
    },
  }),
}));

const mountDrawer = async () => {
  sharedLineRecord.value = { _timestamp: 5, a: 1 } as any;
  searchResultMounts.value = 0;
  const wrapper = mount(LogsPermalinkDrawer, {
    global: {
      plugins: [i18n, store],
      stubs: { ODrawer: { template: "<div><slot /></div>" } },
    },
  });
  await vi.waitFor(() => {
    if (!wrapper.find('[data-test="stub-timeboxed"]').exists()) throw new Error("not loaded");
  });
  return wrapper;
};

describe("LogsPermalinkDrawer search around", () => {
  afterEach(() => {
    sharedLineRecord.value = null;
  });

  it("forwards a time window from the detail table and closes the permalink", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="stub-around-window"]').trigger("click");

    expect(wrapper.emitted("search:aroundwindow")).toEqual([[{ startUs: 1, endUs: 2 }]]);
    expect(sharedLineRecord.value).toBeNull();
  });

  it("still forwards a record search unchanged", async () => {
    const wrapper = await mountDrawer();
    await wrapper.find('[data-test="stub-timeboxed"]').trigger("click");

    expect(wrapper.emitted("search-around")).toEqual([[{ key: 5, size: 10, body: { a: 1 } }]]);
  });
});
