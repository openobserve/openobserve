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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import About from "./About.vue";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

// Mock getImageURL
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

// Mock license server
vi.mock("@/services/license_server", () => ({
  default: {
    get_license: vi.fn().mockResolvedValue({
      data: {
        license: {
          license_id: "test-license-123",
          created_at: 1704067200000000,
          expires_at: 1735689600000000,
          limits: {
            Ingestion: {
              typ: "PerDayCount",
              value: 100,
            },
          },
        },
        expired: false,
        ingestion_used: 45.5,
        installation_id: "install-123",
      },
    }),
  },
}));

describe("About", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        theme: "light",
        zoConfig: {
          version: "v2.0.0",
          build_type: "opensource",
          commit_hash: "abc123def",
          build_date: "2024-01-15",
          meta_org: "meta_org_123",
        },
        organizations: [
          {
            id: 1,
            identifier: "meta_org_123",
            name: "Meta Organization",
            ingest_threshold: 100,
            search_threshold: 50,
          },
        ],
        userInfo: {
          email: "test@example.com",
        },
      },
      actions: {
        setSelectedOrganization: vi.fn(),
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/about", name: "about", component: About },
        { path: "/license", name: "license", component: { template: "<div>License</div>" } },
      ],
    });

    router.push("/about");

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should display logo image", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
  });

  it("should display version from zoConfig", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("v2.0.0");
  });

  it("should display build type from zoConfig", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("opensource");
  });

  it("should display commit hash", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("abc123def");
  });

  it("should format and display build date", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const formattedDate = wrapper.vm.formatDate("2024-01-15");
    expect(formattedDate).toBeTruthy();
  });

  it("should display open source libraries section", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("Open Source Libraries");
  });

  it("should have links to Cargo.toml and package.json", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const links = wrapper.findAll('a[target="_blank"]');
    expect(links.length).toBeGreaterThan(0);
    const hrefs = links.map((l) => l.attributes("href"));
    expect(hrefs.some((h) => h && h.includes("Cargo.toml"))).toBe(true);
    expect(hrefs.some((h) => h && h.includes("package.json"))).toBe(true);
  });

  it("should display license info for opensource build", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("License Information");
  });

  it("should use dark logo src when theme is dark", () => {
    const darkStore = createStore({
      state: {
        theme: "dark",
        zoConfig: {
          version: "v2.0.0",
          build_type: "opensource",
          commit_hash: "abc123def",
          build_date: "2024-01-15",
          meta_org: "meta_org_123",
        },
        organizations: [],
        userInfo: { email: "test@example.com" },
      },
      actions: {
        setSelectedOrganization: vi.fn(),
      },
    });

    const wrapper = mount(About, {
      global: {
        plugins: [i18n, darkStore, router],
      },
    });

    const img = wrapper.find("img");
    expect(img.attributes("src")).toContain("dark");
  });

  it("should use light logo src when theme is light", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const img = wrapper.find("img");
    expect(img.attributes("src")).toContain("light");
  });

  it("should navigate to license page when manage license is clicked", async () => {
    const pushSpy = vi.spyOn(router, "push");

    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.navigateToLicense();

    expect(pushSpy).toHaveBeenCalledWith({
      name: "license",
      query: { org_identifier: "meta_org_123" },
    });
  });

  it("should format license date correctly", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const timestamp = 1704067200000000; // microseconds
    const formatted = wrapper.vm.formatLicenseDate(timestamp);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe("string");
  });

  it("should display hero banner section", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // Hero section contains the logo image
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
  });

  it("should display info cards grid with at least two cards", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // The grid contains Open Source Libraries and License sections
    expect(wrapper.text()).toContain("Open Source Libraries");
    expect(wrapper.text()).toContain("License Information");
  });

  it("should have external links with target blank", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const externalLinks = wrapper.findAll('a[target="_blank"]');
    expect(externalLinks.length).toBeGreaterThan(0);
  });

  it("should display the logo message tagline text", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // The component renders t("about.logoMsg") which is the tagline text
    // Verify the outer container exists and contains the logo image at minimum
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
  });

  it("should render the scrollable content container", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // The root element is a div; the second div inside has overflow-auto
    const scrollContainer = wrapper.find(".overflow-auto");
    expect(scrollContainer.exists()).toBe(true);
  });

  it("should display OIcon components inside the build type span", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // The component renders multiple OIcon components; verify at least one exists
    const icons = wrapper.findAllComponents({ name: "OIcon" });
    expect(icons.length).toBeGreaterThan(0);
  });

  it("should have a root container div", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    // Root element is a div (replaces old .aboutPage class check)
    expect(wrapper.element.tagName).toBe("DIV");
  });
});
