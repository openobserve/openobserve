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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

/**
 * Drives the real `updateQueryValue` in SearchBar.vue for the case where a SQL
 * query names a stream the org doesn't have. Previously this silently left
 * `selectedStream` empty with no message — Index.vue then fell back to the
 * generic "pick a stream" empty state, which reads as if nothing had been
 * typed, hiding that the query pointed at a real, specific, wrong name.
 */
describe("SearchBar — query references a stream that doesn't exist", () => {
  let wrapper: VueWrapper<any>;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

  beforeEach(() => {
    wrapper = mountSearchBar();

    // searchObj is a module-level singleton in useLogs — reset what these tests touch.
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.data.editorValue = "";
    wrapper.vm.searchObj.data.filterErrMsg = "";
    wrapper.vm.searchObj.data.stream.selectedStream = [];
    wrapper.vm.searchObj.data.streamResults = { list: [{ name: "logs" }] };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("reports the missing stream by name instead of leaving no message", () => {
    wrapper.vm.updateQueryValue('SELECT * FROM "does_not_exist"');

    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
    expect(wrapper.vm.searchObj.data.filterErrMsg).toBe('Stream "does_not_exist" does not exist');
  });

  it("selects the stream and clears any prior error when it does exist", () => {
    wrapper.vm.searchObj.data.filterErrMsg = "stale error from a previous query";

    wrapper.vm.updateQueryValue('SELECT * FROM "logs"');

    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual(["logs"]);
    expect(wrapper.vm.searchObj.data.filterErrMsg).toBe("");
  });

  it("clears the message once the query is emptied out", () => {
    wrapper.vm.searchObj.meta.sqlMode = true;
    wrapper.vm.updateQueryValue('SELECT * FROM "does_not_exist"');
    expect(wrapper.vm.searchObj.data.filterErrMsg).not.toBe("");

    wrapper.vm.updateQueryValue("");

    expect(wrapper.vm.searchObj.data.filterErrMsg).toBe("");
  });
});
