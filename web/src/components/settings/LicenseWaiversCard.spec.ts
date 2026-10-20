import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import LicenseWaiversCard from "./LicenseWaiversCard.vue";
import i18n from "@/locales";
import type { LicenseWaiver } from "@/utils/licenseWaivers";

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const us = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) * 1000;

const waiver = (over: Partial<LicenseWaiver>): LicenseWaiver => ({
  id: "wv_1",
  type: "search_unblock",
  starts_at: us(2026, 10, 20),
  ends_at: us(2026, 10, 27),
  note: "Migration freeze",
  ...over,
});

const mountCard = (waivers: LicenseWaiver[] | undefined) =>
  mount(LicenseWaiversCard, {
    props: { waivers },
    global: { plugins: [i18n] },
  });

describe("LicenseWaiversCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when only unknown kinds arrive", () => {
    const w = mountCard([waiver({ type: "future_kind" })]);
    expect(w.find("[data-test=license-waivers-card]").exists()).toBe(false);
  });

  it("lists a restore-search waiver with its UTC end and note", () => {
    const w = mountCard([waiver({})]);
    const text = w.find("[data-test=license-waivers-card]").text();
    expect(text).toContain("Restore search");
    expect(text).toContain("Active");
    expect(text).toContain("until Oct 27, 00:00");
    expect(text).toContain("Migration freeze");
    expect(text).toContain("These came with your license key.");
    expect(w.find("[data-test=license-waiver-row-wv_1]").exists()).toBe(true);
  });

  it("a day kind shows its last covered day", () => {
    const w = mountCard([
      waiver({
        id: "wv_2",
        type: "ingestion_limit",
        limit: { typ: "PerDayCount", value: 500 },
        starts_at: us(2026, 11, 1),
        ends_at: us(2026, 11, 15),
      }),
    ]);
    const text = w.find("[data-test=license-waivers-card]").text();
    expect(text).toContain("Raise limit to 500 GB/day");
    expect(text).toContain("Nov 1");
    expect(text).toContain("Nov 14");
    expect(text).not.toContain("Nov 15");
  });

  it("an Unlimited ingestion waiver is labelled Unlimited ingestion", () => {
    const w = mountCard([
      waiver({
        id: "wv_3",
        type: "ingestion_limit",
        limit: { typ: "Unlimited", value: 0 },
        starts_at: us(2026, 10, 1),
        ends_at: us(2026, 10, 10),
      }),
    ]);
    expect(w.find("[data-test=license-waivers-card]").text()).toContain("Unlimited ingestion");
  });
});
