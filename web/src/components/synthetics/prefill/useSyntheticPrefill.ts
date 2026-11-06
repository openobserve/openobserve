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

import { computed, inject, shallowRef, type ComputedRef, type InjectionKey, type Ref } from "vue";
import { useRoute, type RouteLocationRaw } from "vue-router";
import config from "@/aws-exports";
import { localeFileMap } from "@/locales";
import { listInLocale } from "@/utils/oncall";
import { raw, useI18nTyped, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  BrowserCheckSchedule,
  ProtocolCheck,
  ProtocolCheckType,
  SyntheticsLocation,
} from "@/types/synthetics";
import { locationLiveStatus } from "@/utils/synthetics/locationLiveStatus";
import { takeSyntheticPrefill, type SyntheticPrefillInput } from "./syntheticPrefillContract";

export const CHIP_FIELDS = ["folder", "tags", "url", "locations", "destinations"] as const;
const ALERT_AFTER_FAILED_RUNS = 2;
const LIST_LIMIT = 3;
const MINUTES_PER_UNIT: Partial<Record<NonNullable<BrowserCheckSchedule["intervalUnit"]>, number>> =
  { minutes: 1, hours: 60, days: 1440 };

export const SYNTHETIC_PREFILL_VIEW: InjectionKey<ComputedRef<SyntheticPrefillView | null>> =
  Symbol("syntheticPrefillView");

export type ChipField = (typeof CHIP_FIELDS)[number];
export type Reach = "private" | "public";
export type PrefillList = "locations" | "destinations";
type NoteField = "folder" | "description" | "tags" | "url" | "destinations";

export interface TestRunResult {
  ok: boolean;
  location: string;
  status?: string;
  ms?: number;
  error?: string;
}

/** A run before saving and a location quorum; no server offers them yet, so callers pass none. */
export interface PreSaveRun {
  run: (check: ProtocolCheck) => Promise<TestRunResult>;
  quorum: number;
}

export interface LocationNote {
  key: "public" | "private";
  label: I18nText;
  text: I18nText;
}

export interface SyntheticPrefillView {
  service: string;
  where: I18nText | null;
  chips: ReadonlySet<ChipField>;
  chosenLocations: ReadonlySet<string>;
  notes: Partial<Record<NoteField, I18nText>>;
  unconfirmed: Partial<Record<PrefillList, I18nText>>;
  locationNotes: LocationNote[];
  connecting: I18nText;
  runsPerDay: I18nText | null;
  alertLine: I18nText;
  afterRuns: I18nText;
  afterNotify: I18nText;
  preSaveRun: PreSaveRun | null;
}

interface GateInput {
  isEnterprise: string;
  prefillQuery: unknown;
  checkType: ProtocolCheckType;
  editId?: string;
}

interface ViewContext {
  t: TranslateFn;
  locale: string;
  locations: SyntheticsLocation[];
  chosenLocations: ReadonlySet<string>;
  description: I18nText;
  preSaveRun: PreSaveRun | null;
  unconfirmed?: ReadonlySet<PrefillList>;
}

/** Reads the stored prefill only for an enterprise create visit that asked for it. */
export function readSyntheticPrefill(gate: GateInput): SyntheticPrefillInput | null {
  const open =
    gate.isEnterprise === "true" &&
    gate.prefillQuery === "autoobserve" &&
    gate.checkType === "http" &&
    !gate.editId;
  return open ? takeSyntheticPrefill() : null;
}

/** True for addresses only reachable inside a network: cluster DNS, single-label hosts, private IPv4. */
export function isInternalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(".") || h === "localhost") return true;
  if (/(\.svc|\.cluster\.local|\.internal|\.local)$/.test(h) || h.includes(".svc.")) return true;
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

export function reachOf(prefill: SyntheticPrefillInput): Reach | null {
  if (prefill.evidence?.reach) return prefill.evidence.reach;
  const parsed = prefill.url ? hostOf(prefill.url) : null;
  if (parsed) return isInternalHost(parsed.hostname) ? "private" : "public";
  return prefill.service.cluster ? "private" : null;
}

export function chipFieldsOf(prefill: SyntheticPrefillInput): Set<ChipField> {
  return new Set(
    CHIP_FIELDS.filter(
      (f) => prefill.suggested.includes(f) && (f !== "url" || prefill.url.length > 0),
    ),
  );
}

export function applySyntheticPrefill(
  check: ProtocolCheck,
  prefill: SyntheticPrefillInput,
  description: I18nText,
): ProtocolCheck {
  const serviceTag = `service:${prefill.service.name}`;
  const tags = [...new Set([...check.tags, ...prefill.tags, serviceTag])];
  return {
    ...check,
    name: prefill.name,
    folder: prefill.folder || check.folder,
    description,
    tags,
    url: prefill.url,
    locations: [...prefill.locations],
    notifications: { destinations: [...prefill.destinations] },
    schedule: {
      ...check.schedule,
      type: "interval",
      intervalValue: prefill.intervalMinutes,
      intervalUnit: "minutes",
      isCustomFrequency: false,
    },
    alertIfFails: ALERT_AFTER_FAILED_RUNS,
    http: check.http ? { ...check.http, method: prefill.method } : check.http,
  };
}

/** The prefilled locations that exist and can run this check; a public one never runs a private address. */
export function pickPrefillLocations(
  ids: string[],
  locations: SyntheticsLocation[],
  reach: Reach | null,
): string[] {
  return locations
    .filter((l) => ids.includes(l.id))
    .filter((l) => {
      const isPrivate = l.kind === "private";
      if (reach === "private") return isPrivate && l.status === "online";
      if (reach === "public") return !isPrivate;
      return !isPrivate || l.status === "online";
    })
    .map((l) => l.id);
}

export function runsPerDay(schedule: BrowserCheckSchedule, locationCount: number): number | null {
  const minutes = intervalMinutes(schedule);
  if (minutes <= 0 || locationCount < 1) return null;
  return Math.floor(1440 / minutes) * locationCount;
}

export function autoObserveRoutes(
  service: string,
  orgIdentifier: string,
): { home: RouteLocationRaw; service: RouteLocationRaw } {
  return {
    home: { name: "autoobserve", query: { org_identifier: orgIdentifier } },
    service: {
      name: "autoobserve",
      query: { page: "coverage", service, org_identifier: orgIdentifier },
    },
  };
}

export function buildSyntheticPrefillView(
  prefill: SyntheticPrefillInput,
  check: ProtocolCheck,
  ctx: ViewContext,
): SyntheticPrefillView {
  const chips = chipFieldsOf(prefill);
  return {
    service: prefill.service.name,
    where: whereOf(prefill, ctx.t),
    chips,
    chosenLocations: chips.has("locations") ? ctx.chosenLocations : new Set(),
    notes: fieldNotes(prefill, check, ctx),
    unconfirmed: unconfirmedNotes(prefill, check, ctx),
    locationNotes: locationNotes(prefill, check, ctx),
    connecting: ctx.t("synthetics.prefill.connecting"),
    runsPerDay: runsLine(check, ctx),
    alertLine: alertLine(check, ctx),
    afterRuns: afterRuns(check, ctx),
    afterNotify: afterNotify(check, ctx),
    preSaveRun: ctx.preSaveRun,
  };
}

/** The AutoObserve prefill of the create form; inert (null view, no writes) on every other visit. */
export function useSyntheticPrefill(options: {
  checkType: ProtocolCheckType;
  editId?: string;
  preSaveRun?: PreSaveRun | null;
}) {
  const route = useRoute();
  const { t, locale } = useI18nTyped();
  const prefill = readSyntheticPrefill({
    isEnterprise: config.isEnterprise,
    prefillQuery: route.query.prefill,
    checkType: options.checkType,
    editId: options.editId,
  });
  const appLocale = () => localeFileMap[locale.value] ?? locale.value;
  const description = prefill
    ? t("synthetics.prefill.description", {
        service: prefill.service.name,
        date: new Intl.DateTimeFormat(appLocale(), { month: "short", day: "numeric" }).format(
          new Date(),
        ),
      })
    : raw("");
  const chosenLocations = shallowRef<ReadonlySet<string> | null>(null);
  const unconfirmed = shallowRef<ReadonlySet<PrefillList>>(new Set());
  const settled = new Set<PrefillList>();

  function apply(check: ProtocolCheck): ProtocolCheck {
    return prefill ? applySyntheticPrefill(check, prefill, description) : check;
  }

  function settle(list: PrefillList): boolean {
    if (!prefill || settled.has(list)) return false;
    settled.add(list);
    if (unconfirmed.value.has(list)) {
      unconfirmed.value = new Set([...unconfirmed.value].filter((l) => l !== list));
    }
    return true;
  }

  /** After the first successful load, keeps only prefilled locations that exist and can run; null when nothing changes. */
  function reconcileLocations(
    check: ProtocolCheck,
    locations: SyntheticsLocation[],
  ): ProtocolCheck | null {
    if (!prefill || !settle("locations")) return null;
    const ids = pickPrefillLocations(prefill.locations, locations, reachOf(prefill));
    chosenLocations.value = new Set(ids);
    // A draft restore or an edit before the list landed owns the field now.
    if (!sameSet(check.locations, prefill.locations)) return null;
    return { ...check, locations: check.locations.filter((id) => ids.includes(id)) };
  }

  /** After the first successful load, drops prefilled destinations this org does not have; null when nothing changes. */
  function reconcileDestinations(check: ProtocolCheck, available: string[]): ProtocolCheck | null {
    if (!prefill || !settle("destinations")) return null;
    const current = check.notifications.destinations;
    if (!sameSet(current, prefill.destinations)) return null;
    const kept = current.filter((d) => available.includes(d));
    if (kept.length === current.length) return null;
    return { ...check, notifications: { ...check.notifications, destinations: kept } };
  }

  /** A failed load leaves the suggestions in place but unconfirmed until a later load succeeds. */
  function markUnconfirmed(list: PrefillList): void {
    if (!prefill || settled.has(list) || unconfirmed.value.has(list)) return;
    unconfirmed.value = new Set([...unconfirmed.value, list]);
  }

  /** An AutoObserve visit also lists private locations no agent has joined, so it can say why they are not ticked. */
  function keepsAgentlessLocation(location: SyntheticsLocation): boolean {
    return (
      !!prefill &&
      location.kind === "private" &&
      locationLiveStatus(location) === "pending" &&
      !location.types?.length
    );
  }

  function viewOf(
    check: Ref<ProtocolCheck>,
    locations: Ref<SyntheticsLocation[]>,
  ): ComputedRef<SyntheticPrefillView | null> {
    return computed(() => {
      if (!prefill) return null;
      return buildSyntheticPrefillView(prefill, check.value, {
        t,
        locale: locale.value,
        locations: locations.value,
        chosenLocations: chosenLocations.value ?? new Set(),
        description,
        preSaveRun: options.preSaveRun ?? null,
        unconfirmed: unconfirmed.value,
      });
    });
  }

  return {
    prefill,
    apply,
    reconcileLocations,
    reconcileDestinations,
    markUnconfirmed,
    keepsAgentlessLocation,
    viewOf,
  };
}

/** The prefill view for a configure section; null outside an AutoObserve visit. */
export function useSyntheticPrefillView(): ComputedRef<SyntheticPrefillView | null> | null {
  return inject(SYNTHETIC_PREFILL_VIEW, null);
}

function hostOf(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function intervalMinutes(schedule: BrowserCheckSchedule): number {
  if (schedule.type !== "interval") return 0;
  const perUnit = MINUTES_PER_UNIT[schedule.intervalUnit ?? "minutes"] ?? 0;
  return perUnit * (schedule.intervalValue ?? 0);
}

function listText(items: string[], ctx: Pick<ViewContext, "t" | "locale">): string {
  const shown = items.slice(0, LIST_LIMIT);
  const rest = items.length - shown.length;
  const parts = rest > 0 ? [...shown, ctx.t("synthetics.prefill.more", { count: rest })] : shown;
  return listInLocale(parts, ctx.locale);
}

function urlNote(prefill: SyntheticPrefillInput, check: ProtocolCheck, ctx: ViewContext) {
  const service = prefill.service.name;
  if (!prefill.url) {
    return check.url ? undefined : ctx.t("synthetics.prefill.urlUnknown", { service });
  }
  const from = prefill.evidence?.urlFrom;
  const parsed = hostOf(prefill.url);
  if (!from || !parsed || check.url !== prefill.url) return undefined;
  const source = ctx.t(`synthetics.prefill.source.${from}`);
  if (reachOf(prefill) !== "private") {
    return ctx.t("synthetics.prefill.urlNotePublic", { service, source });
  }
  const route = parsed.pathname || "/";
  return parsed.port
    ? ctx.t("synthetics.prefill.urlNotePrivate", { service, source, port: parsed.port, route })
    : ctx.t("synthetics.prefill.urlNotePrivateNoPort", { service, source, route });
}

function countedNote(
  key: string,
  count: number | undefined,
  named: Record<string, unknown>,
  t: TranslateFn,
) {
  return count && count > 0
    ? t(`synthetics.prefill.${key}`, { ...named, count }, count)
    : t(`synthetics.prefill.${key}Any`, named);
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((v) => b.includes(v));
}

function fieldNotes(prefill: SyntheticPrefillInput, check: ProtocolCheck, ctx: ViewContext) {
  const service = prefill.service.name;
  const chips = chipFieldsOf(prefill);
  const notes: Partial<Record<NoteField, I18nText>> = {};
  if (chips.has("folder") && check.folder === prefill.folder) {
    notes.folder = countedNote("folderNote", prefill.evidence?.folderAlerts, { service }, ctx.t);
  }
  if (check.description === ctx.description) {
    notes.description = ctx.t("synthetics.prefill.descriptionNote");
  }
  if (chips.has("tags") && check.tags.includes(`service:${service}`)) {
    notes.tags = ctx.t("synthetics.prefill.tagNote", { service });
  }
  const url = urlNote(prefill, check, ctx);
  if (url) notes.url = url;
  const destinations = check.notifications.destinations;
  if (
    !ctx.unconfirmed?.has("destinations") &&
    chips.has("destinations") &&
    destinations.length > 0 &&
    sameList(destinations, prefill.destinations)
  ) {
    notes.destinations = countedNote(
      "destinationNote",
      prefill.evidence?.destinationAlerts,
      { service, destinations: listText(destinations, ctx) },
      ctx.t,
    );
  }
  return notes;
}

function unconfirmedNotes(prefill: SyntheticPrefillInput, check: ProtocolCheck, ctx: ViewContext) {
  const notes: Partial<Record<PrefillList, I18nText>> = {};
  const held: Record<PrefillList, [string[], string[]]> = {
    locations: [check.locations, prefill.locations],
    destinations: [check.notifications.destinations, prefill.destinations],
  };
  for (const list of ctx.unconfirmed ?? []) {
    const [current, suggested] = held[list];
    if (suggested.length > 0 && sameSet(current, suggested)) {
      notes[list] = ctx.t(`synthetics.prefill.unconfirmed.${list}`);
    }
  }
  return notes;
}

function locationNotes(prefill: SyntheticPrefillInput, check: ProtocolCheck, ctx: ViewContext) {
  const { t } = ctx;
  const service = prefill.service.name;
  const publicLabel = t("synthetics.locations.publicTitle");
  const privateLabel = t("synthetics.locations.privateTitle");
  const reach = reachOf(prefill);
  if (reach === "private") {
    const cluster = prefill.service.cluster;
    const definition =
      cluster && ctx.chosenLocations.size > 0
        ? t("synthetics.prefill.privateDefinitionWhere", { service, cluster })
        : t("synthetics.prefill.privateDefinition");
    return [
      {
        key: "public",
        label: publicLabel,
        text: t("synthetics.prefill.publicSkipped", { service }),
      },
      { key: "private", label: privateLabel, text: definition },
    ] satisfies LocationNote[];
  }
  if (reach !== "public") return [];
  const notes: LocationNote[] = [
    { key: "private", label: privateLabel, text: t("synthetics.prefill.privateSkipped") },
  ];
  const regions = check.locations.length;
  if (ctx.preSaveRun && regions > 1) {
    const quorum = Math.min(ctx.preSaveRun.quorum, regions);
    notes.push({
      key: "public",
      label: publicLabel,
      text: t("synthetics.prefill.publicQuorum", { count: regions, quorum }),
    });
  }
  return notes;
}

function selectedKinds(check: ProtocolCheck, locations: SyntheticsLocation[]) {
  const selected = locations.filter((l) => check.locations.includes(l.id));
  const allPublic = selected.length > 0 && selected.every((l) => l.kind !== "private");
  return { selected, allPublic, count: check.locations.length };
}

function runsLine(check: ProtocolCheck, ctx: ViewContext): I18nText | null {
  const { allPublic, count } = selectedKinds(check, ctx.locations);
  const perDay = runsPerDay(check.schedule, count);
  if (perDay === null) return null;
  if (count === 1) return ctx.t("synthetics.prefill.runsPerDay", { count: perDay }, perDay);
  const key = allPublic ? "runsPerDayRegions" : "runsPerDayLocations";
  return ctx.t(`synthetics.prefill.${key}`, { count: perDay, locations: count });
}

function alertLine(check: ProtocolCheck, ctx: ViewContext): I18nText {
  const fails = check.alertIfFails ?? 1;
  const total = check.locations.length;
  if (ctx.preSaveRun && total > 1) {
    const quorum = Math.min(ctx.preSaveRun.quorum, total);
    return ctx.t("synthetics.prefill.alertLineQuorum", { count: fails, quorum, total });
  }
  return ctx.t("synthetics.prefill.alertLine", { count: fails }, fails);
}

function afterRuns(check: ProtocolCheck, ctx: ViewContext): I18nText {
  const { t } = ctx;
  const { selected, allPublic, count } = selectedKinds(check, ctx.locations);
  const minutes = intervalMinutes(check.schedule);
  const every =
    minutes > 0
      ? t("synthetics.prefill.after.everyMinutes", { count: minutes }, minutes)
      : t("synthetics.prefill.after.onSchedule");
  if (count === 0) return t("synthetics.prefill.after.noLocation", { every });
  let where: string;
  if (count === 1 && selected.length === 1) where = selected[0].label;
  else if (allPublic) where = t("synthetics.prefill.after.publicRegions", { count }, count);
  else where = t("synthetics.prefill.after.locations", { count }, count);
  return t("synthetics.prefill.after.runs", { every, where });
}

function afterNotify(check: ProtocolCheck, ctx: ViewContext): I18nText {
  const { t } = ctx;
  const fails = check.alertIfFails ?? 1;
  const destinations = check.notifications.destinations;
  if (destinations.length === 0) {
    return t("synthetics.prefill.after.notifyNone", { count: fails }, fails);
  }
  const named = { count: fails, destinations: listText(destinations, ctx) };
  const total = check.locations.length;
  if (ctx.preSaveRun && total > 1) {
    const quorum = Math.min(ctx.preSaveRun.quorum, total);
    return t("synthetics.prefill.after.notifyQuorum", { ...named, quorum, total });
  }
  const key = destinations.length === 1 ? "notify" : "notifyMany";
  return t(`synthetics.prefill.after.${key}`, named, fails);
}

function whereOf(prefill: SyntheticPrefillInput, t: TranslateFn): I18nText | null {
  if (reachOf(prefill) === "public") return t("synthetics.prefill.wherePublic");
  const { cluster, namespace } = prefill.service;
  if (cluster && namespace) {
    return t("synthetics.prefill.whereClusterNamespace", { cluster, namespace });
  }
  return cluster || namespace ? raw(cluster || namespace) : null;
}
