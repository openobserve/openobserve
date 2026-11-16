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

import { beforeEach, describe, expect, it } from "vitest";
import { raw } from "@/types/i18n";
import {
  ACTIONS_AREA_KEY,
  PAGES_AREA_KEY,
  areaForPath,
  rankDestinations,
  rankObjects,
  readAreaVisits,
  recordAreaVisit,
  type JumpDestination,
  type JumpObjectKind,
} from "./jumpToDestinations";

const dest = (key: string, label: string, area: string, path: string): JumpDestination => ({
  key,
  label: raw(label),
  icon: "home",
  area: raw(area),
  areaKey: area.toLowerCase(),
  to: path,
});

const destinations = [
  dest("home", "Home", "Observability", "/"),
  dest("logs", "Logs", "Observability", "/logs"),
  dest("alerts", "All alerts", "Reliability", "/alerts"),
  dest("destinations", "Destinations", "Reliability", "/alert-destinations"),
  dest("users", "Users", "IAM", "/iam/users"),
  dest("alert-settings", "Alert settings", "Settings", "/settings/alerts"),
];

const PAGES = raw("Pages");
const rank = (list: JumpDestination[], query: string, visits = {}) =>
  rankDestinations(list, query, visits, PAGES);
const labels = (groups: ReturnType<typeof rankDestinations>) =>
  groups.map((g) => [String(g.area), g.items.map((i) => String(i.label))]);

describe("rankDestinations", () => {
  it("keeps rail order for an empty query when nothing has been visited", () => {
    expect(rank(destinations, "").map((g) => g.areaKey)).toEqual([
      "observability",
      "reliability",
      "iam",
      "settings",
    ]);
  });

  it("puts the most-visited areas first for an empty query", () => {
    const order = rank(destinations, "", { iam: 4, reliability: 2 }).map((g) => g.areaKey);
    expect(order).toEqual(["iam", "reliability", "observability", "settings"]);
  });

  it("lists every matching page in one Pages group for a query, ignoring case", () => {
    expect(labels(rank(destinations, "DEST"))).toEqual([["Pages", ["Destinations"]]]);
    expect(labels(rank(destinations, "iam"))).toEqual([["Pages", ["Users"]]]);
    expect(rank(destinations, "dest")[0].areaKey).toBe(PAGES_AREA_KEY);
  });

  it("names a page's rail group beside it, but not the solution's own top-level pages", () => {
    const [pages] = rank(destinations, "l");
    const hints = Object.fromEntries(pages.items.map((i) => [i.key, i.hint && String(i.hint)]));
    expect(hints).toMatchObject({ logs: undefined, alerts: "Reliability" });
    expect(destinations.every((d) => d.hint === undefined)).toBe(true);
  });

  it("ranks a label that starts with the query above one that only contains it", () => {
    expect(labels(rank(destinations, "alert"))).toEqual([
      ["Pages", ["Alert settings", "All alerts"]],
    ]);
  });

  it("ranks a word that starts with the query above a match inside a word", () => {
    const list = [
      dest("datasets", "Datasets", "AI", "/ai/datasets"),
      dest("general", "General settings", "Settings", "/settings/general"),
    ];
    expect(labels(rank(list, "set"))).toEqual([["Pages", ["General settings", "Datasets"]]]);
  });

  it("breaks a tie by the areas this browser visits most", () => {
    const list = [dest("a", "Overview", "Infra", "/infra"), dest("b", "Overview", "AI", "/ai")];
    expect(rank(list, "over", { ai: 3 })[0].items.map((i) => i.key)).toEqual(["b", "a"]);
  });

  it("returns nothing when no label or area matches", () => {
    expect(rank(destinations, "zzz")).toEqual([]);
  });

  it("lists actions only for a query, ahead of pages that match as well", () => {
    const action = {
      ...dest("new-alert", "New alert", "Actions", "/alerts/add"),
      areaKey: ACTIONS_AREA_KEY,
      hint: raw("All alerts"),
    };
    const list = [...destinations, action];
    expect(rank(list, "").map((g) => g.areaKey)).not.toContain(ACTIONS_AREA_KEY);
    expect(rank(list, "new").map((g) => g.areaKey)).toEqual([ACTIONS_AREA_KEY]);
    expect(rank(list, "al")[0].areaKey).toBe(PAGES_AREA_KEY);
    expect(rank(list, "all alerts").map((g) => g.areaKey)).toEqual([
      PAGES_AREA_KEY,
      ACTIONS_AREA_KEY,
    ]);
  });

  it("finds a destination by one of its keywords", () => {
    const list = [
      { ...dest("sources", "Data sources", "Data", "/ingestion"), keywords: ["ingestion"] },
    ];
    expect(labels(rank(list, "ingest"))).toEqual([["Pages", ["Data sources"]]]);
  });

  it("leaves the destinations it ranks untouched", () => {
    const before = JSON.stringify(destinations);
    rank(destinations, "al", { reliability: 1 });
    expect(JSON.stringify(destinations)).toBe(before);
  });
});

describe("rankObjects", () => {
  const object = (key: string, label: string): JumpDestination => ({
    ...dest(key, label, "Alerts", `/alerts/${key}`),
    areaKey: "objects:alerts",
  });
  const kind = (items: JumpDestination[], withShowAll = true): JumpObjectKind => ({
    areaKey: "objects:alerts",
    area: raw("Alerts"),
    items,
    showAll: withShowAll
      ? (matches) => ({ ...object("all", `Show all ${matches.length}`), key: "objects:alerts:all" })
      : undefined,
  });

  it("lists nothing for an empty query", () => {
    expect(rankObjects([kind([object("a", "payments")])], " ", 5)).toEqual([]);
  });

  it("keeps the objects whose name holds the query, best match first, then the Show all row", () => {
    const items = [object("c", "slow_payments"), object("b", "cpu"), object("a", "payments_5xx")];
    const [group] = rankObjects([kind(items)], "pay", 5);
    expect(group.items.map((i) => i.key)).toEqual(["a", "c", "objects:alerts:all"]);
    expect(String(group.items.at(-1)!.label)).toBe("Show all 2");
  });

  it("caps each kind before its Show all row", () => {
    const items = Array.from({ length: 8 }, (_, i) => object(`k${i}`, `pay ${i}`));
    const [group] = rankObjects([kind(items)], "pay", 5);
    expect(group.items).toHaveLength(6);
  });

  it("leaves out a kind with no match, and one without a list page has no Show all row", () => {
    expect(rankObjects([kind([object("a", "cpu")])], "pay", 5)).toEqual([]);
    const [group] = rankObjects([kind([object("a", "pay")], false)], "pay", 5);
    expect(group.items.map((i) => i.key)).toEqual(["a"]);
  });
});

describe("areaForPath", () => {
  const resolve = (to: unknown) => String(to);

  it("finds the area of the destination whose path is the longest prefix", () => {
    expect(areaForPath(destinations, "/iam/users/edit", resolve)).toBe("iam");
    expect(areaForPath(destinations, "/alerts", resolve)).toBe("reliability");
  });

  it("matches Home only on the root path", () => {
    expect(areaForPath(destinations, "/", resolve)).toBe("observability");
    expect(areaForPath(destinations, "/unknown", resolve)).toBeNull();
  });
});

describe("area visits", () => {
  beforeEach(() => window.localStorage.removeItem("o2.jumpTo.areaVisits"));

  it("counts a visit and keeps it for the next session", () => {
    const after = recordAreaVisit(recordAreaVisit({}, "iam"), "iam");
    expect(after).toEqual({ iam: 2 });
    expect(readAreaVisits()).toEqual({ iam: 2 });
  });

  it("reads an empty count when storage holds nothing usable", () => {
    window.localStorage.setItem("o2.jumpTo.areaVisits", "not json");
    expect(readAreaVisits()).toEqual({});
  });
});
