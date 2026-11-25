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
  buildDocumentTitle,
  buildSections,
  rankSearch,
  type SwitcherOrg,
  type SwitcherRow,
} from "@/utils/orgSwitcherList";

const org = (identifier: string, label = identifier): SwitcherOrg => ({ identifier, label });

const MANY = [
  org("zeta", "Zeta"),
  org("acme", "Acme"),
  org("billing", "Billing"),
  org("delta", "Delta"),
  org("echo", "Echo"),
  org("foxtrot", "Foxtrot"),
  org("golf", "Golf"),
];

const ids = (rows: SwitcherRow[]) =>
  rows.map((r) => (r.kind === "heading" ? `#${r.section}` : r.org.identifier));

const none = { favorites: [], recents: [] };

describe("buildSections", () => {
  it("B1 orders Favorites > Recent > All, each org once, All A-Z with identifier tie-break", () => {
    const orgs = [...MANY, org("acme3", "Acme"), org("acme2", "Acme")];
    const rows = buildSections(
      orgs,
      { favorites: ["golf", "acme"], recents: ["acme", "delta", "golf"] },
      "zeta",
    );
    expect(ids(rows)).toEqual([
      "#favorites",
      "golf",
      "acme",
      "#recent",
      "delta",
      "#all",
      "acme2",
      "acme3",
      "billing",
      "echo",
      "foxtrot",
      "zeta",
    ]);
    const orgIds = ids(rows).filter((id) => !id.startsWith("#"));
    expect(new Set(orgIds).size).toBe(orgIds.length);
  });

  it("B2 Recent shows 3 newest first, without the current org or favorites", () => {
    const rows = buildSections(
      MANY,
      { favorites: ["echo"], recents: ["zeta", "echo", "golf", "acme", "delta", "billing"] },
      "zeta",
    );
    const recent = rows.filter((r) => r.kind === "row" && r.section === "recent");
    expect(recent.map((r) => (r.kind === "row" ? r.org.identifier : ""))).toEqual([
      "golf",
      "acme",
      "delta",
    ]);
  });

  it("B3 shows headings only for non-empty sections and none on day one", () => {
    const onlyRecent = buildSections(MANY, { favorites: [], recents: ["acme"] }, "zeta");
    expect(ids(onlyRecent).filter((id) => id.startsWith("#"))).toEqual(["#recent", "#all"]);

    const dayOne = buildSections(MANY, none, "zeta");
    expect(dayOne.every((r) => r.kind === "row")).toBe(true);
    expect(ids(dayOne)).toEqual(["acme", "billing", "delta", "echo", "foxtrot", "golf", "zeta"]);
  });

  it("B4 renders 5 orgs or fewer flat with favorites first, and 1 org as one row", () => {
    const five = MANY.slice(0, 5);
    const rows = buildSections(five, { favorites: ["delta"], recents: ["echo"] }, "zeta");
    expect(rows.every((r) => r.kind === "row" && r.section === "flat")).toBe(true);
    expect(ids(rows)).toEqual(["delta", "acme", "billing", "echo", "zeta"]);

    expect(ids(buildSections([org("solo")], { favorites: ["solo"], recents: [] }, "solo"))).toEqual(
      ["solo"],
    );
  });

  it("B5 does not render stale favorite or recent ids", () => {
    const rows = buildSections(MANY, { favorites: ["gone"], recents: ["lost", "acme"] }, "zeta");
    expect(ids(rows)).not.toContain("gone");
    expect(ids(rows)).not.toContain("lost");
    expect(ids(rows).slice(0, 2)).toEqual(["#recent", "acme"]);
  });

  it("caps Favorites at 10", () => {
    const orgs = Array.from({ length: 12 }, (_, i) => org(`o${String(i).padStart(2, "0")}`));
    const favorites = orgs.map((o) => o.identifier);
    const rows = buildSections(orgs, { favorites, recents: [] }, undefined);
    expect(rows.filter((r) => r.kind === "row" && r.section === "favorites")).toHaveLength(10);
  });
});

describe("rankSearch", () => {
  const orgs = [
    org("bill", "Accounts"),
    org("billing", "Billing"),
    org("acme_bill", "Acme billing"),
    org("bill_eu", "Bill"),
    org("xbill", "Xbill"),
    org("other", "Other"),
  ];

  it("B6 ranks exact id > exact name > prefix > substring with no headings", () => {
    const rows = rankSearch(orgs, none, " BILL ");
    expect(rows.every((r) => r.kind === "row" && r.section === "search")).toBe(true);
    expect(ids(rows)).toEqual(["bill", "bill_eu", "billing", "acme_bill", "xbill"]);
  });

  it("B6 breaks ties by favorites (added order), then recents (newest), then A-Z", () => {
    const tied = [org("ab1", "Ab one"), org("ab2", "Ab two"), org("ab3", "Ab three"), org("ab4")];
    const rows = rankSearch(tied, { favorites: ["ab3", "ab2"], recents: ["ab4"] }, "ab");
    expect(ids(rows)).toEqual(["ab3", "ab2", "ab4", "ab1"]);
  });

  it("matches the identifier as well as the label", () => {
    expect(ids(rankSearch(orgs, none, "_eu"))).toEqual(["bill_eu"]);
  });
});

describe("buildDocumentTitle", () => {
  it("B7 leads with the org, then the page", () => {
    expect(buildDocumentTitle("Acme", "Logs")).toBe("Acme · Logs · OpenObserve");
  });

  it("B7 uses the org alone when the page has no name", () => {
    expect(buildDocumentTitle("Acme", undefined)).toBe("Acme · OpenObserve");
  });

  it("B7 keeps today's title without an org", () => {
    expect(buildDocumentTitle(undefined, "Logs")).toBe("OpenObserve - Logs");
    expect(buildDocumentTitle(undefined, undefined)).toBe("OpenObserve");
  });
});
