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

import { shouldPropagateTracing } from "./tracingOrigin";

describe("shouldPropagateTracing", () => {
  it("propagates on a same-origin endpoint", () => {
    expect(shouldPropagateTracing("", "http://localhost:8081")).toBe(true);
    expect(shouldPropagateTracing("/", "http://localhost:8081")).toBe(true);
    expect(shouldPropagateTracing("http://localhost:8081", "http://localhost:8081")).toBe(true);
    expect(shouldPropagateTracing("https://o2.example.com/base", "https://o2.example.com")).toBe(
      true,
    );
  });

  it("refuses a cross-origin endpoint — the preflight would carry SDK headers the backend may not allow", () => {
    expect(
      shouldPropagateTracing("https://dev.internal.example.com", "http://localhost:8081"),
    ).toBe(false);
  });

  it("treats a same-host different-port endpoint as cross-origin", () => {
    expect(shouldPropagateTracing("http://localhost:5080", "http://localhost:8081")).toBe(false);
  });

  it("does not prefix-match a hostile lookalike host", () => {
    expect(
      shouldPropagateTracing("https://o2.example.com.evil.com", "https://o2.example.com"),
    ).toBe(false);
  });
});
