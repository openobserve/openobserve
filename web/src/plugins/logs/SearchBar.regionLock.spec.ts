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

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import config from "@/aws-exports";
import SearchBar from "@/plugins/logs/SearchBar.vue";

describe("SearchBar — region dropdown under a super_cluster license lock", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalIsEnterprise = config.isEnterprise;
  const originalZoConfig = { ...store.state.zoConfig };
  const originalRegionInfo = store.state.regionInfo;

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          QueryEditor: true,
          OTooltip: { template: "<div><slot /></div>" },
        },
      },
    });

  const regionButton = () =>
    wrapper
      ?.findAllComponents({ name: "OButton" })
      .find((c) => c.attributes("data-test") === "logs-search-bar-region-btn");

  const regionDropdown = () =>
    wrapper
      ?.findAllComponents({ name: "ODropdown" })
      .find((c) => c.vm.$attrs["data-test"] === "logs-search-bar-region-btn");

  beforeEach(() => {
    (config as any).isEnterprise = "true";
    store.state.regionInfo = [{ label: "us", children: [{ label: "c1" }] }];
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    (config as any).isEnterprise = originalIsEnterprise;
    store.state.zoConfig = { ...originalZoConfig };
    store.state.regionInfo = originalRegionInfo;
  });

  it("renders a disabled Region button with a lock and no region menu when locked", () => {
    store.state.zoConfig = {
      ...originalZoConfig,
      super_cluster_enabled: true,
      features: { super_cluster: "locked" },
    };
    wrapper = mountSearchBar();
    expect(regionButton()?.props("disabled")).toBe(true);
    expect(wrapper.find('[data-test="logs-search-bar-region-lock"]').exists()).toBe(true);
    expect(regionDropdown()).toBeUndefined();
  });

  it("keeps the region menu when the license leaves super_cluster enabled", () => {
    store.state.zoConfig = { ...originalZoConfig, super_cluster_enabled: true };
    wrapper = mountSearchBar();
    expect(wrapper.find('[data-test="logs-search-bar-region-lock"]').exists()).toBe(false);
    expect(regionDropdown()).toBeDefined();
  });
});
