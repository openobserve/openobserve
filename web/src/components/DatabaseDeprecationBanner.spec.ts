// Copyright 2025 OpenObserve Inc.
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
import { mount } from "@vue/test-utils";
import DatabaseDeprecationBanner from "./DatabaseDeprecationBanner.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";

installQuasar();

describe("DatabaseDeprecationBanner", () => {
  let store: any;
  const DISMISS_KEY = "mysql_deprecation_dismissed";

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should render when MySQL deprecation warning is enabled", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".deprecation-message").exists()).toBe(true);
  });

  it("should not render when MySQL deprecation warning is disabled", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: false,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".deprecation-message").exists()).toBe(false);
  });

  it("should display deprecation message text", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    const message = wrapper.find(".deprecation-message");
    expect(message.text()).toContain("MySQL support is DEPRECATED");
  });

  it("should display migration subtitle", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    const subtitle = wrapper.find(".deprecation-subtitle");
    expect(subtitle.text()).toContain("Please migrate to PostgreSQL");
  });

  it("should render close button", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    const closeButton = wrapper.findComponent({ name: "QBtn" });
    expect(closeButton.exists()).toBe(true);
    expect(closeButton.props("icon")).toBe("close");
  });

  it("should hide banner when close button is clicked", async () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".deprecation-message").exists()).toBe(true);

    const closeButton = wrapper.findComponent({ name: "QBtn" });
    await closeButton.trigger("click");

    expect(wrapper.vm.showDeprecationWarning).toBe(false);
  });

  it("should save dismiss timestamp to localStorage", async () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    const closeButton = wrapper.findComponent({ name: "QBtn" });
    await closeButton.trigger("click");

    const dismissData = localStorage.getItem(DISMISS_KEY);
    expect(dismissData).not.toBeNull();

    const parsedData = JSON.parse(dismissData!);
    expect(parsedData).toHaveProperty("timestamp");
  });

  it("should not show banner if dismissed within 7 days", () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3); // 3 days ago

    localStorage.setItem(
      DISMISS_KEY,
      JSON.stringify({ timestamp: recentDate.toISOString() })
    );

    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.vm.showDeprecationWarning).toBe(false);
  });

  it("should show banner again after 7 days", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10); // 10 days ago

    localStorage.setItem(
      DISMISS_KEY,
      JSON.stringify({ timestamp: oldDate.toISOString() })
    );

    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.vm.showDeprecationWarning).toBe(true);
  });

  it("should apply light theme class", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".light-stream-container").exists()).toBe(true);
  });

  it("should apply dark theme class", () => {
    store = createStore({
      state: {
        theme: "dark",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".dark-stream-container").exists()).toBe(true);
  });

  it("should handle invalid localStorage data gracefully", () => {
    localStorage.setItem(DISMISS_KEY, "invalid json");

    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    // Should show warning when localStorage data is invalid
    expect(wrapper.vm.showDeprecationWarning).toBe(true);
  });

  it("should have correct accessibility attributes", () => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          mysql_deprecated_warning: true,
        },
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    const banner = wrapper.find('[role="region"]');
    expect(banner.exists()).toBe(true);
    expect(banner.attributes("aria-label")).toBe("MySQL deprecation warning");
  });

  it("should not render when zoConfig is missing", () => {
    store = createStore({
      state: {
        theme: "light",
      },
    });

    const wrapper = mount(DatabaseDeprecationBanner, {
      global: {
        plugins: [store],
      },
    });

    expect(wrapper.find(".deprecation-message").exists()).toBe(false);
  });
});
