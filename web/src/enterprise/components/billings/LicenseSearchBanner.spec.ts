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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { DAY_US, LICENSE_BANNER_POLL_MS } from "@/utils/licenseWaivers";

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false", isZincObserveCloud: "false" },
}));

vi.mock("@/services/license_server", () => ({
  default: { get_license: vi.fn(), refresh_license_limits: vi.fn() },
}));

vi.mock("@/services/config", () => ({
  default: { get_config_full: vi.fn() },
}));

const copyToClipboard = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...a: unknown[]) => copyToClipboard(...a),
}));

const push = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import licenseServer from "@/services/license_server";
import zoConfigService from "@/services/config";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import LicenseSearchBanner from "./LicenseSearchBanner.vue";

const DISMISS_KEY = "license_search_banner_dismissed";
const META = "acme";
const PAUSED = { meta_org: META, license_search_allowed: false };
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const restoredConfig = (untilMs: number) => ({
  meta_org: META,
  license_search_allowed: true,
  license_waiver_until: untilMs * 1000,
});

const pausedLicense = {
  license: { license_id: "2HbQ7f3aZk" },
  decision: { blocks: ["usage_over_limit"], exceeded_days: 4, allowed_days: 3 },
  waivers: [],
  can_update_license: true,
};

let store: ReturnType<typeof makeStore>;
let wrapper: VueWrapper | undefined;

function makeStore(zoConfig: Record<string, unknown>, org = META) {
  return createStore({
    state: { zoConfig, selectedOrganization: { identifier: org } },
    mutations: {
      setSelectedOrganization(state: { selectedOrganization: unknown }, payload: unknown) {
        state.selectedOrganization = payload;
      },
      setConfig(state: { zoConfig: Record<string, unknown> }, payload: Record<string, unknown>) {
        state.zoConfig = payload;
      },
    },
    actions: {
      setConfig({ commit }, payload) {
        commit("setConfig", payload);
      },
    },
  });
}

async function mountBanner(zoConfig: Record<string, unknown>, org = META) {
  store = makeStore(zoConfig, org);
  wrapper = mount(LicenseSearchBanner, { global: { plugins: [store, i18n] } });
  await flushPromises();
  return wrapper;
}

describe("LicenseSearchBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    sessionStorage.clear();
    vi.mocked(licenseServer.get_license).mockResolvedValue({ data: pausedLicense } as never);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders nothing when /config has no license fields", async () => {
    const w = await mountBanner({ meta_org: META });
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(false);
    expect(licenseServer.get_license).not.toHaveBeenCalled();
  });

  it("shows the banner in the meta org", async () => {
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
    expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
  });

  it("renders nothing and makes no request outside the meta org", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const cfg of [PAUSED, restoredConfig(NOW + 3600_000)]) {
      const w = await mountBanner(cfg, "default");
      expect(w.html()).toBe("<!--v-if-->");
      await vi.advanceTimersByTimeAsync(LICENSE_BANNER_POLL_MS * 3);
      w.unmount();
      wrapper = undefined;
    }
    expect(licenseServer.get_license).not.toHaveBeenCalled();
    expect(zoConfigService.get_config_full).not.toHaveBeenCalled();
  });

  it("hides on a switch away from the meta org and shows fresh data on return", async () => {
    vi.useFakeTimers();
    vi.mocked(zoConfigService.get_config_full).mockResolvedValue({ data: PAUSED } as never);
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
    expect(licenseServer.get_license).toHaveBeenCalledTimes(1);

    store.commit("setSelectedOrganization", { identifier: "default" });
    await flushPromises();
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(LICENSE_BANNER_POLL_MS * 2);
    expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
    expect(zoConfigService.get_config_full).not.toHaveBeenCalled();

    store.commit("setSelectedOrganization", { identifier: META });
    await flushPromises();
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
    expect(licenseServer.get_license).toHaveBeenCalledTimes(2);
    expect(zoConfigService.get_config_full).toHaveBeenCalledTimes(1);
  });

  it("follows a custom meta org name instead of _meta", async () => {
    const custom = { ...PAUSED, meta_org: "ops-admin" };
    const w = await mountBanner(custom, "ops-admin");
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
    w.unmount();
    wrapper = undefined;
    queryClient.clear();
    vi.mocked(licenseServer.get_license).mockClear();
    const other = await mountBanner(custom, "_meta");
    expect(other.find('[data-test="license-search-banner"]').exists()).toBe(false);
    expect(licenseServer.get_license).not.toHaveBeenCalled();
  });

  it("paused shows the license ID with copy and refresh", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({} as never);
    const w = await mountBanner(PAUSED);
    const banner = w.find('[data-test="license-search-banner"]');
    expect(w.findComponent(OBanner).props("variant")).toBe("error");
    expect(banner.text()).toContain("4 days");
    expect(banner.text()).toContain("2HbQ7f3aZk");
    await w.find('[data-test="license-banner-copy"]').trigger("click");
    expect(copyToClipboard).toHaveBeenCalledWith("2HbQ7f3aZk", expect.any(Function));
    await w.find('[data-test="license-banner-refresh"]').trigger("click");
    expect(licenseServer.refresh_license_limits).toHaveBeenCalledTimes(1);
  });

  it("paused usage copy pluralizes the over-limit day count", async () => {
    for (const [exceeded, phrase] of [
      [1, "on 1 day this month"],
      [5, "on 5 days this month"],
    ] as const) {
      queryClient.clear();
      vi.mocked(licenseServer.get_license).mockResolvedValue({
        data: {
          ...pausedLicense,
          decision: { ...pausedLicense.decision, exceeded_days: exceeded },
        },
      } as never);
      const w = await mountBanner(PAUSED);
      expect(w.find('[data-test="license-search-banner"]').text()).toContain(phrase);
      w.unmount();
      wrapper = undefined;
    }
  });

  it("refresh button reads Refresh now", async () => {
    const w = await mountBanner(PAUSED);
    expect(w.get('[data-test="license-banner-refresh"]').text()).toBe("Refresh now");
  });
  it("renewed outcome shows the new expiry inline even after config unpauses search", async () => {
    const DateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
      return new DateTimeFormat(locale ?? "en-GB", options);
    });
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({
      data: { outcome: "renewed", renewed: { license_id: "new", expires_at: 1825113600000000 } },
    } as never);
    const w = await mountBanner(PAUSED);
    await w.get('[data-test="license-banner-refresh"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="license-banner-outcome"]').text()).toBe(
      "A renewed license was applied. It now expires on Nov 2, 2027.",
    );
    store.commit("setConfig", { meta_org: META, license_search_allowed: true });
    await flushPromises();
    expect(w.get('[data-test="license-banner-outcome"]').text()).toContain(
      "It now expires on Nov 2, 2027",
    );
    expect(w.findComponent(OBanner).props("variant")).toBe("success");
  });
  it("an unchanged refresh preserves the paused warning until config confirms recovery", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({
      data: { outcome: "unchanged" },
    } as never);
    const w = await mountBanner(PAUSED);
    await w.get('[data-test="license-banner-refresh"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Search is paused.");
    expect(w.text()).toContain("License is up to date");
    expect(w.findComponent(OBanner).props("variant")).toBe("error");
  });
  it("unreachable outcome keeps the paused banner and shows the error line", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue({
      data: { error: "unreachable", limits_refreshed: true },
    } as never);
    const w = await mountBanner(PAUSED);
    await w.get('[data-test="license-banner-refresh"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Search is paused.");
    expect(w.get('[data-test="license-banner-outcome"]').text()).toContain(
      "Could not reach the license server. Limits were refreshed.",
    );
  });
  it("does not send overlapping refresh clicks", async () => {
    vi.mocked(licenseServer.refresh_license_limits).mockImplementation(
      () => new Promise(() => {}) as never,
    );
    const w = await mountBanner(PAUSED);
    await w.get('[data-test="license-banner-refresh"]').trigger("click");
    await w.get('[data-test="license-banner-refresh"]').trigger("click");
    expect(licenseServer.refresh_license_limits).toHaveBeenCalledTimes(1);
  });
  it("paused hides refresh from a user who may not update the license", async () => {
    vi.mocked(licenseServer.get_license).mockResolvedValue({
      data: { ...pausedLicense, can_update_license: false },
    } as never);
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-banner-copy"]').exists()).toBe(true);
    expect(w.find('[data-test="license-banner-refresh"]').exists()).toBe(false);
  });

  it("paused hides refresh when the server does not say the user may update", async () => {
    const { can_update_license: _omit, ...older } = pausedLicense;
    vi.mocked(licenseServer.get_license).mockResolvedValue({ data: older } as never);
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-banner-refresh"]').exists()).toBe(false);
  });

  it("paused without a known license ID uses the no-id text and hides copy", async () => {
    vi.mocked(licenseServer.get_license).mockResolvedValue({
      data: { license: {}, decision: { blocks: ["unknown"] } },
    } as never);
    const w = await mountBanner(PAUSED);
    expect(w.text()).toContain(
      "Search is paused by the license check. Data is still being ingested.",
    );
    expect(w.find('[data-test="license-banner-copy"]').exists()).toBe(false);
  });

  it("restored shows the UTC end and the waiver note", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.mocked(licenseServer.get_license).mockResolvedValue({
      data: {
        license: { license_id: "2HbQ7f3aZk" },
        decision: { blocks: [] },
        waivers: [
          {
            id: "w1",
            type: "search_unblock",
            starts_at: (NOW - 3600_000) * 1000,
            ends_at: Date.UTC(2026, 9, 27) * 1000,
            note: "Approved by support",
          },
        ],
      },
    } as never);
    const w = await mountBanner(restoredConfig(Date.UTC(2026, 9, 27)));
    const text = w.find('[data-test="license-search-banner"]').text();
    expect(w.findComponent(OBanner).props("variant")).toBe("success");
    expect(text).toContain("Oct 27, 00:00 UTC");
    expect(text).toContain("Approved by support");
    expect(w.find('[data-test="license-banner-details"]').exists()).toBe(true);
    await w.find('[data-test="license-banner-details"]').trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "license", query: { org_identifier: "acme" } });
  });

  it("warns when restoration ends within a day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const w = await mountBanner(restoredConfig(NOW + 3600_000));
    expect(w.findComponent(OBanner).props("variant")).toBe("warning");
    expect(w.text()).toContain("Search restoration ends");
    expect(w.text()).toContain("The normal limit rules apply again after that.");
  });

  it("dismissing paused does not hide the restored banner", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const w = await mountBanner(PAUSED);
    await w.find('[data-test="license-banner-dismiss"]').trigger("click");
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(false);
    expect(sessionStorage.getItem(DISMISS_KEY)).toBe("paused");
    store.commit("setConfig", restoredConfig(Date.UTC(2026, 9, 27)));
    await flushPromises();
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
  });

  it("renders an icon in all three states", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const cfg of [
      PAUSED,
      restoredConfig(NOW + 7 * 86_400_000),
      restoredConfig(NOW + 3600_000),
    ]) {
      const w = await mountBanner(cfg);
      expect(w.find('[data-test="license-search-banner"] svg').exists()).toBe(true);
      w.unmount();
      wrapper = undefined;
      queryClient.clear();
    }
  });

  it("flips restored to ends-soon at one day before the end", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const until = NOW + 2 * 86_400_000;
    const w = await mountBanner(restoredConfig(until));
    expect(w.findComponent(OBanner).props("variant")).toBe("success");
    await vi.advanceTimersByTimeAsync(until - DAY_US / 1000 - NOW + 1);
    expect(w.findComponent(OBanner).props("variant")).toBe("warning");
    expect(w.text()).toContain("Search restoration ends");
  });

  it("removes the banner and reloads once when the restoration ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const until = NOW + 3600_000;
    vi.mocked(zoConfigService.get_config_full).mockResolvedValue({
      data: { license_search_allowed: true },
    } as never);
    const w = await mountBanner(restoredConfig(until));
    const spy = vi.spyOn(store, "dispatch");
    await vi.advanceTimersByTimeAsync(3600_001);
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(false);
    expect(zoConfigService.get_config_full).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("setConfig", { license_search_allowed: true });
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(zoConfigService.get_config_full).toHaveBeenCalledTimes(1);
  });

  it("stays dismissed on remount while the signature matches", async () => {
    sessionStorage.setItem(DISMISS_KEY, "paused");
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(false);
  });

  it("dismissal survives sessionStorage throwing", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const w = await mountBanner(PAUSED);
    expect(w.find('[data-test="license-search-banner"]').exists()).toBe(true);
    await expect(
      w.find('[data-test="license-banner-dismiss"]').trigger("click"),
    ).resolves.not.toThrow();
  });

  it("polls every 5 minutes only while paused", async () => {
    vi.useFakeTimers();
    vi.mocked(zoConfigService.get_config_full).mockResolvedValue({
      data: restoredConfig(Date.now() + 7 * 86_400_000),
    } as never);
    store = makeStore(PAUSED);
    const spy = vi.spyOn(store, "dispatch");
    wrapper = mount(LicenseSearchBanner, { global: { plugins: [store, i18n] } });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(LICENSE_BANNER_POLL_MS);
    expect(spy).toHaveBeenCalledWith("setConfig", expect.anything());
    spy.mockClear();
    await vi.advanceTimersByTimeAsync(LICENSE_BANNER_POLL_MS * 3);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps exactly one interval across paused, allowed, paused", async () => {
    vi.useFakeTimers();
    const live = new Set<unknown>();
    const realSet = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: never, ms?: number) => {
      const id = realSet(fn, ms);
      if (ms === LICENSE_BANNER_POLL_MS) live.add(id);
      return id;
    }) as never);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(((id: never) => {
      live.delete(id);
      realClear(id);
    }) as never);
    await mountBanner(PAUSED);
    expect(live.size).toBe(1);
    store.commit("setConfig", { meta_org: META, license_search_allowed: true });
    await flushPromises();
    expect(live.size).toBe(0);
    store.commit("setConfig", PAUSED);
    await flushPromises();
    expect(live.size).toBe(1);
    store.commit("setConfig", { ...PAUSED, extra: 1 });
    await flushPromises();
    expect(live.size).toBe(1);
    wrapper?.unmount();
    wrapper = undefined;
    expect(live.size).toBe(0);
  });
});
