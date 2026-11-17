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

import { reactive } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { BulkKind } from "./useBulkReview";

/** How long a just-added alert waits for a pass to count it before the page stops polling for one. */
export const ADDED_KEEP_MS = 30 * 60_000;

interface Added {
  org: string;
  at: number;
}

/** Alerts this session created, keyed by service and class, until the analysis pass after them sees them. */
const created = reactive(new Map<string, Added>());

const keyOf = (serviceKey: string, cls: BulkKind): string => `${cls}\u0000${serviceKey}`;

/** The key the store uses for one service in one cluster and namespace of one org. */
export const serviceKeyOf = (
  org: string,
  service: string,
  cluster: string | null,
  namespace: string | null,
): string => [org, service, cluster ?? "", namespace ?? ""].join("\u0000");

const orgOf = (serviceKey: string): string => serviceKey.split("\u0000")[0];

const fresh = (entry: Added, now: number): boolean => now - entry.at <= ADDED_KEEP_MS;

const has = (serviceKey: string, cls: BulkKind, now: number = Date.now()): boolean => {
  const entry = created.get(keyOf(serviceKey, cls));
  return !!entry && fresh(entry, now);
};

const add = (serviceKey: string, cls: BulkKind, at: number = Date.now()): void => {
  created.set(keyOf(serviceKey, cls), { org: orgOf(serviceKey), at });
};

const remove = (serviceKey: string, cls: BulkKind): void => {
  created.delete(keyOf(serviceKey, cls));
};

/** Forgets every alert of `org` created before its pass at `passAt` (ms), which already counts them. */
const clearOnPass = (org: string, passAt: number): void => {
  for (const [key, entry] of created)
    if (entry.org === org && entry.at <= passAt) created.delete(key);
};

/** Whether an alert of `org` created after its pass at `passAt` (ms) still waits to be counted. */
const waiting = (org: string, passAt: number = 0, now: number = Date.now()): boolean => {
  for (const entry of created.values())
    if (entry.org === org && entry.at > passAt && fresh(entry, now)) return true;
  return false;
};

export const useRecentlyCreated = () => ({ has, add, remove, clearOnPass, waiting });

/** The just-added kind each coverage check is filled by. */
export const KIND_OF_CHECK = { errors: "errors", latency: "latency", absence: "no_data" } as const;

// Coverage and the gap suggestions are what an add changes, so every page reads them again.
export const refreshAfterAdd = (org: string): void => {
  void queryClient.invalidateQueries({ queryKey: autoobserveKeys.coverageAll(org) });
  void queryClient.invalidateQueries({ queryKey: autoobserveKeys.suggestions(org) });
};

const SAVED_KIND: Record<string, BulkKind> = {
  errors: "errors",
  latency: "latency",
  no_data: "no_data",
};

/** Remembers an alert the alert form saved from an AutoObserve draft, as the review list does for its own. */
export const noteSavedDraft = (org: string, meta: Record<string, unknown> | null | undefined) => {
  const service = meta?.service as
    { name?: string; cluster?: string | null; namespace?: string | null } | undefined;
  const kind = SAVED_KIND[String(meta?.check ?? "")];
  if (!org || !service?.name || !kind) return;
  add(serviceKeyOf(org, service.name, service.cluster ?? null, service.namespace ?? null), kind);
  refreshAfterAdd(org);
};

/** The one line every surface shows for alerts it just added, in place of their Add button. */
export const addedNote = (t: TranslateFn, count: number = 1): I18nText =>
  t("insight.kind.cell.justAdded", { count }, count);
