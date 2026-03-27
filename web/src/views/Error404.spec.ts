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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createRouter, createWebHistory } from "vue-router";
import i18n from "@/locales";
import Error404 from "./Error404.vue";

installQuasar();

describe("Error404", () => {
  let wrapper: VueWrapper;

  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div>Home</div>" } },
    ],
  });

  beforeEach(() => {
    vi.useFakeTimers();
    wrapper = mount(Error404, {
      global: {
        plugins: [router, i18n],
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should render the Error404 component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should display 404 text", () => {
    expect(wrapper.text()).toContain("404");
  });

  it("should display 'Page not found' message", () => {
    expect(wrapper.text()).toContain("Page not found");
  });

  it("should have a 'Go home' button", () => {
    const button = wrapper.find('[data-test="error-404-go-home-btn"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain("Go home");
  });

  it("should have correct styling classes", () => {
    const page = wrapper.find(".error-404-page");
    expect(page.exists()).toBe(true);

    const content = wrapper.find(".error-404-content");
    expect(content.exists()).toBe(true);
  });
});
