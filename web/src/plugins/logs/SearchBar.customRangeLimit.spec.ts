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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/formatters";
import SearchBar from "@/plugins/logs/SearchBar.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("SearchBar custom range download with a SQL LIMIT", () => {
  let wrapper: VueWrapper<any> | undefined;
  let downloaded: any[] | undefined;

  const run = async (
    sql: string,
    serverRows: number,
    initial: number,
    range: number,
    encoded = false,
  ) => {
    vi.mocked(searchService.search).mockResolvedValue({
      data: { hits: rows(serverRows) },
    } as any);
    wrapper!.vm.searchObj.data.customDownloadQueryObj = {
      ...(encoded ? { encoding: "base64" } : {}),
      query: { sql, from: 0, size: 50 },
    };
    wrapper!.vm.downloadCustomInitialNumber = initial;
    wrapper!.vm.downloadCustomRange = range;
    wrapper!.vm.downloadRangeData();
    await vi.waitFor(() => expect(searchService.search).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    return vi.mocked(searchService.search).mock.calls[0][0].query.query;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    downloaded = undefined;
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    wrapper.vm.downloadLogs = vi.fn(async (hits: any[]) => {
      downloaded = hits;
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("downloads only the requested range when the query has LIMIT 2000", async () => {
    const sent = await run('select * from "app" limit 2000', 2000, 1, 500);
    expect(sent.size).toBe(2000);
    expect(downloaded).toHaveLength(500);
  });

  it("reads the row count from LIMIT n OFFSET m", async () => {
    const sent = await run('select * from "app" limit 300 offset 5', 300, 1, 100);
    expect(sent.size).toBe(300);
    expect(downloaded).toHaveLength(100);
  });

  it("reads a base64-encoded download query", async () => {
    const sent = await run(b64EncodeUnicode('select * from "app" limit 2000'), 2000, 1, 500, true);
    expect(sent.size).toBe(2000);
    expect(downloaded).toHaveLength(500);
  });

  it("finds the LIMIT of a set-operation query", async () => {
    await run('select a from "x" union all select a from "y" limit 100', 100, 1, 50);
    expect(downloaded).toHaveLength(50);
  });

  it("keeps asking the server for the window when there is no LIMIT", async () => {
    const sent = await run('select * from "app"', 500, 11, 500);
    expect(sent).toMatchObject({ from: 10, size: 500 });
    expect(downloaded).toHaveLength(500);
  });
});
