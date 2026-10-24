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

const GENERATED_SQL =
  'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';

describe("SearchBar — a programmatic empty is not a user clear", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    wrapper.vm.searchObj.meta.sqlMode = true;
    wrapper.vm.searchObj.meta.logsVisualizeToggle = "build";
    wrapper.vm.searchObj.data.query = GENERATED_SQL;
    wrapper.vm.searchObj.data.editorValue = GENERATED_SQL;
    wrapper.vm.searchObj.data.stream.selectedStream = ["e2e_automate"];
  });

  afterEach(() => {
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.loadingStream = false;
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("keeps SQL mode on when the editor emits an empty value it was written to", () => {
    wrapper.vm.updateQueryValue("", { fromUser: false });

    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
  });

  it("keeps the query when the editor emits an empty value it was written to", () => {
    wrapper.vm.updateQueryValue("", { fromUser: false });

    expect(wrapper.vm.searchObj.data.query).toBe(GENERATED_SQL);
    expect(wrapper.vm.searchObj.data.editorValue).toBe(GENERATED_SQL);
  });

  it("still turns SQL mode off when the user clears the editor", () => {
    wrapper.vm.updateQueryValue("", { fromUser: true });

    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
    expect(wrapper.vm.searchObj.data.query).toBe("");
  });

  it("still turns SQL mode off for a clear with no origin reported", () => {
    wrapper.vm.updateQueryValue("");

    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
  });

  it("applies a programmatic non-empty value, which is how the generated SQL lands", () => {
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.data.editorValue = "";

    wrapper.vm.updateQueryValue(GENERATED_SQL, { fromUser: false });

    expect(wrapper.vm.searchObj.data.query).toBe(GENERATED_SQL);
  });
});
