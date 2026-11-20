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
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import {
  HOME_BASE,
  HOME_BASE_GROUPED,
  allClearText,
  cantSeeText,
  homeOrder,
  homeView,
  isHomePriority,
  isHomeRange,
  namesWithMore,
  outcomeOf,
  weekLabel,
} from "./LivePagedModel";

const NOW = Date.UTC(2026, 10, 12, 12);
const DAY_US = 86_400_000_000;

const item = (
  id: string,
  daysAgo: number,
  severity: "P1" | "P2" | "P3" | "P4" = "P2",
  status: "open" | "acknowledged" | "resolved" = "open",
) =>
  ({
    finding: { id: `f-${id}`, first_seen_at: NOW * 1000 - daysAgo * DAY_US },
    incident: { id, severity, status },
  }) as unknown as AutoObserveIncidentItem;

const ids = (rows: { item: AutoObserveIncidentItem }[]) => rows.map((r) => r.item.incident.id);

describe("LivePagedModel", () => {
  it("reads only the ranges and priorities it knows", () => {
    expect(["24h", "7d", "30d"].every(isHomeRange)).toBe(true);
    expect(isHomeRange("90d")).toBe(false);
    expect(isHomePriority("p1")).toBe(true);
    expect(isHomePriority("P1")).toBe(false);
  });

  it("maps status to the row's outcome: only resolved is green", () => {
    expect(outcomeOf("open")).toBe("active");
    expect(outcomeOf("acknowledged")).toBe("contained");
    expect(outcomeOf("resolved")).toBe("resolved");
  });

  it("orders still-happening first, then priority, then newest", () => {
    const rows = [
      item("old-p1-done", 1, "P1", "resolved"),
      item("new-p3", 0.1, "P3"),
      item("old-p1", 2, "P1"),
      item("new-p2", 0.2),
    ].sort(homeOrder);
    expect(rows.map((r) => r.incident.id)).toEqual(["old-p1", "new-p2", "new-p3", "old-p1-done"]);
  });

  it("shows zero, one, a few and many rows with the right Show more count", () => {
    expect(homeView([], "7d", "all", 0, NOW)).toMatchObject({ visible: [], remaining: 0 });
    expect(ids(homeView([item("a", 1)], "7d", "all", 0, NOW).visible)).toEqual(["a"]);
    const many = Array.from({ length: 12 }, (_, i) => item(`i${i}`, i * 0.1));
    const view = homeView(many, "7d", "all", 0, NOW);
    expect(view.visible).toHaveLength(HOME_BASE);
    expect(view.remaining).toBe(12 - HOME_BASE);
    expect(homeView(many, "7d", "all", 10, NOW).remaining).toBe(2);
  });

  it("drops rows outside the range and counts priorities over what is left", () => {
    const rows = [item("a", 0.5, "P1"), item("b", 3), item("c", 10, "P4"), item("d", 40)];
    const day = homeView(rows, "24h", "all", 0, NOW);
    expect(ids(day.visible)).toEqual(["a"]);
    const week = homeView(rows, "7d", "all", 0, NOW);
    expect(week.counts).toEqual({ all: 2, p1: 1, p2: 1, p3: 0, p4: 0 });
    expect(ids(homeView(rows, "30d", "p4", 0, NOW).visible)).toEqual(["c"]);
  });

  it("groups a month by week and heads each week once", () => {
    const rows = [item("a", 1), item("b", 8, "P1"), item("c", 9), item("d", 20)];
    const view = homeView(rows, "30d", "all", 0, NOW);
    expect(view.base).toBe(HOME_BASE_GROUPED);
    expect(view.visible.map((v) => v.group)).toEqual([0, 1, undefined, 2]);
    expect(String(weekLabel(gt, 0))).toBe("This week");
    expect(String(weekLabel(gt, 1))).toBe("Last week");
    expect(String(weekLabel(gt, 3))).toBe("3 weeks ago");
  });

  it("names three gaps then says how many more, in the reader's locale", () => {
    expect(cantSeeText(gt, "en-US", [])).toBeNull();
    expect(String(cantSeeText(gt, "en-US", ["cart"]))).toBe(
      "AutoObserve can't watch 1 service yet: cart.",
    );
    expect(String(namesWithMore(gt, "en-US", ["a", "b"]))).toBe("a and b");
    const many = Array.from({ length: 1204 }, (_, i) => `s${i}`);
    expect(String(cantSeeText(gt, "en-US", many))).toBe(
      "AutoObserve can't watch 1,204 services yet: s0, s1, s2, and 1,201 more.",
    );
  });

  it("says the range it was clear for, and how many services it watched", () => {
    expect(allClearText(gt, "en-US", "24h", 0)).toEqual({
      title: "No problems in the last 24 hours",
      desc: "Nothing needed you.",
    });
    expect(String(allClearText(gt, "en-US", "30d", 1).desc)).toBe(
      "AutoObserve watches 1 service and nothing needed you.",
    );
    expect(String(allClearText(gt, "en-US", "7d", 2400).desc)).toBe(
      "AutoObserve watches 2,400 services and nothing needed you.",
    );
  });
});
