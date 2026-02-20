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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import About from "./About.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

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

  it("should display logo based on theme", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const img = wrapper.find("img.logo");
    expect(img.exists()).toBe(true);
  });

  it("should display version badge", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const versionBadge = wrapper.find(".version-badge");
    expect(versionBadge.exists()).toBe(true);
    expect(versionBadge.text()).toContain("v2.0.0");
  });

  it("should display build type badge", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const buildBadge = wrapper.find(".build-badge");
    expect(buildBadge.exists()).toBe(true);
    expect(buildBadge.text()).toContain("opensource");
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

    const links = wrapper.findAll("a.link-badge");
    expect(links.length).toBeGreaterThan(0);
  });

  it("should display license info for opensource build", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.text()).toContain("License Information");
  });

  it("should apply dark mode styles when theme is dark", () => {
    const darkStore = createStore({
      state: {
        ...store.state,
        theme: "dark",
      },
      actions: store.actions,
    });

    const wrapper = mount(About, {
      global: {
        plugins: [i18n, darkStore, router],
      },
    });

    const versionBadge = wrapper.find(".version-badge");
    expect(versionBadge.classes()).toContain("version-badge-dark");
  });

  it("should apply light mode styles when theme is light", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const versionBadge = wrapper.find(".version-badge");
    expect(versionBadge.classes()).toContain("version-badge-light");
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

  it("should display hero section", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const heroSection = wrapper.find(".hero-section");
    expect(heroSection.exists()).toBe(true);
  });

  it("should display stats grid with commit and build cards", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const statsGrid = wrapper.find(".stats-grid");
    expect(statsGrid.exists()).toBe(true);
  });

  it("should display feature cards", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const featureCards = wrapper.findAll(".feature-card");
    expect(featureCards.length).toBeGreaterThan(0);
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

  it("should display tagline message", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const tagline = wrapper.find(".tagline");
    expect(tagline.exists()).toBe(true);
  });

  it("should have card container with proper styling", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const cardContainer = wrapper.find(".card-container");
    expect(cardContainer.exists()).toBe(true);
  });

  it("should display build badge icon", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const buildBadge = wrapper.find(".build-badge");
    const icon = buildBadge.find(".q-icon");
    expect(icon.exists()).toBe(true);
  });

  it("should have proper page class", () => {
    const wrapper = mount(About, {
      global: {
        plugins: [i18n, store, router],
      },
    });

    const page = wrapper.find(".aboutPage");
    expect(page.exists()).toBe(true);
  });
});
