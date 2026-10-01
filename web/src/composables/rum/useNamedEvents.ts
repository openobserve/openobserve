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
import type { HistoryState } from "vue-router";
import api from "@/services/rumProductAnalytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { gt, type I18nText } from "@/types/i18n";
import { rumPaError } from "@/utils/rum/rumPaApiError";
import {
  MAX_EVENTS_PER_APP,
  parseNamedEvent,
  parseNamedEventDraft,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import {
  createScopedList,
  type ScopedListPermission,
  type ScopedListStatus,
} from "@/composables/rum/scopedList";
import { ANALYTICS_SUBTABS, type AnalyticsSubTab } from "@/utils/rum/productAnalyticsRoutes";

export type NamedEventsPermission = ScopedListPermission;
export type NamedEventsStatus = ScopedListStatus;
export type NamedEventDraft = Pick<NamedEvent, "app" | "name" | "rules"> & { id?: string };
export type FunnelUsage = { id: string; name: string };
export type NamedEventSaveResult = { kind: "saved"; event: NamedEvent } | { kind: "forbidden" };
export type BulkRemoval = { gone: string[]; inUse: { id: string; funnels: FunnelUsage[] }[] };
export type NamedEventHandoff = {
  draft: Pick<NamedEvent, "name" | "rules"> | null;
  pageHints: string[];
  from: AnalyticsSubTab | null;
};

const HANDOFF_KEY = "rumNamedEventHandoff";

const list = createScopedList<NamedEvent>({
  list: (org, app) => api.listEvents(org, app),
  parse: parseNamedEvent,
  loadFailed: () => gt("rum.analytics.events.loadFailed"),
});
const { items: events, permission, load, status, ensure, deny } = list;

const validRule = (r: unknown): r is NamedEvent["rules"][number] => {
  const rule = r as Record<string, unknown> | null;
  if (rule?.t === "view") return typeof rule.value === "string" && typeof rule.op === "string";
  return rule?.t === "action" && Array.isArray(rule.targets);
};

export function resetNamedEvents(): void {
  list.reset();
}

/** History state that opens the editor pre-filled and returns to `from` afterwards; it survives a reload. */
export function namedEventHandoffState(handoff: Partial<NamedEventHandoff>): HistoryState {
  const plain: NamedEventHandoff = {
    draft: handoff.draft ? { name: handoff.draft.name, rules: handoff.draft.rules } : null,
    pageHints: handoff.pageHints ?? [],
    from: handoff.from ?? null,
  };
  // History state is structured-cloned, which throws on the reactive proxies a caller may hold.
  return { [HANDOFF_KEY]: JSON.parse(JSON.stringify(plain)) };
}

export function readNamedEventHandoff(state: unknown): NamedEventHandoff {
  const stored = (state as Record<string, unknown> | null)?.[HANDOFF_KEY] as
    Record<string, unknown> | undefined;
  const draft = stored?.draft as Record<string, unknown> | null | undefined;
  const from = stored?.from as AnalyticsSubTab | undefined;
  return {
    draft:
      draft && typeof draft.name === "string" && Array.isArray(draft.rules)
        ? { name: draft.name, rules: draft.rules.filter(validRule) }
        : null,
    pageHints: Array.isArray(stored?.pageHints)
      ? stored.pageHints.filter((p): p is string => typeof p === "string")
      : [],
    from: from && ANALYTICS_SUBTABS.includes(from) ? from : null,
  };
}

export default function useNamedEvents() {
  // A 403 turns this app read-only; duplicate_name is the form's to show; anything else toasts.
  const guardWrite = async (org: string, app: string, e: unknown, failed: I18nText) => {
    const { status: httpStatus, code } = rumPaError(e);
    if (httpStatus === 403) {
      deny(org, app);
      toast({ variant: "error", message: gt("rum.analytics.events.readOnly") });
    } else if (code === "duplicate_name") return;
    else if (code === "limit_reached") {
      toast({ variant: "error", message: capMessage() });
      await load(org, app, true);
    } else if (code === "version_conflict" || code === "not_found") {
      const message = code === "not_found" ? "deletedElsewhere" : "conflictReloaded";
      toast({ variant: "error", message: gt(`rum.analytics.events.${message}`) });
      await load(org, app, true);
    } else if (httpStatus === 400)
      toast({ variant: "error", message: gt("rum.analytics.events.invalid") });
    else toast({ variant: "error", message: failed });
  };

  const capMessage = () => gt("rum.analytics.events.capReached", { max: MAX_EVENTS_PER_APP });

  // Raised before save's first await, so the toast always belongs to the editor that called save.
  const refuse = (message: I18nText): never => {
    toast({ variant: "error", message });
    throw new Error(message);
  };

  /** Resolves `forbidden` after a 403, which it has already toasted; any other refusal throws. */
  const save = async (
    org: string,
    app: string,
    draft: NamedEventDraft,
  ): Promise<NamedEventSaveResult> => {
    const isNew = !draft.id;
    if (isNew && events.value.length >= MAX_EVENTS_PER_APP) refuse(capMessage());
    const body = parseNamedEventDraft({ app, name: draft.name, rules: draft.rules }, app);
    if (!body) return refuse(gt("rum.analytics.events.invalid"));
    const payload = { name: body.name, rules: body.rules };
    // The edit counter of the list this editor saw; a newer one on the server is a version_conflict.
    const version = events.value.find((e) => e.id === draft.id)?.version ?? 1;
    let row: unknown;
    try {
      row = draft.id
        ? (await api.updateEvent(org, app, draft.id, { ...payload, version })).data
        : (await api.createEvent(org, app, payload)).data;
    } catch (e) {
      await guardWrite(org, app, e, gt("rum.analytics.events.saveFailed"));
      if (rumPaError(e).status === 403) return { kind: "forbidden" };
      throw e;
    }
    await load(org, app, true);
    const id = (row as { id?: unknown } | null)?.id;
    const saved = parseNamedEvent(row, app) ?? events.value.find((e) => e.id === id);
    if (!saved) throw new Error(gt("rum.analytics.events.invalid"));
    return { kind: "saved", event: saved };
  };

  /** Funnels still using the event; an empty list when there are none. */
  const usages = async (org: string, app: string, id: string): Promise<FunnelUsage[]> =>
    (await api.eventUsages(org, app, id)).data?.list ?? [];

  /** Null once deleted; the funnels named by an in-use refusal otherwise, so the caller can confirm and force. */
  const remove = async (
    org: string,
    app: string,
    id: string,
    force = false,
  ): Promise<FunnelUsage[] | null> => {
    if (!events.value.some((e) => e.id === id)) return null;
    try {
      await api.deleteEvent(org, app, id, force);
    } catch (e) {
      const { code, funnels } = rumPaError(e);
      if (code === "event_in_use") return funnels ?? [];
      if (code !== "not_found") {
        await guardWrite(org, app, e, gt("rum.analytics.events.deleteFailed"));
        throw e;
      }
    }
    await load(org, app, true);
    return null;
  };

  /** Deletes every id at once, forcing those in `forced`; in-use refusals come back for the caller to confirm. */
  const removeMany = async (
    org: string,
    app: string,
    ids: readonly string[],
    forced: readonly string[],
  ): Promise<BulkRemoval> => {
    const results = await Promise.allSettled(
      ids.map((id) => api.deleteEvent(org, app, id, forced.includes(id))),
    );
    const out: BulkRemoval = { gone: [], inUse: [] };
    let failed: { reason: unknown } | null = null;
    for (const [i, r] of results.entries()) {
      const err = r.status === "rejected" ? { reason: r.reason, ...rumPaError(r.reason) } : null;
      if (!err || err.code === "not_found") out.gone.push(ids[i]);
      else if (err.code === "event_in_use")
        out.inUse.push({ id: ids[i], funnels: err.funnels ?? [] });
      else failed ??= err;
    }
    if (failed) await guardWrite(org, app, failed.reason, gt("rum.analytics.events.deleteFailed"));
    await load(org, app, true);
    return out;
  };

  return {
    events: computed(() => events.value),
    permission: computed(() => permission.value),
    invalidCount: computed(() => list.invalidCount.value),
    loading: computed(() => list.loading.value),
    load,
    status,
    ensure,
    save,
    usages,
    remove,
    removeMany,
  };
}
