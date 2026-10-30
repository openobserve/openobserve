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

import { afterEach, describe, expect, it, vi } from "vitest";
import { isReactive } from "vue";

import { createTurnRuntime } from "./turnRuntime";

afterEach(() => {
  vi.useRealTimers();
});

describe("turnRuntime", () => {
  const entry = (turn = { id: "t1" }) => ({ controller: new AbortController(), turn });

  it("keeps plain, non-reactive entries keyed by the captured sid (constraint 65)", () => {
    const runtime = createTurnRuntime<{ id: string }>();
    const stored = runtime.set("s1", entry());
    expect(runtime.get("s1")).toBe(stored);
    expect(isReactive(stored)).toBe(false);
  });

  it("moves an entry on rename and never duplicates it (constraint 7)", () => {
    const runtime = createTurnRuntime<{ id: string }>();
    const stored = runtime.set("old", entry());
    runtime.rename("old", "new");
    expect(runtime.get("old")).toBeUndefined();
    expect(runtime.get("new")).toBe(stored);
    runtime.rename("missing", "other");
    expect(runtime.get("other")).toBeUndefined();
    expect(runtime.get("new")).toBe(stored);
  });

  it("aborts one turn, or every turn with a reason", () => {
    const runtime = createTurnRuntime<{ id: string }>();
    const a = runtime.set("a", entry());
    const b = runtime.set("b", entry());
    runtime.abort("a");
    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(false);
    expect(runtime.abortAll("sign_out")).toEqual(["a", "b"]);
    expect(b.controller.signal.reason).toBe("sign_out");
  });

  it("renews the controller for the next request of the same turn", () => {
    const runtime = createTurnRuntime<{ id: string }>();
    const stored = runtime.set("a", entry());
    const first = stored.controller;
    const next = runtime.renew("a");
    expect(first.signal.aborted).toBe(true);
    expect(next).toBe(stored.controller);
    expect(next?.signal.aborted).toBe(false);
    expect(runtime.renew("missing")).toBeNull();
  });

  it("clears the entry's timers when it is deleted or replaced", () => {
    vi.useFakeTimers();
    const runtime = createTurnRuntime<{ id: string }>();
    const fired = vi.fn();
    const stored = runtime.set("a", entry());
    stored.keepaliveTimer = setTimeout(fired, 10);
    stored.expiryTimer = setTimeout(fired, 10);
    runtime.delete("a");
    const replaced = runtime.set("b", entry());
    replaced.expiryTimer = setTimeout(fired, 10);
    runtime.set("b", entry());
    vi.advanceTimersByTime(20);
    expect(fired).not.toHaveBeenCalled();
    expect(runtime.get("a")).toBeUndefined();
  });
});
