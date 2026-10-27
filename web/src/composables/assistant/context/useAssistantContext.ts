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
  effectScope,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef,
} from "vue";

import { contextRegistry } from "@/composables/contextProviders/registry";
import { gt, raw, type I18nText, type TranslateFn } from "@/types/i18n";

import { isRunning, useAssistantStore, type AssistantStoreInternal } from "../assistantStore";
import type { Sid } from "../assistantStore.types";
import { getAssistantRuntime } from "../runtime";
import {
  serializedNameOf,
  attachmentSummary,
  browserTimezone,
  ghostChipsOf,
  isWhitelisted,
  pageChipsOf,
  seesRowsOf,
  timeChipOf,
  timeRangeText,
  timeWindowOf,
  type SeesRow,
  type TimeWindow,
} from "./contextChips";
import { sentWindows, wireContextOf } from "./serialize";
import type { ContextChip, PageContext } from "./types";

/** How often a visible container re-reads the page provider, so the tray follows the page (CT-01 AC 5). */
export const PAGE_POLL_MS = 1_000;

// One reader per tab: every tray shares the same page context.
const page: ShallowRef<PageContext | null> = /* @__PURE__ */ shallowRef(null);

let subscribers = 0;

let generation = 0;

let timer: ReturnType<typeof setInterval> | null = null;

let stopWatchers: (() => void) | null = null;

let reader: () => Promise<PageContext | null> = () => contextRegistry.getActiveContext();

export interface AssistantContextView {
  chips: ComputedRef<ContextChip[]>;
  timeChip: ComputedRef<ContextChip>;
  sees: ComputedRef<SeesRow[]>;
  disclosure: ComputedRef<I18nText>;
  removed: ComputedRef<ContextChip[]>;
  summary: ComputedRef<I18nText>;
  /** The page context the tray last read; `null` before the first read. */
  page: Readonly<ShallowRef<PageContext | null>>;
  /** The window the next message gets, or the running turn's while it runs. */
  window: ComputedRef<TimeWindow>;
  /** True when the page has no stream, so the placeholder is `placeholderEmpty`. */
  noScope: ComputedRef<boolean>;
}

export interface AssistantContextOptions {
  store?: AssistantStoreInternal;
  t?: TranslateFn;
  /** Overrides the registry read, for specs. */
  read?: () => Promise<PageContext | null>;
}

/** The tray, the sees popover and the placeholder of one session (`00` §6.3). */
export function useAssistantContext(
  sid: MaybeRefOrGetter<Sid | null>,
  options: AssistantContextOptions = {},
): AssistantContextView {
  const store = options.store ?? useAssistantStore();
  const t = options.t ?? gt;
  subscribe(store, options.read ?? (() => contextRegistry.getActiveContext()));

  // A chat of another user+org is never shown or summarised here (D21).
  const session = computed(() => {
    const found = store.state.sessions[toValue(sid) ?? ""];
    return found && found.userOrgKey === store.state.userOrgKey ? found : null;
  });
  const composer = computed(() => session.value?.composer ?? null);
  const org = computed(() => session.value?.org ?? String(page.value?.org_id ?? ""));
  const removedKeys = computed(() => composer.value?.removedPageKeys ?? []);

  const window = computed<TimeWindow>(() => {
    const current = session.value;
    const sent = current ? sentWindows.get(current.sid) : undefined;
    if (current && sent && isRunning(current.turn)) return sent;
    return timeWindowOf(page.value, composer.value?.timeOverride ?? null);
  });
  const timeChip = computed(() => timeChipOf(window.value, org.value, t));
  const stagedChips = computed(() => staged(composer.value?.chips ?? []));
  // With the interactive incident agent every chat turn carries the page's incident id, so it reads as sent.
  const incidentSent = computed(() => store.state.capability.rcaChatMode === true);
  const pageChips = computed(() =>
    supersededDropped(
      pageChipsOf(page.value, removedKeys.value, t).map((chip) =>
        incidentSent.value && chip.kind === "incident"
          ? { ...chip, sent: "whitelist" as const }
          : chip,
      ),
      stagedChips.value,
      page.value,
    ),
  );
  // Images live only in the composer's strip, never also in the tray (`40` §8).
  const chips = computed(() => [timeChip.value, ...pageChips.value, ...stagedChips.value]);
  const removed = computed(() => ghostChipsOf(page.value, removedKeys.value, t));

  const sees = computed<SeesRow[]>(() => {
    const wire = wireContextOf(
      page.value,
      {
        chips: composer.value?.chips ?? [],
        timeOverride: composer.value?.timeOverride ?? null,
        removedPageKeys: removedKeys.value,
      },
      { org: org.value, window: window.value },
    );
    const rows = seesRowsOf(
      { ...extrasOf(page.value), ...wire, currentPage: page.value?.currentPage ?? "" },
      {
        removed: removedKeys.value,
        window: window.value,
        timezone: browserTimezone(),
        pageLabel: pageLabelOf(t),
        t,
      },
    );
    if (incidentSent.value)
      for (const row of rows) if (row.id === "incident_id") row.group = "sent";
    const attached = stagedChips.value.filter((chip) => !!serializedNameOf(chip));
    if (attached.length === 0) return rows;
    return [
      ...rows,
      {
        id: "attachments",
        group: "sent",
        label: t("assistant.context.field.attachments"),
        value: attachmentSummary(attached, t),
        fields: [],
      },
    ];
  });

  const disclosure = computed(() =>
    session.value?.share
      ? t("assistant.context.disclosureShared")
      : t("assistant.context.disclosure"),
  );

  const scopeName = computed(() => {
    const streams = page.value?.selectedStreams;
    if (removedKeys.value.includes("selectedStreams")) return null;
    return Array.isArray(streams) && streams.length > 0 ? streams.join(", ") : null;
  });
  const summary = computed(() => {
    const range = timeRangeText(window.value, t);
    return scopeName.value
      ? t("assistant.context.summary", { scope: raw(scopeName.value), range })
      : range;
  });

  return {
    chips,
    timeChip,
    sees,
    disclosure,
    removed,
    summary,
    page,
    window,
    noScope: computed(() => scopeName.value === null),
  };
}

/** Re-reads the page provider now (a composer focus, a door); every tray follows. */
export function refreshPageContext(): void {
  void readPage();
}

/** Lets a spec start from no page context and no reader; never called by app code. */
export function resetAssistantContextForTests(): void {
  page.value = null;
  subscribers = 0;
  stopPolling();
  stopWatchers?.();
  stopWatchers = null;
  reader = () => contextRegistry.getActiveContext();
}

function subscribe(store: AssistantStoreInternal, read: () => Promise<PageContext | null>): void {
  reader = read;
  subscribers += 1;
  if (subscribers === 1) start(store);
  if (getCurrentScope())
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers > 0) return;
      stopPolling();
      stopWatchers?.();
      stopWatchers = null;
    });
}

// A module-owned scope that polls only while a container shows, outliving its first subscriber (CT-01 AC 15, S1).
function start(store: AssistantStoreInternal): void {
  void readPage();
  const route = () => getAssistantRuntime().context.value?.router?.currentRoute.value.fullPath;
  const scope = effectScope(true);
  scope.run(() => {
    watch(contextRegistry.version, () => void readPage());
    watch(route, () => void readPage());
    watch(
      () => store.state.shell.placement.kind !== "hidden",
      (shown) => (shown ? startPolling() : stopPolling()),
      { immediate: true },
    );
    // A dropped chat's sent window goes with it (S11).
    watch(
      () => Object.keys(store.state.sessions),
      (live) => {
        for (const sid of [...sentWindows.keys()]) if (!live.includes(sid)) sentWindows.delete(sid);
      },
    );
  });
  stopWatchers = () => scope.stop();
}

function startPolling(): void {
  if (timer !== null || typeof window === "undefined") return;
  void readPage();
  timer = setInterval(() => {
    if (document.visibilityState !== "hidden") void readPage();
  }, PAGE_POLL_MS);
}

function stopPolling(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

async function readPage(): Promise<void> {
  generation += 1;
  const asked = generation;
  const next = await reader().catch(() => null);
  if (asked !== generation) return;
  // Same content, same object, so the tray does not re-render once a second.
  if (JSON.stringify(next) !== JSON.stringify(page.value)) page.value = next;
}

// A door's chip for the page's own object (the incident a tab is about) replaces the page's copy of it.
function supersededDropped(
  pageChips: ContextChip[],
  stagedChips: readonly ContextChip[],
  page: PageContext | null,
): ContextChip[] {
  if (!page || !stagedChips.length) return pageChips;
  return pageChips.filter((chip) => {
    const value = page[chip.id.replace(/^page:/, "")];
    return !stagedChips.some(
      (door) => door.kind === chip.kind && value != null && door.ref?.id === String(value),
    );
  });
}

// Page fields come from the provider only: a staged copy (a starter's stream or time) is never shown, so it can never outlive a removal (S4).
function staged(chips: readonly ContextChip[]): ContextChip[] {
  return chips.filter((chip) => chip.kind !== "time" && chip.provenance !== "page");
}

// Whitelist fields come from the wire context only, so "Sent" lists exactly what is sent (CT-04 AC 10).
function extrasOf(context: PageContext | null): Record<string, unknown> {
  if (!context) return {};
  return Object.fromEntries(Object.entries(context).filter(([key]) => !isWhitelisted(key)));
}

// The localised title of the route the page provider describes (CT-04 AC 3).
function pageLabelOf(t: TranslateFn): (context: PageContext) => I18nText {
  return (context) => {
    const route = getAssistantRuntime().context.value?.router?.currentRoute.value;
    const key = route?.meta?.titleKey as string | undefined;
    return key ? t(key) : raw(context.pageTitle || context.currentPage);
  };
}
