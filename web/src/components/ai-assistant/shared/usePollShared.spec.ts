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
import { effectScope, ref } from "vue";

import type { SharedChat } from "@/services/ai_chat_share";

import { lastCommitted, usePollShared, type PollResult } from "./usePollShared";

const chat = (over: Partial<SharedChat> = {}): SharedChat => ({
  title: "t",
  mode: "live",
  seq: 1,
  state_version: "v1",
  created_at: 1_000,
  shared_at: 1_000,
  not_modified: false,
  turns: [{ created: 5_000_000, status: "completed", user: { text: "q" }, frames: [] }],
  ...over,
});

function run(initial: SharedChat, answers: (() => PollResult)[], hidden = () => false) {
  const data = ref<SharedChat | undefined>(initial);
  const refetch = vi.fn(async () => {
    const next = answers.shift()?.() ?? { data: data.value };
    if (next.data) data.value = next.data;
    return next;
  });
  const scope = effectScope();
  const poll = scope.run(() => usePollShared(data, { refetch, hidden }))!;
  return { poll, refetch, scope };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePollShared", () => {
  it("never polls a snapshot", async () => {
    const { refetch, poll, scope } = run(chat({ mode: "snapshot" }), []);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refetch).not.toHaveBeenCalled();
    expect(poll.state.value.status).toBe("idle");
    scope.stop();
  });

  it("polls a live share every 30 s and every 5 s while a turn runs", async () => {
    const { refetch, poll, scope } = run(chat(), [() => ({ data: chat({ active_turn: true }) })]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refetch).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(poll.state.value.status).toBe("running");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(refetch).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("backs off to a minute after ten quiet polls, and counts a real change once", async () => {
    const { refetch, poll, scope } = run(chat(), []);
    await vi.advanceTimersByTimeAsync(10 * 30_000);
    expect(refetch).toHaveBeenCalledTimes(10);
    expect(poll.state.value.status).toBe("backoff");
    expect(poll.state.value.intervalMs).toBe(60_000);
    expect(poll.state.value.changes).toBe(0);
    scope.stop();

    const changed = run(chat(), [() => ({ data: chat({ state_version: "v2", seq: 2 }) })]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(changed.poll.state.value.changes).toBe(1);
    expect(changed.poll.state.value.status).toBe("live");
    changed.scope.stop();
  });

  it("keeps the last change on the newest committed turn, not on the poll", async () => {
    const { poll, scope } = run(chat(), []);
    const before = poll.state.value.lastChangeAt;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll.state.value.lastChangeAt).toBe(before);
    expect(before).toBe(5_000);
    scope.stop();
  });

  it("stops on 403 and 404", async () => {
    const { refetch, poll, scope } = run(chat(), [
      () => ({ error: { response: { status: 404 } } }),
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll.state.value.status).toBe("stopped");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("respects Retry-After on 429 and never polls faster than 5 s", async () => {
    const { refetch, poll, scope } = run(chat(), [
      () => ({ error: { response: { status: 429, headers: { "retry-after": "1" } } } }),
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll.state.value.status).toBe("rateLimited");
    expect(poll.state.value.retryInSecs).toBe(5);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refetch).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("caps a huge or broken retry_after between 5 s and an hour", async () => {
    const huge = run(chat(), [
      () => ({ error: { response: { status: 429, data: { retry_after: 9e12 } } } }),
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(huge.poll.state.value.retryInSecs).toBe(3_600);
    await vi.advanceTimersByTimeAsync(3_599_000);
    expect(huge.refetch).toHaveBeenCalledTimes(1);
    huge.scope.stop();
  });

  it("marks a network failure offline and backs off exponentially to a minute", async () => {
    const network = () => ({ error: new Error("network") });
    const { refetch, poll, scope } = run(chat({ active_turn: true }), [
      network,
      network,
      network,
      network,
      network,
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll.state.value.status).toBe("offline");
    for (const gap of [10_000, 20_000, 40_000, 60_000]) {
      const before = refetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(gap - 1);
      expect(refetch).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(refetch).toHaveBeenCalledTimes(5);
    scope.stop();
  });

  it("clears the offline notice as soon as a manual Retry reads the chat", async () => {
    const { refetch, poll, scope } = run(chat(), [() => ({ error: new Error("network") })]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll.state.value.status).toBe("offline");
    await poll.pollNow();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(poll.state.value.status).toBe("live");
    scope.stop();
  });

  it("keeps a 429's wait when the tab comes back", async () => {
    let hidden = false;
    const { refetch, scope } = run(
      chat(),
      [() => ({ error: { response: { status: 429, headers: { "retry-after": "120" } } } })],
      () => hidden,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(100_000);
    expect(refetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refetch).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("pauses while the tab is hidden", async () => {
    let hidden = true;
    const { refetch, scope } = run(chat(), [], () => hidden);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refetch).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(refetch).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("reads the newest finished turn's time in ms", () => {
    expect(lastCommitted(chat())).toBe(5_000);
    expect(lastCommitted(chat({ turns: [] }))).toBeNull();
  });
});
