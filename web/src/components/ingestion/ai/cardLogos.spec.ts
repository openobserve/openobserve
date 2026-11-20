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

import { describe, expect, it, vi } from "vitest";

const getAICardLogos = vi.fn((slug: string) =>
  slug === "acme" ? { logo: "/acme.svg", logoDark: "/acme-dark.svg" } : {},
);

vi.mock("./content/manifest", () => ({
  manifestIntegrations: [{ slug: "acme", name: "Acme", category: "frameworks", order: 1 }],
  manifestCategories: [],
}));
vi.mock("./content", () => ({
  getAICardLogos: (slug: string) => getAICardLogos(slug),
  resolveAICardLogo: () => "",
}));

const card = (categories: { integrations: { slug: string; logo?: string }[] }[]) =>
  categories.flatMap((c) => c.integrations).find((i) => i.slug === "acme");

describe("aiCategoriesWithLogos", () => {
  it("leaves card markdown out of the catalog the router reads", async () => {
    const { aiCategories } = await import("./data");

    expect(getAICardLogos).not.toHaveBeenCalled();
    expect(card(aiCategories)?.logo).toBeUndefined();
  });

  it("gives a content card the logo its markdown names", async () => {
    const { aiCategoriesWithLogos } = await import("./cardLogos");

    expect(card(aiCategoriesWithLogos)).toMatchObject({
      logo: "/acme.svg",
      logoDark: "/acme-dark.svg",
    });
  });
});
