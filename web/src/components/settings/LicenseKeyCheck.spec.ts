import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, enableAutoUnmount } from "@vue/test-utils";
import LicenseKeyCheck from "./LicenseKeyCheck.vue";
import i18n from "@/locales";
import type { KeyCheckResult, RevRefusal } from "@/utils/licenseWaivers";

enableAutoUnmount(afterEach);
const rev = Date.UTC(2026, 9, 20) * 1000;
const result: KeyCheckResult = {
  dry_run: true,
  outcome: "accept",
  message: "",
  license_id: "lic_other",
  same_license: true,
  loaded_rev: rev,
  pasted_rev: rev,
  waivers_added: [],
  waivers_removed: [],
};
const render = (props: { result: KeyCheckResult | null; refusal: RevRefusal | null }) =>
  mount(LicenseKeyCheck, { props, global: { plugins: [i18n] } });
describe("LicenseKeyCheck", () => {
  it("renders nothing without a result", () =>
    expect(render({ result: null, refusal: null }).text()).toBe(""));
  it("accept with no changes explains the same waivers", () =>
    expect(render({ result, refusal: null }).text()).toContain("same waivers"));
  it("accept for another license names the replacement", () =>
    expect(render({ result: { ...result, same_license: false }, refusal: null }).text()).toContain(
      "Different license (lic_other)",
    ));
  for (const [outcome, copy] of [
    ["rev_rollback", "Oct 20, 2026"],
    ["rev_conflict", "issued at the same time"],
    ["superseded", "replaced by a renewal"],
    ["env_key_conflict", "O2_LICENSE_KEY"],
  ] as const) {
    it(`renders ${outcome}`, () =>
      expect(
        render({
          result: { ...result, outcome, pasted_rev: rev - 86400000000 },
          refusal: null,
        }).text(),
      ).toContain(copy));
  }
  it("rev_zero_refusal_uses_the_undated_copy", () => {
    const text = render({
      result: null,
      refusal: {
        code: 409,
        reason: "rev_rollback",
        message: "",
        license_id: "lic_1",
        loaded_rev: rev,
        pasted_rev: 0,
      },
    }).text();
    expect(text).toContain("older copy with no issue date");
    expect(text).not.toContain("1970");
  });
  it("same-day rollback displays both UTC times", () => {
    const text = render({
      result: {
        ...result,
        outcome: "rev_rollback",
        loaded_rev: rev + 14 * 3600000000,
        pasted_rev: rev + 9 * 3600000000,
      },
      refusal: null,
    }).text();
    expect(text).toContain("14:00 UTC");
    expect(text).toContain("09:00 UTC");
  });
  it("an accept preview lists added and removed waivers", () => {
    const waiver = {
      id: "added",
      type: "search_unblock",
      starts_at: rev,
      ends_at: rev + 86400000000,
      note: "Migration note",
    };
    const text = render({
      result: {
        ...result,
        waivers_added: [waiver],
        waivers_removed: [{ ...waiver, id: "removed", note: "Removed note" }],
      },
      refusal: null,
    }).text();
    expect(text).toContain("Added (1)");
    expect(text).toContain("Removed (1)");
    expect(text).toContain("Restore search");
    expect(text).toContain("until Oct 21, 00:00");
    expect(text).toContain("Migration note");
    expect(text).toContain("Removed note");
  });
});

describe("LicenseKeyCheck waiver status clock", () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const waiver = {
    id: "clock",
    type: "search_unblock",
    starts_at: (now + 1000) * 1000,
    ends_at: (now + 2000) * 1000,
    note: "Clock boundary",
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());
  it("refreshes status when a result arrives after its start boundary", async () => {
    const w = render({ result: null, refusal: null });
    await vi.advanceTimersByTimeAsync(1500);
    await w.setProps({ result: { ...result, waivers_added: [waiver] } });
    expect(w.find('[data-test="license-key-check-added"]').text()).toContain("Active");
    expect(w.find('[data-test="license-key-check-added"]').text()).not.toContain("Scheduled");
    w.unmount();
  });
  it("refreshes visible added and removed waivers at start and end boundaries", async () => {
    const w = render({
      result: {
        ...result,
        waivers_added: [waiver],
        waivers_removed: [
          {
            ...waiver,
            id: "removed",
            type: "ingestion_limit",
            limit: { typ: "PerDayCount", value: 400 },
          },
        ],
      },
      refusal: null,
    });
    const added = () => w.find('[data-test="license-key-check-added"]').text();
    const removed = () => w.find('[data-test="license-key-check-removed"]').text();
    expect(added()).toContain("Scheduled");
    expect(removed()).toContain("Scheduled");
    await vi.advanceTimersByTimeAsync(1001);
    expect(added()).toContain("Active");
    expect(removed()).toContain("Active");
    await vi.advanceTimersByTimeAsync(1000);
    expect(added()).toContain("Ended");
    expect(removed()).toContain("Past days");
    w.unmount();
  });
});
