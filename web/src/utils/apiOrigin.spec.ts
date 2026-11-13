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
import { apiOriginOf } from "./apiOrigin";

describe("apiOriginOf", () => {
  it("returns empty string for undefined", () => {
    expect(apiOriginOf(undefined)).toBe("");
  });

  it("returns empty string for an empty base", () => {
    expect(apiOriginOf("")).toBe("");
  });

  it("returns empty string for a bare slash", () => {
    expect(apiOriginOf("/")).toBe("");
  });

  it("strips a trailing slash from an origin", () => {
    expect(apiOriginOf("https://host/")).toBe("https://host");
  });

  it("leaves an origin without a trailing slash unchanged", () => {
    expect(apiOriginOf("https://host")).toBe("https://host");
  });

  it("keeps a path prefix but strips its trailing slash", () => {
    expect(apiOriginOf("https://host/prefix/")).toBe("https://host/prefix");
  });
});
