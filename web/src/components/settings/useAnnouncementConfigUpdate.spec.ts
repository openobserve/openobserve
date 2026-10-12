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

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

import { sameAuthored } from "./useAnnouncementConfigUpdate";

describe("sameAuthored", () => {
  it("matches an identical banner and rejects a changed one", () => {
    expect(sameAuthored({ message: "m" }, { message: "m" })).toBe(true);
    expect(sameAuthored({ message: "n" }, { message: "m" })).toBe(false);
    expect(sameAuthored(undefined, undefined)).toBe(false);
  });

  it("treats a duration the server pinned to ends_at as unchanged", () => {
    const original = { message: "m", duration: "4h" };
    const pinned = { message: "m", ends_at: iso(Date.now() + 3 * HOUR) };

    expect(sameAuthored(pinned, original)).toBe(true);
    expect(sameAuthored({ ...pinned, message: "edited" }, original)).toBe(false);
  });

  it("does not take someone else's end for a pin", () => {
    const original = { message: "m", duration: "4h" };
    expect(sameAuthored({ message: "m", ends_at: iso(Date.now() + 9 * HOUR) }, original)).toBe(
      false,
    );

    const start = Date.parse("2030-01-01T00:00:00Z");
    const scheduled = { message: "m", starts_at: iso(start), duration: "4h" };
    const pinnedEnd = { message: "m", starts_at: iso(start), ends_at: iso(start + 4 * HOUR) };
    const otherEnd = { message: "m", starts_at: iso(start), ends_at: iso(start + 2 * HOUR) };
    expect(sameAuthored(pinnedEnd, scheduled)).toBe(true);
    expect(sameAuthored(otherEnd, scheduled)).toBe(false);
  });
});
