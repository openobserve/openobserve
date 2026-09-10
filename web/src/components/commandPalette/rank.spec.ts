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
import { fold, rankItems, scoreItem } from "./rank";
import { matchAliases } from "./aliases";
import type { PaletteItem } from "./types";

const item = (id: string, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  type: "page",
  label,
  icon: "search",
  ...extra,
});

const ITEMS: PaletteItem[] = [
  item("page:logs", "Logs"),
  item("page:logstreams", "Streams", { subtitle: "Data" }),
  item("page:dashboards", "Dashboards"),
  item("page:alertList", "All Alerts", {
    subtitle: "Reliability · Alerts",
    keywords: ["alertList"],
  }),
  item("page:iam", "IAM", { keywords: ["roles", "users"] }),
  item("action:toggleTheme", "Switch to dark mode", { type: "action" }),
];

describe("fold", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(fold("  Métricas   Über ")).toBe("metricas uber");
  });
});

describe("matchAliases", () => {
  it("fires on prefix once the minimum length is typed", () => {
    expect(matchAliases("sq").has("page:logs")).toBe(false);
    expect(matchAliases("sql").has("page:logs")).toBe(true);
    expect(matchAliases("prom").has("page:metrics")).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(matchAliases("").size).toBe(0);
  });
});

describe("scoreItem", () => {
  it("orders alias > exact > prefix > word start > substring > keyword", () => {
    const q = "al";
    const exact = scoreItem(item("x", "Al"), q);
    const prefix = scoreItem(item("x", "Alerts"), q);
    const word = scoreItem(item("x", "All Alerts"), "alerts");
    const sub = scoreItem(item("x", "Total"), q);
    const kw = scoreItem(item("x", "IAM", { keywords: ["alias"] }), q);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(kw);
    expect(scoreItem(item("page:logs", "Logs"), "sql")).toBeGreaterThan(exact);
  });

  it("ranks an exact id keyword above every label substring", () => {
    const dash = item("dashboard:default/7Ab", "Payments", {
      type: "dashboard",
      keywords: ["7Ab9xQ"],
    });
    const decoy = item("page:x", "7ab9xq report");
    expect(rankItems([decoy, dash], "7Ab9xQ").map((i) => i.id)).toEqual([
      "dashboard:default/7Ab",
      "page:x",
    ]);
    expect(rankItems([dash], "7ab9").map((i) => i.id)).toEqual(["dashboard:default/7Ab"]);
  });

  it("returns 0 for a non-match and caps the frecency boost", () => {
    expect(scoreItem(item("x", "Logs"), "zzz")).toBe(0);
    const frecency = new Map([["x", 40]]);
    expect(scoreItem(item("x", "Logs"), "logs", { frecency })).toBe(80 + 30 + 3);
  });
});

describe("rankItems", () => {
  it("returns nothing for an empty query", () => {
    expect(rankItems(ITEMS, "   ")).toEqual([]);
  });

  it("ranks by score then label, and matches subtitles and keywords", () => {
    const ids = rankItems(ITEMS, "al").map((i) => i.id);
    expect(ids[0]).toBe("page:alertList");
    expect(rankItems(ITEMS, "data").map((i) => i.id)).toEqual(["page:logstreams"]);
    expect(rankItems(ITEMS, "roles").map((i) => i.id)).toEqual(["page:iam"]);
  });

  it("lets frecency reorder equal matches", () => {
    const two = [item("a", "Alpha"), item("b", "Alpine")];
    expect(rankItems(two, "al").map((i) => i.id)).toEqual(["a", "b"]);
    expect(rankItems(two, "al", { frecency: new Map([["b", 1]]) }).map((i) => i.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("dedupes ids and honours the limit", () => {
    const dupes = [item("a", "Alpha"), item("a", "Alpha"), item("b", "Alps"), item("c", "Alto")];
    expect(rankItems(dupes, "al", { limit: 2 })).toHaveLength(2);
    expect(rankItems(dupes, "al").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("resolves aliases to the target row", () => {
    expect(rankItems(ITEMS, "dark")[0].id).toBe("action:toggleTheme");
    expect(rankItems(ITEMS, "sql")[0].id).toBe("page:logs");
  });
});
