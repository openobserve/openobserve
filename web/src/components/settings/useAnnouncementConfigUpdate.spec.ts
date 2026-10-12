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

import { sameAuthored } from "./useAnnouncementConfigUpdate";

describe("sameAuthored", () => {
  it("matches an identical banner and rejects a changed one", () => {
    expect(sameAuthored({ message: "m" }, { message: "m" })).toBe(true);
    expect(sameAuthored({ message: "n" }, { message: "m" })).toBe(false);
    expect(sameAuthored(undefined, undefined)).toBe(false);
  });

  it("treats a duration the server pinned to ends_at as unchanged", () => {
    const original = { message: "m", duration: "4h" };
    const pinned = { message: "m", ends_at: "2026-10-12T16:00:00+00:00" };

    expect(sameAuthored(pinned, original)).toBe(true);
    expect(sameAuthored({ ...pinned, message: "edited" }, original)).toBe(false);
  });
});
