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
import SearchBar from "@/plugins/logs/SearchBar.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const stream = {
  name: "app_logs",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "body", type: "Utf8" },
    { name: "status", type: "Int64" },
  ],
  settings: { full_text_search_keys: ["body"] },
};

describe("SearchBar — create an alert from the search", () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
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
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.data.stream.streamLists = [{ label: "app_logs", value: "app_logs" }];
    searchObj.data.stream.selectedStreamFields = stream.schema.map((f) => ({ name: f.name }));
    searchObj.data.streamResults = { list: [stream] };
  });

  afterEach(() => {
    const { searchObj } = wrapper!.vm;
    searchObj.data.query = "";
    searchObj.data.streamResults = { list: [] };
    searchObj.data.stream.selectedStream = [];
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("shows an Alert on this button on the toolbar", () => {
    const button = wrapper!.find('[data-test="logs-search-bar-alert-on-this-btn"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("Alert on this");
  });

  it("hands a plain filter to the alert form as builder conditions", async () => {
    wrapper!.vm.searchObj.data.query = "status = 500";
    await vi.waitFor(() => expect(wrapper!.vm.buildAlertPrefill().queryType).toBe("custom"));
    const prefill = wrapper!.vm.buildAlertPrefill();
    expect(prefill.conditions.conditions).toEqual([
      expect.objectContaining({ column: "status", operator: "=", value: "500" }),
    ]);
  });

  it("keeps SQL for a free-text filter the builder cannot hold", async () => {
    wrapper!.vm.searchObj.data.query = "status=500 -404";
    await new Promise((resolve) => setTimeout(resolve, 50));
    const prefill = wrapper!.vm.buildAlertPrefill();
    expect(prefill.queryType).toBe("sql");
    expect(prefill.sql).toMatch(/^select _timestamp from "app_logs"/);
  });
});
