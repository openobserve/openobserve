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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createStore } from "vuex";
import OSidebarLogo from "./OSidebarLogo.vue";
import config from "@/aws-exports";

let wrapper: VueWrapper;

async function mountLogo(zoConfig: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", name: "home", component: { template: "<div />" } }],
  });
  await router.push("/");
  const store = createStore({
    state: { selectedOrganization: { identifier: "default" }, zoConfig, theme: "light" },
  });
  wrapper = mount(OSidebarLogo, { global: { plugins: [router, store] } });
  await flushPromises();
  return wrapper;
}

afterEach(() => wrapper?.unmount());

describe("OSidebarLogo", () => {
  it("links home with the org and shows the full wordmark", async () => {
    await mountLogo();
    const logo = wrapper.find("[data-test='sidebar-logo']");
    expect(logo.attributes("href")).toContain("org_identifier=default");
    const img = wrapper.find("[data-test='sidebar-openobserve-logo']");
    expect(img.attributes("src")).toContain("openobserve_latest_light_2");
    expect(img.classes()).toContain("h-7");
  });

  it("shows an enterprise custom logo in place of the wordmark, beside the mark unless hidden", async () => {
    const was = config.isEnterprise;
    (config as { isEnterprise: string }).isEnterprise = "true";
    try {
      await mountLogo({ custom_logo_img: "AAAA", custom_hide_self_logo: false });
      expect(wrapper.find("[data-test='sidebar-custom-logo']").attributes("src")).toContain("AAAA");
      expect(wrapper.find("[data-test='sidebar-openobserve-logo']").attributes("src")).toContain(
        "openobserve_mark",
      );
      wrapper.unmount();
      await mountLogo({ custom_logo_text: "Acme", custom_hide_self_logo: true });
      expect(wrapper.find("[data-test='sidebar-custom-logo-text']").text()).toBe("Acme");
      expect(wrapper.find("[data-test='sidebar-openobserve-logo']").exists()).toBe(false);
    } finally {
      (config as { isEnterprise: string }).isEnterprise = was;
    }
  });
});
