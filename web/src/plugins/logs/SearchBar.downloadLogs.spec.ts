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
import analytics from "@/services/product_analytics";
import SearchBar from "@/plugins/logs/SearchBar.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

describe("SearchBar — logs_downloaded analytics", () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    (URL as any).createObjectURL = vi.fn(() => "blob:test");
    (URL as any).revokeObjectURL = vi.fn();
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });
    wrapper.vm.searchObj.data.stream.selectedStream = ["app"];
    wrapper.vm.searchObj.data.queryResults = { hits: [{ level: "info" }] };
    wrapper.vm.searchObj.meta.executed = {
      generation: 1,
      signature: wrapper.vm.autoRun.readSignature(),
      req: {},
      complete: true,
    };
    wrapper.vm.searchObj.meta.editorDirty = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each(["csv", "json"])("tracks logs_downloaded after a %s file is produced", async (format) => {
    await wrapper!.vm.downloadLogs([{ level: "info" }], format);

    expect(analytics.track).toHaveBeenCalledWith("logs_downloaded", { format });
  });

  it("does not track when there is nothing to download", async () => {
    await wrapper!.vm.downloadLogs([], "csv");

    expect(analytics.track).not.toHaveBeenCalledWith("logs_downloaded", expect.anything());
  });

  it("does not track when building the file fails", async () => {
    (URL as any).createObjectURL = vi.fn(() => {
      throw new Error("boom");
    });

    await wrapper!.vm.downloadLogs([{ level: "info" }], "json");

    expect(analytics.track).not.toHaveBeenCalledWith("logs_downloaded", expect.anything());
  });
});
