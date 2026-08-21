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

import { vi } from "vitest";

/**
 * Overlay stub methods onto a real service module for `vi.mock`.
 *
 * Cache declarations now live in `<domain>.queries.ts` and reach the transport
 * through a normal module import, so a plain `vi.mock("@/services/x")` already
 * reaches a query's `queryFn` — prefer that for new specs. This helper remains
 * for the many existing specs that stub only part of a service and want the
 * rest of the real module to survive.
 *
 *   vi.mock("@/services/reports", async (importOriginal) => {
 *     const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
 *     return overlayServiceMock(await importOriginal(), {
 *       default: { listByFolderId: vi.fn() },
 *     });
 *   });
 */
export function overlayServiceMock<T extends Record<string, any>>(
  actual: T,
  stubs: Record<string, any>,
): T {
  const merged: Record<string, any> = { ...actual };
  for (const [name, stub] of Object.entries(stubs)) {
    const real = merged[name];
    if (real && typeof real === "object" && stub && typeof stub === "object") {
      // Everything on an overlaid object is stubbed, not just what the caller
      // named — a wholesale `vi.mock` factory left the rest undefined, and a
      // method that quietly stayed real would reach the network.
      for (const [member, value] of Object.entries(real)) {
        if (typeof value === "function") real[member] = vi.fn();
      }
      Object.assign(real, stub);
    } else {
      merged[name] = stub;
    }
  }
  return merged as T;
}

/**
 * The `vi.mock("@/services/x")` automock: every endpoint method becomes a spy.
 *
 * Safe to point at a whole service now that query declarations live in their
 * own module — there are no query exports here left to stub out.
 */
export function automockService<T extends Record<string, any>>(actual: T): T {
  const merged: Record<string, any> = { ...actual };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "function") {
      // A bare function export: the module namespace is the only seam, so the
      // stub replaces the export rather than mutating anything.
      merged[key] = vi.fn();
    } else if (value && typeof value === "object") {
      for (const [name, member] of Object.entries(value)) {
        if (typeof member === "function") value[name] = vi.fn();
      }
    }
  }
  return merged as T;
}
