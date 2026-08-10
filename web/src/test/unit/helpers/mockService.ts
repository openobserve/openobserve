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
 * A service file declares its cached reads next to the endpoints they call, so
 * a query holds a direct reference to the service object. Replacing the module
 * wholesale would take the query exports with it, and stubbing around the
 * object would leave the query calling the real endpoint — so the stubs are
 * written *onto* the real objects, which both the query and the component see.
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
      if (!real.__isQuery) {
        for (const [member, value] of Object.entries(real)) {
          if (typeof value === "function") real[member] = vi.fn();
        }
      }
      Object.assign(real, stub);
    } else {
      merged[name] = stub;
    }
  }
  return merged as T;
}

/**
 * The `vi.mock("@/services/x")` automock, minus the queries.
 *
 * Automocking a service file would stub its query exports too, so every read
 * through them resolves `undefined`. This stubs the endpoint methods in place
 * and leaves the queries real, which is what the component actually calls.
 */
export function automockService<T extends Record<string, any>>(actual: T): T {
  const merged: Record<string, any> = { ...actual };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "function") {
      // A bare function export: the module namespace is the only seam, so the
      // stub replaces the export rather than mutating anything.
      merged[key] = vi.fn();
    } else if (value && typeof value === "object" && !value.__isQuery) {
      for (const [name, member] of Object.entries(value)) {
        if (typeof member === "function") value[name] = vi.fn();
      }
    }
  }
  return merged as T;
}

/**
 * A stub query that reads through `fetch`, for services whose endpoints are
 * bare function exports (`@/services/iam`). Those cannot be intercepted from
 * outside the module, so the query is pointed back at the spec's own stub and
 * the existing call assertions keep describing one seam.
 */
export function queryStub(
  fetch: (...args: any[]) => Promise<any>,
  map: (res: any) => unknown = (res) => res?.data,
) {
  const read = (org: string, ...args: any[]) => fetch(org, ...args).then(map);
  return {
    __isQuery: true,
    get: vi.fn(read),
    refresh: vi.fn(read),
    // No cached half: the stub has no store behind it, so a spec always sees
    // the fetch it set up.
    swr: vi.fn((org: string, ...args: any[]) => ({
      cached: undefined,
      fresh: read(org, ...args),
    })),
    peek: vi.fn(() => undefined),
    invalidate: vi.fn(),
    remove: vi.fn(),
    prime: vi.fn(),
    prefetch: vi.fn(),
    use: vi.fn(),
    options: vi.fn(),
    key: vi.fn(),
  };
}

export default overlayServiceMock;
