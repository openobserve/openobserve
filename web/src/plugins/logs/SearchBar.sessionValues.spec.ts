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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/composables/fieldValueStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/fieldValueStore")>()),
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue([]),
}));

import SearchBar from "@/plugins/logs/SearchBar.vue";

describe("SearchBar — session values reach the first value lookup", () => {
  let wrapper: VueWrapper<any>;

  afterEach(() => wrapper?.unmount());

  // The query is emitted on a debounce, so a lookup on the first keystroke must not wait for it to see the page's values.
  it("offers the page's values before any query has been emitted", async () => {
    wrapper = mount(SearchBar, {
      props: { fieldValues: { level: new Set(["error", "warn"]) } },
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    wrapper.vm.searchObj.data.stream.selectedStream = [];
    await wrapper.vm.$nextTick();
    await expect(wrapper.vm.resolveFieldValues("level")).resolves.toEqual(["error", "warn"]);
  });
});
