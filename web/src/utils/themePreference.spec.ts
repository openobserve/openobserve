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

import { afterEach, describe, expect, it } from "vitest";
import { getThemePreference } from "./themePreference";

describe("getThemePreference", () => {
  afterEach(() => localStorage.clear());

  it("follows the OS when nothing was chosen", () => {
    expect(getThemePreference()).toBe("system");
  });

  it("keeps an explicit choice", () => {
    localStorage.setItem("themePreference", "light");
    expect(getThemePreference()).toBe("light");
  });

  it("treats a legacy light as the old default and follows the OS", () => {
    localStorage.setItem("theme", "light");
    expect(getThemePreference()).toBe("system");
  });

  it("keeps a legacy dark, which was a deliberate pick", () => {
    localStorage.setItem("theme", "dark");
    expect(getThemePreference()).toBe("dark");
  });

  it("saves the migrated choice so a later resolved-mode write cannot change it", () => {
    localStorage.setItem("theme", "light");
    getThemePreference();
    localStorage.setItem("theme", "dark");
    expect(getThemePreference()).toBe("system");
  });
});
