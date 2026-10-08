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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import IndexList from "@/plugins/logs/IndexList.vue";
import { searchState } from "@/composables/useLogs/searchState";
import { b64DecodeUnicode } from "@/utils/zincutils";

const sentValues = vi.hoisted(() => [] as any[]);

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any) => {
      sentValues.push(payload.queryReq);
    },
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

const stream = (name: string, fts: boolean) => ({
  name,
  schema: [
    { name: fts ? "body" : "msg_text", type: "Utf8" },
    { name: "level", type: "Utf8" },
  ],
  settings: fts ? { full_text_search_keys: ["body"] } : {},
});

describe("IndexList with a free-text filter (item 1)", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  const select = (...streams: any[]) => {
    searchObj.data.stream.streamType = "logs";
    searchObj.data.streamResults = { list: streams } as any;
    searchObj.data.stream.selectedStream = streams.map((s) => s.name);
    searchObj.data.stream.selectedStreamFields = [
      { name: "level", streams: streams.map((s) => s.name) },
    ] as any;
  };

  const valuesSql = () => sentValues.map((p) => [p.stream_name, b64DecodeUnicode(p.sql)]);

  beforeEach(async () => {
    sentValues.length = 0;
    searchObj.meta.sqlMode = false;
    searchObj.data.filterErrMsg = "";
    wrapper = mount(IndexList, { global: { provide: { store }, plugins: [i18n, router] } });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    searchObj.data.query = "";
    searchObj.data.stream.selectedStream = [];
    vi.clearAllMocks();
  });

  it("loads values with the rendered match_all and keeps the results visible (AC6.4)", async () => {
    select(stream("fts_a", true));
    searchObj.data.query = "timeout";

    await wrapper.vm.openFilterCreator({}, { name: "level", ftsKey: false, streams: ["fts_a"] });

    expect(valuesSql()).toEqual([["fts_a", `SELECT * FROM "fts_a" WHERE match_all('timeout')`]]);
    expect(searchObj.data.filterErrMsg).toBe("");
  });

  it("renders the text per stream and drops it where a stream cannot search text", async () => {
    select(stream("fts_a", true), stream("nofts_b", false));
    searchObj.data.query = "timeout";

    await wrapper.vm.openFilterCreator(
      {},
      { name: "level", ftsKey: false, streams: ["fts_a", "nofts_b"] },
    );

    expect(valuesSql()).toEqual([
      ["fts_a", `SELECT * FROM "fts_a" WHERE match_all('timeout')`],
      ["nofts_b", `SELECT * FROM "nofts_b"`],
    ]);
  });

  it("keeps today's values SQL for a field filter", async () => {
    select(stream("fts_a", true));
    searchObj.data.query = "level='error'";

    await wrapper.vm.openFilterCreator({}, { name: "body", ftsKey: false, streams: ["fts_a"] });

    expect(valuesSql()[0][1]).toContain(`WHERE "level" = 'error'`);
  });

  it("marks an included value even when the filter carries free text (AC6.5)", () => {
    select(stream("fts_a", true));
    searchObj.data.query = "match_all('timeout') and level='error'";
    expect(wrapper.vm.activeIncludeFilterValues).toEqual({ level: ["error"] });
    searchObj.data.query = "timeout";
    expect(wrapper.vm.activeIncludeFilterValues).toEqual({});
  });
});
