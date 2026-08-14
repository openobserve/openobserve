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
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

/**
 * Drives the real `addSearchTerm` watcher in SearchBar.vue — the code path that
 * runs when a user clicks a field value in the index list to add it as a filter.
 *
 * These tests mount the component rather than re-implementing the watcher, so a
 * regression in the production code actually fails the suite.
 */
describe("SearchBar — adding a filter term to the query", () => {
  let wrapper: VueWrapper<any>;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

  /**
   * Sets the filter the index list would hand over and lets the watcher run.
   * Returns the query the user ends up with in the editor.
   */
  const addFilterTerm = async (filter: string) => {
    wrapper.vm.searchObj.data.stream.addToFilter = filter;
    await nextTick();
    return wrapper.vm.searchObj.data.query;
  };

  beforeEach(() => {
    wrapper = mountSearchBar();

    // searchObj is a module-level singleton in useLogs — reset what these tests touch.
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.data.editorValue = "";
    wrapper.vm.searchObj.data.stream.addToFilter = "";
    wrapper.vm.searchObj.data.stream.addToFilterMode = "replace";
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("appends the filter after a match_all term that contains a pipe", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    const query = await addFilterTerm("kubernetes_namespace_name='ziox'");

    expect(query).toBe("match_all('text | error') and kubernetes_namespace_name='ziox'");
  });

  it("leaves a match_all term with several pipes intact", async () => {
    wrapper.vm.searchObj.data.query = "match_all('a | b | c')";

    const query = await addFilterTerm("code=200");

    expect(query).toBe("match_all('a | b | c') and code=200");
  });

  it("appends the filter after a match_all term with no pipe", async () => {
    wrapper.vm.searchObj.data.query = "match_all('error')";

    const query = await addFilterTerm("code=200");

    expect(query).toBe("match_all('error') and code=200");
  });

  it("uses the filter as the whole query when the query is empty", async () => {
    const query = await addFilterTerm("code=200");

    expect(query).toBe("code=200");
  });

  it("mirrors the resulting query into the editor value", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    await addFilterTerm("code=200");

    expect(wrapper.vm.searchObj.data.editorValue).toBe("match_all('text | error') and code=200");
  });

  it("clears addToFilter once the term has been applied", async () => {
    wrapper.vm.searchObj.data.query = "match_all('text | error')";

    await addFilterTerm("code=200");

    expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("");
  });
});
