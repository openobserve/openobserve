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

import { STALE_AFTER_US, staleSinceUs } from "./usePackHealth";

const NOW = 10 * STALE_AFTER_US;

describe("staleSinceUs", () => {
  it("stays quiet under 30 minutes", () => {
    const rows = [{ name: "a", stats: { doc_time_max: NOW - STALE_AFTER_US + 1 } }];
    expect(staleSinceUs(rows, new Set(["a"]), NOW)).toBeNull();
  });

  it("answers the newest event once every stream is quiet", () => {
    const rows = [
      { name: "a", stats: { doc_time_max: 100 } },
      { name: "b", stats: { doc_time_max: 200 } },
      { name: "other", stats: { doc_time_max: NOW } },
    ];
    expect(staleSinceUs(rows, new Set(["a", "b"]), NOW)).toBe(200);
  });

  it("says nothing without stats", () => {
    expect(staleSinceUs([{ name: "a" }], new Set(["a"]), NOW)).toBeNull();
  });
});
