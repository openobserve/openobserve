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
import { packageOf, paletteIndexFor } from "./flameGraphPackage";

describe("packageOf", () => {
  it.each([
    ["crypto/internal/fips140/sha256.(*Digest).Sum", "crypto/internal/fips140/sha256"],
    ["encoding/json/v2.Marshal", "encoding/json/v2"],
    ["main.handleCheckout", "main"],
    ["runtime.(*mheap).alloc.func1", "runtime"],
    ["std::vec::Vec<T>::push", "std"],
    ["java.util.HashMap.get", "java"],
    ["total", "total"],
    ["other", "other"],
  ])("%s → %s", (name, expected) => {
    expect(packageOf(name)).toBe(expected);
  });
});

describe("paletteIndexFor", () => {
  it("gives every function of one package the same colour", () => {
    expect(paletteIndexFor("main.worker", 7)).toBe(paletteIndexFor("main.handleCheckout", 7));
    expect(paletteIndexFor("crypto/sha256.Sum256", 7)).toBe(
      paletteIndexFor("crypto/sha256.(*Digest).Write", 7),
    );
  });

  it("stays inside the palette", () => {
    for (const name of ["a.b", "runtime.madvise", "x/y.z", ""]) {
      const index = paletteIndexFor(name, 7);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });
});
