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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

describe("SearchBar Run query pending mark after the query changes", () => {
  let wrapper: VueWrapper<any> | undefined;

  const mountWithRun = (toggle: string) => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    const { searchObj, autoRun } = wrapper.vm;
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.query = "match_all('error')";
    searchObj.data.editorValue = "match_all('error')";
    searchObj.meta.logsVisualizeToggle = toggle;
    searchObj.meta.editorDirty = false;
    searchObj.meta.executed = {
      generation: 1,
      signature: autoRun.readSignature(),
      req: {},
      complete: true,
    };
  };

  const clearQuery = async () => {
    wrapper!.vm.searchObj.data.query = "";
    wrapper!.vm.searchObj.data.editorValue = "";
    await nextTick();
  };

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each(["logs", "drilldown"])(
    "marks Run query pending in %s once the query differs from the last run",
    async (toggle) => {
      mountWithRun(toggle);
      expect(wrapper!.vm.showRunQueryPending).toBe(false);

      await clearQuery();

      expect(wrapper!.vm.showRunQueryPending).toBe(true);
    },
  );

  it.each(["visualize", "patterns"])(
    "leaves the logs-run pending mark out of %s",
    async (toggle) => {
      mountWithRun(toggle);

      await clearQuery();

      expect(wrapper!.vm.showRunQueryPending).toBe(false);
    },
  );
});
