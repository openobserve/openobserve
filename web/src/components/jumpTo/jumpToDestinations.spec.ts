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
  areaForPath,
  rankDestinations,
  readAreaVisits,
  recordAreaVisit,
  type JumpDestination,
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

const labels = (groups: ReturnType<typeof rankDestinations>) =>
  groups.map((g) => [String(g.area), g.items.map((i) => String(i.label))]);

describe("rankDestinations", () => {
  it("keeps rail order for an empty query when nothing has been visited", () => {
    expect(rankDestinations(destinations, "", {}).map((g) => g.areaKey)).toEqual([
      "observability",
      "reliability",
      "iam",
      "settings",
    ]);
  });

  it("puts the most-visited areas first for an empty query", () => {
    const order = rankDestinations(destinations, "", { iam: 4, reliability: 2 }).map(
      (g) => g.areaKey,
    );
    expect(order).toEqual(["iam", "reliability", "observability", "settings"]);
  });

  it("matches a substring of the label or the area, ignoring case", () => {
    expect(labels(rankDestinations(destinations, "DEST", {}))).toEqual([
      ["Reliability", ["Destinations"]],
    ]);
    expect(labels(rankDestinations(destinations, "iam", {}))).toEqual([["IAM", ["Users"]]]);
  });

  it("ranks a label that starts with the query above one that only contains it", () => {
    expect(labels(rankDestinations(destinations, "alert", {}))).toEqual([
      ["Settings", ["Alert settings"]],
      ["Reliability", ["All alerts"]],
    ]);
  });

  it("ranks a word that starts with the query above a match inside a word", () => {
    const list = [
      dest("datasets", "Datasets", "AI", "/ai/datasets"),
      dest("general", "General settings", "Settings", "/settings/general"),
    ];
    expect(labels(rankDestinations(list, "set", {}))).toEqual([
      ["Settings", ["General settings"]],
      ["AI", ["Datasets"]],
    ]);
  });

  it("returns nothing when no label or area matches", () => {
    expect(rankDestinations(destinations, "zzz", {})).toEqual([]);
  });

  it("lists actions only for a query, ahead of pages that match as well", () => {
    const action = {
      ...dest("new-alert", "New alert", "Actions", "/alerts/add"),
      areaKey: ACTIONS_AREA_KEY,
      hint: raw("All alerts"),
    };
    const list = [...destinations, action];
    expect(rankDestinations(list, "", {}).map((g) => g.areaKey)).not.toContain(ACTIONS_AREA_KEY);
    expect(rankDestinations(list, "new", {}).map((g) => g.areaKey)).toEqual([ACTIONS_AREA_KEY]);
    expect(rankDestinations(list, "al", {})[0].areaKey).toBe("reliability");
    expect(rankDestinations(list, "all alerts", {}).map((g) => g.areaKey)).toEqual([
      "reliability",
      ACTIONS_AREA_KEY,
    ]);
  });

  it("finds a destination by one of its keywords", () => {
    const list = [
      { ...dest("sources", "Data sources", "Data", "/ingestion"), keywords: ["ingestion"] },
    ];
    expect(labels(rankDestinations(list, "ingest", {}))).toEqual([["Data", ["Data sources"]]]);
  });

  it("leaves the destinations it ranks untouched", () => {
    const before = JSON.stringify(destinations);
    rankDestinations(destinations, "al", { reliability: 1 });
    expect(JSON.stringify(destinations)).toBe(before);
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
