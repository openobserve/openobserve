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

import { describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import {
  endOfDayMicros,
  expiryDate,
  makePublicLinkSchema,
  publicLinkDefaults,
  publicLinkFormFrom,
  nextNewRange,
  pickerPeriod,
  rangeError,
  rangeFromPicker,
  rangeKey,
  sortRanges,
  todayIn,
  toPublicLinkConfig,
} from "./PublicLinkForm.schema";
import type { PublicLink, PublicLinkRange } from "@/services/public_dashboards_admin";

const schema = makePublicLinkSchema(gt, "2026-09-25");

const named = () => ({ ...publicLinkDefaults(), name: "NOC wall" });
const rel = (secs: number): PublicLinkRange => ({ type: "relative", secs });
const abs = (start: number, end: number): PublicLinkRange => ({ type: "absolute", start, end });

describe("PublicLinkForm schema", () => {
  it("accepts a named link with the default settings", () => {
    expect(schema.safeParse(named()).success).toBe(true);
  });

  it("requires a name", () => {
    const r = schema.safeParse({ ...named(), name: "   " });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["name"]);
  });

  it("defaults the refresh to 1 minute", () => {
    expect(publicLinkDefaults().rebuildSecs).toBe(60);
  });

  it("rejects an expiry before today but allows today", () => {
    expect(schema.safeParse({ ...named(), expires: "2026-09-24" }).success).toBe(false);
    expect(schema.safeParse({ ...named(), expires: "2026-09-25" }).success).toBe(true);
  });

  it("keeps an edited link's own past expiry valid, but no other past date", () => {
    const editing = makePublicLinkSchema(gt, "2026-09-25", () => "2026-09-01");
    expect(editing.safeParse({ ...named(), expires: "2026-09-01" }).success).toBe(true);
    expect(editing.safeParse({ ...named(), expires: "2026-09-02" }).success).toBe(false);
    expect(editing.safeParse({ ...named(), expires: "2026-09-25" }).success).toBe(true);
  });

  it("needs a default that is one of the listed ranges", () => {
    const r = schema.safeParse({ ...named(), ranges: [rel(86400)], defaultKey: "r3600" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["defaultKey"]);
  });

  it("needs at least one time range", () => {
    const r = schema.safeParse({ ...named(), ranges: [] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["ranges"]);
  });

  it("allows any refresh for a long relative range", () => {
    const long = { ...named(), ranges: [rel(90 * 86400)], defaultKey: "r7776000" };
    expect(schema.safeParse({ ...long, rebuildSecs: 60 }).success).toBe(true);
  });
});

describe("PublicLinkForm ranges", () => {
  it("keys and sorts relative ranges before absolute ones", () => {
    expect(rangeKey(rel(3600))).toBe("r3600");
    expect(rangeKey(abs(1, 2))).toBe("a1-2");
    expect(sortRanges([abs(5, 9), rel(86400), abs(1, 2), rel(60)])).toEqual([
      rel(60),
      rel(86400),
      abs(1, 2),
      abs(5, 9),
    ]);
  });

  it("reads the picker, counting a month as 30 days", () => {
    const relative = (period: string) =>
      rangeFromPicker({
        valueType: "relative",
        relativeTimePeriod: period,
        startTime: 0,
        endTime: 0,
      });
    expect(relative("2w")).toEqual(rel(1209600));
    expect(relative("3M")).toEqual(rel(7776000));
    expect(
      rangeFromPicker({
        valueType: "absolute",
        relativeTimePeriod: null,
        startTime: 5,
        endTime: 9,
      }),
    ).toEqual(abs(5, 9));
  });

  it("refuses ranges the server would reject", () => {
    const now = 400 * 86_400 * 1_000_000;
    const day = 86_400 * 1_000_000;
    const err = (range: PublicLinkRange, list: PublicLinkRange[] = []) =>
      rangeError(range, list, now, gt);
    expect(err(rel(3600))).toBeNull();
    expect(err(rel(3600), [rel(3600)])).toBe("This time range is already in the list");
    expect(err(rel(30))).toBe("A relative time range must be whole minutes, at least 1 minute");
    expect(err(rel(90))).not.toBeNull();
    expect(err(rel(366 * 86400))).toBe("A time range can be at most 365 days");
    expect(err(abs(now - day, now))).toBeNull();
    expect(err(abs(now, now - day))).toBe("The start must be before the end");
    expect(err(abs(now - day, now + 1))).toBe("An absolute time range must end in the past");
    expect(err(abs(now - 366 * day, now))).toBe("A time range can be at most 365 days");
  });

  it("writes a relative range as the picker's period, largest unit first", () => {
    expect(pickerPeriod(3600)).toBe("1h");
    expect(pickerPeriod(1209600)).toBe("2w");
    expect(pickerPeriod(2592000)).toBe("1M");
    expect(pickerPeriod(5400)).toBe("90m");
  });

  it("starts a new row on the first common range not listed yet", () => {
    expect(nextNewRange([rel(3600), rel(86400)])).toEqual(rel(604800));
    expect(nextNewRange([])).toEqual(rel(3600));
  });

  it("blocks saving while a listed range is invalid", () => {
    const r = schema.safeParse({ ...named(), ranges: [rel(3600), rel(3600)] });
    expect(r.error?.issues[0].message).toBe("Fix the time ranges marked above");
  });
});

describe("PublicLinkForm payload", () => {
  it("ends the chosen day in the author's timezone", () => {
    const micros = endOfDayMicros("2026-10-01", "Asia/Kolkata");
    expect(new Date(micros / 1000).toISOString()).toBe("2026-10-01T18:29:59.999Z");
  });

  it("reads today in the author's timezone", () => {
    expect(todayIn("Asia/Kolkata", new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26");
  });

  it("sends one range as its own default, with a trimmed name", () => {
    const cfg = toPublicLinkConfig(
      { ...publicLinkDefaults(), name: "  NOC  ", ranges: [rel(900)], defaultKey: "r900" },
      { env: "prod" },
      "UTC",
    );
    expect(cfg).toEqual({
      name: "NOC",
      visibility: "public",
      time_range: { ranges: [rel(900)], default: rel(900) },
      frozen_variables: { env: "prod" },
      rebuild_secs: 60,
      expires_at: null,
    });
  });

  it("sends mixed ranges sorted, with the chosen default", () => {
    const value = {
      ...publicLinkDefaults(),
      name: "x",
      ranges: [abs(1, 2), rel(86400), rel(3600)],
      defaultKey: "a1-2",
    };
    expect(toPublicLinkConfig(value, {}, "UTC").time_range).toEqual({
      ranges: [rel(3600), rel(86400), abs(1, 2)],
      default: abs(1, 2),
    });
  });

  it("edits a link with its ranges and default", () => {
    const link = {
      name: "a",
      rebuild_secs: 60,
      expires_at: null,
      time_range: { ranges: [abs(1, 2), rel(900)], default: abs(1, 2) },
    } as unknown as PublicLink;
    const value = publicLinkFormFrom(link, "UTC");
    expect(value.ranges).toEqual([rel(900), abs(1, 2)]);
    expect(value.defaultKey).toBe("a1-2");
  });

  it("round-trips a link's expiry through the edit form", () => {
    const expires_at = endOfDayMicros("2026-12-31", "America/New_York");
    const link = {
      name: "a",
      rebuild_secs: 120,
      expires_at,
      time_range: { ranges: [rel(3600), rel(86400)], default: rel(86400) },
    } as PublicLink;
    const value = publicLinkFormFrom(link, "America/New_York");
    expect(value.expires).toBe("2026-12-31");
    expect(toPublicLinkConfig(value, {}, "America/New_York").expires_at).toBe(expires_at);
  });

  it("sends an unchanged expiry back as stored, whatever the author's timezone", () => {
    const stored = endOfDayMicros("2026-12-31", "America/New_York");
    const shown = expiryDate(stored, "Asia/Kolkata");
    expect(shown).toBe("2027-01-01");
    const value = { ...named(), expires: shown };
    expect(toPublicLinkConfig(value, {}, "Asia/Kolkata", stored).expires_at).toBe(stored);
  });

  it("re-derives the expiry from a changed date, and clears a removed one", () => {
    const stored = endOfDayMicros("2026-12-31", "America/New_York");
    const changed = { ...named(), expires: "2027-01-05" };
    expect(toPublicLinkConfig(changed, {}, "Asia/Kolkata", stored).expires_at).toBe(
      endOfDayMicros("2027-01-05", "Asia/Kolkata"),
    );
    expect(toPublicLinkConfig(named(), {}, "Asia/Kolkata", stored).expires_at).toBeNull();
  });
});
