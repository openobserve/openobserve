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

import { bannerRank, orderBanners } from "./announcementOrder";

const named = (variant: string, message: string) => ({ variant, message });

describe("announcementOrder", () => {
  it("ranks severities the way the server does", () => {
    expect(bannerRank("critical")).toBeGreaterThan(bannerRank("warning"));
    expect(bannerRank("warning")).toBeGreaterThan(bannerRank("info"));
    expect(bannerRank("info")).toBeGreaterThan(bannerRank("promo"));
  });

  it("treats an unknown variant as the default rather than dropping it", () => {
    // A banner authored against a newer schema still has to be seen.
    expect(bannerRank("whatever-comes-next")).toBe(bannerRank("info"));
    expect(orderBanners([named("whatever-comes-next", "keep me")])).toHaveLength(1);
  });

  it("sorts most severe first, whatever order they arrived in", () => {
    const ordered = orderBanners([
      named("promo", "promo"),
      named("info", "info"),
      named("warning", "warning"),
    ]);

    expect(ordered.map((b) => b.message)).toEqual(["warning", "info", "promo"]);
  });

  it("keeps equal severities in the order they came in", () => {
    // The live bar relies on this: the server already broke ties by starts_at.
    const ordered = orderBanners([
      named("warning", "first"),
      named("warning", "second"),
      named("warning", "third"),
    ]);

    expect(ordered.map((b) => b.message)).toEqual(["first", "second", "third"]);
  });

  it("hides promos while a critical banner is up", () => {
    const ordered = orderBanners([
      named("promo", "webinar"),
      named("critical", "outage"),
      named("info", "notice"),
    ]);

    expect(ordered.map((b) => b.message)).toEqual(["outage", "notice"]);
  });

  it("shows promos again once the critical is gone", () => {
    const ordered = orderBanners([named("promo", "webinar"), named("info", "notice")]);

    expect(ordered.map((b) => b.message)).toEqual(["notice", "webinar"]);
  });

  it("does not mutate its input", () => {
    const input = [named("promo", "a"), named("critical", "b")];

    orderBanners(input);

    expect(input.map((b) => b.message)).toEqual(["a", "b"]);
  });
});
