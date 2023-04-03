// Copyright 2022 Zinc Labs Inc. and Contributors

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { installQuasar } from "../../helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

import Index from "@/plugins/logs/Index.vue";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import i18n from "@/locales";
import store from "../../helpers/store";
import routes from "@/router/routes";
import { createRouter, createWebHistory } from "vue-router";
import "plotly.js";
import searchService from "@/services/search";

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("Search Result", async () => {
  let wrapper: any;
  beforeEach(async () => {
    vi.useFakeTimers();
    wrapper = mount(Index, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
        stubs: {
          IndexList: true,
          SearchResult: true,
        },
      },
    });
    wrapper.vm.router.currentRoute.value.name = "logs";
    await flushPromises();
    vi.advanceTimersByTime(500);
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
    // vi.clearAllMocks();
  });

  it("Should render show query toggle btn", () => {
    expect(
      wrapper
        .find('[data-test="logs-search-bar-show-query-toggle-btn"]')
        .exists()
    ).toBeTruthy();
  });

  it("Should render show fields toggle btn", () => {
    expect(
      wrapper
        .find('[data-test="logs-search-bar-show-fields-toggle-btn"]')
        .exists()
    ).toBeTruthy();
  });

  it("Should render show histogram toggle btn", () => {
    expect(
      wrapper
        .find('[data-test="logs-search-bar-show-histogram-toggle-btn"]')
        .exists()
    ).toBeTruthy();
  });

  it("Should render sql mode toggle btn", () => {
    expect(
      wrapper.find('[data-test="logs-search-bar-sql-mode-toggle-btn"]').exists()
    ).toBeTruthy();
  });

  it("Should render date selection", () => {
    expect(
      wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()
    ).toBeTruthy();
  });

  it("Should render Run Query btn and emit searchdata on click", async () => {
    await wrapper
      .find('[data-test="logs-search-bar-refresh-btn"]')
      .trigger("click");

    expect(
      wrapper.findComponent(SearchBar).emitted()["searchdata"]
    ).toBeTruthy();
  });

  it("Should get logs after 5 secs when search interval is updated to 5 secs", async () => {
    const search = vi.spyOn(searchService, "search");
    const domWrapper = new DOMWrapper(document.body);
    await wrapper
      .find('[data-test="logs-search-refresh-interval-dropdown-btn"]')
      .trigger("click");

    await domWrapper
      .find('[data-test="logs-search-bar-refresh-time-5"]')
      .trigger("click");

    await vi.advanceTimersByTime(6000);
    expect(search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTime(6000);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("Should get logs when date time is updated", async () => {
    const search = vi.spyOn(searchService, "search");
    const domWrapper = new DOMWrapper(document.body);
    await wrapper.find('[data-test="date-time-btn"]').trigger("click");

    await domWrapper
      .find('[data-test="date-time-relative-1-Weeks-btn"]')
      .trigger("click");

    await vi.advanceTimersByTime(2000);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
