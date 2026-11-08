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
import { isNetworkFailure } from "@/utils/networkFailure";

describe("isNetworkFailure", () => {
  it.each(["network error", "Load failed", "Failed to fetch", "NetworkError when attempting"])(
    "matches a TypeError saying %s",
    (message) => expect(isNetworkFailure(new TypeError(message))).toBe(true),
  );

  it("rejects other errors", () => {
    expect(isNetworkFailure(new Error("network error"))).toBe(false);
    expect(isNetworkFailure(new TypeError("x is undefined"))).toBe(false);
    expect(isNetworkFailure("Failed to fetch")).toBe(false);
  });
});
