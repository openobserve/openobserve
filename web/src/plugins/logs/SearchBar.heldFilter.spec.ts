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
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import searchService from "@/services/search";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import useSearchQuery from "@/composables/useLogs/useSearchQuery";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const stream = {
  name: "fts_a",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "body", type: "Utf8" },
    { name: "status", type: "Int64" },
    { name: "is_error", type: "Boolean" },
  ],
  settings: { full_text_search_keys: ["body"] },
};

const QueryProbe = defineComponent({
  setup() {
    const { t } = useI18n();
    return { getQueryReq: useSearchQuery(t).getQueryReq };
  },
  template: "<div />",
});

describe("SearchBar — a held filter never reaches an alert or a download", () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
    const { searchObj } = wrapper.vm;
    searchObj.meta.sqlMode = false;
    searchObj.meta.quickMode = false;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStream = ["fts_a"];
    searchObj.data.stream.streamLists = [{ label: "fts_a", value: "fts_a" }];
    searchObj.data.stream.selectedStreamFields = stream.schema.map((f) => ({ name: f.name }));
    searchObj.data.streamResults = { list: [stream] };
  });

  afterEach(() => {
    const { searchObj } = wrapper!.vm;
    searchObj.data.query = "";
    searchObj.data.streamResults = { list: [] };
    searchObj.data.stream.selectedStream = [];
    searchObj.data.customDownloadQueryObj = {};
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each(["status=500 -404 AND is_error", "status=500 AND is_error -404"])(
    "opens the logs alert on the stream with the filter-dropped warning: %s",
    (query) => {
      wrapper!.vm.searchObj.data.query = query;
      const prefill = wrapper!.vm.buildAlertPrefill();
      const keys = prefill.warnings.map((w: any) => w.key);
      expect(prefill.sql).toBe('select * from "fts_a"');
      expect(keys).toContain("heldFilterDropped");
      expect(keys).not.toContain("textFilterDropped");
      expect(keys).not.toContain("convertedToSql");
      expect(prefill.sql).not.toContain("404");
    },
  );

  it("carries a filter it can run into the logs alert without the warning", () => {
    wrapper!.vm.searchObj.data.query = "status=500 -404";
    const prefill = wrapper!.vm.buildAlertPrefill();
    expect(prefill.sql).toBe(`select * from "fts_a"  WHERE status = 500 AND NOT match_all('404')`);
    expect(prefill.warnings.map((w: any) => w.key)).not.toContain("heldFilterDropped");
  });

  it("refuses a download after a held run, even right after a run that built one", () => {
    const search = vi
      .spyOn(searchService, "search")
      .mockResolvedValue({ data: { hits: [] } } as any);
    const probe = mount(QueryProbe, {
      global: { provide: { store }, plugins: [i18n, router] },
    });
    const { searchObj } = wrapper!.vm;
    wrapper!.vm.downloadCustomInitialNumber = 1;
    searchObj.data.query = "status=500";
    expect(probe.vm.getQueryReq(false)).not.toBeNull();
    wrapper!.vm.downloadRangeData();
    expect(search).toHaveBeenCalledTimes(1);
    searchObj.data.query = "status=500 AND is_error -404";
    expect(probe.vm.getQueryReq(false)).toBeNull();
    wrapper!.vm.downloadRangeData();
    expect(search).toHaveBeenCalledTimes(1);
    probe.unmount();
  });
});
