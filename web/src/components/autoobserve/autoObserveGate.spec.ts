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

import { describe, expect, it, vi } from "vitest";

import {
  autoObserveAllowed,
  isAutoObserveEnabled,
  type AutoObserveConfig,
} from "./autoObserveGate";

function source(
  initial: AutoObserveConfig | null,
  full: () => Promise<AutoObserveConfig | null> = () => new Promise(() => {}),
) {
  let listener: ((config: AutoObserveConfig) => void) | null = null;
  const stop = vi.fn();
  const fetchFull = vi.fn(full);
  return {
    stop,
    fetchFull,
    emit: (config: AutoObserveConfig) => listener?.(config),
    read: () => initial,
    watch: (callback: (config: AutoObserveConfig) => void) => {
      listener = callback;
      return stop;
    },
  };
}

const FULL = { version: "v0.80.0" };

describe("AutoObserve gate", () => {
  it("is on only for an experimental org on an enterprise build", () => {
    expect(isAutoObserveEnabled("true", { experimental: true })).toBe(true);
    expect(isAutoObserveEnabled("true", { experimental: false })).toBe(false);
    expect(isAutoObserveEnabled("false", { experimental: true })).toBe(false);
    expect(isAutoObserveEnabled("true", null)).toBe(false);
  });

  it("decides at once when the full config is already loaded", async () => {
    const on = source({ ...FULL, experimental: true });
    await expect(autoObserveAllowed("true", on)).resolves.toBe(true);
    expect(on.fetchFull).not.toHaveBeenCalled();
    await expect(
      autoObserveAllowed("true", source({ ...FULL, experimental: false })),
    ).resolves.toBe(false);
    await expect(autoObserveAllowed("true", source(FULL))).resolves.toBe(false);
  });

  it("does not read the login-time subset as the org's config", async () => {
    const config = source({ experimental: true } as AutoObserveConfig);
    const allowed = autoObserveAllowed("true", config, 1_000);
    config.emit({ build_type: "enterprise" } as AutoObserveConfig);
    config.emit({ ...FULL, experimental: false });
    await expect(allowed).resolves.toBe(false);
    expect(config.stop).toHaveBeenCalled();
  });

  it("fetches the full config on a cold load, since the layout that loads it waits on this guard", async () => {
    const config = source({}, async () => ({ ...FULL, experimental: true }));
    await expect(autoObserveAllowed("true", config, 1_000)).resolves.toBe(true);
    expect(config.fetchFull).toHaveBeenCalledTimes(1);
  });

  it("gives up after the wait when the full config never arrives", async () => {
    vi.useFakeTimers();
    const config = source(null, () => Promise.reject(new Error("offline")));
    const allowed = autoObserveAllowed("true", config, 1_000);
    vi.advanceTimersByTime(1_000);
    await expect(allowed).resolves.toBe(false);
    vi.useRealTimers();
  });
});
