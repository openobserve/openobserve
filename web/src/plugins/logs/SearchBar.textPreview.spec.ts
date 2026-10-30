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

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — query editor text preview", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("asks the Logs query editor for the plain-text preview", async () => {
    await router.replace({ name: "logs" });
    wrapper = mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          UnifiedQueryEditor: {
            name: "UnifiedQueryEditor",
            template: '<div class="query-editor-stub" />',
            props: { textPreview: { type: Boolean, default: false } },
          },
        },
      },
    });
    await nextTick();
    const editor = wrapper
      .findAllComponents({ name: "UnifiedQueryEditor" })
      .find((c) => c.attributes("data-test") === "logs-search-bar-query-editor");
    expect(editor).toBeTruthy();
    expect(editor!.props("textPreview")).toBe(true);
  });
});
