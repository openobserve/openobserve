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
import { useThemeCustomizer } from "./useThemeCustomizer";

describe("useThemeCustomizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level singletons before each test
    const { isOpen } = useThemeCustomizer();
    isOpen.value = false;
    // Clear any previously registered update function by registering null-like
    // placeholder — source guard checks truthiness so we register a no-op that
    // we immediately override; cleanest way is to rely on the reset helper below.
    const { registerUpdateFunction } = useThemeCustomizer();
    registerUpdateFunction(null as any);
  });

  it("returns all four expected exports", () => {
    const result = useThemeCustomizer();
    expect(result).toHaveProperty("isOpen");
    expect(result).toHaveProperty("toggleCustomizer");
    expect(result).toHaveProperty("registerUpdateFunction");
    expect(result).toHaveProperty("applyTheme");
  });

  it("isOpen starts as false", () => {
    const { isOpen } = useThemeCustomizer();
    expect(isOpen.value).toBe(false);
  });

  it("toggleCustomizer flips isOpen from false to true", () => {
    const { isOpen, toggleCustomizer } = useThemeCustomizer();
    toggleCustomizer();
    expect(isOpen.value).toBe(true);
  });

  it("toggleCustomizer flips isOpen back from true to false", () => {
    const { isOpen, toggleCustomizer } = useThemeCustomizer();
    toggleCustomizer();
    toggleCustomizer();
    expect(isOpen.value).toBe(false);
  });

  it("toggleCustomizer cycles the value correctly over multiple calls", () => {
    const { isOpen, toggleCustomizer } = useThemeCustomizer();
    for (let i = 1; i <= 4; i++) {
      toggleCustomizer();
      expect(isOpen.value).toBe(i % 2 === 1);
    }
  });

  it("registerUpdateFunction stores a function that can later be called via applyTheme", () => {
    const { registerUpdateFunction, applyTheme } = useThemeCustomizer();
    const mockFn = vi.fn();
    registerUpdateFunction(mockFn);

    const themeConfig = { primaryColor: "#ff0000" };
    applyTheme(themeConfig);

    expect(mockFn).toHaveBeenCalledOnce();
    expect(mockFn).toHaveBeenCalledWith(themeConfig);
  });

  it("applyTheme calls the registered function with the provided themeConfig", () => {
    const { registerUpdateFunction, applyTheme } = useThemeCustomizer();
    const mockFn = vi.fn();
    registerUpdateFunction(mockFn);

    const themeConfig = { primaryColor: "#00ff00", secondaryColor: "#0000ff" };
    applyTheme(themeConfig);

    expect(mockFn).toHaveBeenCalledWith(themeConfig);
  });

  it("applyTheme is a no-op when no function has been registered", () => {
    // registerUpdateFunction was set to null in beforeEach
    const { applyTheme } = useThemeCustomizer();
    // Should not throw
    expect(() => applyTheme({ primaryColor: "#fff" })).not.toThrow();
  });

  it("applyTheme is a no-op after registering null", () => {
    const { registerUpdateFunction, applyTheme } = useThemeCustomizer();
    const mockFn = vi.fn();
    registerUpdateFunction(mockFn);
    registerUpdateFunction(null as any);

    applyTheme({ color: "red" });
    expect(mockFn).not.toHaveBeenCalled();
  });

  it("registering a new function replaces the previous one", () => {
    const { registerUpdateFunction, applyTheme } = useThemeCustomizer();
    const firstFn = vi.fn();
    const secondFn = vi.fn();

    registerUpdateFunction(firstFn);
    registerUpdateFunction(secondFn);

    const config = { theme: "dark" };
    applyTheme(config);

    expect(firstFn).not.toHaveBeenCalled();
    expect(secondFn).toHaveBeenCalledWith(config);
  });

  it("multiple calls to useThemeCustomizer share the same isOpen singleton", () => {
    const a = useThemeCustomizer();
    const b = useThemeCustomizer();
    expect(a.isOpen).toBe(b.isOpen);
  });

  it("toggling via one instance is visible in another", () => {
    const a = useThemeCustomizer();
    const b = useThemeCustomizer();
    a.toggleCustomizer();
    expect(b.isOpen.value).toBe(true);
  });

  it("applyTheme passes complex theme objects unchanged", () => {
    const { registerUpdateFunction, applyTheme } = useThemeCustomizer();
    const mockFn = vi.fn();
    registerUpdateFunction(mockFn);

    const complexConfig = {
      colors: { primary: "#abc", secondary: "#def" },
      fonts: { base: "Roboto", heading: "Montserrat" },
      spacing: { unit: 8 },
    };
    applyTheme(complexConfig);

    expect(mockFn).toHaveBeenCalledWith(complexConfig);
  });
});
