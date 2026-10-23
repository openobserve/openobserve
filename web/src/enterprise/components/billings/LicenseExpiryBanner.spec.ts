import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import licenseServer from "@/services/license_server";
import { DAY_US } from "@/utils/licenseWaivers";
import LicenseExpiryBanner from "./LicenseExpiryBanner.vue";
vi.mock("@/services/license_server", () => ({ default: { get_license: vi.fn() } }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useLicenseRefresh", () => ({
  useLicenseRefresh: () => ({ refreshLicenseLimits: refresh }),
}));
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const NOW = Date.UTC(2026, 9, 23);
let w: VueWrapper | undefined;
const mountBanner = async ({
  online = true,
  canUpdate = true,
  expiry = NOW * 1000 + 10 * DAY_US,
  org = "acme",
} = {}) => {
  vi.mocked(licenseServer.get_license).mockResolvedValue({
    data: {
      license: { environment_type: online ? "online" : "airgapped" },
      can_update_license: canUpdate,
    },
  } as never);
  const store = createStore({
    state: {
      zoConfig: { meta_org: "acme", license_expiry: expiry },
      selectedOrganization: { identifier: org },
    },
  });
  w = mount(LicenseExpiryBanner, { global: { plugins: [store, i18n] } });
  await flushPromises();
  return { w, store };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  queryClient.clear();
  sessionStorage.clear();
  refresh.mockResolvedValue({ ok: true, body: { outcome: "unchanged" } });
});
afterEach(() => {
  w?.unmount();
  vi.useRealTimers();
});
describe("LicenseExpiryBanner", () => {
  it("online with update rights shows Refresh now copy", async () => {
    const { w } = await mountBanner();
    expect(w.text()).toContain("Click Refresh now to check for a renewed license.");
    expect(w.get('[data-test="license-expiry-refresh"]').text()).toBe("Refresh now");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("online without rights asks an administrator", async () => {
    const { w } = await mountBanner({ canUpdate: false });
    expect(w.text()).toContain("Ask an administrator to refresh the license.");
    expect(w.find('[data-test="license-expiry-refresh"]').exists()).toBe(false);
  });
  it("airgapped says contact OpenObserve", async () => {
    const { w } = await mountBanner({ online: false });
    expect(w.text()).toContain("Contact OpenObserve for a renewed key.");
    expect(w.find('[data-test="license-expiry-refresh"]').exists()).toBe(false);
  });
  it.each([NOW * 1000 + 31 * DAY_US, NOW * 1000, NOW * 1000 - DAY_US])(
    "hidden beyond 30 days and after expiry (%s)",
    async (expiry) => {
      const { w } = await mountBanner({ expiry });
      expect(w.find('[data-test="license-expiry-banner"]').exists()).toBe(false);
      expect(licenseServer.get_license).not.toHaveBeenCalled();
    },
  );
  it("dismiss persists for the session and a new expiry has its own signature", async () => {
    const { w: one } = await mountBanner();
    await one.get('[data-test="license-expiry-dismiss"]').trigger("click");
    one.unmount();
    const { w: two, store } = await mountBanner();
    expect(two.find('[data-test="license-expiry-banner"]').exists()).toBe(false);
    store.state.zoConfig.license_expiry += DAY_US;
    await flushPromises();
    expect(two.find('[data-test="license-expiry-banner"]').exists()).toBe(true);
  });
  it("only meta org fetches or shows the banner", async () => {
    const { w } = await mountBanner({ org: "other" });
    expect(w.find('[data-test="license-expiry-banner"]').exists()).toBe(false);
    expect(licenseServer.get_license).not.toHaveBeenCalled();
  });
  it("details links to the license page", async () => {
    const { w } = await mountBanner();
    await w.get('[data-test="license-expiry-details"]').trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "license", query: { org_identifier: "acme" } });
  });
  it("only clicks refresh and displays the outcome inline", async () => {
    const { w } = await mountBanner();
    expect(refresh).not.toHaveBeenCalled();
    await w.get('[data-test="license-expiry-refresh"]').trigger("click");
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain("License is up to date");
  });
  it("reaches and leaves the 30-day window without reloading", async () => {
    const { w } = await mountBanner({ expiry: NOW * 1000 + 31 * DAY_US });
    await vi.advanceTimersByTimeAsync(86400001);
    await flushPromises();
    expect(w.find('[data-test="license-expiry-banner"]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(30 * 86400000);
    expect(w.find('[data-test="license-expiry-banner"]').exists()).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});

it("an unchanged refresh preserves the expiry date, warning and recheck action", async () => {
  const { w } = await mountBanner();
  await w.get('[data-test="license-expiry-refresh"]').trigger("click");
  await flushPromises();
  expect(w.text()).toContain("Your license expires on Nov 2, 2026.");
  expect(w.text()).toContain("License is up to date");
  expect(w.find('[data-test="license-expiry-refresh"]').exists()).toBe(true);
  expect(w.findComponent({ name: "OBanner" }).props("variant")).toBe("warning");
});
