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

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AssistantHint } from "./assistantStore.types";
import {
  ORG_PING_PREFIX,
  USER_PING_PREFIX,
  computeUserHash,
  createHintChannel,
  toHint,
  type AssistantHintChannel,
} from "./hints";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

const at = 1_760_000_000_000;

const started: AssistantHint = {
  v: 1,
  type: "turn_started",
  org: "org1",
  sid: "s1",
  turnId: "t1",
  origin: "chat",
  at,
};

const channels: AssistantHintChannel[] = [];

function channel(key: string): AssistantHintChannel {
  const made = createHintChannel(key);
  channels.push(made);
  return made;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// Each field of every hint is an id, an enum, a flag or a time; text could carry a prompt.
type Primitive = string | number | boolean | undefined;
type FieldValues<T> = T extends unknown ? T[keyof T] : never;

afterEach(() => {
  channels.splice(0).forEach((made) => made.close());
  vi.unstubAllGlobals();
  track.mockClear();
  localStorage.clear();
});

describe("hint type", () => {
  it("carries only ids, enums, flags and timestamps", () => {
    expectTypeOf<FieldValues<AssistantHint>>().toExtend<Primitive>();
    expectTypeOf<Extract<AssistantHint, { type: "turn_started" }>["origin"]>().toEqualTypeOf<
      "chat" | "rca"
    >();
    expectTypeOf<AssistantHint["type"]>().not.toEqualTypeOf<"draft_changed">();
  });

  it("rebuilds a received payload field by field and refuses anything else", () => {
    expect(toHint({ ...started, text: "my prompt" })).toEqual(started);
    expect(toHint({ ...started, org: { evil: true } })).toBeNull();
    expect(toHint({ ...started, v: 2 })).toBeNull();
    expect(toHint({ v: 1, type: "draft_changed", sid: "s1", at })).toBeNull();
    expect(toHint({ v: 1, type: "signed_out", at: "now" })).toBeNull();
    expect(
      toHint({ v: 1, type: "turn_ended", org: "o", sid: "s", turnId: "t", status: "x", at }),
    ).toBeNull();
    expect(toHint({ ...started, sid: "s".repeat(201) })).toBeNull();
    expect(toHint({ v: 1, type: "prefs_changed", key: "sidebar_width", at })).toEqual({
      v: 1,
      type: "prefs_changed",
      key: "sidebar_width",
      at,
    });
  });
});

describe("createHintChannel over BroadcastChannel", () => {
  it("delivers a hint to the other tab of the same user and org, and counts it", async () => {
    const a = channel("k1");
    const b = channel("k1");
    const seen = vi.fn();
    b.on("turn_started", seen);
    a.post(started);
    await settle();
    expect(seen).toHaveBeenCalledWith(started);
    expect(track).toHaveBeenCalledWith("ai_cross_tab_hint", { type: "turn_started" });
  });

  it("counts a heartbeat's repeats once per episode, and a new episode once the card resolves", async () => {
    const a = channel("k1");
    const b = channel("k1");
    const seen = vi.fn();
    b.on("approval_pending", seen);
    const pending = {
      v: 1 as const,
      type: "approval_pending" as const,
      sid: "s1",
      turnId: "t1",
      at,
    };
    a.post(pending);
    a.post(pending);
    a.post({ ...pending, sid: "s2" });
    await settle();
    expect(seen).toHaveBeenCalledTimes(3);
    const counted = () =>
      track.mock.calls.filter(
        ([name, props]) => name === "ai_cross_tab_hint" && props.type === "approval_pending",
      ).length;
    expect(counted()).toBe(2);
    a.post({ v: 1, type: "approval_resolved", sid: "s1", approved: true, at });
    a.post(pending);
    await settle();
    expect(counted()).toBe(3);
    // A holder that vanished never resolved its card; the chat's next card still counts.
    a.post({ ...pending, sid: "s2", turnId: "t9" });
    await settle();
    expect(counted()).toBe(4);
  });

  it("keeps a card's own expiry and drops a malformed one", () => {
    const pending = { v: 1, type: "approval_pending", sid: "s1", turnId: "t1", at };
    expect(toHint({ ...pending, expiresAt: at + 5 })).toEqual({ ...pending, expiresAt: at + 5 });
    expect(toHint({ ...pending, expiresAt: "soon" })).toEqual(pending);
  });

  it("takes a Stop asked from a tab waiting on a card, by session only", () => {
    expect(toHint({ v: 1, type: "approval_stop", sid: "s1", at })).toEqual({
      v: 1,
      type: "approval_stop",
      sid: "s1",
      at,
    });
    expect(toHint({ v: 1, type: "approval_stop", at })).toBeNull();
  });

  it("re-binds to the new user+org for receiving", async () => {
    const a = channel("k1");
    const b = channel("k1");
    const seen = vi.fn();
    b.on("share_changed", seen);
    b.rebind("k2");
    a.post({ v: 1, type: "share_changed", sid: "s1", at });
    await settle();
    expect(seen).not.toHaveBeenCalled();
    a.postFor("k2", { v: 1, type: "share_changed", sid: "s2", at });
    await settle();
    expect(seen).toHaveBeenCalledWith({ v: 1, type: "share_changed", sid: "s2", at });
  });

  it("carries signed_out and the turn mirrors on the user channel to every org's tabs", async () => {
    const a = channel("k1");
    const b = channel("k2");
    await a.bindUser("Ada@Example.com");
    await b.bindUser("ada@example.com");
    expect(a.userHash()).toBe(b.userHash());
    const out = vi.fn();
    const turns = vi.fn();
    b.on("signed_out", out);
    b.on("turn_started", turns);
    a.post({ v: 1, type: "signed_out", at });
    a.post(started);
    await settle();
    expect(out).toHaveBeenCalledTimes(1);
    expect(turns).toHaveBeenCalledWith(started);
  });
});

describe("createHintChannel without BroadcastChannel", () => {
  it("writes a ping that is gone on the next tick and reads another tab's ping", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const a = channel("k1");
    const seen = vi.fn();
    a.on("history_changed", seen);
    a.post({ v: 1, type: "history_changed", sid: "s1", op: "rename", at });
    const written = localStorage.getItem(`${ORG_PING_PREFIX}k1`);
    expect(JSON.parse(written ?? "{}")).toMatchObject({ type: "history_changed" });
    await settle();
    expect(localStorage.getItem(`${ORG_PING_PREFIX}k1`)).toBeNull();
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: `${ORG_PING_PREFIX}k1`,
        newValue: JSON.stringify({ v: 1, type: "history_changed", sid: "s9", op: "pin", at }),
      }),
    );
    expect(seen).toHaveBeenCalledWith({ v: 1, type: "history_changed", sid: "s9", op: "pin", at });
  });

  it("pings the user key for signed_out", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const a = channel("k1");
    await a.bindUser("ada@example.com");
    const hash = await computeUserHash("ada@example.com");
    const set = vi.spyOn(Storage.prototype, "setItem");
    a.post({ v: 1, type: "signed_out", at });
    expect(set).toHaveBeenCalledWith(`${USER_PING_PREFIX}${hash}`, expect.any(String));
    expect(set).not.toHaveBeenCalledWith(`${ORG_PING_PREFIX}k1`, expect.any(String));
    set.mockRestore();
  });
});

describe("computeUserHash", () => {
  it("is 16 hex characters of the lowercased email's SHA-256", async () => {
    const hash = await computeUserHash(" ADA@example.com ");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(await computeUserHash("ada@example.com"));
  });
});
