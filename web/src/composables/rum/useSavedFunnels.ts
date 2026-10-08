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

import { computed } from "vue";
import api from "@/services/rumProductAnalytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { gt, type I18nText } from "@/types/i18n";
import { rumPaError } from "@/utils/rum/rumPaApiError";
import {
  MAX_FUNNELS_PER_APP,
  fitsSqlCap,
  parseSavedFunnel,
  parseSavedFunnelDraft,
  type SavedFunnel,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";
import { createScopedList } from "@/composables/rum/scopedList";

export type SavedFunnelDraft = { name: string; description?: string; def: FunnelDef; sql: string };
export type SaveFunnelResult =
  | { kind: "saved"; funnel: SavedFunnel }
  | { kind: "conflict"; current: SavedFunnel }
  | { kind: "duplicate" }
  | { kind: "gone" }
  | { kind: "forbidden" };

const list = createScopedList<SavedFunnel>({
  list: (org, app) => api.listFunnels(org, app),
  parse: parseSavedFunnel,
  loadFailed: () => gt("rum.analytics.saved.loadFailed"),
});
const { items: funnels, permission, load, status, ensure, deny } = list;

export function resetSavedFunnels(): void {
  list.reset();
}

const fold = (name: string) => name.trim().toLowerCase();

const capMessage = () => gt("rum.analytics.saved.capReached", { max: MAX_FUNNELS_PER_APP });

// Raised before save's first await, so the toast belongs to the dialog that called save.
const refuse = (message: I18nText): never => {
  toast({ variant: "error", message });
  throw new Error(message);
};

export default function useSavedFunnels() {
  /** One funnel by id, for a link that arrives before the list; null only when confirmed absent or unreadable. */
  const fetchOne = async (
    org: string,
    app: string,
    id: string,
  ): Promise<SavedFunnel | null | "failed"> => {
    try {
      return parseSavedFunnel((await api.getFunnel(org, app, id)).data, app);
    } catch (e) {
      return rumPaError(e).status === 404 ? null : "failed";
    }
  };

  const nameTaken = (name: string, exceptId?: string): boolean =>
    funnels.value.some((f) => f.id !== exceptId && fold(f.name) === fold(name));

  // A 403 turns this app read-only and says so, since the read-only note is hidden on phones.
  const guardWrite = async (org: string, app: string, e: unknown, failed: I18nText) => {
    const { status: httpStatus, code } = rumPaError(e);
    if (httpStatus === 403) {
      deny(org, app);
      toast({ variant: "error", message: gt("rum.analytics.saved.readOnly") });
    } else if (code === "limit_reached") {
      toast({ variant: "error", message: capMessage() });
      await load(org, app, true);
    } else if (code === "unknown_event") {
      toast({ variant: "error", message: gt("rum.analytics.saved.unknownEvent") });
    } else if (httpStatus === 400)
      toast({ variant: "error", message: gt("rum.analytics.saved.invalid") });
    else toast({ variant: "error", message: failed });
  };

  /** Creates without `opened`, else updates at the opened version; a 403 resolves `forbidden`, already toasted. */
  const save = async (
    org: string,
    app: string,
    draft: SavedFunnelDraft,
    opened?: { id: string; version: number },
  ): Promise<SaveFunnelResult> => {
    if (!opened && funnels.value.length >= MAX_FUNNELS_PER_APP) refuse(capMessage());
    if (!fitsSqlCap(draft.sql)) refuse(gt("rum.analytics.saved.sqlTooLarge"));
    const body = parseSavedFunnelDraft(draft);
    if (!body) return refuse(gt("rum.analytics.saved.invalid"));
    let row: unknown;
    try {
      row = opened
        ? (await api.updateFunnel(org, app, opened.id, { ...body, version: opened.version })).data
        : (await api.createFunnel(org, app, body)).data;
    } catch (e) {
      const err = rumPaError(e);
      if (err.code === "duplicate_name") return { kind: "duplicate" };
      if (err.code === "not_found" && opened) {
        await load(org, app, true);
        return { kind: "gone" };
      }
      const theirs = err.code === "version_conflict" ? parseSavedFunnel(err.current, app) : null;
      if (theirs) return { kind: "conflict", current: theirs };
      await guardWrite(org, app, e, gt("rum.analytics.saved.saveFailed"));
      if (err.status === 403) return { kind: "forbidden" };
      throw e;
    }
    await load(org, app, true);
    const id = (row as { id?: unknown } | null)?.id;
    const funnel = parseSavedFunnel(row, app) ?? funnels.value.find((f) => f.id === id);
    if (!funnel) throw new Error(gt("rum.analytics.saved.invalid"));
    return { kind: "saved", funnel };
  };

  const remove = async (org: string, app: string, id: string): Promise<void> => {
    try {
      await api.deleteFunnel(org, app, id);
    } catch (e) {
      if (rumPaError(e).code !== "not_found") {
        await guardWrite(org, app, e, gt("rum.analytics.saved.deleteFailed"));
        throw e;
      }
    }
    await load(org, app, true);
  };

  /** Deletes each of `ids` and reloads once; resolves to the ids now gone, a funnel already gone among them. */
  const removeMany = async (org: string, app: string, ids: string[]): Promise<string[]> => {
    const results = await Promise.allSettled(ids.map((id) => api.deleteFunnel(org, app, id)));
    const gone = results.map(
      (r) => r.status === "fulfilled" || rumPaError(r.reason).code === "not_found",
    );
    const failure = results.find((r, i): r is PromiseRejectedResult => !gone[i]);
    if (failure) await guardWrite(org, app, failure.reason, gt("rum.analytics.saved.deleteFailed"));
    await load(org, app, true);
    return ids.filter((_, i) => gone[i]);
  };

  return {
    funnels: computed(() => funnels.value),
    permission: computed(() => permission.value),
    invalidCount: computed(() => list.invalidCount.value),
    loading: computed(() => list.loading.value),
    loadedAt: computed(() => list.loadedAt.value),
    load,
    status,
    ensure,
    fetchOne,
    nameTaken,
    save,
    remove,
    removeMany,
  };
}
