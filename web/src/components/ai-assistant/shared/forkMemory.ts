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

import type { ForkSeed } from "@/composables/assistant/pure";
import { computeUserOrgKey } from "@/utils/userOrgKey";

/** One fork of a share made in this browser; the token is the link's credential, so only its hash is stored. */
export interface ForkEntry {
  tokenHash: string;
  sessionId: string;
  at: number;
}

const KEY_PREFIX = "o2.assistant.forks:";
const MAX_ENTRIES = 50;
const MAX_TOKEN = 256;

// The seed the first open reads until the record keeps it; a reload elsewhere honestly has none.
const seeds = new Map<string, ForkSeed>();

/** SHA-256 of `share:{token}`, hex; equal tokens give equal hashes and the token never reaches storage. */
export async function hashShareToken(token: string): Promise<string> {
  if (!token) return "";
  return computeUserOrgKey("share", token);
}

/** This browser's forks of the share whose token hashes to `tokenHash`, oldest first. */
export function forksOf(userOrgKey: string, tokenHash: string): ForkEntry[] {
  if (!tokenHash) return [];
  return readForks(userOrgKey).filter((entry) => entry.tokenHash === tokenHash);
}

/** Read-merge-write, newest last, capped so the key never grows past 50 entries. */
export function rememberFork(userOrgKey: string, entry: ForkEntry): void {
  if (!userOrgKey) return;
  const next = [...readForks(userOrgKey).filter((e) => e.sessionId !== entry.sessionId), entry];
  try {
    localStorage.setItem(KEY_PREFIX + userOrgKey, JSON.stringify(next.slice(-MAX_ENTRIES)));
  } catch {
    // A full or blocked storage only costs the "Open my copy" shortcut.
  }
}

export function readForks(userOrgKey: string): ForkEntry[] {
  if (!userOrgKey) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + userOrgKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.flatMap(toEntry).slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function keepForkSeed(sessionId: string, seed: ForkSeed): void {
  seeds.set(sessionId, seed);
}

export function forkSeedOf(sessionId: string): ForkSeed | undefined {
  return seeds.get(sessionId);
}

function toEntry(value: unknown): ForkEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const { tokenHash, sessionId, at } = value as Record<string, unknown>;
  if (typeof tokenHash !== "string" || !tokenHash || tokenHash.length > MAX_TOKEN) return [];
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > MAX_TOKEN) return [];
  return [{ tokenHash, sessionId, at: typeof at === "number" && Number.isFinite(at) ? at : 0 }];
}
