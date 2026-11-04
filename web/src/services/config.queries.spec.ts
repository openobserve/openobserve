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
import { isFullConfigLoaded } from "./config.queries";

describe("isFullConfigLoaded", () => {
  it("is false before any config and for the bootstrap subset", () => {
    expect(isFullConfigLoaded(undefined)).toBe(false);
    expect(isFullConfigLoaded({})).toBe(false);
    expect(isFullConfigLoaded({ commit_hash: "abc", sso_enabled: false })).toBe(false);
  });

  it("is true for a full config, including one from a build without a git tag", () => {
    expect(isFullConfigLoaded({ version: "v1.0.0", timestamp_column: "_timestamp" })).toBe(true);
    expect(isFullConfigLoaded({ version: "", timestamp_column: "_timestamp" })).toBe(true);
  });
});
