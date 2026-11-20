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
import SearchBar from "@/plugins/logs/SearchBar.vue";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: toastMock };
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("SearchBar custom range download with a partial response", () => {
  let wrapper: VueWrapper<any> | undefined;
  let downloaded: any[] | undefined;

  const run = async (data: Record<string, unknown>) => {
    vi.mocked(searchService.search).mockResolvedValue({ data } as any);
    wrapper!.vm.searchObj.data.customDownloadQueryObj = {
      query: { sql: 'select * from "app"', from: 0, size: 50 },
    };
    wrapper!.vm.downloadCustomInitialNumber = 1;
    wrapper!.vm.downloadCustomRange = 1000;
    wrapper!.vm.downloadRangeData();
    await vi.waitFor(() => expect(searchService.search).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
  };

  const warnings = () =>
    toastMock.mock.calls.map((c) => c[0]).filter((t) => t.variant === "warning");

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

  it("still saves the rows but warns with the server reason when is_partial is true", async () => {
    await run({
      hits: rows(999),
      is_partial: true,
      function_error: ["Query duration is modified due to query range restriction of 1 hours"],
    });
    expect(downloaded).toHaveLength(999);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0].message).toContain("query range restriction of 1 hours");
  });

  it("warns with a generic message when is_partial is true and no reason is given", async () => {
    await run({ hits: rows(12), is_partial: true });
    expect(downloaded).toHaveLength(12);
    expect(warnings()).toHaveLength(1);
  });

  it("warns when function_error is a non-empty string", async () => {
    await run({ hits: rows(5), is_partial: false, function_error: "VRL failed" });
    expect(downloaded).toHaveLength(5);
    expect(warnings()[0].message).toContain("VRL failed");
  });

  it("shows no warning for a full response", async () => {
    await run({ hits: rows(12), is_partial: false, function_error: [] });
    expect(downloaded).toHaveLength(12);
    expect(warnings()).toHaveLength(0);
  });
});
