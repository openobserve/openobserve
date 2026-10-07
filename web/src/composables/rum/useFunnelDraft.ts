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

import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  type ComputedRef,
} from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useSavedFunnels from "@/composables/rum/useSavedFunnels";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  MAX_FUNNELS_PER_APP,
  MIN_SAVED_STEPS,
  funnelParam,
  type NamedEvent,
  type SavedFunnel,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { forwardFunnelLink, isProductAnalyticsPath } from "@/utils/rum/funnelLinks";

export { forwardFunnelLink, isProductAnalyticsPath };

export type FunnelDraft = {
  dirty: ComputedRef<boolean>;
  confirmDiscard: () => Promise<boolean>;
  openSaved: (f: SavedFunnel) => Promise<boolean>;
  startNew: (def?: FunnelDef) => Promise<boolean>;
  toList: () => Promise<unknown>;
  builderLink: () => string;
};

export const emptyFunnel = (): FunnelDef => ({
  steps: [],
  unit: "sessions",
  window: "session",
  breakdown: null,
});

const signature = (d: FunnelDef) => JSON.stringify(funnelParam(d));

// Edits this tab made to each saved funnel, so a Back to a URL carrying them reopens them, not the stored steps.
const sessionEdits = new Map<string, string>();

export function resetFunnelDraft(): void {
  sessionEdits.clear();
}

/** Remembers the edits made to the opened saved funnel for as long as this tab lives. */
export function trackSessionEdits(): void {
  const pa = useProductAnalytics();
  watch(
    () => [pa.openedFunnel.value, pa.funnel.value] as const,
    ([opened, d]) => {
      if (!opened) return;
      if (signature(d) === signature(opened.def)) sessionEdits.delete(opened.id);
      else sessionEdits.set(opened.id, signature(d));
    },
    { deep: true },
  );
}

/** True when `d` is what this tab last had on screen while editing the saved funnel `id`. */
export const editedInSession = (id: string, d: FunnelDef): boolean =>
  sessionEdits.get(id) === signature(d);

// Only a ready events list can prove an event is gone; a create naming one would be refused.
export const hasDeletedStep = (d: FunnelDef, events: readonly NamedEvent[], ready: boolean) =>
  ready && d.steps.some((s) => s.kind === "e" && !events.some((e) => e.id === s.key));

export default function useFunnelDraft(): FunnelDraft {
  const pa = useProductAnalytics();
  const router = useRouter();
  const { confirm } = useConfirmDialog();
  const { t } = useI18nTyped();

  const dirty = computed(() => {
    const opened = pa.openedFunnel.value;
    return !!opened && signature(pa.funnel.value) !== signature(opened.def);
  });

  const confirmDiscard = async (): Promise<boolean> => {
    const opened = pa.openedFunnel.value;
    if (!dirty.value || !opened) return true;
    return confirm({
      title: t("rum.analytics.saved.discardTitle"),
      message: t("rum.analytics.saved.discardMessage", { name: raw(opened.name) }),
      confirmLabel: t("rum.analytics.saved.discard"),
    });
  };

  const toBuilder = () => pa.pushSubTab(router, PA_ROUTES.funnelBuilder);
  const toList = () => pa.pushSubTab(router, PA_ROUTES.funnels);

  /** Opens `f` in the builder; the funnel already open keeps its edits. */
  const openSaved = async (f: SavedFunnel): Promise<boolean> => {
    if (pa.openedFunnel.value?.id !== f.id) {
      if (!(await confirmDiscard())) return false;
      pa.openSavedFunnel(f);
    }
    await toBuilder();
    return true;
  };

  /** Opens the builder on an unsaved funnel, empty or from a quick start. */
  const startNew = async (def: FunnelDef = emptyFunnel()): Promise<boolean> => {
    if (!(await confirmDiscard())) return false;
    pa.detachSavedFunnel();
    pa.funnel.value = def;
    pa.lastSubTab.value = "funnels";
    await toBuilder();
    return true;
  };

  const builderLink = (): string => {
    const href = router.resolve({ name: PA_ROUTES.funnelBuilder, query: pa.toQuery() }).href;
    return `${window.location.origin}${href}`;
  };

  return { dirty, confirmDiscard, openSaved, startNew, toList, builderLink };
}

/** Asks before a route outside Product Analytics, or a reload, drops a saved funnel's unsaved edits. */
export function useFunnelLeaveGuard(draft: FunnelDraft): void {
  onBeforeRouteLeave((to) =>
    !draft.dirty.value || isProductAnalyticsPath(to.path) ? true : draft.confirmDiscard(),
  );
  const onUnload = (e: BeforeUnloadEvent) => {
    if (draft.dirty.value) e.preventDefault();
  };
  const listen = () => window.addEventListener("beforeunload", onUnload);
  const unlisten = () => window.removeEventListener("beforeunload", onUnload);
  onMounted(listen);
  onActivated(listen);
  onDeactivated(unlisten);
  onBeforeUnmount(unlisten);
}

/** Why the funnel on screen cannot be saved, saved as a copy, or overwritten; null when it can. */
export function useFunnelSaveBlockers(opts: {
  events: readonly NamedEvent[];
  eventsReady: boolean;
  compileSql?: (d: FunnelDef) => string | null;
}) {
  const pa = useProductAnalytics();
  const sf = useSavedFunnels();
  const { t } = useI18nTyped();

  // The stored sql must implement the stored def, so a funnel whose unit cannot be compiled here is not saved.
  const sql = computed(() => opts.compileSql?.(pa.funnel.value) ?? null);
  const uncompiled = computed<I18nText | null>(() => {
    if (pa.funnel.value.steps.length < MIN_SAVED_STEPS) {
      return t("rum.analytics.saved.needsTwoSteps");
    }
    return sql.value === null ? t("rum.analytics.saved.usersUnavailable") : null;
  });
  // A create cannot keep a deleted event's step, so Save as and Duplicate wait until it is removed.
  const copyBlocked = computed<I18nText | null>(() => {
    if (uncompiled.value) return uncompiled.value;
    if (hasDeletedStep(pa.funnel.value, opts.events, opts.eventsReady)) {
      return t("rum.analytics.saved.deletedStepFirst");
    }
    if (sf.funnels.value.length >= MAX_FUNNELS_PER_APP) {
      return t("rum.analytics.saved.capReached", { max: MAX_FUNNELS_PER_APP });
    }
    return null;
  });
  // An unchanged opened funnel would only bump its version.
  const saveBlocked = computed<I18nText | null>(() => {
    const opened = pa.openedFunnel.value;
    if (!opened) return copyBlocked.value;
    if (signature(pa.funnel.value) === signature(opened.def))
      return t("rum.analytics.saved.noChanges");
    return uncompiled.value;
  });
  return { sql, uncompiled, copyBlocked, saveBlocked };
}
