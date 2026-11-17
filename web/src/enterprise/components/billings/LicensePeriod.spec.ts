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
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import licenseServer from "@/services/license_server";

vi.mock("@/services/license_server", () => ({
  default: { get_license: vi.fn() },
}));

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
const nowPlusDays = (days: number) => msToMicro(Date.now() + days * 24 * 60 * 60 * 1000);

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
const createTestStore = (zoConfig: Record<string, any>) => createStore({ state: { zoConfig } });

const createWrapper = (storeOverride: any) => {
  const testStore = createTestStore(storeOverride.state.zoConfig);
  return mount(LicensePeriod, {
    global: {
      plugins: [i18n, testStore],
    },
  });
};

// ─── tests ──────────────────────────────────────────────────────────────────

// A serialized LicenseResponse for an expired 200 GB key, as the backend sends it.
const licenseResponse = (overrides: Record<string, unknown> = {}) => ({
  installation_id: "inst_test",
  license: {
    license_id: "lic_test",
    expires_at: 1790000000000000,
    limits: { Ingestion: { typ: "PerDayCount", value: 200 } },
  },
  expired: true,
  ingestion_used: 40,
  ingestion_exceeded: 2,
  decision: {
    search_allowed: true,
    blocks: [],
    exceeded_days: 2,
    allowed_days: 3,
    limit_today_gb: 50,
    used_today_gb: 20,
    waiver_ids_applied: [],
  },
  evaluated_at: 1790000000000000,
  can_update_license: true,
  ...overrides,
});

const expiredOn = () => {
  const expiry = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  return expiry.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

describe("LicensePeriod.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    queryClient.clear();
    vi.mocked(licenseServer.get_license).mockResolvedValue({ data: licenseResponse() } as never);
  });

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

    it("should keep only the date sentence before the license response arrives", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(-3)));
      expect(wrapper.vm.getLicenseExpiryMessage()).toBe(
        `Your license expired on ${expiredOn()}. Your features stay on.`,
      );
    });

    it("should treat an expiry of exactly now as expired", () => {
      wrapper = createWrapper(makeStore(msToMicro(Date.now())));
      expect(wrapper.vm.getLicenseExpiryMessage()).toContain("Your license expired on");
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
      const banner = wrapper.find('[data-test="license-period-container"]');
      expect(banner.exists()).toBe(true);
    });

    it("should NOT render the banner when license is far from expiry", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(30)));
      const banner = wrapper.find('[data-test="license-period-container"]');
      expect(banner.exists()).toBe(false);
    });

    it("should NOT render the banner when license_expiry is null", () => {
      wrapper = createWrapper(makeStore(null));
      const banner = wrapper.find('[data-test="license-period-container"]');
      expect(banner.exists()).toBe(false);
    });

    it("should render the message span when warning is active", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const span = wrapper.find('[data-test="license-period-message"]');
      expect(span.exists()).toBe(true);
    });

    it("should display the expiry message text in the template", () => {
      wrapper = createWrapper(makeStore(nowPlusDays(5)));
      const span = wrapper.find('[data-test="license-period-message"]');
      expect(span.text()).toMatch(/5 days remaining until your license expires/);
    });
  });

  // ── Banner from a serialized LicenseResponse ───────────────────────────

  describe("Expired banner", () => {
    const message = () => wrapper.find('[data-test="license-period-message"]').text();
    const renew = () => wrapper.find('[data-test="license-period-renew-btn"]');
    const askAdmin = () => wrapper.find('[data-test="license-period-ask-admin"]');
    const mountExpired = async (overrides: Record<string, unknown> = {}) => {
      vi.mocked(licenseServer.get_license).mockResolvedValue({
        data: licenseResponse(overrides),
      } as never);
      wrapper = createWrapper(makeStore(nowPlusDays(-3)));
      await flushPromises();
    };

    it("is a warning banner on the kept container id", async () => {
      await mountExpired();
      const banner = wrapper.findComponent({ name: "OBanner" });
      expect(banner.props("variant")).toBe("warning");
      expect(banner.props("icon")).toBe("warning");
      expect(wrapper.find('[data-test="license-period-container"]').attributes("role")).toBe(
        "alert",
      );
    });

    it("says the date, the limit and the days from the decision, not the license", async () => {
      await mountExpired();
      expect(message()).toBe(
        `Your license expired on ${expiredOn()}. Your features stay on. The free limit of 50 GB/day now applies: more than 3 days over it in a month pauses search until you renew.`,
      );
    });

    it("shows a license's own count when the decision has one", async () => {
      await mountExpired({ decision: { limit_today_gb: 75, allowed_days: 5 } });
      expect(message()).toContain("The free limit of 75 GB/day");
      expect(message()).toContain("more than 5 days");
    });

    it("drops the limit sentence for an unevaluated decision", async () => {
      await mountExpired({ evaluated_at: 0 });
      expect(message()).toBe(`Your license expired on ${expiredOn()}. Your features stay on.`);
    });

    it("drops the limit sentence for a null limit", async () => {
      await mountExpired({ decision: { limit_today_gb: null, allowed_days: 3 } });
      expect(message()).toBe(`Your license expired on ${expiredOn()}. Your features stay on.`);
    });

    it("gives an admin Renew license, which emits renew, and no ask line", async () => {
      await mountExpired();
      expect(askAdmin().exists()).toBe(false);
      expect(renew().text()).toBe("Renew license");
      await renew().trigger("click");
      expect(wrapper.emitted("renew")).toHaveLength(1);
    });

    it("gives everyone else the ask line and no Renew license", async () => {
      await mountExpired({ can_update_license: false });
      expect(renew().exists()).toBe(false);
      expect(askAdmin().text()).toBe("Ask your license administrator to renew.");
    });

    it("shows neither the action nor the ask line until the response arrives", async () => {
      vi.mocked(licenseServer.get_license).mockReturnValue(new Promise(() => {}) as never);
      wrapper = createWrapper(makeStore(nowPlusDays(-3)));
      await flushPromises();
      expect(message()).toContain("Your license expired on");
      expect(renew().exists()).toBe(false);
      expect(askAdmin().exists()).toBe(false);
    });

    it("keeps the countdown text in the warning banner under 14 days", async () => {
      wrapper = createWrapper(makeStore(nowPlusDays(12)));
      await flushPromises();
      expect(message()).toBe("12 days remaining until your license expires");
      expect(wrapper.findComponent({ name: "OBanner" }).props("variant")).toBe("warning");
      expect(renew().exists()).toBe(true);
    });

    it("does not fetch the license when no banner shows", async () => {
      wrapper = createWrapper(makeStore(nowPlusDays(30)));
      await flushPromises();
      expect(licenseServer.get_license).not.toHaveBeenCalled();
    });
  });

  // ── Lifecycle & edge cases ─────────────────────────────────────────────

  describe("Lifecycle and edge cases", () => {
    it("should not throw when mounted with null license_expiry", () => {
      expect(() => createWrapper(makeStore(null))).not.toThrow();
    });

    it("should not throw when mounted without zoConfig", () => {
      expect(() => createWrapper({ state: { zoConfig: {} } })).not.toThrow();
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
