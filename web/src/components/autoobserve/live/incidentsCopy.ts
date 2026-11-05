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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type {
  AutoObserveFindingKind,
  AutoObserveIncidentItem,
  AutoObserveIncidentList,
} from "@/services/autoobserve";
import type { Incident } from "@/services/incidents";
import {
  NOT_RUN,
  OUTCOME,
  isLiveRca,
  isStoredNotRunReason,
  type RcaCellTone,
} from "@/utils/incidents/rcaCell";
import { agoText, formatWhen } from "./liveCopy";

export interface AnalysisLine {
  label: I18nText;
  tone: RcaCellTone;
  detail: I18nText;
  spinner: boolean;
  hasRun: boolean;
}

export interface IncidentRoute {
  name: "incidentDetail" | "incidentList";
  params?: { id: string };
  query: { org_identifier: string; tab?: "incidentAnalysis" };
}

// Three rows keep the card short above the rail's suggestion cards (RAIL_CAP = 5).
export const PAGED_CAP = 3;

// The main column shows what the fixture problem list showed per step (ThisWeek's STEP = 10).
export const MAIN_PAGED_CAP = 10;

// The rail card's single placeholder row stays; a longer card holds three, its few-rows shape.
export const MAX_SKELETON_ROWS = 3;

// The incident list's poll while a run on its page is live (RCA_LIVE_POLL_MS).
export const PAGED_POLL_MS = 30_000;

const FINDING_KEY: Record<AutoObserveFindingKind, I18nKey> = {
  stream_silence: "autoobserveLive.incidents.finding.stream_silence",
  stream_drop: "autoobserveLive.incidents.finding.stream_drop",
  stream_rise: "autoobserveLive.incidents.finding.stream_rise",
};

const STATUS_KEY: Record<Incident["status"], I18nKey> = {
  open: "alerts.incidents.statusOpen",
  acknowledged: "alerts.incidents.statusAcknowledged",
  resolved: "alerts.incidents.statusResolved",
};

const EMPTY = raw("");

const line = (
  label: I18nText,
  tone: RcaCellTone,
  hasRun: boolean,
  detail: I18nText = EMPTY,
  spinner = false,
): AnalysisLine => ({ label, tone, detail, spinner, hasRun });

const isFindingKind = (kind: string | null): kind is AutoObserveFindingKind =>
  kind !== null && Object.prototype.hasOwnProperty.call(FINDING_KEY, kind);

// An unknown kind or an unreadable stream falls back to the server's own English title.
export const findingSentence = (t: TranslateFn, item: AutoObserveIncidentItem): I18nText => {
  const { kind, stream_name, stream_type } = item.finding;
  if (!isFindingKind(kind) || !stream_name || !stream_type) return raw(item.incident.title);
  return t(FINDING_KEY[kind], { stream: raw(stream_name), type: raw(stream_type) });
};

const notRunLine = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
  rcaEnabled: boolean,
): AnalysisLine => {
  const reason = item.investigation.not_run_reason;
  if (reason === "l0_off")
    return line(
      t("alerts.incidents.aiAnalysis.rcaOff"),
      "muted",
      false,
      t("alerts.incidents.aiAnalysis.noAiSreFor", {
        severity: raw(String(item.incident.severity).toUpperCase()),
      }),
    );
  if (isStoredNotRunReason(reason)) {
    const notRun = NOT_RUN[reason];
    return line(t(notRun.label), notRun.tone, false, t(notRun.detail));
  }
  if (reason)
    return line(
      t("alerts.incidents.aiAnalysis.rcaOff"),
      "muted",
      false,
      t("autoobserveLive.incidents.analysis.offOther"),
    );
  if (!rcaEnabled)
    return line(
      t("alerts.incidents.aiAnalysis.rcaDisabled"),
      "muted",
      false,
      t("autoobserveLive.incidents.analysis.disabledDetail"),
    );
  return line(
    t("alerts.incidents.aiAnalysis.notAnalyzed"),
    "muted",
    false,
    t("autoobserveLive.incidents.analysis.notRunDetail"),
  );
};

// A failed run's detail is a server error that can name agent URLs, so the row shows a fixed sentence.
export const analysisLine = (
  t: TranslateFn,
  item: AutoObserveIncidentItem,
  rcaEnabled: boolean,
): AnalysisLine => {
  const { state, outcome, summary } = item.investigation;
  switch (state) {
    case "running":
      return line(t("alerts.incidents.aiAnalysis.investigating"), "muted", true, EMPTY, true);
    case "waiting_input":
      return line(
        t("alerts.incidents.aiAnalysis.blocked"),
        "warn-strong",
        true,
        raw(summary?.detail ?? ""),
      );
    case "completed": {
      const known = outcome ? OUTCOME[outcome] : undefined;
      if (!known) return line(t("alerts.incidents.aiAnalysis.analyzed"), "ok", true);
      // A blocked run names what it needs, as the incident list does.
      const detail = outcome === "blocked" ? raw(summary?.detail ?? "") : EMPTY;
      return line(t(known.key), known.tone, true, detail);
    }
    case "failed":
      return line(
        t("alerts.incidents.aiAnalysis.failed"),
        "err",
        true,
        t("autoobserveLive.incidents.analysis.failedDetail"),
      );
    case "cancelled":
      return line(t("alerts.incidents.rcaRun.state.cancelled"), "err", true);
    default:
      return notRunLine(t, item, rcaEnabled);
  }
};

// The server's error text can name internal hosts, so the details give only the status and the time.
export const failedDetail = (
  t: TranslateFn,
  locale: string,
  timeZone: string,
  status: unknown,
  at: number,
  now = Date.now(),
): I18nText => {
  const time = formatWhen(at, locale, timeZone, now);
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? t("autoobserveLive.incidents.failedDetail.status", { status: raw(String(status)), time })
    : t("autoobserveLive.incidents.failedDetail.noResponse", { time });
};

export const statusLabel = (t: TranslateFn, status: Incident["status"]): I18nText =>
  t(STATUS_KEY[status]);

export const openedText = (
  t: TranslateFn,
  locale: string,
  item: AutoObserveIncidentItem,
  now: number,
): I18nText =>
  t("autoobserveLive.incidents.opened", {
    when: agoText(
      t,
      locale,
      Math.max(0, Math.floor((now - item.incident.created_at / 1000) / 60_000)),
    ),
  });

export const pagingNote = (t: TranslateFn): I18nText => t("autoobserveLive.incidents.pagingNote");

const count = (locale: string, n: number): I18nText => raw(new Intl.NumberFormat(locale).format(n));

export const newFindingsText = (t: TranslateFn, locale: string, n: number): I18nText =>
  t("autoobserveLive.incidents.newFindings", { count: count(locale, n) }, n);

export const moreText = (t: TranslateFn, locale: string, cap = PAGED_CAP): I18nText =>
  t("autoobserveLive.incidents.more", { count: count(locale, cap) });

export const skeletonRows = (cap: number): number =>
  cap > PAGED_CAP ? Math.min(cap, MAX_SKELETON_ROWS) : 1;

// The card's fixed words, so the component holds no key of its own.
export const pagedCopy = (t: TranslateFn) => ({
  title: t("autoobserveLive.incidents.title"),
  subtitle: t("autoobserveLive.incidents.subtitle"),
  openIncident: t("autoobserveLive.incidents.openIncident"),
  viewAnalysis: t("autoobserveLive.incidents.viewAnalysis"),
  showNew: t("autoobserveLive.incidents.showNew"),
  seeAll: t("autoobserveLive.incidents.seeAll"),
  emptyTitle: t("autoobserveLive.incidents.empty.title"),
  emptyDesc: t("autoobserveLive.incidents.empty.desc"),
  offTitle: t("autoobserveLive.incidents.emptyOff.title"),
  offDesc: t("autoobserveLive.incidents.emptyOff.desc"),
});

export const incidentLink = (org: string, id: string): IncidentRoute => ({
  name: "incidentDetail",
  params: { id },
  query: { org_identifier: org },
});

// The incident page reads `tab` once and drops it, so Back and reload keep the user's own tab.
export const analysisLink = (org: string, id: string): IncidentRoute => ({
  name: "incidentDetail",
  params: { id },
  query: { org_identifier: org, tab: "incidentAnalysis" },
});

export const incidentListLink = (org: string): IncidentRoute => ({
  name: "incidentList",
  query: { org_identifier: org },
});

export const anyLive = (list: AutoObserveIncidentList | undefined): boolean =>
  !!list?.items.some((item) => isLiveRca(item.investigation));
