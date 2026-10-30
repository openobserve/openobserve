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

import { trackAssistant } from "@/services/assistantAnalytics";

import type { AssistantHint, HintChannel } from "./assistantStore.types";

/** Same-browser channel of one user+org; the per-org hints travel here. */
export const ORG_CHANNEL_PREFIX = "o2-assistant:";

/** Same-browser channel of one user whatever the org: `signed_out` and the turn mirrors. */
export const USER_CHANNEL_PREFIX = "o2-assistant-user:";

/** The `localStorage` ping keys a browser without `BroadcastChannel` uses instead. */
export const ORG_PING_PREFIX = "o2-assistant-ping:";

export const USER_PING_PREFIX = "o2-assistant-ping-user:";

// Ids are UUIDs and orgs short identifiers; anything longer is not a hint.
const MAX_ID_CHARS = 200;

const USER_TYPES: ReadonlySet<AssistantHint["type"]> = new Set([
  "signed_out",
  "turn_started",
  "turn_ended",
]);

const TURN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);

const PREF_KEYS: ReadonlySet<string> = new Set(["prompt_history", "sidebar_width", "sidebar_mode"]);

const HISTORY_OPS: ReadonlySet<string> = new Set(["create", "rename", "pin", "delete", "clear"]);

// The cross-tab telemetry dedupe never holds more episodes than this.
const MAX_EPISODES = 200;

type HintHandler = (hint: AssistantHint) => void;

/** One end of a channel: `BroadcastChannel` when the browser has it, else the ping key. */
interface Endpoint {
  post(hint: AssistantHint): void;
  listen(on: ((hint: AssistantHint) => void) | null): void;
  close(): void;
}

/** The binding `HintChannel` plus the user channel and the per-key send cache. */
export interface AssistantHintChannel extends HintChannel {
  /** Binds the user channel; `null` on sign-out. */
  bindUser(email: string | null): Promise<void>;
  /** Posts on the channel of `userOrgKey`, the key a session captured, not the current one. */
  postFor(userOrgKey: string, hint: AssistantHint): void;
  /** The user channel's hash, the live-turn ledger's key; `null` until bound. */
  userHash(): string | null;
}

/** `sha256hex(lowercase(email)).slice(0, 16)`; djb2 where `crypto.subtle` is missing. */
export async function computeUserHash(email: string): Promise<string> {
  const value = email.trim().toLowerCase();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = (((hash << 5) + hash) ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** A received payload rebuilt field by field, so only ids, enums and timestamps ever reach a handler. */
export function toHint(value: unknown): AssistantHint | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || !isTime(raw.at)) return null;
  const at = raw.at;
  switch (raw.type) {
    case "turn_started":
      if (!ids(raw, "org", "sid", "turnId") || (raw.origin !== "chat" && raw.origin !== "rca"))
        return null;
      return {
        v: 1,
        type: raw.type,
        org: raw.org,
        sid: raw.sid,
        turnId: raw.turnId,
        origin: raw.origin,
        at,
      };
    case "turn_ended":
      if (!ids(raw, "org", "sid", "turnId") || !TURN_STATUSES.has(String(raw.status))) return null;
      return {
        v: 1,
        type: raw.type,
        org: raw.org,
        sid: raw.sid,
        turnId: raw.turnId,
        status: raw.status as Extract<AssistantHint, { type: "turn_ended" }>["status"],
        at,
      };
    default:
      return otherHint(raw, at);
  }
}

/** The same-browser hint channel; a receiver re-reads and never applies a payload as state. */
export function createHintChannel(userOrgKey: string): AssistantHintChannel {
  const handlers = new Map<AssistantHint["type"], Set<HintHandler>>();
  const endpoints = new Map<string, Endpoint>();
  let current = userOrgKey;
  let user: { hash: string; endpoint: Endpoint } | null = null;
  let closed = false;

  // A heartbeat repeats one episode's hint; telemetry counts each (kind, chat) episode once.
  const episodes = new Set<string>();
  const receive = (hint: AssistantHint) => {
    if (countsAsNew(episodes, hint)) trackAssistant("ai_cross_tab_hint", { type: hint.type });
    for (const handler of handlers.get(hint.type) ?? []) handler(hint);
  };
  const endpointFor = (key: string) => {
    let endpoint = endpoints.get(key);
    if (!endpoint) {
      endpoint = openEndpoint(`${ORG_CHANNEL_PREFIX}${key}`, `${ORG_PING_PREFIX}${key}`);
      endpoints.set(key, endpoint);
    }
    return endpoint;
  };
  // Only the current org's channel stays open, so org switches never pile up channels.
  const drop = (key: string) => {
    endpoints.get(key)?.close();
    endpoints.delete(key);
  };
  const bindOrg = (key: string) => {
    endpoints.get(current)?.listen(null);
    if (key !== current) drop(current);
    current = key;
    if (key) endpointFor(key).listen(receive);
  };
  const send = (key: string, hint: AssistantHint) => {
    if (closed) return;
    if (hint.type !== "signed_out" && key) {
      endpointFor(key).post(hint);
      if (key !== current) drop(key);
    }
    if (USER_TYPES.has(hint.type)) user?.endpoint.post(hint);
  };
  bindOrg(userOrgKey);

  return {
    post: (hint) => send(current, hint),
    postFor: send,
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as HintHandler);
      handlers.set(type, set);
      return () => set.delete(handler as HintHandler);
    },
    rebind(key) {
      if (key === current) return;
      episodes.clear();
      bindOrg(key);
    },
    async bindUser(email) {
      const hash = email ? await computeUserHash(email) : null;
      if (user && user.hash === hash) return;
      user?.endpoint.close();
      user = null;
      if (!hash || closed) return;
      const endpoint = openEndpoint(`${USER_CHANNEL_PREFIX}${hash}`, `${USER_PING_PREFIX}${hash}`);
      endpoint.listen((hint) => USER_TYPES.has(hint.type) && receive(hint));
      user = { hash, endpoint };
    },
    userHash: () => user?.hash ?? null,
    close() {
      closed = true;
      for (const endpoint of endpoints.values()) endpoint.close();
      endpoints.clear();
      user?.endpoint.close();
      user = null;
      handlers.clear();
    },
  };
}

function openEndpoint(name: string, pingKey: string): Endpoint {
  if (typeof BroadcastChannel !== "undefined") return broadcastEndpoint(name);
  return pingEndpoint(pingKey);
}

function broadcastEndpoint(name: string): Endpoint {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(name);
  } catch {
    channel = null;
  }
  return {
    post(hint) {
      try {
        channel?.postMessage(hint);
      } catch {
        // A closed channel or an uncloneable value is a lost hint, which receivers tolerate.
      }
    },
    listen(on) {
      if (!channel) return;
      channel.onmessage = on ? (event) => deliver(event.data, on) : null;
    },
    close() {
      channel?.close();
      channel = null;
    },
  };
}

// The value is removed on the next tick, so the key never holds a hint and every write fires `storage` again.
function pingEndpoint(key: string): Endpoint {
  let listener: ((event: StorageEvent) => void) | null = null;
  const stop = () => {
    if (listener) window.removeEventListener("storage", listener);
    listener = null;
  };
  return {
    post(hint) {
      try {
        localStorage.setItem(key, JSON.stringify(hint));
        setTimeout(() => {
          try {
            localStorage.removeItem(key);
          } catch {
            // Blocked storage never held the ping.
          }
        }, 0);
      } catch {
        // Blocked storage: the hint is lost and the next read is the truth.
      }
    },
    listen(on) {
      stop();
      if (!on || typeof window === "undefined") return;
      listener = (event) => {
        if (event.key !== key || !event.newValue) return;
        try {
          deliver(JSON.parse(event.newValue), on);
        } catch {
          // A malformed ping is ignored.
        }
      };
      window.addEventListener("storage", listener);
    },
    close: stop,
  };
}

function deliver(value: unknown, on: (hint: AssistantHint) => void): void {
  const hint = toHint(value);
  if (hint) on(hint);
}

function otherHint(raw: Record<string, unknown>, at: number): AssistantHint | null {
  switch (raw.type) {
    case "approval_pending":
      if (!ids(raw, "sid", "turnId") || !optionalId(raw.callId)) return null;
      return {
        v: 1,
        type: raw.type,
        sid: raw.sid,
        turnId: raw.turnId,
        ...callId(raw),
        ...(isTime(raw.expiresAt) && { expiresAt: raw.expiresAt }),
        at,
      };
    case "approval_resolved":
      if (!ids(raw, "sid") || !optionalId(raw.callId) || typeof raw.approved !== "boolean")
        return null;
      return { v: 1, type: raw.type, sid: raw.sid, ...callId(raw), approved: raw.approved, at };
    case "approval_stop":
      return ids(raw, "sid") ? { v: 1, type: raw.type, sid: raw.sid, at } : null;
    case "consent_granted":
      if (!ids(raw, "org") || raw.feature !== "ai_credits") return null;
      return { v: 1, type: raw.type, org: raw.org, feature: "ai_credits", at };
    case "signed_out":
      return { v: 1, type: raw.type, at };
    case "prefs_changed":
      if (!PREF_KEYS.has(String(raw.key))) return null;
      return {
        v: 1,
        type: raw.type,
        key: raw.key as Extract<AssistantHint, { type: "prefs_changed" }>["key"],
        at,
      };
    case "history_changed":
      if (!ids(raw, "sid") || !HISTORY_OPS.has(String(raw.op))) return null;
      return {
        v: 1,
        type: raw.type,
        sid: raw.sid,
        op: raw.op as Extract<AssistantHint, { type: "history_changed" }>["op"],
        at,
      };
    case "share_changed":
      return ids(raw, "sid") ? { v: 1, type: raw.type, sid: raw.sid, at } : null;
    default:
      return null;
  }
}

function ids<K extends string>(
  raw: Record<string, unknown>,
  ...keys: K[]
): raw is Record<string, unknown> & Record<K, string> {
  return keys.every((key) => isId(raw[key]));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_CHARS;
}

// Re-announcements of a pending card or a started turn belong to the episode their first hint opened; a new card or turn has new ids.
function countsAsNew(episodes: Set<string>, hint: AssistantHint): boolean {
  if (hint.type === "signed_out") episodes.clear();
  if (!("sid" in hint)) return true;
  if (hint.type === "approval_resolved") forget(episodes, `approval_pending:${hint.sid}:`);
  if (hint.type === "turn_ended") episodes.delete(`turn_started:${hint.sid}:${hint.turnId}`);
  if (hint.type !== "approval_pending" && hint.type !== "turn_started") return true;
  const id = hint.type === "approval_pending" ? (hint.callId ?? hint.turnId) : hint.turnId;
  const key = `${hint.type}:${hint.sid}:${id}`;
  if (episodes.has(key)) return false;
  // A holder that vanished never closes its episode; the set stays small all the same.
  if (episodes.size >= MAX_EPISODES) episodes.clear();
  episodes.add(key);
  return true;
}

function forget(episodes: Set<string>, prefix: string): void {
  for (const key of episodes) if (key.startsWith(prefix)) episodes.delete(key);
}

function optionalId(value: unknown): boolean {
  return value === undefined || isId(value);
}

function callId(raw: Record<string, unknown>): { callId?: string } {
  return isId(raw.callId) ? { callId: raw.callId } : {};
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
