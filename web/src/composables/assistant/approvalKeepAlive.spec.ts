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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";

import {
  BACKGROUND_EXTEND_AT_MS,
  KEEP_ALIVE_RETRY_MS,
  createApprovalKeepAlive,
  type ApprovalKeepAliveDeps,
} from "./approvalKeepAlive";
import type { AssistantState } from "./assistantStore.types";

const START = 1_000_000;

function fakeLocks(heldNames: string[] = []) {
  const held = new Set(heldNames);
  return {
    held,
    query: vi.fn(async () => ({ held: [...held].map((name) => ({ name })), pending: [] })),
    request: vi.fn(async (name: string, opts: unknown, cb?: unknown) => {
      const callback = (cb ?? opts) as (lock: unknown) => Promise<unknown>;
      const shared = (opts as { mode?: string }).mode === "shared";
      if (!shared && held.has(name)) return callback(null);
      held.add(name);
      await callback({ name });
      held.delete(name);
      return undefined;
    }),
  };
}

function setup(over: Partial<ApprovalKeepAliveDeps> = {}, expiresAt = START + 300_000) {
  const state = reactive({
    sessions: {
      s1: {
        sid: "s1",
        pendingApproval: { id: "c1", expiresAt, askedIn: "here" },
      },
    },
  }) as unknown as AssistantState;
  const returns: (() => void)[] = [];
  const pending = () => state.sessions.s1.pendingApproval!;
  const extend = vi.fn(async () => {
    pending().expiresAt = (pending().expiresAt as number) + 300_000;
    return "extended" as const;
  });
  const reconcile = vi.fn(async () => undefined);
  const keepAlive = createApprovalKeepAlive({
    state: () => state,
    shownHere: () => [],
    budgets: () => true,
    locks: fakeLocks() as unknown as ApprovalKeepAliveDeps["locks"],
    extend,
    reconcile,
    now: () => Date.now(),
    onReturn: (cb) => {
      returns.push(cb);
      return () => undefined;
    },
    ...over,
  });
  return { state, pending, extend, reconcile, keepAlive, returns };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("createApprovalKeepAlive", () => {
  let disposers: (() => void)[] = [];
  const track = <T extends { keepAlive: { dispose(): void } }>(made: T) => {
    disposers.push(() => made.keepAlive.dispose());
    return made;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    disposers = [];
  });

  afterEach(() => {
    disposers.forEach((dispose) => dispose());
    vi.useRealTimers();
  });

  it("extends from the background budget only once 90 s or less remain", async () => {
    const { extend } = track(setup());
    await advance(300_000 - BACKGROUND_EXTEND_AT_MS - 1_000);
    expect(extend).not.toHaveBeenCalled();
    await advance(1_000);
    expect(extend).toHaveBeenCalledTimes(1);
    expect(extend).toHaveBeenCalledWith("s1", "c1");
  });

  it("re-arms from the server's new expiry and stops once the budget is spent", async () => {
    const { extend, pending } = track(setup());
    await advance(300_000 - BACKGROUND_EXTEND_AT_MS);
    expect(extend).toHaveBeenCalledTimes(1);
    extend.mockImplementation(async () => "spent" as never);
    await advance(300_000);
    expect(extend).toHaveBeenCalledTimes(2);
    expect(pending().expiresAt).toBe(START + 600_000);
    await advance(600_000);
    expect(extend).toHaveBeenCalledTimes(2);
  });

  it("posts nothing on a server without split budgets (PO A14)", async () => {
    const { extend } = track(setup({ budgets: () => false }));
    await advance(400_000);
    expect(extend).not.toHaveBeenCalled();
  });

  it("skips the extend while this tab shows the chat, and reads the card when it starts showing", async () => {
    const { extend, reconcile } = track(setup({ shownHere: () => ["s1"] }));
    await nextTick();
    expect(reconcile).toHaveBeenCalledWith("s1");
    await advance(400_000);
    expect(extend).not.toHaveBeenCalled();
  });

  it("skips the extend while another tab holds the shown lock", async () => {
    const locks = fakeLocks(["o2-assistant-shown:s1"]);
    const { extend } = track(setup({ locks: locks as never }));
    await advance(300_000 - BACKGROUND_EXTEND_AT_MS + KEEP_ALIVE_RETRY_MS);
    expect(extend).not.toHaveBeenCalled();
    locks.held.delete("o2-assistant-shown:s1");
    await advance(KEEP_ALIVE_RETRY_MS);
    expect(extend).toHaveBeenCalledTimes(1);
  });

  it("never extends from a tab that did not get the extend lock", async () => {
    const locks = fakeLocks(["o2-assistant-extend:c1"]);
    const { extend } = track(setup({ locks: locks as never }));
    await advance(400_000);
    expect(extend).not.toHaveBeenCalled();
  });

  it("re-reads the card on taking the lock and on every return", async () => {
    const { reconcile, returns } = track(setup());
    await advance(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    returns[0]();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("without Web Locks extends only the card that came on this tab's own stream", async () => {
    const own = track(setup({ locks: null }));
    await advance(300_000 - BACKGROUND_EXTEND_AT_MS);
    expect(own.extend).toHaveBeenCalledTimes(1);
    const other = track(setup({ locks: null }));
    other.pending().askedIn = "other_tab";
    await advance(600_000);
    expect(other.extend).not.toHaveBeenCalled();
  });

  it("forgets a decided card, so nothing is posted for it", async () => {
    const { state, extend } = track(setup());
    state.sessions.s1.pendingApproval = null;
    await nextTick();
    await advance(400_000);
    expect(extend).not.toHaveBeenCalled();
  });
});
