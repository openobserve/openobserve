import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import LicenseStatusCard from "./LicenseStatusCard.vue";
import i18n from "@/locales";
import type { LicenseDecision, LicenseWaiver } from "@/utils/licenseWaivers";

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

const mountCard = (props: Partial<InstanceType<typeof LicenseStatusCard>["$props"]>) =>
  mount(LicenseStatusCard, {
    props: { decision: decision(), envKeyActive: false, ...props },
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

  it("usage reason pluralizes the over-limit day count", () => {
    const reason = (exceeded: number) =>
      mountCard({
        decision: decision({
          search_allowed: false,
          blocks: ["usage_over_limit"],
          exceeded_days: exceeded,
          allowed_days: 0,
        }),
      })
        .find("[data-test=license-status-reason]")
        .text();
    expect(reason(1)).toBe("Over the daily limit on 1 day this month (0 allowed)");
    expect(reason(4)).toBe("Over the daily limit on 4 days this month (0 allowed)");
  });

  it("restored-by-waiver line pluralizes the allowed day count", () => {
    const line = (allowed: number) =>
      mountCard({
        decision: decision({ waiver_ids_applied: ["wv_1"] }),
        base: decision({ search_allowed: false, exceeded_days: 2, allowed_days: allowed }),
      })
        .find("[data-test=license-status-search]")
        .text();
    expect(line(1)).toContain("(2 of 1 allowed day used)");
    expect(line(3)).toContain("(2 of 3 allowed days used)");
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
      "in use instead of O2_LICENSE_KEY",
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

it("describes keys fetched online as well as pasted keys", () => {
  const w = mountCard({ envKeyActive: true, envKeyInUse: false });
  expect(w.get('[data-test="license-status-env-key"]').text()).toBe(
    "A newer key for this license (pasted or fetched online) is in use instead of O2_LICENSE_KEY. Update O2_LICENSE_KEY when convenient so the two match.",
  );
});

describe("status rows from waiver data", () => {
  const start = Date.UTC(2026, 9, 24);
  const end = Date.UTC(2026, 9, 30);
  const breach: LicenseWaiver = {
    id: "breach",
    type: "breach_days",
    extra: 2,
    starts_at: start * 1000,
    ends_at: end * 1000,
    note: "",
  };
  const grace: LicenseWaiver = { ...breach, id: "grace", type: "report_grace" };
  afterEach(() => vi.useRealTimers());

  it("renders the approved base plus waiver and used fragments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const w = mountCard({
      waivers: [breach, grace],
      base: decision({ exceeded_days: 4 }),
      decision: decision({ allowed_days: 5, exceeded_days: 4 }),
    });
    expect(w.find("[data-test=license-status-days]").find("dd").text()).toBe(
      "3 allowed this month + 2 from a waiver · 4 used",
    );
    expect(w.find("[data-test=license-status-reporting]").find("dd").text()).toBe(
      "grace until Oct 30 — features stay on while reports catch up",
    );
    w.unmount();
  });

  it("updates grace at start and exclusive end and breach at UTC month rollover without a fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start - 1);
    const w = mountCard({ waivers: [breach, grace], base: decision() });
    expect(w.find("[data-test=license-status-reporting]").exists()).toBe(false);
    expect(w.find("[data-test=license-status-days]").text()).not.toContain("from a waiver");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.find("[data-test=license-status-reporting]").exists()).toBe(true);
    expect(w.find("[data-test=license-status-days]").text()).toContain("+ 2 from a waiver");
    await vi.advanceTimersByTimeAsync(end - start - 1);
    expect(w.find("[data-test=license-status-reporting]").exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.find("[data-test=license-status-reporting]").exists()).toBe(false);
    expect(w.find("[data-test=license-status-days]").text()).toContain("+ 2 from a waiver");
    await vi.advanceTimersByTimeAsync(Date.UTC(2026, 10, 1) - end - 1);
    expect(w.find("[data-test=license-status-days]").text()).toContain("+ 2 from a waiver");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.find("[data-test=license-status-days]").find("dd").text()).toBe(
      "3 allowed this month · 0 used",
    );
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])(
    "drops expired relief from an initially active response without a fetch (base present: %s)",
    async (hasBase) => {
      vi.useFakeTimers();
      vi.setSystemTime(start);
      const w = mountCard({
        waivers: [breach],
        base: hasBase ? decision() : undefined,
        decision: decision({ allowed_days: 5 }),
      });
      expect(w.get("[data-test=license-status-days]").find("dd").text()).toBe(
        hasBase ? "3 allowed this month + 2 from a waiver · 0 used" : "2 from a waiver · 0 used",
      );
      await vi.advanceTimersByTimeAsync(Date.UTC(2026, 10, 1) - start - 1);
      expect(w.get("[data-test=license-status-days]").text()).toContain("2 from a waiver");
      await vi.advanceTimersByTimeAsync(1);
      const days = w.get("[data-test=license-status-days]").find("dd").text();
      expect(days).toBe(hasBase ? "3 allowed this month · 0 used" : "0 used");
      expect(days).not.toContain("from a waiver");
      expect(days).not.toContain("5 allowed");
      w.unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("omits each absent source fragment instead of using a fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const w = mountCard({
      waivers: [breach],
      decision: decision({ allowed_days: 5, exceeded_days: undefined }),
    });
    expect(w.find("[data-test=license-status-days]").find("dd").text()).toBe("2 from a waiver");
    await w.setProps({
      waivers: [{ ...breach, extra: undefined }],
      decision: decision({ allowed_days: undefined, exceeded_days: undefined }),
    });
    expect(w.find("[data-test=license-status-days]").exists()).toBe(false);
    expect(w.find("[data-test=license-status-reporting]").exists()).toBe(false);
    expect(w.html()).not.toMatch(/undefined|NaN/);
    w.unmount();
  });
});

describe("LicenseStatusCard boundary events", () => {
  afterEach(() => vi.useRealTimers());

  it("reports the report-grace end so the page can refetch the decision", async () => {
    const now = Date.UTC(2026, 9, 20, 12);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(now);
    const endsUs = (now + 1000) * 1000;
    const w = mountCard({
      waivers: [
        {
          id: "grace",
          type: "report_grace",
          starts_at: (now - 1000) * 1000,
          ends_at: endsUs,
          note: "",
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(w.emitted("boundary")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.emitted("boundary")).toEqual([[endsUs]]);
    w.unmount();
  });
});
