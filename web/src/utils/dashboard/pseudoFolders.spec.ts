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
import { FAVORITES_FOLDER_ID } from "@/composables/useFavoriteDashboards";
import { PUBLIC_LINKS_FOLDER_ID, isPseudoFolder } from "./pseudoFolders";

describe("isPseudoFolder", () => {
  it("is true for the Favorites and Public dashboards entries", () => {
    expect(isPseudoFolder(FAVORITES_FOLDER_ID)).toBe(true);
    expect(isPseudoFolder(PUBLIC_LINKS_FOLDER_ID)).toBe(true);
  });

  it("is false for real folders, the default folder included", () => {
    expect(isPseudoFolder("default")).toBe(false);
    expect(isPseudoFolder("7f3a9c")).toBe(false);
    expect(isPseudoFolder("")).toBe(false);
  });
});
