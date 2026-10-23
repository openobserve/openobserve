import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LicenseStatusCard from "./LicenseStatusCard.vue";
import i18n from "@/locales";
import type { LicenseDecision } from "@/utils/licenseWaivers";

const decision = (over: Partial<LicenseDecision> = {}): LicenseDecision => ({
  search_allowed: true,
  blocks: [],
  exceeded_days: 0,
  allowed_days: 3,
  limit_today_gb: 200,
  used_today_gb: 122,
  waiver_ids_applied: [],
  ...over,
});

const mountCard = (props: Record<string, unknown>) =>
  mount(LicenseStatusCard, {
    props: { decision: decision(), envKeyActive: false, ...props } as any,
    global: { plugins: [i18n] },
  });

describe("LicenseStatusCard", () => {
  it("search on by waiver shows the would-be-paused count", () => {
    const w = mountCard({
      decision: decision({ waiver_ids_applied: ["wv_1"], exceeded_days: 0 }),
      base: decision({ search_allowed: false, exceeded_days: 4, allowed_days: 3 }),
    });
    const text = w.find("[data-test=license-status-search]").text();
    expect(text).toContain("On");
    expect(text).toContain("4 of 3");
  });

  it("does not claim a restore when the backend never blocked", () => {
    const w = mountCard({ base: decision() });
    expect(w.find("[data-test=license-status-search]").text()).not.toContain("Restored by");
  });

  it("paused shows each block's reason", () => {
    const w = mountCard({
      decision: decision({
        search_allowed: false,
        blocks: ["usage_over_limit", "report_failure"],
        exceeded_days: 4,
      }),
    });
    const text = w.find("[data-test=license-status-search]").text();
    expect(text).toContain("Paused");
    expect(text).toContain("Over the daily limit on 4 days");
    expect(text).toContain("Usage reports are failing");
  });

  it("an unknown block renders no reason line", () => {
    const w = mountCard({
      decision: decision({ search_allowed: false, blocks: ["unknown"] }),
    });
    expect(w.findAll("[data-test=license-status-reason]")).toHaveLength(0);
    expect(w.find("[data-test=license-status-search]").text()).toContain("Paused");
  });

  it("Unlimited today never renders NaN", () => {
    const w = mountCard({ decision: decision({ limit_today_gb: null, used_today_gb: 0 }) });
    expect(w.find("[data-test=license-status-limit]").text()).toContain("Unlimited");
    expect(w.html()).not.toMatch(/NaN|Infinity/);
  });

  it("limit row shows GB/day and percent", () => {
    const w = mountCard({});
    expect(w.find("[data-test=license-status-limit]").text()).toContain("200 GB/day · 61% used");
  });

  it("days row shows allowed and used", () => {
    const w = mountCard({ decision: decision({ exceeded_days: 2 }) });
    expect(w.find("[data-test=license-status-days]").text()).toContain(
      "3 allowed this month · 2 used",
    );
  });

  it("days row shows the count before waivers when it differs", () => {
    const w = mountCard({
      decision: decision({ exceeded_days: 0 }),
      base: decision({ exceeded_days: 4 }),
    });
    expect(w.find("[data-test=license-status-days]").text()).toContain("0 used (4 before waivers)");
  });

  it("a zero limit shows 0 GB/day, never NaN or Infinity", () => {
    const w = mountCard({ decision: decision({ limit_today_gb: 0, used_today_gb: 5 }) });
    const text = w.find("[data-test=license-status-limit]").text();
    expect(text).toContain("0 GB/day");
    expect(text).not.toContain("Unlimited");
    expect(w.html()).not.toMatch(/NaN|Infinity/);
  });

  it("before the first evaluation claims no limit and hides the days row", () => {
    const w = mountCard({ evaluatedAt: 0, decision: decision({ limit_today_gb: null }) });
    const text = w.find("[data-test=license-status-limit]").text();
    expect(text).toBe("—");
    expect(text).not.toContain("Unlimited");
    expect(w.find("[data-test=license-status-days]").exists()).toBe(false);
  });

  it("an evaluated status shows its limit and days", () => {
    const w = mountCard({ evaluatedAt: 1792000000000000 });
    expect(w.find("[data-test=license-status-limit]").text()).toContain("200 GB/day");
    expect(w.find("[data-test=license-status-days]").exists()).toBe(true);
  });

  it("env key notice shows only when the env key is active", () => {
    const on = mountCard({ envKeyActive: true, envKeyInUse: true });
    expect(on.find("[data-test=license-status-env-key]").text()).toContain("O2_LICENSE_KEY");
    expect(on.find("[data-test=license-status-env-key]").text()).toContain("paste a newer key");
    expect(on.findComponent({ name: "OBanner" }).props("variant")).toBe("warning");
    expect(on.findComponent({ name: "OBanner" }).props("icon")).toBe("warning");
    const off = mountCard({ envKeyActive: false });
    expect(off.find("[data-test=license-status-env-key]").exists()).toBe(false);
  });

  it("a pasted key newer than the env key shows the info banner", () => {
    const w = mountCard({ envKeyActive: true, envKeyInUse: false });
    const banner = w.findComponent({ name: "OBanner" });
    expect(banner.props("variant")).toBe("info");
    expect(w.find("[data-test=license-status-env-key]").text()).toContain(
      "newer than O2_LICENSE_KEY is in use",
    );
  });
});

describe("license revision high-water warning", () => {
  const warning = {
    source: "env",
    license_id: "lic_1",
    loaded_rev: Date.UTC(2026, 9, 14) * 1000,
    hwm_rev: Date.UTC(2026, 9, 20) * 1000,
  };
  it("shows the env-below-hwm warning with both dates", () => {
    const w = mountCard({ envKeyActive: true, revHwmWarning: warning });
    const text = w.find('[data-test="license-status-rev-hwm"]').text();
    expect(text).toContain("O2_LICENSE_KEY holds an older key");
    expect(text).toContain("Oct 14, 2026");
    expect(text).toContain("Oct 20, 2026");
    expect(w.find('[data-test="license-status-env-key"]').exists()).toBe(false);
  });
  it("shows the db-below-hwm warning", () => {
    const w = mountCard({ revHwmWarning: { ...warning, source: "db" } });
    expect(w.find('[data-test="license-status-rev-hwm"]').text()).toContain(
      "The stored key for this license",
    );
  });
  it("no rev warning when rev_hwm_warning is null", () =>
    expect(
      mountCard({ revHwmWarning: null }).find('[data-test="license-status-rev-hwm"]').exists(),
    ).toBe(false));
  it("an undated env key never renders the epoch", () => {
    const text = mountCard({ revHwmWarning: { ...warning, loaded_rev: 0 } })
      .find('[data-test="license-status-rev-hwm"]')
      .text();
    expect(text).toContain("older undated key");
    expect(text).not.toContain("1970");
  });
  it("an undated stored key never renders the epoch", () => {
    const text = mountCard({ revHwmWarning: { ...warning, source: "db", loaded_rev: 0 } })
      .find('[data-test="license-status-rev-hwm"]')
      .text();
    expect(text).toContain("stored undated key");
    expect(text).not.toContain("1970");
  });
  it("only an updater sees the stored-key recovery action", async () => {
    const props = { revHwmWarning: { ...warning, source: "db" } };
    expect(mountCard(props).find('[data-test="license-status-rev-hwm-add-key"]').exists()).toBe(
      false,
    );
    const w = mountCard({ ...props, canUpdateLicense: true });
    await w.find('[data-test="license-status-rev-hwm-add-key"]').trigger("click");
    expect(w.emitted("add-license-key")).toHaveLength(1);
    expect(
      mountCard({ revHwmWarning: warning, canUpdateLicense: true })
        .find('[data-test="license-status-rev-hwm-add-key"]')
        .exists(),
    ).toBe(false);
  });
});
