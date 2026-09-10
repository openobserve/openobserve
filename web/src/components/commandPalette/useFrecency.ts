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

import { ref, type Ref } from "vue";
import settings from "@/services/settings";
import type { FrecencyBucketName, FrecencyDoc, FrecencyRecord, PaletteSnapshot } from "./types";

const SETTING_KEY = "command_palette";
const SETTING_CATEGORY = "ui";
const LOCAL_KEY = "o2.commandPalette";
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 100;
const PERSIST_DEBOUNCE_MS = 2000;

// Module-level shared state: one doc for every consumer, like useFavoriteDashboards.
const doc: Ref<FrecencyDoc> = ref(emptyDoc());
const currentOrg = ref("");
const currentUser = ref("");
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emptyDoc(): FrecencyDoc {
  return { v: 1, buckets: {} };
}

function isRecord(r: unknown): r is FrecencyRecord {
  const x = r as FrecencyRecord;
  return (
    !!x &&
    typeof x.item_id === "string" &&
    typeof x.count === "number" &&
    typeof x.last === "number"
  );
}

function isSnapshot(s: unknown): s is PaletteSnapshot {
  const x = s as PaletteSnapshot;
  return (
    !!x && typeof x.type === "string" && typeof x.label === "string" && typeof x.icon === "string"
  );
}

function withValidSnapshot(r: FrecencyRecord): FrecencyRecord {
  const { item, ...rest } = r;
  return isSnapshot(item) ? { ...rest, item } : rest;
}

function sanitize(input: unknown): FrecencyDoc {
  const out = emptyDoc();
  const buckets = (input as FrecencyDoc | undefined)?.buckets;
  if (!buckets || typeof buckets !== "object") return out;
  for (const [org, byBucket] of Object.entries(buckets)) {
    if (!byBucket || typeof byBucket !== "object") continue;
    out.buckets[org] = {};
    for (const [bucket, records] of Object.entries(byBucket)) {
      if (Array.isArray(records)) {
        out.buckets[org][bucket as FrecencyBucketName] = records
          .filter(isRecord)
          .map(withValidSnapshot);
      }
    }
  }
  return out;
}

function mergeRecord(prev: FrecencyRecord, next: FrecencyRecord): FrecencyRecord {
  const merged: FrecencyRecord = {
    item_id: next.item_id,
    count: Math.max(prev.count, next.count),
    last: Math.max(prev.last, next.last),
  };
  const item = (next.last >= prev.last ? next.item : prev.item) ?? prev.item ?? next.item;
  if (item) merged.item = item;
  return merged;
}

// Per item: the higher count and the later timestamp win, so local-only visits survive a server load.
function mergeDocs(local: FrecencyDoc, server: FrecencyDoc): FrecencyDoc {
  const out = emptyDoc();
  const orgs = new Set([...Object.keys(local.buckets), ...Object.keys(server.buckets)]);
  for (const org of orgs) {
    out.buckets[org] = {};
    const buckets = new Set([
      ...Object.keys(local.buckets[org] ?? {}),
      ...Object.keys(server.buckets[org] ?? {}),
    ]) as Set<FrecencyBucketName>;
    for (const bucket of buckets) {
      const byId = new Map<string, FrecencyRecord>();
      for (const r of [
        ...(server.buckets[org]?.[bucket] ?? []),
        ...(local.buckets[org]?.[bucket] ?? []),
      ]) {
        const prev = byId.get(r.item_id);
        byId.set(r.item_id, prev ? mergeRecord(prev, r) : r);
      }
      out.buckets[org][bucket] = [...byId.values()];
    }
  }
  return out;
}

function readLocal(): FrecencyDoc | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(value: FrecencyDoc): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
  } catch {
    // Storage may be full or disabled; the server copy is the durable one.
  }
}

/** Decayed score: each selection is worth 1 and halves every HALF_LIFE_MS. */
export function frecencyScore(record: FrecencyRecord, now: number = Date.now()): number {
  const age = Math.max(0, now - record.last);
  return record.count * Math.pow(0.5, age / HALF_LIFE_MS);
}

function bucketRecords(bucket: FrecencyBucketName, org: string): FrecencyRecord[] {
  return doc.value.buckets[org]?.[bucket] ?? [];
}

function setBucketRecords(
  bucket: FrecencyBucketName,
  org: string,
  records: FrecencyRecord[],
): void {
  const byBucket = doc.value.buckets[org] ?? {};
  byBucket[bucket] = records;
  doc.value = { v: 1, buckets: { ...doc.value.buckets, [org]: byBucket } };
}

function schedulePersist(): void {
  writeLocal(doc.value);
  if (!currentOrg.value || !currentUser.value) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    settings
      .setUserSetting(currentOrg.value, currentUser.value, SETTING_KEY, doc.value, SETTING_CATEGORY)
      .catch(() => {
        // Best effort: localStorage already holds the change and a later save retries.
      });
  }, PERSIST_DEBOUNCE_MS);
}

export function useFrecency() {
  /** localStorage first for an instant first paint, then the server copy wins. */
  const load = async (org: string, userId: string): Promise<void> => {
    currentOrg.value = org;
    currentUser.value = userId;
    const local = readLocal();
    if (local) doc.value = local;
    if (!org || !userId) return;
    try {
      const res = await settings.getSetting(org, SETTING_KEY, userId);
      const value = res?.data?.setting_value;
      if (value && typeof value === "object") {
        doc.value = mergeDocs(doc.value, sanitize(value));
        writeLocal(doc.value);
      }
    } catch {
      // Missing setting / 404: nothing recorded yet for this user.
    }
  };

  /** `persist: false` keeps the record in localStorage only; a later palette selection uploads the merged doc. */
  const record = (
    bucket: FrecencyBucketName,
    itemId: string,
    now: number = Date.now(),
    persist: boolean = true,
    snapshot?: PaletteSnapshot,
  ): void => {
    const org = currentOrg.value;
    if (!org || !itemId) return;
    const records = bucketRecords(bucket, org).filter((r) => r.item_id !== itemId);
    const existing = bucketRecords(bucket, org).find((r) => r.item_id === itemId);
    const next: FrecencyRecord = { item_id: itemId, count: (existing?.count ?? 0) + 1, last: now };
    const item = snapshot ?? existing?.item;
    if (item) next.item = item;
    records.push(next);
    // Cap by decayed score so a burst of new items evicts stale ones, not fresh ones.
    records.sort((a, b) => frecencyScore(b, now) - frecencyScore(a, now));
    setBucketRecords(bucket, org, records.slice(0, MAX_RECORDS));
    if (persist) schedulePersist();
    else writeLocal(doc.value);
  };

  const scores = (bucket: FrecencyBucketName, now: number = Date.now()): Map<string, number> => {
    const out = new Map<string, number>();
    for (const r of bucketRecords(bucket, currentOrg.value))
      out.set(r.item_id, frecencyScore(r, now));
    return out;
  };

  /** Display snapshots stored with entity records, keyed by item id. */
  const snapshots = (bucket: FrecencyBucketName): Map<string, PaletteSnapshot> => {
    const out = new Map<string, PaletteSnapshot>();
    for (const r of bucketRecords(bucket, currentOrg.value)) if (r.item) out.set(r.item_id, r.item);
    return out;
  };

  const topItems = (
    bucket: FrecencyBucketName,
    limit: number,
    now: number = Date.now(),
  ): string[] =>
    [...scores(bucket, now).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

  const reset = (): void => {
    doc.value = emptyDoc();
    currentOrg.value = "";
    currentUser.value = "";
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
  };

  return { doc, currentOrg, load, record, scores, snapshots, topItems, reset };
}
