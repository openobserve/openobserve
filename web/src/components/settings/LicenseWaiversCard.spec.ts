import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import LicenseWaiversCard from "./LicenseWaiversCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import i18n from "@/locales";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
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

enableAutoUnmount(afterEach);

describe("LicenseWaiversCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("the note column takes the width the fixed columns leave", () => {
    const columns = mountCard([waiver({})])
      .findComponent(OTable)
      .props("columns") as OTableColumnDef[];
    const note = columns.find((c) => c.id === "note");
    expect(note?.size).toBeUndefined();
    expect(note?.meta).toMatchObject({ autoWidth: true, fillRemaining: true });
  });

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
    expect(text).toContain("These come with your license.");
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

  it("badges read Scheduled, Ended and Past days", () => {
    const w = mountCard([
      waiver({ id: "s", starts_at: us(2026, 11, 1), ends_at: us(2026, 11, 8) }),
      waiver({ id: "e", starts_at: us(2026, 9, 1), ends_at: us(2026, 9, 8) }),
      waiver({
        id: "p",
        type: "ingestion_limit",
        limit: { typ: "PerDayCount", value: 300 },
        starts_at: us(2026, 9, 1),
        ends_at: us(2026, 9, 8),
      }),
    ]);
    const text = (id: string) => w.find(`[data-test=license-waiver-row-${id}]`).text();
    expect(text("s")).toContain("Scheduled");
    expect(text("e")).toContain("Ended");
    expect(text("p")).toContain("Past days");
  });

  it("badges move on at each waiver boundary without a reload", async () => {
    const HOUR_MS = 3_600_000;
    const startUs = (NOW + HOUR_MS) * 1000;
    const w = mountCard([
      waiver({ id: "t", starts_at: startUs, ends_at: startUs + 2 * HOUR_MS * 1000 }),
    ]);
    const text = () => w.find("[data-test=license-waiver-row-t]").text();
    expect(text()).toContain("Scheduled");
    await vi.advanceTimersByTimeAsync(HOUR_MS + 1);
    expect(text()).toContain("Active");
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
    expect(text()).toContain("Ended");
  });

  it("unmounting clears the boundary timer", () => {
    const w = mountCard([waiver({ id: "t", starts_at: (NOW + 60_000) * 1000 })]);
    expect(vi.getTimerCount()).toBe(1);
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
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

it("explains manual online delivery and air-gapped key delivery", () => {
  const w = mount(LicenseWaiversCard, {
    props: { waivers: [waiver({})] },
    global: { plugins: [i18n] },
  });
  expect(w.text()).toContain(
    "These come with your license. Online installs pick up changes when an administrator clicks Refresh now; air-gapped installs apply a new key from OpenObserve here.",
  );
});

describe("O14 card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("new_kinds_visible_unknown_kind_still_filtered", async () => {
    const w = mountCard([waiver({})]);
    const refreshed = JSON.parse(
      JSON.stringify([
        waiver({}),
        waiver({
          id: "ingestion",
          type: "ingestion_limit",
          limit: { typ: "PerDayCount", value: 500 },
        }),
        waiver({ id: "one", type: "breach_days", extra: 1 }),
        waiver({ id: "five", type: "breach_days", extra: 5 }),
        waiver({ id: "grace", type: "report_grace" }),
        waiver({ id: "future", type: "future_kind" }),
      ]),
    );
    await w.setProps({ waivers: refreshed });
    expect(w.text()).toContain("Allow 1 extra over-limit day in Oct");
    expect(w.text()).toContain("Allow 5 extra over-limit days in Oct");
    expect(w.text()).toContain("Reporting grace until Oct 27, 00:00");
    expect(w.text()).toContain("Restore search");
    expect(w.text()).toContain("Raise limit to 500 GB/day");
    expect(w.find("[data-test=license-waiver-row-future]").exists()).toBe(false);
  });

  it("new_kind_window_and_status_boundaries_update_without_reload", async () => {
    const start = Date.UTC(2026, 9, 30);
    const end = Date.UTC(2026, 9, 31);
    const monthEnd = Date.UTC(2026, 10, 1);
    vi.setSystemTime(start - 1);
    const w = mountCard([
      waiver({
        id: "breach",
        type: "breach_days",
        extra: 2,
        starts_at: start * 1000,
        ends_at: end * 1000,
      }),
      waiver({ id: "grace", type: "report_grace", starts_at: start * 1000, ends_at: end * 1000 }),
    ]);
    const row = (id: string) => w.get(`[data-test=license-waiver-row-${id}]`).text();
    const expectDetails = (graceSummary: string) => {
      expect(w.get("[data-test=license-waiver-window-breach]").text()).toBe(
        "Oct 30 through Oct 30",
      );
      expect(w.get("[data-test=license-waiver-window-grace]").text()).toBe(
        "Oct 30, 00:00 → Oct 31, 00:00",
      );
      expect(w.get("[data-test=license-waiver-summary-grace]").text()).toBe(graceSummary);
    };
    const activeSummary = "Ends Oct 31 at 00:00 UTC; reports continue.";
    const endedSummary = "Grace ended Oct 31 at 00:00 UTC; reports continue.";
    expect(row("breach")).toContain("Scheduled");
    expect(row("grace")).toContain("Scheduled");
    expectDetails("Grace starts Oct 30 at 00:00 UTC.");
    await vi.advanceTimersByTimeAsync(1);
    expect(row("breach")).toContain("Active");
    expect(row("grace")).toContain("Active");
    expectDetails(activeSummary);
    await vi.advanceTimersByTimeAsync(end - start - 1);
    expect(row("grace")).toContain("Active");
    expectDetails(activeSummary);
    await vi.advanceTimersByTimeAsync(1);
    expect(row("grace")).toContain("Ended");
    expectDetails(endedSummary);
    expect(row("breach")).toContain("Past days");
    expect(row("breach")).toContain(
      "Past day coverage; 2 extra allowed days retained through Oct 31.",
    );
    await vi.advanceTimersByTimeAsync(monthEnd - end - 1);
    expect(row("breach")).toContain("retained through Oct 31");
    expectDetails(endedSummary);
    await vi.advanceTimersByTimeAsync(1);
    expect(row("breach")).toContain("October allowance ended at Nov 1, 00:00 UTC.");
    expect(row("breach")).toContain("Expired");
    expectDetails(endedSummary);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("viewers see the same waiver details and ask an administrator to refresh", async () => {
  const w = mountCard([waiver({ id: "grace", type: "report_grace" })]);
  await w.setProps({ canUpdate: false });
  expect(w.get("[data-test=license-waivers-ask-admin]").text()).toBe(
    "Ask an administrator to refresh the license for waiver changes.",
  );
  expect(w.text()).toContain("Reporting grace until Oct 27, 00:00");
  await w.setProps({ canUpdate: true });
  expect(w.find("[data-test=license-waivers-ask-admin]").exists()).toBe(false);
});
