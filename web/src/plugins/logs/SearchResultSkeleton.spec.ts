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

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import SearchResultSkeleton from "./SearchResultSkeleton.vue";
import { searchState } from "@/composables/useLogs/searchState";

describe("SearchResultSkeleton", () => {
  const { searchObj } = searchState();

  beforeEach(() => {
    searchObj.meta.showHistogram = true;
    searchObj.meta.logsVisualizeToggle = "logs";
  });

  const mountSkeleton = () => mount(SearchResultSkeleton, { global: { plugins: [i18n] } });

  it("reserves the histogram strip when the histogram is on", () => {
    const wrapper = mountSkeleton();
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.find('[data-test="logs-search-result-loading-histogram"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("draws the results table skeleton on the logs tab", () => {
    const wrapper = mountSkeleton();
    expect(wrapper.find('[data-test="logs-search-result-table-skeleton"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("leaves the histogram strip out when the histogram is off", () => {
    searchObj.meta.showHistogram = false;
    const wrapper = mountSkeleton();
    expect(wrapper.find('[data-test="logs-search-result-loading-histogram"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("leaves the histogram strip out on the patterns tab, which has no histogram", () => {
    searchObj.meta.logsVisualizeToggle = "patterns";
    const wrapper = mountSkeleton();
    expect(wrapper.find('[data-test="logs-search-result-loading-histogram"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
