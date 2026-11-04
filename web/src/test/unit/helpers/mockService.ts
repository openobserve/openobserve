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
import { AxiosHeaders, type AxiosResponse } from "axios";

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

/** An axios-shaped 200 for `mockResolvedValue`; typed `never` so one fixture fits whatever payload the endpoint declares. */
export function axiosReply(data: unknown): AxiosResponse<never> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse<never>;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A mocked axios answer typed from the call it stands in for; the fixture holds only the fields under test. */
export function ok<R extends { data: unknown }>(data: DeepPartial<R["data"]> | null): R {
  return axiosReply(data) as unknown as R;
}

/** A reply the test sends later with `answer(data)`, for ordering a slow read against a newer one. */
export function deferredReply(): {
  promise: Promise<AxiosResponse<never>>;
  answer: (data: unknown) => void;
} {
  let resolve: (reply: AxiosResponse<never>) => void = () => {};
  const promise = new Promise<AxiosResponse<never>>((done) => (resolve = done));
  return { promise, answer: (data) => resolve(axiosReply(data)) };
}
