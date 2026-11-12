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
  TIME_RANGE_CHIPS,
  TIME_RANGE_CHIP_SETS,
  formatLimitShorthand,
  orderCalendarItems,
  scrollCue,
  composeTimeRangeList,
  filterTimeRangeList,
  matchWordPrefixes,
  rangeLimitReason,
  retentionFloorMicros,
  splitLabelMatches,
  stepListCursor,
  visibleRecentEntries,
  isOfferedElsewhere,
  type TimeRangeListRow,
} from "./timeRangeList";

const DAY_US = 86_400_000_000;
const HOUR_US = 3_600_000_000;
const NOW_MS = Date.UTC(2026, 10, 11, 7, 12);
const NOW_US = NOW_MS * 1000;
const TEXT = { retention: "Outside 7-day retention", restriction: "Max 24 hours" };

const row = (id: string, label: string, disabled = false): TimeRangeListRow => ({
  id,
  kind: "calendar",
  label,
  meta: "",
  disabled,
  testId: `date-time-list-calendar-${id}`,
});

describe("retention and query-range limits", () => {
  it("floors retention at whole days back from now, and applies none when unknown", () => {
    expect(retentionFloorMicros(7, NOW_MS)).toBe(NOW_US - 7 * DAY_US);
    expect(retentionFloorMicros(0, NOW_MS)).toBeNull();
    expect(retentionFloorMicros(undefined, NOW_MS)).toBeNull();
  });

  it("greys a range wholly outside retention, and keeps one that only partly overlaps", () => {
    const limits = { retentionFloorUs: NOW_US - 7 * DAY_US, maxHours: 0 };
    const old = rangeLimitReason(NOW_US - 30 * DAY_US, NOW_US - 8 * DAY_US, limits, TEXT);
    const partial = rangeLimitReason(NOW_US - 30 * DAY_US, NOW_US, limits, TEXT);
    expect(old).toBe(TEXT.retention);
    expect(partial).toBeNull();
  });

  it("greys a range longer than the page's limit with the restriction message", () => {
    const limits = { retentionFloorUs: null, maxHours: 24 };
    expect(rangeLimitReason(NOW_US - 30 * DAY_US, NOW_US, limits, TEXT)).toBe(TEXT.restriction);
    expect(rangeLimitReason(NOW_US - 24 * HOUR_US, NOW_US, limits, TEXT)).toBeNull();
  });

  it("greys nothing while retention is unknown and there is no limit", () => {
    const limits = { retentionFloorUs: null, maxHours: 0 };
    expect(rangeLimitReason(0, NOW_US, limits, TEXT)).toBeNull();
  });
});

describe("list composition", () => {
  const options = {
    pinned: [{ startUs: 1, endUs: 2 }],
    chips: TIME_RANGE_CHIPS,
    calendarTokens: ["calendar:day:0", "calendar:day:-1"],
    applied: { relative: "6h" },
  };

  it("drops recent entries that are pinned, applied, a chip or a calendar row", () => {
    const recent = [
      { relative: "15m" },
      { relative: "6h" },
      { relative: "calendar:day:-1" },
      { startUs: 1, endUs: 2 },
      { relative: "2h" },
      { startUs: 5, endUs: 9 },
    ];
    expect(visibleRecentEntries(recent, options)).toEqual([
      { relative: "2h" },
      { startUs: 5, endUs: 9 },
    ]);
  });

  it("treats pins, chips and calendar rows as offered elsewhere, and nothing else", () => {
    expect(isOfferedElsewhere({ startUs: 1, endUs: 2 }, options)).toBe(true);
    expect(isOfferedElsewhere({ relative: "1h" }, options)).toBe(true);
    expect(isOfferedElsewhere({ relative: "calendar:day:0" }, options)).toBe(true);
    expect(isOfferedElsewhere({ relative: "6h" }, options)).toBe(false);
    expect(isOfferedElsewhere({ startUs: 1, endUs: 3 }, options)).toBe(false);
  });

  it("joins non-empty groups in order and numbers them for dividers", () => {
    const list = composeTimeRangeList([[row("a", "A")], [], [row("b", "B"), row("c", "C")]]);
    expect(list.map((item) => [item.id, item.group])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 1],
    ]);
  });

  it("starts at the calendar rows on first use, with no empty groups", () => {
    const list = composeTimeRangeList([[], [], [row("today", "Today")]]);
    expect(list).toHaveLength(1);
    expect(list[0].group).toBe(0);
  });
});

describe("filtering by word prefix", () => {
  it("matches every typed word against the start of a label word, in order", () => {
    expect(matchWordPrefixes("Yesterday", "yest")).toEqual([[0, 4]]);
    expect(matchWordPrefixes("Previous week", "prev w")).toEqual([
      [0, 4],
      [9, 10],
    ]);
    expect(matchWordPrefixes("Previous week", "week prev")).toBeNull();
    expect(matchWordPrefixes("Yesterday", "day")).toBeNull();
  });

  it("keeps matching rows with what matched, and bolds only that", () => {
    const rows = [row("y", "Yesterday"), row("t", "Today"), row("lw", "Previous week")];
    const kept = filterTimeRangeList(rows, "yesterday 9-17");
    expect(kept.map((item) => item.id)).toEqual(["y"]);
    expect(filterTimeRangeList(rows, "3")).toEqual([]);
    const yesterday = filterTimeRangeList(rows, "yes");
    expect(yesterday.map((item) => item.id)).toEqual(["y"]);
    expect(splitLabelMatches(yesterday[0].label, yesterday[0].match)).toEqual([
      { text: "Yes", matched: true },
      { text: "terday", matched: false },
    ]);
  });
});

describe("filtering by what the text reads as", () => {
  it("keeps the calendar row a snap expression resolves to", () => {
    const rows = [
      { ...row("y", "Yesterday"), period: "calendar:day:-1" },
      { ...row("t", "Today"), period: "calendar:day:0" },
    ];
    const kept = filterTimeRangeList(rows, "now-1d/d", "calendar:day:-1");
    expect(kept.map((item) => item.id)).toEqual(["y"]);
    expect(splitLabelMatches(kept[0].label, kept[0].match)).toEqual([
      { text: "Yesterday", matched: false },
    ]);
  });
});

describe("list cursor", () => {
  it("skips greyed rows and wraps", () => {
    const rows = [{ disabled: false }, { disabled: true }, { disabled: false }];
    expect(stepListCursor(rows, 0, 1)).toBe(2);
    expect(stepListCursor(rows, 2, 1)).toBe(0);
    expect(stepListCursor(rows, 0, -1)).toBe(2);
    expect(stepListCursor([{ disabled: true }], 0, 1)).toBe(-1);
  });
});

describe("presets", () => {
  it("leads dashboards with long chips that store whole months", () => {
    expect(TIME_RANGE_CHIP_SETS.ops.map((chip) => chip.value)).toEqual([...TIME_RANGE_CHIPS]);
    expect(TIME_RANGE_CHIP_SETS.dashboard).toEqual([
      { value: "24h", label: "24h" },
      { value: "7d", label: "7d" },
      { value: "30d", label: "30d" },
      { value: "90d", label: "90d" },
      { value: "6M", label: "6mo" },
      { value: "12M", label: "1y" },
    ]);
  });

  it("orders calendar rows by unit per preset, keeping each unit's own order", () => {
    const items = ["day:0", "day:-1", "week:0", "month:0", "quarter:0", "quarter:-1", "year:0"].map(
      (token) => ({ token: `calendar:${token}` }),
    );
    expect(orderCalendarItems(items, "dashboard").map((item) => item.token)).toEqual([
      "calendar:quarter:0",
      "calendar:quarter:-1",
      "calendar:month:0",
      "calendar:year:0",
      "calendar:week:0",
      "calendar:day:0",
      "calendar:day:-1",
    ]);
    expect(orderCalendarItems(items, "ops")).toEqual(items);
  });
});

describe("limit shorthand and scroll cue", () => {
  it("writes a page limit in its largest whole unit", () => {
    expect(formatLimitShorthand(168)).toBe("7d");
    expect(formatLimitShorthand(36)).toBe("36h");
    expect(formatLimitShorthand(12)).toBe("12h");
  });

  it("says which edges of the list hide rows", () => {
    expect(scrollCue({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBeNull();
    expect(scrollCue({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 })).toBe("bottom");
    expect(scrollCue({ scrollTop: 100, scrollHeight: 300, clientHeight: 100 })).toBe("both");
    expect(scrollCue({ scrollTop: 200, scrollHeight: 300, clientHeight: 100 })).toBe("top");
  });
});
