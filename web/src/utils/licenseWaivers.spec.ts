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

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import {
  DAY_US,
  MAX_TIMEOUT_MS,
  activeSearchUnblock,
  statusWaiverRelief,
  bannerSignature,
  boundaryDelayMs,
  formatUtc,
  issuedOn,
  isDayWaiver,
  breachRetentionEndUs,
  isRevRefusal,
  isKeyCheckResult,
  knownWaivers,
  lastCoveredDayUs,
  licenseBannerState,
  licenseExpiryState,
  quotaPercent,
  waiverStatus,
  waiverKindLabel,
  waiverWindowLabel,
  waiverSummary,
  type LicenseDecision,
} from "./licenseWaivers";

const us = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m, d, h, min) * 1000;
const unblock = {
  id: "wv_1",
  type: "search_unblock",
  starts_at: us(2026, 9, 20),
  ends_at: us(2026, 9, 27),
  note: "n",
};
const raise = {
  id: "wv_2",
  type: "ingestion_limit",
  limit: { typ: "PerDayCount" as const, value: 400 },
  starts_at: us(2026, 10, 1),
  ends_at: us(2026, 10, 15),
  note: "",
};

describe("licenseWaivers", () => {
  it("waiverStatus honours inclusive start and exclusive end", () => {
    expect(waiverStatus(unblock, us(2026, 9, 19))).toBe("scheduled");
    expect(waiverStatus(unblock, unblock.starts_at)).toBe("active");
    expect(waiverStatus(unblock, unblock.ends_at)).toBe("ended");
    expect(waiverStatus({ ...unblock, type: "ingestion_limit" }, unblock.ends_at)).toBe("past");
  });

  it("knownWaivers drops kinds this release does not know", () => {
    expect(
      knownWaivers([
        unblock,
        { ...unblock, id: "x", type: "future_kind" },
        { ...unblock, id: "y", type: "unknown" },
      ]).map((w) => w.id),
    ).toEqual(["wv_1"]);
    expect(knownWaivers(undefined)).toEqual([]);
  });

  it("formatUtc is UTC whatever the browser zone", () => {
    expect(formatUtc(us(2026, 9, 27), "en-US", true)).toBe("Oct 27, 00:00");
    expect(formatUtc(us(2026, 9, 26, 23, 30), "en-US", true)).toBe("Oct 26, 23:30");
  });

  it("a day kind's last covered day is the day before ends_at", () => {
    expect(formatUtc(lastCoveredDayUs(raise), "en-US", false)).toBe("Nov 14");
  });

  it("quotaPercent is null for Unlimited and a zero limit", () => {
    const d = { limit_today_gb: 200, used_today_gb: 122 } as LicenseDecision;
    expect(quotaPercent(d)).toBe(61);
    expect(quotaPercent({ ...d, limit_today_gb: null })).toBeNull();
    expect(quotaPercent({ ...d, limit_today_gb: 0 })).toBeNull();
  });

  it("licenseBannerState", () => {
    const now = us(2026, 9, 25);
    expect(licenseBannerState({}, now)).toEqual({ kind: "none" });
    expect(licenseBannerState({ license_search_allowed: false }, now)).toEqual({ kind: "paused" });
    expect(
      licenseBannerState(
        { license_search_allowed: true, license_waiver_until: now + 2 * DAY_US },
        now,
      ),
    ).toEqual({ kind: "restored", untilUs: now + 2 * DAY_US, endsSoon: false });
    expect(
      licenseBannerState(
        { license_search_allowed: true, license_waiver_until: now + DAY_US - 1 },
        now,
      ),
    ).toMatchObject({ endsSoon: true });
    expect(
      licenseBannerState({ license_search_allowed: true, license_waiver_until: null }, now),
    ).toEqual({ kind: "none" });
    expect(
      licenseBannerState({ license_search_allowed: true, license_waiver_until: now }, now),
    ).toEqual({ kind: "none" });
  });

  it("bannerSignature changes with the state", () => {
    expect(bannerSignature({ kind: "paused" })).not.toBe(
      bannerSignature({ kind: "restored", untilUs: 1, endsSoon: false }),
    );
    expect(bannerSignature({ kind: "restored", untilUs: 1, endsSoon: false })).not.toBe(
      bannerSignature({ kind: "restored", untilUs: 2, endsSoon: false }),
    );
  });

  it("activeSearchUnblock picks the active unblock with the latest end", () => {
    const later = { ...unblock, id: "wv_3", ends_at: us(2026, 9, 30) };
    const now = us(2026, 9, 25);
    expect(activeSearchUnblock([unblock, later, raise], now)?.id).toBe("wv_3");
    expect(activeSearchUnblock([raise], now)).toBeUndefined();
    expect(activeSearchUnblock(undefined, now)).toBeUndefined();
  });

  it("tolerates the unknown block in a decision", () => {
    const d: LicenseDecision = {
      search_allowed: false,
      blocks: ["unknown"],
      exceeded_days: 0,
      allowed_days: 0,
      limit_today_gb: 10,
      used_today_gb: 5,
      waiver_ids_applied: [],
    };
    expect(quotaPercent(d)).toBe(50);
  });
});

describe("boundaryDelayMs", () => {
  it("wakes 1 ms past the boundary", () => {
    expect(boundaryDelayMs(5_000_000, 1_000_000)).toBe(4_001);
  });

  it("clamps a far boundary to the longest timeout a browser honours", () => {
    expect(boundaryDelayMs(40 * DAY_US, 0)).toBe(MAX_TIMEOUT_MS);
  });
});

describe("license revision protection", () => {
  it("issuedOn formats µs as a UTC date", () => {
    expect(issuedOn(Date.UTC(2026, 9, 20) * 1000, "en-US")).toBe("Oct 20, 2026");
  });
  it("issuedOn(0) is empty", () => expect(issuedOn(0, "en-US")).toBe(""));
  it("issuedOn round-trips 1760918400000000 without precision loss", () => {
    expect(issuedOn(JSON.parse("1760918400000000"), "en-US")).toBe("Oct 20, 2025");
  });
  it("isRevRefusal accepts the 409 body and rejects the env body", () => {
    const body = {
      code: 409,
      reason: "rev_rollback",
      license_id: "lic_1",
      message: "older",
      loaded_rev: 9,
      pasted_rev: 0,
    };
    expect(isRevRefusal(body)).toBe(true);
    for (const invalid of [
      null,
      {},
      { ...body, reason: "env_key_conflict" },
      { ...body, code: "409" },
      { ...body, loaded_rev: "9" },
      { ...body, pasted_rev: null },
    ])
      expect(isRevRefusal(invalid)).toBe(false);
  });
});

describe("licenseExpiryState", () => {
  const now = 1792713600000000;
  it("includes the 30-day boundary for online licenses", () => {
    expect(licenseExpiryState({ license_expiry: now + 30 * DAY_US }, "online", now)).toEqual({
      kind: "expiring",
      untilUs: now + 30 * DAY_US,
      online: true,
    });
  });
  it("marks airgapped licenses offline", () => {
    expect(licenseExpiryState({ license_expiry: now + DAY_US }, "airgapped", now)).toEqual({
      kind: "expiring",
      untilUs: now + DAY_US,
      online: false,
    });
  });
  it.each([undefined, 0, now, now - 1, now + 31 * DAY_US])(
    "hides missing, expired or distant expiries (%s)",
    (expiry) => {
      expect(licenseExpiryState({ license_expiry: expiry }, "online", now)).toEqual({
        kind: "none",
      });
    },
  );
});

describe("O14 new waiver kinds", () => {
  const breach = { ...unblock, type: "breach_days", extra: 2 };
  const grace = {
    ...unblock,
    type: "report_grace",
    starts_at: us(2026, 9, 23, 12),
    ends_at: us(2026, 9, 30),
  };

  it("new_kinds_visible_unknown_kind_still_filtered", () => {
    expect(
      knownWaivers([unblock, raise, breach, grace, { ...unblock, type: "future_kind" }]),
    ).toEqual([unblock, raise, breach, grace]);
  });

  it("breach_extra_one_and_five_render_exact_values", () => {
    for (const extra of [1, 5]) {
      const w = { ...breach, extra };
      expect(waiverKindLabel(w, gt, "en-US")).toBe(
        `Allow ${extra} extra over-limit ${extra === 1 ? "day" : "days"} in Oct`,
      );
      expect(waiverSummary(w, breach.starts_at, "en-US", gt)).toBe(
        `Adds ${extra} allowed ${extra === 1 ? "day" : "days"} this month, through Oct 31.`,
      );
    }
  });

  it("missing_or_invalid_extra_never_invents_a_limit", () => {
    for (const extra of [undefined, null, "2", 0, -1, 1.5, 6, NaN, Infinity]) {
      const w = JSON.parse(JSON.stringify({ ...breach, extra }));
      expect(waiverKindLabel(w, gt, "en-US")).toBe("Extra over-limit days");
      expect(waiverSummary(w, breach.starts_at, "en-US", gt)).toBe(
        "Contact OpenObserve for details.",
      );
    }
  });

  it("new_kind_labels_and_summaries_are_distinct", () => {
    expect(waiverKindLabel(grace, gt, "en-US")).toBe("Reporting grace until Oct 30, 00:00");
    expect(waiverSummary(grace, grace.starts_at, "en-US", gt)).toBe(
      "Ends Oct 30 at 00:00 UTC; reports continue.",
    );
    expect(waiverWindowLabel(breach, "en-US", gt)).toBe("Oct 20 through Oct 26");
    expect(waiverSummary(breach, breach.ends_at, "en-US", gt)).toBe(
      "Past day coverage; 2 extra allowed days retained through Oct 31.",
    );
    expect(waiverSummary(breach, us(2026, 10, 1), "en-US", gt)).toBe(
      "October allowance ended at Nov 1, 00:00 UTC.",
    );
  });

  it("report_grace_uses_exact_time_not_day_window", () => {
    expect(isDayWaiver(grace)).toBe(false);
    expect(isDayWaiver(breach)).toBe(true);
    expect(isDayWaiver(raise)).toBe(true);
    expect(isDayWaiver(unblock)).toBe(false);
    expect(waiverWindowLabel(grace, "en-US", gt)).toBe("Oct 23, 12:00 → Oct 30, 00:00");
    expect(waiverSummary(grace, grace.starts_at - 1, "en-US", gt)).toBe(
      "Grace starts Oct 23 at 12:00 UTC.",
    );
    expect(waiverSummary(grace, grace.ends_at, "en-US", gt)).toBe(
      "Grace ended Oct 30 at 00:00 UTC; reports continue.",
    );
    expect(waiverStatus(grace, grace.starts_at - 1)).toBe("scheduled");
    expect(waiverStatus(grace, grace.starts_at)).toBe("active");
    expect(waiverStatus(grace, grace.ends_at - 1)).toBe("active");
    expect(waiverStatus(grace, grace.ends_at)).toBe("ended");
    expect(waiverStatus(breach, breach.starts_at - 1)).toBe("scheduled");
    expect(waiverStatus(breach, breach.starts_at)).toBe("active");
    expect(waiverStatus(breach, breach.ends_at - 1)).toBe("active");
    expect(waiverStatus(breach, breach.ends_at)).toBe("past");
  });

  it("key-check response parsing preserves extra and tolerates future kinds", () => {
    const result: unknown = JSON.parse(
      JSON.stringify({
        dry_run: true,
        outcome: "accept",
        message: "",
        license_id: "synthetic",
        same_license: true,
        loaded_rev: 1,
        pasted_rev: 2,
        waivers_added: [{ ...breach, extra: 5 }, grace, { ...unblock, type: "future_kind" }],
        waivers_removed: [],
      }),
    );
    expect(isKeyCheckResult(result)).toBe(true);
    if (!isKeyCheckResult(result)) throw new Error("Invalid fixture");
    expect(result.waivers_added[0].extra).toBe(5);
    expect(knownWaivers(result.waivers_added)).toHaveLength(2);
  });
});

it("breach retention uses every touched UTC month, leap days and year rollover", () => {
  for (const [start, end, retained] of [
    [Date.UTC(2028, 1, 28), Date.UTC(2028, 2, 1), Date.UTC(2028, 2, 1)],
    [Date.UTC(2026, 9, 31), Date.UTC(2026, 10, 2), Date.UTC(2026, 11, 1)],
    [Date.UTC(2026, 11, 31), Date.UTC(2027, 0, 2), Date.UTC(2027, 1, 1)],
  ]) {
    const w = {
      ...unblock,
      type: "breach_days",
      extra: 2,
      starts_at: start * 1000,
      ends_at: end * 1000,
    };
    expect(breachRetentionEndUs(w)).toBe(retained * 1000);
    expect(waiverStatus(w, retained * 1000 - 1)).toBe(retained === end ? "active" : "past");
    expect(waiverStatus(w, retained * 1000)).toBe("ended");
    if (retained !== end) {
      expect(waiverSummary(w, start * 1000, "en-US", gt)).toContain("in each covered UTC month");
      expect(waiverSummary(w, end * 1000, "en-US", gt)).toContain("Past day coverage");
    }
  }
});

describe("status waiver relief", () => {
  const breach = { ...unblock, type: "breach_days", extra: 2 };
  const grace = { ...unblock, type: "report_grace" };

  it("adds breach days only after activation in a covered UTC month", () => {
    expect(statusWaiverRelief([breach], breach.starts_at - 1).breachDays).toBe(0);
    expect(statusWaiverRelief([breach], breach.starts_at).breachDays).toBe(2);
    expect(statusWaiverRelief([breach], breach.ends_at - 1).breachDays).toBe(2);
    expect(statusWaiverRelief([breach], breach.ends_at).breachDays).toBe(2);
    expect(statusWaiverRelief([breach], us(2026, 10, 1) - 1).breachDays).toBe(2);
    expect(statusWaiverRelief([breach], us(2026, 10, 1)).breachDays).toBe(0);
    const nextMonth = { ...breach, starts_at: us(2026, 10, 1), ends_at: us(2026, 11, 1) };
    expect(statusWaiverRelief([breach, nextMonth], us(2026, 9, 31, 23, 59)).breachDays).toBe(2);
    expect(statusWaiverRelief([breach, nextMonth], us(2026, 10, 1)).breachDays).toBe(2);
    const spanning = { ...breach, ends_at: us(2026, 10, 3) };
    expect(statusWaiverRelief([spanning], us(2026, 10, 30)).breachDays).toBe(2);
    expect(statusWaiverRelief([spanning], us(2026, 11, 1)).breachDays).toBe(0);
    expect(statusWaiverRelief([breach, { ...breach, extra: 5 }], breach.starts_at).breachDays).toBe(
      7,
    );
  });

  it("uses the half-open report grace window with microsecond precision", () => {
    expect(statusWaiverRelief([grace], grace.starts_at - 1).reportGraceUntil).toBeUndefined();
    expect(statusWaiverRelief([grace], grace.starts_at).reportGraceUntil).toBe(grace.ends_at);
    expect(statusWaiverRelief([grace], grace.ends_at - 1).reportGraceUntil).toBe(grace.ends_at);
    expect(statusWaiverRelief([grace], grace.ends_at).reportGraceUntil).toBeUndefined();
  });

  it("never invents relief for absent or invalid source fields", () => {
    expect(statusWaiverRelief(undefined, breach.starts_at)).toEqual({ breachDays: 0 });
    for (const extra of [undefined, 0, 6, -1, 1.5, NaN]) {
      expect(statusWaiverRelief([{ ...breach, extra }], breach.starts_at).breachDays).toBe(0);
    }
    expect(
      statusWaiverRelief([{ ...breach, ends_at: breach.starts_at }], breach.starts_at).breachDays,
    ).toBe(0);
    expect(
      statusWaiverRelief([{ ...grace, ends_at: NaN }], grace.starts_at).reportGraceUntil,
    ).toBeUndefined();
  });
});
