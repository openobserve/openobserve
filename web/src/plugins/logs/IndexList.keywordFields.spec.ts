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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import IndexList from "@/plugins/logs/IndexList.vue";
import FieldValuesPanel from "@/components/common/FieldValuesPanel.vue";
import { searchState } from "@/composables/useLogs/searchState";

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: vi.fn(),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: (...args: any[]) => ({
      ...actual.default(...args),
      getStreams: vi.fn(async () => ({ list: [] })),
    }),
  };
});

const appStream = {
  name: "app",
  schema: ["order", "group", "svc_name", "msg"].map((name) => ({ name, type: "Utf8" })),
  settings: {},
};

describe("Logs field list with a SQL-keyword field in the query", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  beforeEach(async () => {
    searchObj.meta.sqlMode = false;
    searchObj.data.stream.streamType = "logs";
    searchObj.data.streamResults = { list: [appStream] } as any;
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedStreamFields = appStream.schema.map((field) => ({
      name: field.name,
      streams: ["app"],
    })) as any;
    wrapper = mount(IndexList, { global: { provide: { store }, plugins: [i18n, router] } });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    searchObj.data.query = "";
    searchObj.data.stream.addToFilter = "";
    searchObj.data.stream.selectedStream = [];
    vi.clearAllMocks();
  });

  it.each(["order", "group", "svc_name"])(
    "ticking a second msg value next to a %s filter ORs it with the first",
    async (field) => {
      searchObj.data.query = `(${field} = 'x1') AND msg = 'A'`;
      await flushPromises();
      expect(wrapper.vm.activeIncludeFilterValues).toEqual({ [field]: ["x1"], msg: ["A"] });

      const panel = mount(FieldValuesPanel, {
        props: {
          fieldName: "msg",
          fieldValues: {
            isLoading: false,
            values: [
              { key: "A", count: 2 },
              { key: "B", count: 1 },
            ],
          },
          activeIncludeValues: wrapper.vm.activeIncludeFilterValues.msg,
        },
        global: { plugins: [i18n] },
      });
      await panel
        .find('[data-test="logs-search-subfield-add-msg-B"] [role="checkbox"]')
        .trigger("click");
      const [name, values, action] = panel.emitted("add-multiple-search-terms")!.at(-1)!;
      wrapper.vm.addMultipleSearchTerms(name, values, action);
      panel.unmount();

      expect(searchObj.data.stream.addToFilter).toBe("(msg = 'A' OR msg = 'B')");
    },
  );

  it("reads an excluded value next to a keyword-named field", async () => {
    searchObj.data.query = "group = 'g1' AND msg != 'A'";
    await flushPromises();
    expect(wrapper.vm.activeExcludeFilterValues).toEqual({ msg: ["A"] });
    expect(wrapper.vm.activeIncludeFilterValues).toEqual({ group: ["g1"] });
  });
});
