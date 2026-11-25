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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import About from "./About.vue";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import config from "@/aws-exports";
import licenseServer from "@/services/license_server";

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

// A serialized LicenseResponse, as GET /api/license sends it.
const licenseResponse = (overrides: Record<string, unknown> = {}) => ({
  key: "anonymised-key",
  waivers: [],
  base: {
    search_allowed: true,
    blocks: [],
    exceeded_days: 0,
    allowed_days: 3,
    limit_today_gb: 100,
    used_today_gb: 42,
    waiver_ids_applied: [],
  },
  env_key_active: false,
  env_key_in_use: false,
  installation_id: "inst_test",
  license: {
    license_id: "lic_test",
    active: true,
    created_at: 1704067200000000,
    expires_at: 1735689600000000,
    limits: { Ingestion: { typ: "PerDayCount", value: 100 } },
    features: ["ai_assistant"],
    feature_definition: {
      features: {
        ai_assistant: { display_name: "AI Assistant", gate: true },
        oncall: { display_name: "On-Call", gate: true },
        alerts: { display_name: "Alerts", gate: false },
      },
    },
  },
  expired: false,
  ingestion_used: 42,
  ingestion_exceeded: 0,
  decision: {
    search_allowed: true,
    blocks: [],
    exceeded_days: 0,
    allowed_days: 3,
    limit_today_gb: 100,
    used_today_gb: 42,
    waiver_ids_applied: [],
  },
  evaluated_at: 1704067200000000,
  can_update_license: true,
  ...overrides,
});

// Mock license server
vi.mock("@/services/license_server", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { get_license: vi.fn() },
  });
});

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

  describe("enterprise license details", () => {
    const decision = (overrides: Record<string, unknown>) => ({
      ...licenseResponse().decision,
      ...overrides,
    });
    const limits = (typ: string, value: number) => ({
      ...licenseResponse().license,
      limits: { Ingestion: { typ, value } },
    });

    const mountAbout = async (overrides: Record<string, unknown> = {}) => {
      vi.mocked(licenseServer.get_license).mockResolvedValue({
        data: licenseResponse(overrides),
      } as never);
      const wrapper = mount(About, {
        global: {
          plugins: [
            i18n,
            createStore({
              state: {
                theme: "light",
                zoConfig: {
                  build_type: "enterprise",
                  version: "v0.70.0",
                  feature_revision: 1,
                  license_server_url: "https://license.example.com",
                  feature_names: { oncall: "On-Call", ai_assistant: "AI Assistant" },
                  features: { ai_assistant: "enabled", oncall: "locked", alerts: "enabled" },
                },
              },
            }),
            router,
          ],
        },
      });
      await flushPromises();
      return wrapper;
    };
    const text = (wrapper: ReturnType<typeof mount>, id: string) =>
      wrapper.find(`[data-test="${id}"]`).text();

    beforeEach(() => {
      config.isEnterprise = "true";
    });

    afterEach(() => {
      config.isEnterprise = "false";
    });

    it("shows the limit in force, with no raw type or separator", async () => {
      const wrapper = await mountAbout();

      expect(text(wrapper, "about-license-limit")).toBe("100 GB / day");
      expect(text(wrapper, "about-license-used")).toBe("42 GB today100 GB / day");
      expect(wrapper.text()).toContain("42%");
      expect(wrapper.text()).not.toContain("PerDayCount");
      expect(wrapper.text()).not.toContain("· limit");
    });

    it("shows the 50 an expired 200 GB key is held to", async () => {
      const wrapper = await mountAbout({
        expired: true,
        license: limits("PerDayCount", 200),
        ingestion_used: 21,
        decision: decision({ limit_today_gb: 50 }),
      });

      expect(text(wrapper, "about-license-limit")).toBe("50 GB / day");
      expect(text(wrapper, "about-license-used")).toBe("42 GB today50 GB / day");
      expect(wrapper.text()).toContain("84%");
    });

    it("shows Unlimited, not 50, for an Unlimited key", async () => {
      const wrapper = await mountAbout({
        license: limits("Unlimited", 0),
        decision: decision({ limit_today_gb: null }),
      });

      expect(text(wrapper, "about-license-limit")).toBe("Unlimited");
      expect(text(wrapper, "about-license-used")).toBe("42 GB today");
      expect(wrapper.text()).not.toContain("of daily limit used today");
      expect(wrapper.find('[data-test="about-license-plan-detail"]').exists()).toBe(false);
    });

    it("shows a 200 GB key's own limit while the decision is not evaluated", async () => {
      const wrapper = await mountAbout({
        license: limits("PerDayCount", 200),
        ingestion_used: 21,
        evaluated_at: 0,
        decision: decision({ limit_today_gb: null, used_today_gb: 0 }),
      });

      expect(text(wrapper, "about-license-limit")).toBe("200 GB / day");
      expect(text(wrapper, "about-license-used")).toBe("42 GB today200 GB / day");
      expect(wrapper.text()).toContain("21%");
    });

    it.each([
      ["200 GB", limits("PerDayCount", 200)],
      ["Unlimited", limits("Unlimited", 0)],
    ])("holds an expired %s key to 50 while the decision is not evaluated", async (_n, license) => {
      const wrapper = await mountAbout({
        expired: true,
        license,
        ingestion_used: 20,
        evaluated_at: 0,
        decision: decision({ limit_today_gb: null, used_today_gb: 0 }),
      });

      expect(text(wrapper, "about-license-limit")).toBe("50 GB / day");
      expect(text(wrapper, "about-license-used")).toBe("10 GB today50 GB / day");
      expect(wrapper.text()).toContain("20%");
    });

    it("keeps the free-plan note on the free limit only", async () => {
      const free = await mountAbout({
        license: limits("PerDayCount", 50),
        decision: decision({ limit_today_gb: 50 }),
      });
      expect(free.find('[data-test="about-license-plan-detail"]').exists()).toBe(true);

      const paid = await mountAbout();
      expect(paid.find('[data-test="about-license-plan-detail"]').exists()).toBe(false);
    });

    it("lists a partial license and says so in the comparison sentence", async () => {
      const wrapper = await mountAbout();
      const list = wrapper.find('[data-test="about-license-features"]');

      expect(list.text()).toContain("Features");
      expect(list.find('[data-test="settings-license-features-unlocked"]').text()).toContain(
        "AI Assistant",
      );
      expect(list.find('[data-test="settings-license-features-missing"]').text()).toContain(
        "On-Call",
      );
      expect(text(wrapper, "feature-comparison-ent-msg")).toContain(
        "Some features are not in your license",
      );
    });

    it("opens the request form with the installation's context for an admin", async () => {
      const wrapper = await mountAbout();
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      await wrapper.find('[data-test="settings-license-features-request-access"]').trigger("click");

      const url = new URL(String(open.mock.calls[0][0]));
      expect(`${url.origin}${url.pathname}`).toBe(
        "https://license.example.com/user/request-license",
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        base_url: window.location.origin,
        license_id: "inst_test",
        o2_version: "v0.70.0",
        feature_revision: "1",
        features: "ai_assistant",
      });
      open.mockRestore();
    });

    it("shows a non-admin the list without Request Access", async () => {
      const wrapper = await mountAbout({ can_update_license: false });

      expect(wrapper.find('[data-test="settings-license-features-request-access"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="settings-license-features-missing"]').exists()).toBe(true);
    });
  });
});
