// Copyright 2023 OpenObserve Inc.
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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import MenuLink from "@/components/MenuLink.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: { template: "<div>Home</div>" } },
    { path: "/logs", component: { template: "<div>Logs</div>" } }
  ]
});

// Set current route for the router
mockRouter.currentRoute.value = {
  path: "/logs",
  name: "logs",
  params: {},
  query: {},
  hash: "",
  fullPath: "/logs",
  matched: [],
  meta: {},
  redirectedFrom: undefined
};

describe("MenuLink", async () => {
  let wrapper: any = null;
  beforeEach(() => {
    // render the component
    wrapper = mount(MenuLink, {
      props: {
        title: "Logs",
        caption: "",
        link: "#",
        icon: "",
        mini: false,
      },
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
      },
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("should mount MenuLink component", async () => {
    expect(wrapper).toBeTruthy();
  });

  it("should render item title", async () => {
    expect(wrapper.find('[data-test="menu-link-#-item"]').text()).toBe("Logs");
  });

  it("should handle mini prop correctly", async () => {
    await wrapper.setProps({ mini: true });
    expect(wrapper.props("mini")).toBe(true);
  });

  it("should call window.open after clicking on external url", async () => {
    const windowOpen = vi.spyOn(window, "open");
    await wrapper.setProps({ external: true });
    await wrapper.find('[data-test="menu-link-#-item"]').trigger("click");
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toBeCalledWith("#", "_blank");
    windowOpen.mockRestore();
  });

  it("should render icon when icon prop is provided", async () => {
    await wrapper.setProps({ icon: "home" });
    expect(wrapper.find(".q-icon").exists()).toBe(true);
  });

  it("should render with iconComponent when provided", async () => {
    const iconComponent = { template: "<div>Custom Icon</div>" };
    await wrapper.setProps({ iconComponent });
    expect(wrapper.vm.iconComponent).toBeDefined();
  });

  it("should have correct default props", () => {
    expect(wrapper.props("caption")).toBe("");
    expect(wrapper.props("link")).toBe("#");
    expect(wrapper.props("icon")).toBe("");
    expect(wrapper.props("mini")).toBe(false);
  });

  it("should expose openWebPage function from setup", () => {
    expect(typeof wrapper.vm.openWebPage).toBe("function");
  });

  it("should not open external link when external is false", async () => {
    const windowOpen = vi.spyOn(window, "open");
    await wrapper.setProps({ external: false });
    await wrapper.find('[data-test="menu-link-#-item"]').trigger("click");
    expect(windowOpen).not.toHaveBeenCalled();
    windowOpen.mockRestore();
  });
});
