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

import { afterEach, describe, expect, it } from "vitest";
import { ADDED_KEEP_MS, serviceKeyOf, useRecentlyCreated } from "./useRecentlyCreated";

const recently = useRecentlyCreated();
const inA = serviceKeyOf("org-a", "api", null, null);
const inB = serviceKeyOf("org-b", "api", null, null);

describe("useRecentlyCreated keeps each org's just-added alerts apart (F4)", () => {
  afterEach(() => {
    recently.clearOnPass("org-a", Number.MAX_SAFE_INTEGER);
    recently.clearOnPass("org-b", Number.MAX_SAFE_INTEGER);
  });

  it("another org's pass does not forget this org's just-added alert", () => {
    recently.add(inA, "errors", 1_000);
    recently.clearOnPass("org-b", 2_000);
    expect(recently.has(inA, "errors", 2_000)).toBe(true);
  });

  it("a pass forgets only its own org's alerts created before it", () => {
    recently.add(inA, "errors", 1_000);
    recently.add(inB, "errors", 1_000);
    recently.clearOnPass("org-a", 2_000);
    expect(recently.has(inA, "errors", 2_000)).toBe(false);
    expect(recently.has(inB, "errors", 2_000)).toBe(true);
  });

  it("another org's alert does not make this org wait for a pass", () => {
    recently.add(inA, "errors", 5_000);
    expect(recently.waiting("org-b", 4_000, 5_000)).toBe(false);
    expect(recently.waiting("org-a", 4_000, 5_000)).toBe(true);
  });

  it("stops waiting once an alert has gone uncounted past the bound, so polling ends", () => {
    recently.add(inA, "errors", 1_000);
    expect(recently.waiting("org-a", 0, 1_000 + ADDED_KEEP_MS - 1)).toBe(true);
    expect(recently.waiting("org-a", 0, 1_000 + ADDED_KEEP_MS + 1)).toBe(false);
    expect(recently.has(inA, "errors", 1_000 + ADDED_KEEP_MS + 1)).toBe(false);
  });
});
