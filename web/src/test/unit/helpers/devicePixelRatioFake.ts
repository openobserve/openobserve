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

import { vi, type Mock } from "vitest";

export interface FakeCanvasLayer {
  dpr: number;
  ctx: { dpr: number };
  resize: Mock;
}

export interface FakeCanvasPainter {
  type: "canvas" | "svg";
  dpr: number;
  layers: Record<string, FakeCanvasLayer>;
  getLayers: Mock;
  getWidth: Mock;
  getHeight: Mock;
  refresh: Mock;
}

export interface DevicePixelRatioFake {
  /** Moves the window to a display with this ratio, firing `change` on the queries that stop matching. */
  setRatio: (next: number) => void;
  /** How many `change` listeners are attached to resolution queries right now. */
  listenerCount: () => number;
  restore: () => void;
}

/** Drives `window.devicePixelRatio` and the `(resolution: Ndppx)` media queries the way a browser does. */
export const fakeDevicePixelRatio = (
  initial: number,
  { legacyWebKit = false }: { legacyWebKit?: boolean } = {},
): DevicePixelRatioFake => {
  let ratio = initial;
  const listeners = new Map<string, Set<EventListener>>();
  const ratioDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  const realMatchMedia = window.matchMedia;
  const queryFor = (r: number) =>
    legacyWebKit ? `(-webkit-device-pixel-ratio: ${r})` : `(resolution: ${r}dppx)`;

  Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => ratio });
  window.matchMedia = ((media: string) => {
    // Breakpoint queries keep the shared mock so layout code sees the usual desktop.
    if (!media.startsWith("(resolution:") && !media.startsWith("(-webkit-device-pixel-ratio:")) {
      return realMatchMedia(media);
    }
    const add = (fn: EventListener) => {
      if (!listeners.has(media)) listeners.set(media, new Set());
      listeners.get(media)?.add(fn);
    };
    const remove = (fn: EventListener) => listeners.get(media)?.delete(fn);
    // Safari before 16 matches only the prefixed query and exposes only addListener/removeListener.
    const api = legacyWebKit
      ? { addListener: add, removeListener: remove }
      : {
          addEventListener: (_type: string, fn: EventListener) => add(fn),
          removeEventListener: (_type: string, fn: EventListener) => remove(fn),
        };
    return { media, matches: media === queryFor(ratio), ...api } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    setRatio: (next) => {
      const stale = queryFor(ratio);
      ratio = next;
      // Copied first: a handler re-arms itself while the set is being walked.
      [...(listeners.get(stale) ?? [])].forEach((fn) => fn(new Event("change")));
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    restore: () => {
      window.matchMedia = realMatchMedia;
      if (ratioDescriptor) Object.defineProperty(window, "devicePixelRatio", ratioDescriptor);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    },
  };
};

/** A zrender canvas painter shaped like 6.1's: a base and a hover layer, each with its own context ratio. */
export const fakeCanvasPainter = (
  dpr: number,
  type: "canvas" | "svg" = "canvas",
): FakeCanvasPainter => {
  const layer = (): FakeCanvasLayer => ({ dpr, ctx: { dpr }, resize: vi.fn() });
  const layers = { "zr_0.0": layer(), "zr_100000.0": layer() };
  return {
    type,
    dpr,
    layers,
    getLayers: vi.fn(() => layers),
    getWidth: vi.fn(() => 400),
    getHeight: vi.fn(() => 300),
    refresh: vi.fn(),
  };
};
