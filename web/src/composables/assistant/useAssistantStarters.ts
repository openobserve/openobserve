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

import { useQuery } from "@tanstack/vue-query";
import { computed, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from "vue";

import { contextRegistry } from "@/composables/contextProviders/registry";
import { queryClient } from "@/composables/query/queryClient";
import i18n from "@/locales";
import type { StarterKind } from "@/services/assistantAnalytics";
import { streamNameListQuery } from "@/services/stream.queries";
import { gt, raw, type I18nKey, type I18nText } from "@/types/i18n";
import { formatOrgRange, uiIntlLocale } from "@/utils/formatters";

import type { AssistantHostAdapter, ObjectKind, Sid, Tri } from "./assistantStore.types";
import type { ContextChip, PageContext } from "./context/types";
import { getAssistantRuntime } from "./runtime";

export const STARTER_COUNT = 3;

/** How far down the history the "Continue" starter looks for a chat other than the open one. */
const RECENT_LOOKUP = 5;

// SI symbols for clock units, as `formatElapsed` writes them; calendar units take the locale's short form.
const PERIOD_SYMBOLS: Record<string, string> = { s: "s", m: "min", h: "h" };

const PERIOD_UNITS: Record<string, Intl.NumberFormatOptions["unit"]> = {
  d: "day",
  w: "week",
  M: "month",
  y: "year",
};

const STREAM_TYPES = ["logs", "metrics", "traces"] as const;

/** Model input stays English whatever the UI locale (`95` decision 6). */
const PROMPT_LOCALE = "en-US";

/** One suggestion of the welcome; `prompt` is what lands in the composer, `label` what the button says. */
export interface Starter {
  id: string;
  kind: StarterKind;
  label: I18nText;
  prompt: string;
  chips: ContextChip[];
  /** `recent` only: opens that chat instead of staging. */
  chatId?: number;
  /** `recent` only: the chat's session id, which opens it even when this browser never saved it. */
  sid?: Sid;
  dataTest: `assistant-starter-${number}`;
}

/** What the welcome's scope line says the assistant sees (`70` §3.1). */
export interface AssistantScope {
  org: string;
  /** `null` while no stream list is in the cache. */
  streamCount: number | null;
  timeRange: I18nText | null;
  pageObject?: { kind: ObjectKind; name: string };
  /** Docked: the editor's buffer leads the line ("this SQL"), then its stream. */
  editor?: { language: AssistantHostAdapter["language"]; stream: string | null };
  canWrite: Tri;
}

export interface AssistantStartersInput {
  /** The route name the container sits on, or `home`. */
  page: MaybeRefOrGetter<string>;
  host?: AssistantHostAdapter;
}

interface StarterDraft {
  key: I18nKey;
  params?: Record<string, string>;
  /** The model's copy of `params`: the same values, formatted for en-US. */
  promptParams?: Record<string, string>;
  kind: StarterKind;
  chips?: ContextChip[];
  chatId?: number;
  sid?: Sid;
}

interface StarterFacts {
  org: string;
  stream: string | null;
  metric: string | null;
  /** `label` is the scope tag ("last 15 min"); `period` ("15 min") exists for relative ranges only. */
  range: {
    label: string;
    period: string | null;
    periodEn: string | null;
    from?: number;
    to?: number;
  } | null;
  dashboard: string | null;
}

/** Starters built only from cached lists and the page's context provider; never an `/ai/*` call (`70` §4). */
export function useAssistantStarters(input: AssistantStartersInput): {
  starters: ComputedRef<Starter[]>;
  loading: ComputedRef<boolean>;
  scope: ComputedRef<AssistantScope>;
} {
  const runtime = getAssistantRuntime();
  const org = computed(() => runtime.context.value?.getOrg()?.identifier ?? "");
  const lists = STREAM_TYPES.map((type) =>
    // Disabled observers read what the pages already fetched; the client is explicit because the welcome builds this lazily, outside setup.
    useQuery(
      computed(() => ({ ...streamNameListQuery(org.value, type), enabled: false as const })),
      queryClient,
    ),
  );
  const pageContext = shallowRef<PageContext | null>(null);
  const contextPending = shallowRef(true);
  let generation = 0;

  watch(
    () => toValue(input.page),
    async () => {
      generation += 1;
      const asked = generation;
      contextPending.value = true;
      const context = await contextRegistry.getActiveContext().catch(() => null);
      if (asked !== generation) return;
      pageContext.value = context;
      contextPending.value = false;
    },
    { immediate: true },
  );

  const names = (index: number): string[] | null => {
    const data = lists[index].data.value;
    return Array.isArray(data)
      ? data.map((s: { name?: string }) => s?.name ?? "").filter(Boolean)
      : null;
  };
  const streamCount = computed(() => {
    const loaded = STREAM_TYPES.map((_, i) => names(i)).filter((list) => list !== null);
    return loaded.length ? loaded.reduce((sum, list) => sum + list.length, 0) : null;
  });
  const facts = computed<StarterFacts>(() => ({
    org: org.value,
    stream: pageStream(pageContext.value) ?? names(0)?.[0] ?? null,
    metric: names(1)?.[0] ?? null,
    range: rangeOf(pageContext.value),
    dashboard: stringField(pageContext.value, "dashboardName"),
  }));

  const loading = computed(
    () =>
      contextPending.value ||
      lists.some((list) => list.isFetching.value && list.data.value === undefined),
  );

  const starters = computed(() => {
    if (streamCount.value === 0) return finish(ingestDrafts());
    return finish(
      fill(pageDrafts(toValue(input.page), input.host, facts.value), recentDraft(), org.value),
    );
  });

  const scope = computed<AssistantScope>(() => {
    const dashboard = facts.value.dashboard;
    return {
      org: org.value,
      streamCount: streamCount.value,
      timeRange: facts.value.range ? raw(facts.value.range.label) : null,
      ...(dashboard && { pageObject: { kind: "dashboard" as const, name: dashboard } }),
      ...(input.host && {
        editor: { language: input.host.language, stream: pageStream(pageContext.value) ?? null },
      }),
      canWrite: runtime.capability.capability.value.canWrite,
    };
  });

  // History rows, so a chat from another tab or device can be continued too.
  function recentDraft(): StarterDraft | null {
    const active = runtime.store.state.shell.activeSid;
    const row = runtime.history.rows.value
      .slice(0, RECENT_LOOKUP)
      .find((candidate) => candidate.sid !== active);
    if (!row) return null;
    return {
      key: "assistant.welcome.starter.recent",
      params: { title: row.title },
      kind: "recent",
      sid: row.sid,
      ...(row.chatId !== null && { chatId: row.chatId }),
    };
  }

  return { starters, loading, scope };
}

// The label reads the period in the UI locale; the prompt gets the en-US one (`95` decision 6).
function pageDrafts(
  page: string,
  host: AssistantHostAdapter | undefined,
  facts: StarterFacts,
): StarterDraft[] {
  const english = facts.range?.periodEn;
  return pageTable(page, host, facts).map((d) =>
    d.params?.range && english ? { ...d, promptParams: { ...d.params, range: english } } : d,
  );
}

function pageTable(
  page: string,
  host: AssistantHostAdapter | undefined,
  facts: StarterFacts,
): StarterDraft[] {
  if (host) return hostDrafts(host, facts);
  const { stream, range, dashboard, metric } = facts;
  const r = range?.period;
  switch (page) {
    case "home":
      return [
        draft("assistant.welcome.starter.home.1", { org: facts.org }),
        draft("assistant.welcome.starter.home.2"),
      ];
    case "logs":
      return [
        stream && r
          ? draft("assistant.welcome.starter.logs.1", { stream, range: r }, logChips(facts))
          : draft("assistant.welcome.starter.logs.1Generic"),
        stream
          ? draft("assistant.welcome.starter.logs.2", { stream })
          : draft("assistant.welcome.starter.logs.2Generic"),
      ];
    case "viewDashboard":
      return [
        dashboard && r
          ? draft("assistant.welcome.starter.dashboard.1", { dashboard, range: r })
          : draft("assistant.welcome.starter.dashboard.1Generic"),
        draft("assistant.welcome.starter.dashboard.2"),
      ];
    case "alertList":
      return [
        draft("assistant.welcome.starter.alerts.1"),
        stream
          ? draft("assistant.welcome.starter.alerts.2", { stream })
          : draft("assistant.welcome.starter.alerts.2Generic"),
      ];
    case "traces":
      return [
        r
          ? draft("assistant.welcome.starter.traces.1", { range: r })
          : draft("assistant.welcome.starter.traces.1Generic"),
      ];
    case "metrics":
      return [
        metric
          ? draft("assistant.welcome.starter.metrics.1", { metric })
          : draft("assistant.welcome.starter.metrics.1Generic"),
        draft("assistant.welcome.starter.metrics.2"),
      ];
    default:
      return [learnDraft(), draft("assistant.welcome.starter.home.2")];
  }
}

function hostDrafts(host: AssistantHostAdapter, facts: StarterFacts): StarterDraft[] {
  const stream = facts.stream;
  switch (host.id) {
    case "function":
      return [
        draft("assistant.welcome.starter.function.1", undefined, [], "object"),
        draft("assistant.welcome.starter.function.2", undefined, [], "object"),
      ];
    case "regex":
      return [
        draft("assistant.welcome.starter.regex.1", undefined, [], "object"),
        stream
          ? draft("assistant.welcome.starter.regex.2", { stream }, [], "object")
          : draft("assistant.welcome.starter.regex.2Generic", undefined, [], "object"),
      ];
    case "json_editor":
      return [
        draft(
          host.objectKind === "alert"
            ? "assistant.welcome.starter.jsonEditor.alert"
            : "assistant.welcome.starter.jsonEditor.pipeline",
          undefined,
          [],
          "object",
        ),
        draft("assistant.welcome.starter.jsonEditor.2", undefined, [], "object"),
      ];
    default:
      return [
        draft("assistant.welcome.starter.sqlEditor.1", undefined, [], "object"),
        stream
          ? draft("assistant.welcome.starter.sqlEditor.2", { stream }, [], "object")
          : draft("assistant.welcome.starter.sqlEditor.2Generic", undefined, [], "object"),
      ];
  }
}

function ingestDrafts(): StarterDraft[] {
  return [
    draft("assistant.welcome.starter.ingest.1", undefined, [], "ingest"),
    draft("assistant.welcome.starter.ingest.2", undefined, [], "ingest"),
    draft("assistant.welcome.starter.ingest.3", undefined, [], "ingest"),
  ];
}

function learnDraft(): StarterDraft {
  return draft("assistant.welcome.starter.learn", undefined, [], "learn");
}

function draft(
  key: I18nKey,
  params?: Record<string, string>,
  chips: ContextChip[] = [],
  kind: StarterKind = "page",
): StarterDraft {
  return { key, kind, chips, ...(params && { params }) };
}

// Page starters first, then recent, then the generic ones, until three distinct remain.
function fill(page: StarterDraft[], recent: StarterDraft | null, org: string): StarterDraft[] {
  const picked: StarterDraft[] = [];
  const generic = [
    learnDraft(),
    draft("assistant.welcome.starter.home.2"),
    draft("assistant.welcome.starter.home.1", { org }),
  ];
  for (const candidate of [...page.slice(0, 2), recent, ...generic]) {
    if (!candidate || picked.some((p) => p.key === candidate.key)) continue;
    picked.push(candidate);
    if (picked.length === STARTER_COUNT) break;
  }
  return picked;
}

function finish(drafts: StarterDraft[]): Starter[] {
  return drafts.map((d, index) => ({
    id: `${d.key}:${index}`,
    kind: d.kind,
    label: gt(d.key, d.params ?? {}),
    prompt: englishPrompt(d.key, d.promptParams ?? d.params ?? {}),
    chips: d.chips ?? [],
    ...(d.chatId !== undefined && { chatId: d.chatId }),
    ...(d.sid !== undefined && { sid: d.sid }),
    dataTest: `assistant-starter-${index}`,
  }));
}

function englishPrompt(key: I18nKey, params: Record<string, string>): string {
  const global = i18n.global as unknown as {
    t(key: string, named: Record<string, string>, options: { locale: string }): string;
  };
  return global.t(key, params, { locale: PROMPT_LOCALE });
}

function logChips(facts: StarterFacts): ContextChip[] {
  const chips: ContextChip[] = [];
  if (facts.range && facts.range.from !== undefined && facts.range.to !== undefined)
    chips.push({
      id: "starter-time",
      kind: "time",
      label: raw(facts.range.label),
      ref: { type: "time", org: facts.org, from: facts.range.from, to: facts.range.to },
      sizeBytes: 32,
      provenance: "page",
      sent: "whitelist",
    });
  if (facts.stream)
    chips.push({
      id: `starter-stream-${facts.stream}`,
      kind: "stream",
      label: raw(facts.stream),
      ref: {
        type: "stream",
        id: facts.stream,
        org: facts.org,
        stream: facts.stream,
        streamType: "logs",
      },
      sizeBytes: facts.stream.length,
      provenance: "page",
      sent: "whitelist",
    });
  return chips;
}

function pageStream(context: PageContext | null): string | null {
  const first = context?.selectedStreams?.[0];
  return typeof first === "string" && first ? first : null;
}

function stringField(context: PageContext | null, field: string): string | null {
  const value = context?.[field];
  return typeof value === "string" && value ? value : null;
}

// Providers report `{ relativeTimePeriod, startTime, endTime }` in microseconds; host adapters `{ from, to }` in ms.
function rangeOf(context: PageContext | null): StarterFacts["range"] {
  const range = context?.timeRange as
    | {
        from?: number;
        to?: number;
        period?: string;
        relativeTimePeriod?: string;
        startTime?: number;
        endTime?: number;
        type?: string;
      }
    | undefined;
  if (!range) return null;
  const from = range.from ?? (range.startTime ? Math.round(range.startTime / 1000) : undefined);
  const to = range.to ?? (range.endTime ? Math.round(range.endTime / 1000) : undefined);
  const relative = range.period ?? range.relativeTimePeriod;
  const period = relative ? periodText(relative, uiIntlLocale()) : null;
  const periodEn = relative ? periodText(relative, PROMPT_LOCALE) : null;
  if (period) {
    const label = gt("assistant.welcome.lastRange", { period: raw(period) });
    return { label, period, periodEn, from, to };
  }
  if (from !== undefined && to !== undefined)
    return { label: formatOrgRange(from, to), period: null, periodEn: null, from, to };
  return null;
}

/** "15 min", "1 h", "7 days" for a relative period such as `15m`; `null` for anything else. */
export function periodText(period: string, locale: string): string | null {
  const match = /^(\d+)([smhdwMy])$/.exec(period);
  if (!match) return null;
  const count = Number(match[1]);
  const symbol = PERIOD_SYMBOLS[match[2]];
  const number = new Intl.NumberFormat(locale);
  if (symbol) return `${number.format(count)} ${symbol}`;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: PERIOD_UNITS[match[2]],
    unitDisplay: "long",
  }).format(count);
}
