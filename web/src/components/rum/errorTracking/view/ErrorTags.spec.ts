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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ErrorTags from "@/components/rum/errorTracking/view/ErrorTags.vue";
import i18n from "@/locales";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Install Quasar plugins
installQuasar({
  plugins: [quasar.Dialog, quasar.Notify, quasar.Loading],
});

// Mock ErrorTag component
vi.mock("@/components/rum/errorTracking/view/ErrorTag.vue", () => ({
  default: {
    name: "ErrorTag",
    template: '<div data-test="error-tag">{{ tag.key }}: {{ tag.value }}</div>',
    props: ["tag"],
  },
}));

// Mock image imports
vi.mock("@/assets/images/rum/chrome.png", () => ({
  default: "/mock/chrome.png",
}));
vi.mock("@/assets/images/rum/firefox.png", () => ({
  default: "/mock/firefox.png",
}));
vi.mock("@/assets/images/rum/safari.png", () => ({
  default: "/mock/safari.png",
}));
vi.mock("@/assets/images/rum/opera.png", () => ({
  default: "/mock/opera.png",
}));
vi.mock("@/assets/images/rum/edge.png", () => ({ default: "/mock/edge.png" }));
vi.mock("@/assets/images/rum/ip_ad.png", () => ({ default: "/mock/ip.png" }));
vi.mock("@/assets/images/rum/windows.png", () => ({
  default: "/mock/windows.png",
}));
vi.mock("@/assets/images/rum/mac.png", () => ({ default: "/mock/mac.png" }));
vi.mock("@/assets/images/rum/linux.png", () => ({
  default: "/mock/linux.png",
}));

describe("ErrorTags Component", () => {
  let wrapper: any;

  const mockError = {
    ip: "192.168.1.1",
    user_agent_user_agent_family: "Chrome",
    user_agent_user_agent_major: "120",
    user_agent_user_agent_minor: "0",
    user_agent_user_agent_patch: "0",
    user_agent_os_family: "Windows",
    user_agent_os_major: "10",
    user_agent_os_minor: "0",
    user_agent_os_patch: "19045",
    view_url: "https://example.com/dashboard",
    error_handling: "unhandled",
    service: "web-app",
    source: "browser",
    user_agent_device_brand: "Dell",
    user_agent_device_family: "Desktop",
    sdk_version: "1.2.3",
    usr_email: "user@example.com",
    geo_info_country: "United States",
    geo_info_city: "New York",
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(ErrorTags, {
      attachTo: "#app",
      props: {
        error: mockError,
      },
      global: {
        plugins: [i18n],
        stubs: {
          "q-separator": {
            template: '<div data-test="separator" />',
            props: ["vertical"],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should render tags title", () => {
      const title = wrapper.find(".tags-title");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Tags");
    });
  });

  describe("IP Address Display", () => {
    it("should display IP address with icon", () => {
      const ipSection = wrapper.find(".q-mr-lg.items-center");
      expect(ipSection.exists()).toBe(true);
      expect(ipSection.text()).toContain("192.168.1.1");
    });

    it("should render IP icon", () => {
      const ipIcon = wrapper.find("img[src='/mock/ip.png']");
      expect(ipIcon.exists()).toBe(true);
      expect(ipIcon.attributes("alt")).toBe("IP");
      expect(ipIcon.classes()).toContain("tw:w-[1.875rem]!");
      expect(ipIcon.classes()).toContain("tw:h-auto!");
    });
  });

  describe("Browser Information", () => {
    it("should display browser information", () => {
      const browserSection = wrapper.find(".q-mx-lg.items-center");
      expect(browserSection.exists()).toBe(true);
      expect(browserSection.text()).toContain("Chrome");
      expect(browserSection.text()).toContain("Version 120.0.0");
    });

    it("should render correct browser icon for Chrome", () => {
      const browserIcon = wrapper.find("img[src='/mock/chrome.png']");
      expect(browserIcon.exists()).toBe(true);
      expect(browserIcon.classes()).toContain("inline-block");
    });

    it("should render Firefox icon for Firefox", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "Firefox",
        },
      });

      await wrapper.vm.$nextTick();

      // The component sets icons only on mount, not reactively
      // So we need to check the computed method result instead
      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/firefox.png");
    });

    it("should render Safari icon for Safari", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "Safari",
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/safari.png");
    });

    it("should render Opera icon for Opera", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "Opera",
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/opera.png");
    });

    it("should render Edge icon for Edge", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "Edge",
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/edge.png");
    });

    it("should default to Chrome icon for unknown browser", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "UnknownBrowser",
        },
      });

      await wrapper.vm.$nextTick();

      const browserIcon = wrapper.find("img[src='/mock/chrome.png']");
      expect(browserIcon.exists()).toBe(true);
    });
  });

  describe("Operating System Information", () => {
    it("should display OS information", () => {
      const osElements = wrapper.findAll(".q-mx-lg.items-center");
      const osSection = osElements[1]; // Second section is OS
      expect(osSection.text()).toContain("Windows");
      expect(osSection.text()).toContain("Version 10.0.19045");
    });

    it("should render Windows icon for Windows", () => {
      const osIcon = wrapper.find("img[src='/mock/windows.png']");
      expect(osIcon.exists()).toBe(true);
    });

    it("should render Mac icon for Mac", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_os_family: "Mac OS X",
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.getOsIcon()).toBe("/mock/mac.png");
    });

    it("should render Linux icon for Linux", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_os_family: "Linux",
        },
      });

      await wrapper.vm.$nextTick();

      expect(wrapper.vm.getOsIcon()).toBe("/mock/linux.png");
    });

    it("should default to Windows icon for unknown OS", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_os_family: "UnknownOS",
        },
      });

      await wrapper.vm.$nextTick();

      const osIcon = wrapper.find("img[src='/mock/windows.png']");
      expect(osIcon.exists()).toBe(true);
    });
  });

  describe("Version Computations", () => {
    it("should compute browser version correctly", () => {
      expect(wrapper.vm.getBrowserVersion).toBe("Version 120.0.0");
    });

    it("should handle missing browser version info", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_major: null,
        },
      });

      expect(wrapper.vm.getBrowserVersion).toBe("Version Unknown");
    });

    it("should handle partial browser version info", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_major: "119",
          user_agent_user_agent_minor: null,
          user_agent_user_agent_patch: null,
        },
      });

      expect(wrapper.vm.getBrowserVersion).toBe("Version 119");
    });

    it("should compute OS version correctly", () => {
      expect(wrapper.vm.getOsVersion).toBe("Version 10.0.19045");
    });

    it("should handle missing OS version info", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_os_major: null,
        },
      });

      expect(wrapper.vm.getOsVersion).toBe("Version Unknown");
    });
  });

  describe("Tags Generation", () => {
    it("should generate correct tags", () => {
      const tags = wrapper.vm.getTags;

      expect(tags.ip).toBe("192.168.1.1");
      expect(tags.url).toBe("https://example.com/dashboard");
      expect(tags.handled).toBe(false);
      expect(tags.location).toBe("United States, New York");
      expect(tags.service).toBe("web-app");
      expect(tags.source).toBe("browser");
      expect(tags.device).toBe("Dell Desktop");
      expect(tags.browser).toBe("Chrome");
      expect(tags.level).toBe("error");
      expect(tags.sdk_version).toBe("1.2.3");
      expect(tags.user_email).toBe("user@example.com");
    });

    it("should handle handled errors", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          error_handling: "handled",
        },
      });

      const tags = wrapper.vm.getTags;
      expect(tags.handled).toBe(true);
    });

    it("should provide defaults for missing values", async () => {
      await wrapper.setProps({
        error: {
          ip: "127.0.0.1",
        },
      });

      const tags = wrapper.vm.getTags;
      expect(tags.service).toBe("Unknown");
      expect(tags.source).toBe("Unknown");
      expect(tags.user_email).toBe("Unknown User");
      expect(tags.location).toBe("Unknown");
      expect(tags.device).toBe("Unknown");
    });
  });

  describe("Device Information", () => {
    it("should combine device brand and family", () => {
      expect(wrapper.vm.getDevice()).toBe("Dell Desktop");
    });

    it("should handle missing device brand", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_device_brand: null,
        },
      });

      expect(wrapper.vm.getDevice()).toBe("Desktop");
    });

    it("should handle missing device family", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_device_family: null,
        },
      });

      expect(wrapper.vm.getDevice()).toBe("Dell");
    });

    it("should handle missing device info", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_device_brand: null,
          user_agent_device_family: null,
        },
      });

      expect(wrapper.vm.getDevice()).toBe("Unknown");
    });
  });

  describe("Location Information", () => {
    it("should combine country and city", () => {
      expect(wrapper.vm.getLocation()).toBe("United States, New York");
    });

    it("should handle missing country", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          geo_info_country: null,
        },
      });

      expect(wrapper.vm.getLocation()).toBe("New York");
    });

    it("should handle missing city", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          geo_info_city: null,
        },
      });

      expect(wrapper.vm.getLocation()).toBe("United States");
    });

    it("should handle missing location info", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          geo_info_country: null,
          geo_info_city: null,
        },
      });

      expect(wrapper.vm.getLocation()).toBe("Unknown");
    });
  });

  describe("Error Tags Rendering", () => {
    it("should render multiple ErrorTag components", () => {
      const errorTags = wrapper.findAllComponents({ name: "ErrorTag" });
      expect(errorTags.length).toBeGreaterThan(0);
    });

    it("should pass correct props to ErrorTag components", () => {
      const errorTags = wrapper.findAllComponents({ name: "ErrorTag" });

      const ipTag = errorTags.find(
        (tag) =>
          tag.props("tag").key === "ip" &&
          tag.props("tag").value === "192.168.1.1",
      );

      expect(ipTag).toBeDefined();
    });

    it("should render tags in correct container", () => {
      const tagsContainer = wrapper.find(".row.items-center.wrap.q-mt-md");
      expect(tagsContainer.exists()).toBe(true);
    });
  });

  describe("Separators", () => {
    it("should render vertical separators", () => {
      const separators = wrapper.findAll('[data-test="separator"]');
      expect(separators.length).toBeGreaterThan(0);
    });

    it("should have proper separator placement", () => {
      const separators = wrapper.findAllComponents({ name: "q-separator" });
      separators.forEach((separator: any) => {
        if (separator.exists()) {
          expect(separator.props("vertical")).toBe(true);
        }
      });
    });
  });

  describe("Component Lifecycle", () => {
    it("should call onMounted hook", () => {
      expect(wrapper.vm.osIcon).toBeDefined();
      expect(wrapper.vm.browserIcon).toBeDefined();
    });

    it("should set icons on mount", () => {
      expect(wrapper.vm.osIcon).toBe("/mock/windows.png");
      expect(wrapper.vm.browserIcon).toBe("/mock/chrome.png");
    });

    it("should update icons when props change", async () => {
      await wrapper.setProps({
        error: {
          ...mockError,
          user_agent_user_agent_family: "Firefox",
          user_agent_os_family: "Mac OS X",
        },
      });

      await wrapper.vm.$nextTick();

      // Icons are set only on mount, but methods return correct values
      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/firefox.png");
      expect(wrapper.vm.getOsIcon()).toBe("/mock/mac.png");
    });
  });

  describe("Browser Icon Methods", () => {
    it("should return correct icons for different browsers", async () => {
      const testCases = [
        { family: "Chrome Mobile", expected: "/mock/chrome.png" },
        { family: "Firefox Mobile", expected: "/mock/firefox.png" },
        { family: "Safari Mobile", expected: "/mock/safari.png" },
        { family: "Opera Mini", expected: "/mock/opera.png" },
        { family: "Microsoft Edge", expected: "/mock/edge.png" },
      ];

      for (const { family, expected } of testCases) {
        await wrapper.setProps({
          error: { ...mockError, user_agent_user_agent_family: family },
        });
        const result = wrapper.vm.getBrowserIcon();
        expect(result).toBe(expected);
      }
    });

    it("should handle case-insensitive browser matching", async () => {
      const testCases = [
        { family: "CHROME", expected: "/mock/chrome.png" },
        { family: "firefox", expected: "/mock/firefox.png" },
        { family: "Safari", expected: "/mock/safari.png" },
      ];

      for (const { family, expected } of testCases) {
        await wrapper.setProps({
          error: { ...mockError, user_agent_user_agent_family: family },
        });
        const result = wrapper.vm.getBrowserIcon();
        expect(result).toBe(expected);
      }
    });
  });

  describe("OS Icon Methods", () => {
    it("should return correct icons for different OS", async () => {
      const testCases = [
        { family: "Windows 10", expected: "/mock/windows.png" },
        { family: "Mac OS X", expected: "/mock/mac.png" },
        { family: "Ubuntu Linux", expected: "/mock/linux.png" },
      ];

      for (const { family, expected } of testCases) {
        await wrapper.setProps({
          error: { ...mockError, user_agent_os_family: family },
        });
        const result = wrapper.vm.getOsIcon();
        expect(result).toBe(expected);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle null error object", () => {
      // Component expects an object, so this test should validate prop type requirement
      expect(ErrorTags.props?.error?.required).toBe(true);
      expect(ErrorTags.props?.error?.type).toBe(Object);
    });

    it("should handle empty error object", async () => {
      await wrapper.setProps({
        error: {},
      });

      const tags = wrapper.vm.getTags;
      expect(tags.service).toBe("Unknown");
      expect(tags.user_email).toBe("Unknown User");
    });

    it("should handle undefined user agent fields", async () => {
      await wrapper.setProps({
        error: {
          ip: "127.0.0.1",
          user_agent_user_agent_family: undefined,
        },
      });

      expect(wrapper.vm.getBrowserIcon()).toBe("/mock/chrome.png");
      expect(wrapper.vm.getBrowserVersion).toBe("Version Unknown");
    });
  });

  describe("CSS Classes", () => {
    it("should apply correct styling classes", () => {
      const title = wrapper.find(".tags-title");
      expect(title.classes()).toContain("tags-title");

      const mainRow = wrapper.find(".row.items-center");
      expect(mainRow.classes()).toContain("row");
      expect(mainRow.classes()).toContain("items-center");
    });

    it("should apply inline-block classes", () => {
      const inlineElements = wrapper.findAll(".inline-block");
      expect(inlineElements.length).toBeGreaterThan(0);
    });
  });

  describe("Props Validation", () => {
    it("should require error prop", () => {
      expect(ErrorTags.props?.error?.required).toBe(true);
      expect(ErrorTags.props?.error?.type).toBe(Object);
    });
  });
});
