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

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import SqlFilterBuilder from "@/components/filterBar/SqlFilterBuilder.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

const stream = (name: string, fields: string[]) => ({
  name,
  schema: fields.map((field) => ({ name: field, type: "Utf8" })),
  settings: {},
});

describe("SearchBar — the editor knows whether match_all can run", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    if (wrapper) {
      wrapper.vm.searchObj.data.stream.selectedStream = [];
      wrapper.vm.searchObj.data.streamResults = {};
    }
    wrapper?.unmount();
    wrapper = undefined;
  });

  const editorFullTextSearch = async (selected: string[], streams: any[]) => {
    await router.replace({ name: "logs" });
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          UnifiedQueryEditor: {
            name: "UnifiedQueryEditor",
            template: '<div class="query-editor-stub" />',
            props: { fullTextSearch: { type: Boolean, default: true } },
          },
        },
      },
    });
    wrapper.vm.searchObj.data.streamResults = { list: streams };
    wrapper.vm.searchObj.data.stream.selectedStream = selected;
    await nextTick();
    const editor = wrapper
      .findAllComponents({ name: "UnifiedQueryEditor" })
      .find((c) => c.attributes("data-test") === "logs-search-bar-query-editor");
    return editor!.props("fullTextSearch");
  };

  it("says yes for a stream with a full-text search field", async () => {
    expect(await editorFullTextSearch(["app"], [stream("app", ["log", "code"])])).toBe(true);
  });

  it("says no for a stream without one", async () => {
    expect(await editorFullTextSearch(["app"], [stream("app", ["code", "level"])])).toBe(false);
  });

  it("says no when any selected stream lacks one, since match_all fails there", async () => {
    const streams = [stream("app", ["log"]), stream("metrics", ["code"])];
    expect(await editorFullTextSearch(["app", "metrics"], streams)).toBe(false);
  });
});

describe("SearchBar — the filter builder offers free text only where match_all runs", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    if (wrapper) {
      wrapper.vm.searchObj.data.stream.selectedStream = [];
      wrapper.vm.searchObj.data.streamResults = {};
    }
    wrapper?.unmount();
    wrapper = undefined;
    localStorage.removeItem("o2.logs.queryInput");
  });

  const builderFreeText = async (fields: string[]) => {
    localStorage.setItem("o2.logs.queryInput", "builder");
    await router.replace({ name: "logs" });
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { UnifiedQueryEditor: true } },
    });
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.streamResults = { list: [stream("app", fields)] };
    wrapper.vm.searchObj.data.stream.selectedStream = ["app"];
    await nextTick();
    return wrapper.findComponent(SqlFilterBuilder).props("freeText");
  };

  it("keeps the search-text row for a stream with a full-text search field", async () => {
    expect(await builderFreeText(["log", "code"])).toBe(true);
  });

  it("drops it for a stream without one", async () => {
    expect(await builderFreeText(["code", "level"])).toBe(false);
  });
});
