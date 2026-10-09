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

import {
  addStyle,
  bannerStatus,
  formatSpan,
  formatStamp,
  isHiddenByCritical,
  isShowingNow,
  isUnchangedAt,
  listStatuses,
  parseIndexQuery,
  remainingMs,
  removeBanner,
  removeStyle,
  saveIntent,
  upsertBanner,
} from "./announcementConfig";
import { emptyDraft, type BannerDraft, type IndexedDraft } from "./announcementDrafts";

const NOW = new Date(2026, 7, 12, 12, 0).getTime();

const draft = (overrides: Partial<BannerDraft> = {}): BannerDraft => ({
  ...emptyDraft(),
  message: "m",
  ...overrides,
});

describe("bannerStatus", () => {
  it("reads an unscheduled banner as always on", () => {
    expect(bannerStatus(draft(), NOW)).toBe("always");
  });

  it("reads a banner that ends after a span as live", () => {
    expect(bannerStatus(draft({ end: "after", duration: "1h" }), NOW)).toBe("live");
  });

  it("places a window against the clock", () => {
    const window = (startsAt: string, endsAt: string) =>
      bannerStatus(
        draft({
          start: startsAt ? "at" : "now",
          startsAt,
          end: endsAt ? "at" : "never",
          endsAt,
        }),
        NOW,
      );

    expect(window("2026-08-12T13:00", "2026-08-12T14:00")).toBe("scheduled");
    expect(window("2026-08-12T11:00", "2026-08-12T13:00")).toBe("live");
    expect(window("2026-08-12T10:00", "2026-08-12T11:00")).toBe("ended");
    expect(window("", "2026-08-12T13:00")).toBe("live");
    expect(window("", "2026-08-12T12:00")).toBe("ended");
    expect(window("2026-08-12T12:00", "")).toBe("live");
    expect(window("", "")).toBe("always");
  });

  it("counts live and always-on banners as showing now", () => {
    expect(isShowingNow(draft(), NOW)).toBe(true);
    expect(isShowingNow(draft({ start: "at", startsAt: "2026-08-13T00:00" }), NOW)).toBe(false);
  });
});

describe("upsertBanner", () => {
  const stored = {
    version: 2,
    banners: [
      { message: "first", duration: "1h" },
      { message: "second", variant: "warning" },
    ],
  };

  it("replaces the banner at the index and leaves the others byte-for-byte", () => {
    const next = upsertBanner(stored, 1, draft({ message: "edited", variant: "critical" }));

    expect(next.banners).toEqual([
      { message: "first", duration: "1h" },
      { message: "edited", variant: "critical" },
    ]);
    expect(next.version).toBe(2);
  });

  it("appends a new banner", () => {
    const next = upsertBanner(stored, null, draft({ message: "new" }));

    expect(next.banners).toHaveLength(3);
    expect(next.banners[2]).toEqual({ message: "new" });
  });

  it("appends when the index no longer exists", () => {
    expect(upsertBanner(stored, 9, draft({ message: "late" })).banners).toHaveLength(3);
  });

  it("sends a picked duration as typed", () => {
    const next = upsertBanner({ banners: [] }, null, draft({ end: "after", duration: "30m" }));

    expect(next.banners[0]).toEqual({ message: "m", duration: "30m" });
  });

  it("starts a list when the config has none", () => {
    expect(upsertBanner(null, null, draft())).toEqual({
      banners: [{ message: "m" }],
    });
  });

  it("does not mutate the loaded config", () => {
    upsertBanner(stored, 0, draft({ message: "x" }));

    expect(stored.banners[0]).toEqual({ message: "first", duration: "1h" });
  });
});

describe("removeBanner", () => {
  it("removes only the banner at the index", () => {
    const next = removeBanner({ banners: [{ message: "a" }, { message: "b" }] }, 0);

    expect(next.banners).toEqual([{ message: "b" }]);
  });
});

describe("parseIndexQuery", () => {
  it("reads a non-negative integer", () => {
    expect(parseIndexQuery("3")).toBe(3);
    expect(parseIndexQuery(["0"])).toBe(0);
  });

  it("rejects anything else", () => {
    expect(parseIndexQuery(undefined)).toBeNull();
    expect(parseIndexQuery("-1")).toBeNull();
    expect(parseIndexQuery("1.5")).toBeNull();
    expect(parseIndexQuery("abc")).toBeNull();
  });
});

describe("listStatuses", () => {
  const entry = (index: number, overrides: Partial<BannerDraft>): IndexedDraft => ({
    index,
    draft: draft(overrides),
    raw: {},
  });

  it("marks a live promo hidden while a critical banner is showing", () => {
    const statuses = listStatuses(
      [entry(0, { variant: "critical" }), entry(1, { variant: "promo" })],
      NOW,
    );

    expect(statuses.get(0)).toBe("always");
    expect(statuses.get(1)).toBe("hidden");
  });

  it("leaves a promo alone when the critical banner is not live", () => {
    const statuses = listStatuses(
      [
        entry(0, {
          variant: "critical",
          end: "at",
          endsAt: "2026-08-12T11:00",
        }),
        entry(1, { variant: "promo" }),
      ],
      NOW,
    );

    expect(statuses.get(0)).toBe("ended");
    expect(statuses.get(1)).toBe("always");
  });

  it("does not hide a scheduled promo", () => {
    const statuses = listStatuses(
      [
        entry(0, { variant: "critical" }),
        entry(1, {
          variant: "promo",
          start: "at",
          startsAt: "2026-08-13T00:00",
        }),
      ],
      NOW,
    );

    expect(statuses.get(1)).toBe("scheduled");
  });
});

describe("remainingMs and formatSpan", () => {
  it("measures the time left on a live window", () => {
    const live = draft({ end: "at", endsAt: "2026-08-12T14:00" });

    expect(remainingMs(live, NOW)).toBe(2 * 3_600_000);
    expect(remainingMs(draft(), NOW)).toBeNull();
    expect(remainingMs(draft({ start: "at", startsAt: "2026-08-13T00:00" }), NOW)).toBeNull();
  });

  it("formats spans compactly", () => {
    expect(formatSpan(30_000)).toBe("1m");
    expect(formatSpan(45 * 60_000)).toBe("45m");
    expect(formatSpan(3_600_000 - 1)).toBe("1h");
    expect(formatSpan(23 * 3_600_000)).toBe("23h");
    expect(formatSpan(3 * 86_400_000)).toBe("3d");
  });
});

describe("formatStamp", () => {
  it("is short, and carries the zone only when asked", () => {
    const plain = formatStamp("2026-08-12T09:05");

    expect(plain).toMatch(/09:05/);
    expect(formatStamp("2026-08-12T09:05", true).length).toBeGreaterThan(plain.length);
    expect(formatStamp("nope")).toBe("");
  });
});

describe("saveIntent", () => {
  it("publishes what will show on save", () => {
    expect(saveIntent(draft(), NOW)).toBe("publish");
    expect(saveIntent(draft({ end: "after", duration: "2h" }), NOW)).toBe("publish");
  });

  it("schedules a future start and only stores an ended window", () => {
    expect(saveIntent(draft({ start: "at", startsAt: "2026-08-13T00:00" }), NOW)).toBe("schedule");
    expect(saveIntent(draft({ end: "at", endsAt: "2026-08-12T11:00" }), NOW)).toBe("save");
  });
});

describe("isUnchangedAt", () => {
  const latest = { banners: [{ message: "a", orgs: ["x"] }, { message: "b" }] };

  it("accepts a structurally equal entry", () => {
    expect(isUnchangedAt(latest, 0, { message: "a", orgs: ["x"] })).toBe(true);
  });

  it("rejects an entry that changed or no longer exists", () => {
    expect(isUnchangedAt(latest, 1, { message: "b", variant: "warning" })).toBe(false);
    expect(isUnchangedAt(latest, 2, { message: "c" })).toBe(false);
  });
});

describe("isHiddenByCritical", () => {
  const NOW_MS = Date.now();
  const critical = (orgs: string[]) => ({
    ...emptyDraft(),
    variant: "critical" as const,
    orgs,
  });
  const promo = (orgs: string[]) => ({
    ...emptyDraft(),
    variant: "promo" as const,
    orgs,
  });

  it("hides a promotion only where a live critical banner also shows", () => {
    expect(isHiddenByCritical(promo([]), [critical([])], NOW_MS)).toBe(true);
    expect(isHiddenByCritical(promo(["a"]), [critical(["a", "b"])], NOW_MS)).toBe(true);
    expect(isHiddenByCritical(promo(["a", "c"]), [critical(["a"])], NOW_MS)).toBe(false);
    expect(isHiddenByCritical(promo([]), [critical(["a"])], NOW_MS)).toBe(false);
  });
});

describe("saved styles", () => {
  const style = {
    id: "s1",
    name: "Release",
    icon: "rocket-launch",
    textSize: "large" as const,
    colorLight: "",
    colorDark: "",
  };

  it("adds and removes a style, leaving banners and other keys alone", () => {
    const source = { banners: [{ message: "m" }], future: 1 };
    const added = addStyle(source, style);

    expect(added).toEqual({
      banners: [{ message: "m" }],
      future: 1,
      styles: [
        {
          id: "s1",
          name: "Release",
          icon: "rocket-launch",
          text_size: "large",
        },
      ],
    });
    expect(removeStyle(added, "s1")).toEqual({
      banners: [{ message: "m" }],
      future: 1,
      styles: [],
    });
  });
});
