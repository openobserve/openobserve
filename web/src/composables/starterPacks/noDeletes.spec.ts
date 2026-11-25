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

const sources = import.meta.glob<string>(
  ["./*.ts", "!./*.spec.ts", "../../components/starterPacks/*.{ts,vue}", "!../../**/*.spec.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("starter packs delete nothing a pack made", () => {
  it("calls no delete of an alert, dashboard, folder or saved view", () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => /\bdelete(Alert|Dashboard|Folder|SavedView)/.test(source))
      .map(([path]) => path);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
