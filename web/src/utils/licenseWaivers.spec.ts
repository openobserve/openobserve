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
import {
  DAY_US,
  MAX_TIMEOUT_MS,
  activeSearchUnblock,
  bannerSignature,
  boundaryDelayMs,
  formatUtc,
  issuedOn,
  isRevRefusal,
  knownWaivers,
  lastCoveredDayUs,
  licenseBannerState,
  licenseExpiryState,
  quotaPercent,
  waiverStatus,
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
        { ...unblock, id: "x", type: "breach_days" },
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
