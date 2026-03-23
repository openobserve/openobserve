// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { usePredefinedThemes } from "./usePredefinedThemes";

describe("usePredefinedThemes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level singleton ref to false before each test so tests are
    // isolated from each other's side effects.
    const { isOpen } = usePredefinedThemes();
    isOpen.value = false;
  });

  it("returns isOpen and toggleThemes", () => {
    const result = usePredefinedThemes();
    expect(result).toHaveProperty("isOpen");
    expect(result).toHaveProperty("toggleThemes");
  });

  it("isOpen starts as false", () => {
    const { isOpen } = usePredefinedThemes();
    expect(isOpen.value).toBe(false);
  });

  it("toggleThemes flips isOpen from false to true", () => {
    const { isOpen, toggleThemes } = usePredefinedThemes();
    expect(isOpen.value).toBe(false);
    toggleThemes();
    expect(isOpen.value).toBe(true);
  });

  it("toggleThemes flips isOpen back from true to false on second call", () => {
    const { isOpen, toggleThemes } = usePredefinedThemes();
    toggleThemes();
    expect(isOpen.value).toBe(true);
    toggleThemes();
    expect(isOpen.value).toBe(false);
  });

  it("multiple calls to toggleThemes cycle the value correctly", () => {
    const { isOpen, toggleThemes } = usePredefinedThemes();
    for (let i = 1; i <= 6; i++) {
      toggleThemes();
      expect(isOpen.value).toBe(i % 2 === 1);
    }
  });

  it("multiple calls to usePredefinedThemes share the same isOpen ref (singleton)", () => {
    const a = usePredefinedThemes();
    const b = usePredefinedThemes();

    // Same object reference since isOpen is module-level
    expect(a.isOpen).toBe(b.isOpen);
  });

  it("toggling via one instance is visible in another instance", () => {
    const a = usePredefinedThemes();
    const b = usePredefinedThemes();

    a.toggleThemes();
    expect(b.isOpen.value).toBe(true);
  });

  it("toggleThemes is a function", () => {
    const { toggleThemes } = usePredefinedThemes();
    expect(typeof toggleThemes).toBe("function");
  });

  it("isOpen is a Vue ref (has a .value property)", () => {
    const { isOpen } = usePredefinedThemes();
    expect(isOpen).toHaveProperty("value");
  });
});
