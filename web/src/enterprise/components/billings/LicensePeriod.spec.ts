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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import i18n from "@/locales";

installQuasar();

// Mock vue-router
const mockRouter = { push: vi.fn() };
vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock aws-exports — default: enterprise + self-hosted so the banner renders
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "false",
  },
}));

// ─── helpers ────────────────────────────────────────────────────────────────

/** Convert a "days from now" value into the microsecond timestamp LicensePeriod expects */
const msToMicro = (ms: number) => ms * 1000;
const nowPlusDays = (days: number) =>
  msToMicro(Date.now() + days * 24 * 60 * 60 * 1000);

const makeStore = (licenseExpiry: number | null | undefined) => ({
  state: {
    zoConfig: {
      license_expiry: licenseExpiry,
    },
  },
});

/**
 * Creates a real Vuex store so that useStore() in the Composition API
 * component resolves correctly (mocks: { $store } only works for Options API).
 */
const createTestStore = (zoConfig: Record<string, any>) =>
  createStore({ state: { zoConfig } });

const createWrapper = (storeOverride: any) => {
  const testStore = createTestStore(storeOverride.state.zoConfig);
  return mount(LicensePeriod, {
    global: {
      plugins: [i18n, testStore],
    },
  });
};

// ─── tests ──────────────────────────────────────────────────────────────────

describe("LicensePeriod.vue", () => {
  let wrapper: any;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  // ── Component basics ───────────────────────────────────────────────────

  describe("Component initialization", () => {
    beforeEach(() => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
    });

    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("LicensePeriod");
    });

    it("should expose getLicenseExpiryMessage as a function", () => {
      expect(typeof wrapper.vm.getLicenseExpiryMessage).toBe("function");
    });

    it("should expose showLicenseExpiryWarning", () => {
      expect(wrapper.vm.showLicenseExpiryWarning).toBeDefined();
    });

    it("should expose config", () => {
      expect(wrapper.vm.config).toBeDefined();
    });
  });

  // ── showLicenseExpiryWarning computed ──────────────────────────────────

  describe("showLicenseExpiryWarning computed property", () => {
    it("should return true when license expires in less than 14 days", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(true);
    });

    it("should return true when license expires in exactly 13 days", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(13)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(true);
    });

    it("should return true when license expires in 1 day", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(1)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(true);
    });

    it("should return true when license has already expired", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(-1)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(true);
    });

    it("should return false when license expires in exactly 14 days", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(14)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(false);
    });

    it("should return false when license expires in more than 14 days", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(30)));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(false);
    });

    it("should return false when license_expiry is null", () => {
      wrapper = createWrapper(makeStore(null));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(false);
    });

    it("should return false when license_expiry is undefined", () => {
      wrapper = createWrapper(makeStore(undefined));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(false);
    });

    it("should return false when license_expiry is 0", () => {
      wrapper = createWrapper(makeStore(0));
      expect(wrapper.vm.showLicenseExpiryWarning).toBe(false);
    });
  });

  // ── getLicenseExpiryMessage ────────────────────────────────────────────

  describe("getLicenseExpiryMessage()", () => {
    it("should return empty string when license_expiry is missing", () => {
      wrapper = createWrapper(makeStore(null));
      expect(wrapper.vm.getLicenseExpiryMessage()).toBe("");
    });

    it("should return empty string when license_expiry is undefined", () => {
      wrapper = createWrapper(makeStore(undefined));
      expect(wrapper.vm.getLicenseExpiryMessage()).toBe("");
    });

    it("should return empty string when license_expiry is 0", () => {
      wrapper = createWrapper(makeStore(0));
      expect(wrapper.vm.getLicenseExpiryMessage()).toBe("");
    });

    it("should return plural days message when daysUntilExpiry > 1", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toMatch(/5 days remaining until your license expires/);
    });

    it("should return singular day message when daysUntilExpiry === 1", () => {
      // Use exactly 1 day: now + 1 day, minus a small margin so Math.ceil gives 1
      wrapper = createWrapper(makeStore(nowPlusDays(1)));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toBe("1 day remaining until your license expires");
    });

    it("should return expired message when license already expired", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(-2)));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toBe("Your license has expired");
    });

    it("should return expired message when daysUntilExpiry is 0", () => {
      // 0 days: expiry is exactly now (microseconds), Math.ceil(0) = 0 → expired branch
      wrapper = createWrapper(makeStore(msToMicro(Date.now())));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toBe("Your license has expired");
    });

    it("should return correct message for 13 days remaining", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(13)));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toBe("13 days remaining until your license expires");
    });

    it("should return correct message for 2 days remaining", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(2)));
      const msg = wrapper.vm.getLicenseExpiryMessage();
      expect(msg).toBe("2 days remaining until your license expires");
    });
  });

  // ── Template rendering ─────────────────────────────────────────────────

  describe("Template rendering", () => {
    it("should render the banner when warning is active", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const banner = wrapper.find(".license-expiry-container");
      expect(banner.exists()).toBe(true);
    });

    it("should NOT render the banner when license is far from expiry", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(30)));
      const banner = wrapper.find(".license-expiry-container");
      expect(banner.exists()).toBe(false);
    });

    it("should NOT render the banner when license_expiry is null", () => {
      wrapper = createWrapper(makeStore(null));
      const banner = wrapper.find(".license-expiry-container");
      expect(banner.exists()).toBe(false);
    });

    it("should render the message span when warning is active", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const span = wrapper.find(".o2-license-message");
      expect(span.exists()).toBe(true);
    });

    it("should render the subtitle span when warning is active", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const span = wrapper.find(".o2-license-subtitle");
      expect(span.exists()).toBe(true);
      expect(span.text()).toContain(
        "Please update your license by contacting your administrator."
      );
    });

    it("should display the expiry message text in the template", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const span = wrapper.find(".o2-license-message");
      expect(span.text()).toMatch(/5 days remaining until your license expires/);
    });

    it("should display expired message in the template", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(-3)));
      const span = wrapper.find(".o2-license-message");
      expect(span.text()).toBe("Your license has expired");
    });
  });

  // ── Lifecycle & edge cases ─────────────────────────────────────────────

  describe("Lifecycle and edge cases", () => {
    it("should not throw when mounted with null license_expiry", () => {
      expect(() => createWrapper(makeStore(null))).not.toThrow();
    });

    it("should not throw when mounted without zoConfig", () => {
      expect(() =>
        createWrapper({ state: { zoConfig: {} } })
      ).not.toThrow();
    });

    it("should unmount gracefully", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should maintain reactive showLicenseExpiryWarning type as boolean", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      expect(typeof wrapper.vm.showLicenseExpiryWarning).toBe("boolean");
    });
  });
});
