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

import { computed, effectScope, reactive, watch, type ComputedRef } from "vue";
import { useStore } from "vuex";

import config from "@/aws-exports";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import authz, {
  AUTHZ_CHECK_MAX_ITEMS,
  type AuthzAction,
  type AuthzCheckItem,
  type AuthzResource,
} from "@/services/authz";

export type { AuthzAction, AuthzResource } from "@/services/authz";

/** `pending` = not answered yet; gated controls stay hidden so they appear late and never vanish. */
export type CanStatus = "allowed" | "denied" | "pending";

export interface UseCan {
  /** True only once the control is known to be usable. */
  can: (
    resource: AuthzResource,
    id: string,
    action: AuthzAction,
    folder?: string,
    streamType?: string,
  ) => boolean;
  status: (
    resource: AuthzResource,
    id: string,
    action: AuthzAction,
    folder?: string,
    streamType?: string,
  ) => CanStatus;
  /** `undefined` until the first answer for the current org. */
  enforced: ComputedRef<boolean | undefined>;
  ready: ComputedRef<boolean>;
  /** Call from the catch block of an edit/delete write so a 403 latches that control closed. */
  noteWriteDenied: (
    err: unknown,
    resource: AuthzResource,
    id: string,
    action: AuthzAction,
    folder?: string,
    streamType?: string,
  ) => void;
}

interface Entry {
  allowed: boolean;
  at: number;
}

interface Queued {
  org: string;
  key: string;
  item: AuthzCheckItem;
}

export const AUTHZ_CACHE_TTL_MS = 60_000;
const SESSION_PREFIX = "o2.authz.enforced.";
const SKIPPED_NAMES_SHOWN = 5;

const state = reactive({
  entries: {} as Record<string, Entry>,
  latched: {} as Record<string, true>,
  enforced: {} as Record<string, boolean | undefined>,
});

const queue = new Map<string, Queued>();
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let orgWatchStarted = false;

/** Tests only — the cache is module state and outlives a component. */
export function resetCanCache(): void {
  state.entries = {};
  state.latched = {};
  state.enforced = {};
  queue.clear();
  inFlight.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  orgWatchStarted = false;
}

/** Splits rows into the ones the user may act on and the ones that will be skipped. */
export function splitByPermission<T>(
  rows: T[],
  isAllowed: (row: T) => boolean,
): { allowed: T[]; skipped: T[] } {
  const allowed: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) (isAllowed(row) ? allowed : skipped).push(row);
  return { allowed, skipped };
}

/** The "Skipped: a, b +N more" line under a partial bulk-delete confirm; empty when nothing is skipped. */
export function skippedNamesText(t: TranslateFn, names: string[]): I18nText {
  if (!names.length) return raw("");
  const shown = names.slice(0, SKIPPED_NAMES_SHOWN).join(", ");
  const rest = names.length - SKIPPED_NAMES_SHOWN;
  return rest > 0
    ? t("authz.skippedNamesMore", { names: shown, count: rest })
    : t("authz.skippedNames", { names: shown });
}

// OSS never enforces per-object permissions, so it never needs the round trip.
function gatingPossible(): boolean {
  return (
    config.isEnterprise == "true" ||
    config.isCloud == "true" ||
    Boolean(import.meta.env.DEV && import.meta.env.VITE_AUTHZ_STUB)
  );
}

function keyOf(org: string, item: AuthzCheckItem): string {
  return [org, item.resource, item.id, item.action, item.folder ?? "", item.stream_type ?? ""].join(
    "|",
  );
}

function readSessionEnforced(org: string): boolean | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + org);
    return raw === null ? undefined : raw === "1";
  } catch {
    return undefined;
  }
}

function writeSessionEnforced(org: string, value: boolean | undefined): void {
  try {
    if (value === undefined) sessionStorage.removeItem(SESSION_PREFIX + org);
    else sessionStorage.setItem(SESSION_PREFIX + org, value ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still applies.
  }
}

function hydrateEnforced(org: string): void {
  if (!org || org in state.enforced) return;
  const stored = readSessionEnforced(org);
  if (stored !== undefined) state.enforced[org] = stored;
}

function setEnforced(org: string, value: boolean): void {
  state.enforced[org] = value;
  writeSessionEnforced(org, value);
}

function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

function enqueue(org: string, key: string, item: AuthzCheckItem): void {
  if (inFlight.has(key) || queue.has(key)) return;
  queue.set(key, { org, key, item });
  if (!flushTimer) flushTimer = setTimeout(flushQueue, 0);
}

function applyResults(batch: Queued[], enforced: boolean, results: { allowed: boolean | null }[]) {
  const org = batch[0].org;
  setEnforced(org, enforced);
  const now = Date.now();
  batch.forEach((q, i) => {
    state.entries[q.key] = { allowed: !enforced || results[i]?.allowed !== false, at: now };
  });
}

async function sendBatch(batch: Queued[]): Promise<void> {
  const org = batch[0].org;
  batch.forEach((q) => inFlight.add(q.key));
  try {
    const res = await authz.check(
      org,
      batch.map((q) => q.item),
    );
    applyResults(batch, Boolean(res.data?.enforced), res.data?.results ?? []);
  } catch (err) {
    // An older backend has no endpoint: behave exactly as before for the rest of the session.
    if (httpStatus(err) === 404) setEnforced(org, false);
    const now = Date.now();
    batch.forEach((q) => (state.entries[q.key] = { allowed: true, at: now }));
  } finally {
    batch.forEach((q) => inFlight.delete(q.key));
  }
}

async function flushQueue(): Promise<void> {
  flushTimer = null;
  const byOrg = new Map<string, Queued[]>();
  for (const q of queue.values()) {
    if (!byOrg.has(q.org)) byOrg.set(q.org, []);
    byOrg.get(q.org)!.push(q);
  }
  queue.clear();
  const sends: Promise<void>[] = [];
  for (const items of byOrg.values()) {
    for (let i = 0; i < items.length; i += AUTHZ_CHECK_MAX_ITEMS) {
      sends.push(sendBatch(items.slice(i, i + AUTHZ_CHECK_MAX_ITEMS)));
    }
  }
  await Promise.all(sends);
}

/** Tests only — runs the pending batch now instead of on the next macrotask. */
export async function flushCanQueue(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  await flushQueue();
}

function statusFor(org: string, item: AuthzCheckItem): CanStatus {
  if (!gatingPossible() || !org) return "allowed";
  const key = keyOf(org, item);
  if (state.latched[key]) return "denied";
  if (state.enforced[org] === false) return "allowed";
  const entry = state.entries[key];
  if (!entry) {
    enqueue(org, key, item);
    return "pending";
  }
  if (Date.now() - entry.at > AUTHZ_CACHE_TTL_MS) enqueue(org, key, item);
  return entry.allowed ? "allowed" : "denied";
}

function startOrgWatch(orgId: () => string): void {
  if (orgWatchStarted) return;
  orgWatchStarted = true;
  effectScope(true).run(() => {
    watch(orgId, (org, previous) => {
      if (org === previous) return;
      state.entries = {};
      state.latched = {};
      hydrateEnforced(org);
    });
  });
}

function buildItem(
  resource: AuthzResource,
  id: string,
  action: AuthzAction,
  folder?: string,
  streamType?: string,
): AuthzCheckItem {
  const item: AuthzCheckItem = { resource, id: String(id ?? ""), action };
  if (folder) item.folder = folder;
  if (streamType) item.stream_type = streamType;
  return item;
}

export function useCan(): UseCan {
  const store = useStore();
  const orgId = (): string => store.state.selectedOrganization?.identifier ?? "";
  hydrateEnforced(orgId());
  startOrgWatch(orgId);

  const status: UseCan["status"] = (resource, id, action, folder, streamType) =>
    statusFor(orgId(), buildItem(resource, id, action, folder, streamType));

  const can: UseCan["can"] = (...args) => status(...args) === "allowed";

  const enforced = computed<boolean | undefined>(() =>
    gatingPossible() ? state.enforced[orgId()] : false,
  );
  const ready = computed(() => enforced.value !== undefined);

  const noteWriteDenied: UseCan["noteWriteDenied"] = (
    err,
    resource,
    id,
    action,
    folder,
    streamType,
  ) => {
    const org = orgId();
    if (httpStatus(err) !== 403 || !org) return;
    state.latched[keyOf(org, buildItem(resource, id, action, folder, streamType))] = true;
    // A 403 means the role changed under us: revalidate everything without hiding what is cached.
    for (const entry of Object.values(state.entries)) entry.at = 0;
    if (state.enforced[org] === false) {
      state.enforced[org] = undefined;
      writeSessionEnforced(org, undefined);
    }
  };

  return { can, status, enforced, ready, noteWriteDenied };
}
