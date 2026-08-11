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

import { describe, expect, it, beforeEach, vi } from "vitest";

// The composable memoises its matchMedia listeners at module scope, so each
// case re-imports it fresh (resetModules) with matchMedia stubbed to a chosen
// width. The stub reads the min-width from the query and compares to `width`.
const mockMatchMedia = (width: number) => {
  vi.stubGlobal("matchMedia", (query: string) => {
    const m = query.match(/min-width:\s*([\d.]+)rem/);
    const minPx = m ? parseFloat(m[1]) * 16 : 0;
    return {
      matches: width >= minPx,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
};

const load = async () => (await import("./useBreakpoint")).default;

describe("useBreakpoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("should report mobile below the md breakpoint (< 768px)", async () => {
    mockMatchMedia(375);
    const bp = (await load())();
    expect(bp.isMobile.value).toBe(true);
    expect(bp.isTablet.value).toBe(false);
    expect(bp.isDesktop.value).toBe(false);
  });

  it("should report tablet between md and lg (768–1023px)", async () => {
    mockMatchMedia(768);
    const bp = (await load())();
    expect(bp.isMobile.value).toBe(false);
    expect(bp.isTablet.value).toBe(true);
    expect(bp.isDesktop.value).toBe(false);
  });

  it("should report desktop at or above the lg breakpoint (>= 1024px)", async () => {
    mockMatchMedia(1280);
    const bp = (await load())();
    expect(bp.isMobile.value).toBe(false);
    expect(bp.isTablet.value).toBe(false);
    expect(bp.isDesktop.value).toBe(true);
  });

  it("should expose mdUp and lgUp booleans matching the tier", async () => {
    mockMatchMedia(768);
    const bp = (await load())();
    expect(bp.mdUp.value).toBe(true);
    expect(bp.lgUp.value).toBe(false);
  });
});
