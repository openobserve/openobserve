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
import worldMap from "@/assets/dashboard/maps/map.json";
import { COUNTRY_ALIASES, countries, resolveCountryName } from "./countryMappings";

describe("resolveCountryName", () => {
  it("resolves ISO codes and map names in any case", () => {
    expect(resolveCountryName("US")).toBe("United States");
    expect(resolveCountryName("us")).toBe("United States");
    expect(resolveCountryName("usa")).toBe("United States");
    expect(resolveCountryName(" united states ")).toBe("United States");
    expect(resolveCountryName("CZECH REP.")).toBe("Czech Rep.");
  });

  it("resolves common full names to the abbreviated map names", () => {
    expect(resolveCountryName("South Korea")).toBe("Korea");
    expect(resolveCountryName("Czech Republic")).toBe("Czech Rep.");
    expect(resolveCountryName("Czechia")).toBe("Czech Rep.");
    expect(resolveCountryName("Bosnia and Herzegovina")).toBe("Bosnia and Herz.");
    expect(resolveCountryName("Russian Federation")).toBe("Russia");
    expect(resolveCountryName("UK")).toBe("United Kingdom");
  });

  it("returns null for values that name no country", () => {
    expect(resolveCountryName("us-east-1")).toBeNull();
    expect(resolveCountryName("")).toBeNull();
    expect(resolveCountryName(null)).toBeNull();
    expect(resolveCountryName(undefined)).toBeNull();
  });

  it("only ever returns region names that exist on the world map", () => {
    const mapNames = new Set(
      (worldMap as any).features.map((feature: any) => feature.properties.name),
    );
    for (const country of countries) expect(mapNames.has(country.name)).toBe(true);
    for (const name of Object.values(COUNTRY_ALIASES)) expect(mapNames.has(name)).toBe(true);
  });
});
