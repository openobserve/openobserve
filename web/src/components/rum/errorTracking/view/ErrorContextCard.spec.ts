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

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ErrorContextCard from "@/components/rum/errorTracking/view/ErrorContextCard.vue";
import i18n from "@/locales";

const mockError = {
  usr_name: "Göksenin Güngör",
  usr_email: "goksenin.gungor@example.ch",
  ip: "176.42.18.160",
  geo_info_city: "Ankara",
  geo_info_country: "Türkiye",
  user_agent_user_agent_family: "Chrome",
  user_agent_user_agent_major: "149",
  user_agent_os_family: "Mac OS X",
  user_agent_os_major: "10",
  user_agent_os_minor: "15",
  user_agent_device_brand: "Apple",
  user_agent_device_family: "Mac",
  view_url: "https://app.example.com/billings/plans",
  service: "checkout-web",
  version: "2.4.1",
  env: "production",
  sdk_version: "0.3.2-beta.3",
  source: "console",
};

describe("ErrorContextCard", () => {
  let wrapper: VueWrapper<any>;

  const mountComponent = (error: Record<string, any> = mockError) =>
    mount(ErrorContextCard, {
      props: { error },
      global: { plugins: [i18n] },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("identity", () => {
    it("shows the user's name and email", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-context-user-name"]').text()).toBe(
        "Göksenin Güngör",
      );
      expect(wrapper.find('[data-test="rum-error-context-user-email"]').text()).toBe(
        "goksenin.gungor@example.ch",
      );
    });

    it("falls back to an unknown-user label when no identity was captured", () => {
      wrapper = mountComponent({});

      expect(wrapper.find('[data-test="rum-error-context-user-name"]').text()).toBe("Unknown User");
    });

    it("derives initials from the email when there is no name", () => {
      wrapper = mountComponent({ usr_email: "ada.lovelace@example.com" });

      expect(wrapper.text()).toContain("al");
    });
  });

  describe("environment", () => {
    it("shows the browser family and version", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-context-browser"]').text()).toBe("Chrome");
      expect(wrapper.text()).toContain("Version 149");
    });

    it("shows the operating system with a dotted version", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-context-os"]').text()).toBe("Mac OS X");
      expect(wrapper.text()).toContain("Version 10.15");
    });

    it("says the version is unknown when no version parts were captured", () => {
      wrapper = mountComponent({ user_agent_user_agent_family: "Chrome" });

      expect(wrapper.text()).toContain("Version unknown");
    });
  });

  describe("metadata rows", () => {
    it("shows the device, location, ip and page url", () => {
      wrapper = mountComponent();

      expect(wrapper.find('[data-test="rum-error-context-device"]').text()).toContain("Apple Mac");
      expect(wrapper.find('[data-test="rum-error-context-location"]').text()).toContain(
        "Ankara, Türkiye",
      );
      expect(wrapper.find('[data-test="rum-error-context-ip"]').text()).toContain("176.42.18.160");
      expect(wrapper.find('[data-test="rum-error-context-url"]').text()).toContain(
        "https://app.example.com/billings/plans",
      );
    });

    it("omits the ip and url rows when those fields are absent", () => {
      wrapper = mountComponent({ usr_email: "a@b.com" });

      expect(wrapper.find('[data-test="rum-error-context-ip"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-error-context-url"]').exists()).toBe(false);
    });

    it("shows an unknown label for device and location when nothing was captured", () => {
      wrapper = mountComponent({});

      expect(wrapper.find('[data-test="rum-error-context-device"]').text()).toContain("Unknown");
      expect(wrapper.find('[data-test="rum-error-context-location"]').text()).toContain("Unknown");
    });

    it("shows just the country when the city is missing", () => {
      wrapper = mountComponent({ geo_info_country: "Türkiye" });

      expect(wrapper.find('[data-test="rum-error-context-location"]').text()).toContain("Türkiye");
    });
  });

  describe("deployment chips", () => {
    it("shows the service, version, environment and sdk chips", () => {
      wrapper = mountComponent();

      const text = wrapper.text();
      expect(text).toContain("checkout-web");
      expect(text).toContain("2.4.1");
      expect(text).toContain("production");
      expect(text).toContain("0.3.2-beta.3");
    });

    it("renders no chips when the error carries no deployment identity", () => {
      wrapper = mountComponent({ usr_email: "a@b.com" });

      expect(wrapper.text()).not.toContain("checkout-web");
    });
  });
});
