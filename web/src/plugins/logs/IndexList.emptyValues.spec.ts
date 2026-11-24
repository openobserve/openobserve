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

const schema = [
  { name: "k", type: "Utf8" },
  { name: "n", type: "Int64" },
];

// The values API returns a missing field as "", so the field list's blank row holds missing and empty values.
describe("Logs field list: the blank and null rows", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  beforeEach(async () => {
    searchObj.meta.sqlMode = false;
    searchObj.data.stream.streamType = "logs";
    searchObj.data.streamResults = { list: [{ name: "app", schema, settings: {} }] } as any;
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedStreamFields = schema.map((f) => ({
      name: f.name,
      dataType: f.type,
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

  it.each([
    ["k", [""], "include", "(k is null OR k = '')"],
    ["k", [""], "exclude", "(k is not null AND k != '')"],
    ["k", ["", "x"], "include", "(k is null OR k = '' OR k = 'x')"],
    ["k", ["", "x"], "exclude", "(k is not null AND k != '' AND k != 'x')"],
    ["k", ["null"], "include", "k = 'null'"],
    ["n", ["", "5"], "include", "(n is null OR n = 5)"],
  ])("ticking %s %j (%s) builds %s", (field, values, action, expression) => {
    wrapper.vm.addMultipleSearchTerms(field, values, action);
    expect(searchObj.data.stream.addToFilter).toBe(expression);
  });

  it.each([
    ["include", "k is null"],
    ["exclude", "k is not null"],
  ])(
    "checks only null (%s) when another selected stream types the field as a number",
    (action, expression) => {
      searchObj.data.streamResults = {
        list: [
          { name: "app", schema, settings: {} },
          { name: "other", schema: [{ name: "k", type: "Int64" }], settings: {} },
        ],
      } as any;
      searchObj.data.stream.selectedStream = ["app", "other"];
      wrapper.vm.addMultipleSearchTerms("k", [""], action);
      expect(searchObj.data.stream.addToFilter).toBe(expression);
    },
  );

  it("reads the blank-row filter back as the blank row", async () => {
    searchObj.data.query = "(k is null OR k = '' OR k = 'x')";
    await flushPromises();
    expect(wrapper.vm.activeIncludeFilterValues).toEqual({ k: ["", "x"] });
  });
});
