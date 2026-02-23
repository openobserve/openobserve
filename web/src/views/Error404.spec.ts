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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import Error404 from "./Error404.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

describe("Error404", () => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div>Home</div>" } },
    ],
  });

  it("should render the Error404 component", () => {
    const wrapper = mount(Error404, {
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display 404 text", () => {
    const wrapper = mount(Error404, {
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.text()).toContain("404");
  });

  it("should display 'Oops. Nothing here...' message", () => {
    const wrapper = mount(Error404, {
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.text()).toContain("Oops. Nothing here...");
  });

  it("should have a 'Go Home' button", () => {
    const wrapper = mount(Error404, {
      global: {
        plugins: [router],
      },
    });

    const button = wrapper.findComponent({ name: "QBtn" });
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("Go Home");
  });

  it("should have correct styling classes", () => {
    const wrapper = mount(Error404, {
      global: {
        plugins: [router],
      },
    });

    const container = wrapper.find("div");
    expect(container.classes()).toContain("fullscreen");
    expect(container.classes()).toContain("bg-blue");
  });
});
