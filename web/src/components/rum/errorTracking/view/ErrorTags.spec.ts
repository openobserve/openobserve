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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ErrorTags from "@/components/rum/errorTracking/view/ErrorTags.vue";
import i18n from "@/locales";

vi.mock("@/assets/images/rum/chrome.png", () => ({ default: "/mock/chrome.png" }));
vi.mock("@/assets/images/rum/firefox.png", () => ({ default: "/mock/firefox.png" }));
vi.mock("@/assets/images/rum/safari.png", () => ({ default: "/mock/safari.png" }));
vi.mock("@/assets/images/rum/opera.png", () => ({ default: "/mock/opera.png" }));
vi.mock("@/assets/images/rum/edge.png", () => ({ default: "/mock/edge.png" }));
vi.mock("@/assets/images/rum/ip_ad.png", () => ({ default: "/mock/ip.png" }));
vi.mock("@/assets/images/rum/windows.png", () => ({ default: "/mock/windows.png" }));
vi.mock("@/assets/images/rum/mac.png", () => ({ default: "/mock/mac.png" }));
vi.mock("@/assets/images/rum/linux.png", () => ({ default: "/mock/linux.png" }));

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

function mountComponent(error = mockError) {
  return mount(ErrorTags, {
    props: { error },
    global: {
      plugins: [i18n],
      stubs: {
        OSeparator: {
          template: '<div data-test="separator" />',
          props: ["vertical"],
        },
        ErrorTag: {
          name: "ErrorTag",
          template: '<div data-test="error-tag">{{ tag.key }}: {{ tag.value }}</div>',
          props: ["tag"],
        },
      },
    },
  });
}

describe("ErrorTags Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  it("mounts successfully", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.exists()).toBe(true);
  });

  it("shows the Tags section title", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Tags");
  });

  it("displays the IP address", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("192.168.1.1");
  });

  it("renders the IP icon image", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const img = wrapper.find('img[alt="IP"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBe("/mock/ip.png");
  });

  it("displays the browser family name", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Chrome");
  });

  it("displays the browser version", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Version 120.0.0");
  });

  it("renders the Chrome browser icon on mount", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const img = wrapper.find('img[src="/mock/chrome.png"]');
    expect(img.exists()).toBe(true);
  });

  it("displays the OS family name", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Windows");
  });

  it("displays the OS version", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    expect(wrapper.text()).toContain("Version 10.0.19045");
  });

  it("renders the Windows OS icon on mount", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const img = wrapper.find('img[src="/mock/windows.png"]');
    expect(img.exists()).toBe(true);
  });

  it("renders ErrorTag components for all tags", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const errorTags = wrapper.findAll('[data-test="error-tag"]');
    expect(errorTags.length).toBeGreaterThan(0);
  });

  it("renders an ErrorTag with the ip value", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const ipTag = tags.find((t: any) => t.text().includes("ip"));
    expect(ipTag).toBeDefined();
    expect(ipTag!.text()).toContain("192.168.1.1");
  });

  it("renders an ErrorTag with the service value", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const serviceTag = tags.find((t: any) => t.text().includes("service"));
    expect(serviceTag).toBeDefined();
    expect(serviceTag!.text()).toContain("web-app");
  });

  it("renders an ErrorTag with the location value", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const locationTag = tags.find((t: any) => t.text().includes("location"));
    expect(locationTag).toBeDefined();
    expect(locationTag!.text()).toContain("United States, New York");
  });

  it("renders an ErrorTag with handled: false for unhandled errors", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const handledTag = tags.find((t: any) => t.text().includes("handled"));
    expect(handledTag).toBeDefined();
    expect(handledTag!.text()).toContain("false");
  });

  it("renders an ErrorTag with handled: true for handled errors", async () => {
    // Arrange
    await wrapper.setProps({ error: { ...mockError, error_handling: "handled" } });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const handledTag = tags.find((t: any) => t.text().includes("handled"));
    expect(handledTag).toBeDefined();
    expect(handledTag!.text()).toContain("true");
  });

  it("shows Unknown for missing service", async () => {
    // Arrange
    await wrapper.setProps({ error: { ip: "127.0.0.1" } });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const serviceTag = tags.find((t: any) => t.text().includes("service"));
    expect(serviceTag!.text()).toContain("Unknown");
  });

  it("shows Unknown for missing source", async () => {
    // Arrange
    await wrapper.setProps({ error: { ip: "127.0.0.1" } });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const sourceTag = tags.find((t: any) => t.text().includes("source"));
    expect(sourceTag!.text()).toContain("Unknown");
  });

  it("shows Unknown User for missing user email", async () => {
    // Arrange
    await wrapper.setProps({ error: { ip: "127.0.0.1" } });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const emailTag = tags.find((t: any) => t.text().includes("user_email"));
    expect(emailTag!.text()).toContain("Unknown User");
  });

  it("shows Unknown location when both country and city are missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, geo_info_country: null, geo_info_city: null },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const locationTag = tags.find((t: any) => t.text().includes("location"));
    expect(locationTag!.text()).toContain("Unknown");
  });

  it("shows only city when country is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, geo_info_country: null },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const locationTag = tags.find((t: any) => t.text().includes("location"));
    expect(locationTag!.text()).toContain("New York");
  });

  it("shows only country when city is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, geo_info_city: null },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const locationTag = tags.find((t: any) => t.text().includes("location"));
    expect(locationTag!.text()).toContain("United States");
  });

  it("shows device brand and family combined", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const deviceTag = tags.find((t: any) => t.text().includes("device"));
    expect(deviceTag!.text()).toContain("Dell Desktop");
  });

  it("shows only device family when brand is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, user_agent_device_brand: null },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const deviceTag = tags.find((t: any) => t.text().includes("device"));
    expect(deviceTag!.text()).toContain("Desktop");
  });

  it("shows only device brand when family is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, user_agent_device_family: null },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const deviceTag = tags.find((t: any) => t.text().includes("device"));
    expect(deviceTag!.text()).toContain("Dell");
  });

  it("shows Unknown device when both brand and family are missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: {
        ...mockError,
        user_agent_device_brand: null,
        user_agent_device_family: null,
      },
    });

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const deviceTag = tags.find((t: any) => t.text().includes("device"));
    expect(deviceTag!.text()).toContain("Unknown");
  });

  it("shows Version Unknown when browser major version is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, user_agent_user_agent_major: null },
    });

    // Assert
    expect(wrapper.text()).toContain("Version Unknown");
  });

  it("shows partial browser version when only major is present", async () => {
    // Arrange
    await wrapper.setProps({
      error: {
        ...mockError,
        user_agent_user_agent_major: "119",
        user_agent_user_agent_minor: null,
        user_agent_user_agent_patch: null,
      },
    });

    // Assert
    expect(wrapper.text()).toContain("Version 119");
  });

  it("shows Version Unknown when OS major version is missing", async () => {
    // Arrange
    await wrapper.setProps({
      error: { ...mockError, user_agent_os_major: null },
    });

    // Assert
    expect(wrapper.text()).toContain("Version Unknown");
  });

  it("shows partial OS version when only major is present", async () => {
    // Arrange
    await wrapper.setProps({
      error: {
        ...mockError,
        user_agent_os_major: "14",
        user_agent_os_minor: null,
        user_agent_os_patch: null,
      },
    });

    // Assert
    expect(wrapper.text()).toContain("Version 14");
  });

  it("renders Firefox browser icon when browser family contains 'Firefox'", async () => {
    // Arrange — remount with Firefox to capture onMounted icon selection
    const firefoxWrapper = mountComponent({
      ...mockError,
      user_agent_user_agent_family: "Firefox",
    });
    await flushPromises();

    // Assert
    const img = firefoxWrapper.find('img[src="/mock/firefox.png"]');
    expect(img.exists()).toBe(true);
    firefoxWrapper.unmount();
  });

  it("renders Safari browser icon when browser family contains 'Safari'", async () => {
    // Arrange
    const safariWrapper = mountComponent({
      ...mockError,
      user_agent_user_agent_family: "Safari",
    });
    await flushPromises();

    // Assert
    const img = safariWrapper.find('img[src="/mock/safari.png"]');
    expect(img.exists()).toBe(true);
    safariWrapper.unmount();
  });

  it("renders Opera browser icon when browser family contains 'Opera'", async () => {
    // Arrange
    const operaWrapper = mountComponent({
      ...mockError,
      user_agent_user_agent_family: "Opera",
    });
    await flushPromises();

    // Assert
    const img = operaWrapper.find('img[src="/mock/opera.png"]');
    expect(img.exists()).toBe(true);
    operaWrapper.unmount();
  });

  it("renders Edge browser icon when browser family contains 'Edge'", async () => {
    // Arrange
    const edgeWrapper = mountComponent({
      ...mockError,
      user_agent_user_agent_family: "Edge",
    });
    await flushPromises();

    // Assert
    const img = edgeWrapper.find('img[src="/mock/edge.png"]');
    expect(img.exists()).toBe(true);
    edgeWrapper.unmount();
  });

  it("renders Mac OS icon when OS family contains 'Mac'", async () => {
    // Arrange
    const macWrapper = mountComponent({
      ...mockError,
      user_agent_os_family: "Mac OS X",
    });
    await flushPromises();

    // Assert
    const img = macWrapper.find('img[src="/mock/mac.png"]');
    expect(img.exists()).toBe(true);
    macWrapper.unmount();
  });

  it("renders Linux OS icon when OS family contains 'Linux'", async () => {
    // Arrange
    const linuxWrapper = mountComponent({
      ...mockError,
      user_agent_os_family: "Ubuntu Linux",
    });
    await flushPromises();

    // Assert
    const img = linuxWrapper.find('img[src="/mock/linux.png"]');
    expect(img.exists()).toBe(true);
    linuxWrapper.unmount();
  });

  it("renders an ErrorTag with the url value", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const urlTag = tags.find((t: any) => t.text().includes("url"));
    expect(urlTag).toBeDefined();
    expect(urlTag!.text()).toContain("https://example.com/dashboard");
  });

  it("renders an ErrorTag with level: error", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const tags = wrapper.findAll('[data-test="error-tag"]');
    const levelTag = tags.find((t: any) => t.text().includes("level"));
    expect(levelTag).toBeDefined();
    expect(levelTag!.text()).toContain("error");
  });

  it("renders vertical separators between info sections", () => {
    // Arrange + Act handled in beforeEach

    // Assert
    const separators = wrapper.findAll('[data-test="separator"]');
    expect(separators.length).toBeGreaterThan(0);
  });

  it("requires the error prop", () => {
    // Assert
    expect(ErrorTags.props?.error?.required).toBe(true);
    expect(ErrorTags.props?.error?.type).toBe(Object);
  });
});
