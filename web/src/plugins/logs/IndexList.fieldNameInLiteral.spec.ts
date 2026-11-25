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

describe("IndexList field values for a filter whose text contains a field name", () => {
  const { searchObj } = searchState();
  let wrapper: any;

  const names = ["message", "service", "status", "api"];

  const valuesSql = () => sentValues.map((p) => b64DecodeUnicode(p.sql));

  const loadServiceValues = async (query: string) => {
    searchObj.data.streamResults = {
      list: [{ name: "app", schema: names.map((name) => ({ name, type: "Utf8" })), settings: {} }],
    } as any;
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.selectedStreamFields = names.map((name) => ({
      name,
      streams: ["app"],
    })) as any;
    searchObj.data.query = query;
    await wrapper.vm.openFilterCreator({}, { name: "service", ftsKey: false, streams: ["app"] });
  };

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

  it("leaves the text of a LIKE literal untouched and quotes the real field", async () => {
    await loadServiceValues("message LIKE '%from api status 500%'");

    expect(valuesSql()).toEqual([
      `SELECT * FROM "app" WHERE "message" LIKE '%from api status 500%'`,
    ]);
  });

  it("does the same for NOT LIKE", async () => {
    await loadServiceValues("message NOT LIKE '%from api status 500%'");

    expect(valuesSql()).toEqual([
      `SELECT * FROM "app" WHERE "message" NOT LIKE '%from api status 500%'`,
    ]);
  });

  it("still quotes a field used outside a literal", async () => {
    await loadServiceValues("status = 500 AND message = 'api'");

    expect(valuesSql()).toEqual([`SELECT * FROM "app" WHERE "status" = 500 AND "message" = 'api'`]);
  });
});
