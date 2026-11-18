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
  AutoObserveCauseLine,
  AutoObserveChangeKind,
  AutoObserveImpactLine,
  AutoObserveImpactRecord,
  AutoObserveIssueContext,
} from "@/services/autoobserve";
import type { InsightZone } from "../insight/insightCopy";
import { checkGroups, foldCauses, type CauseFold } from "./liveAdapter";
import { formatWhen } from "./liveCopy";

export type ContextTone = "neutral" | "warning" | "error";

export interface CauseBlockCopy {
  failed: I18nText | null;
  gap: I18nText | null;
  empty: I18nText | null;
  footer: I18nText | null;
  fold: { more: I18nText; less: I18nText } | null;
  unlisted: I18nText | null;
  hidden: I18nText | null;
  rows: CauseFold;
  // Callouts in strongest-first order; only the first `impactsShown` fit before the reader expands.
  impacts: { line: AutoObserveImpactLine; copy: ImpactCopy }[];
  impactsShown: number;
}

export interface ImpactCopy {
  tone: ContextTone;
  text: I18nText;
  redacted: I18nText | null;
  link: { label: I18nText; item: number } | null;
}

export const SECURITY_SOURCE = "security_source";

/** Two-line row slots of the collapsed block; an impact callout takes two of them. */
export const CAUSE_SLOTS = 3;
export const IMPACT_SLOTS = 2;

export const BLOCK_HEIGHT = { step: "h-[25.375rem]", bare: "h-[16.625rem]" } as const;

const TONE_RANK: Record<ContextTone, number> = { error: 0, warning: 1, neutral: 2 };

// The registered actions (R1) carry the drawer's primary button; other links are outlined.
const PRIMARY_KINDS: ReadonlySet<AutoObserveChangeKind> = new Set([
  "pipeline_failing",
  "pipeline_changed",
  "collector_offline",
  "collector_export_errors",
  "config_rollout",
]);

const LINK_KEY: Record<AutoObserveChangeKind, I18nKey> = {
  pipeline_failing: "autoobserve.context.link.pipeline",
  pipeline_changed: "autoobserve.context.link.pipeline",
  settings_changed: "autoobserve.context.link.streamSettings",
  stream_deleted: "autoobserve.context.link.streamSettings",
  ingestion_refused: "autoobserve.context.link.streamSettings",
  deploy: "autoobserve.context.link.versions",
  rollback: "autoobserve.context.link.versions",
  collector_offline: "autoobserve.context.link.collector",
  collector_export_errors: "autoobserve.context.link.collector",
  config_rollout: "autoobserve.context.link.rollout",
  token_changed: "autoobserve.context.link.tokens",
  alert_changed: "autoobserve.context.link.alert",
};

const IMPACT_LINK_KEY: Record<AutoObserveImpactRecord["kind"], I18nKey> = {
  detection: "autoobserve.context.impact.open.detection",
  alert: "autoobserve.context.impact.open.alert",
  slo: "autoobserve.context.impact.open.slo",
  dashboard: "autoobserve.context.impact.open.dashboard",
  service: "autoobserve.context.impact.open.service",
};

export const gradeLabel = (t: TranslateFn, grade: AutoObserveCauseLine["grade"]): I18nText =>
  t(grade === "likely" ? "autoobserve.context.likely" : "autoobserve.context.possible");

export const causeLinkLabel = (t: TranslateFn, kind: AutoObserveChangeKind): I18nText =>
  t(LINK_KEY[kind] ?? "autoobserve.context.link.page");

export const isPrimaryKind = (kind: AutoObserveChangeKind): boolean => PRIMARY_KINDS.has(kind);

/** Provider labels are the server's words, joined the reader's way. */
export const sourcesText = (locale: string, labels: string[], or = false): I18nText =>
  raw(new Intl.ListFormat(locale, { type: or ? "disjunction" : "conjunction" }).format(labels));

/** Every word of the cause block that the server does not send. */
export const causeBlockCopy = (
  t: TranslateFn,
  zone: InsightZone,
  cx: AutoObserveIssueContext,
  nowMs: number,
  recovered = false,
): CauseBlockCopy => {
  const groups = checkGroups(cx.checks);
  const clock = clockOf(zone, cx.window[0]);
  const list = (labels: string[]) => sourcesText(zone.locale, labels);
  const recheck = recheckOf(cx, nowMs);
  const failing = groups.failed.length ? list(groups.failed) : null;
  const failed = !failing
    ? null
    : recheck === null
      ? t("autoobserve.context.failed", { sources: failing })
      : recheck === "due"
        ? t("autoobserve.context.failedRetrySoon", { sources: failing })
        : t("autoobserve.context.failedRetry", { sources: failing, time: clock(recheck.at) });
  const gaps = [
    groups.off.length
      ? t("autoobserve.context.off", { sources: list(groups.off) }, groups.off.length)
      : null,
    groups.partial.length
      ? t("autoobserve.context.partial", { sources: list(groups.partial) })
      : null,
  ].filter((g): g is I18nText => g !== null);
  const partly = groups.failed.length + groups.off.length + groups.partial.length > 0;
  const notRecorded = groups.notRecorded.length
    ? t(
        "autoobserve.context.notRecorded",
        { sources: raw(capital(list(groups.notRecorded), zone.locale)) },
        groups.notRecorded.length,
      )
    : null;
  const checked = groups.ok.length ? footerOf(t, cx, list(groups.ok), clock, recheck) : null;
  const footer = [checked, notRecorded].filter((s): s is I18nText => s !== null);
  const impacts = cx.impact
    .flatMap((line) => {
      const shown = impactCopy(t, line, recovered);
      return shown ? [{ line, copy: shown }] : [];
    })
    .sort((a, b) => TONE_RANK[a.copy.tone] - TONE_RANK[b.copy.tone]);
  const impactsShown = Math.min(impacts.length, Math.floor(CAUSE_SLOTS / IMPACT_SLOTS));
  const rows = foldCauses(cx.causes, CAUSE_SLOTS - IMPACT_SLOTS * impactsShown);
  const unlisted = rows.unlisted;
  return {
    failed,
    gap: gaps.length ? raw(gaps.join(" ")) : null,
    empty: emptyOf(t, cx, groups.ok, partly, zone.locale, clock),
    footer: footer.length ? raw(footer.join(" ")) : null,
    fold: foldOf(t, rows, impacts.length - impactsShown),
    unlisted: unlisted ? t("autoobserve.context.unlisted", { count: unlisted }, unlisted) : null,
    hidden: cx.hidden ? t("autoobserve.context.hidden", { count: cx.hidden }, cx.hidden) : null,
    rows,
    impacts,
    impactsShown,
  };
};

/** Red while detections are blind, amber while they see part of the data, neutral once back. */
export const impactCopy = (
  t: TranslateFn,
  line: AutoObserveImpactLine,
  recovered: boolean,
): ImpactCopy | null => {
  if (!line.sentence) return null;
  const items = line.record.items;
  const one = items.length === 1 && line.record.more === 0 && items[0].open;
  return {
    tone: recovered ? "neutral" : line.record.effect === "blind" ? "error" : "warning",
    text: raw(line.sentence),
    redacted: line.redacted ? t("autoobserve.context.impact.redacted") : null,
    link: one ? { label: t(IMPACT_LINK_KEY[line.record.kind]), item: 0 } : null,
  };
};

/** The header badge of a security source; quiet only while a blind line still stands. */
export const securityBadge = (
  t: TranslateFn,
  cx: AutoObserveIssueContext,
  recovered: boolean,
): { label: I18nText; quiet: boolean } | null => {
  if (!cx.classes.includes(SECURITY_SOURCE)) return null;
  const quiet = !recovered && cx.impact.some((l) => l.sentence && l.record.effect === "blind");
  return {
    label: quiet ? t("autoobserve.context.badge.quiet") : t("autoobserve.context.badge.source"),
    quiet,
  };
};

const capital = (text: string, locale: string) =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

const clockOf = (zone: InsightZone, anchorUs: number) => (us: number) =>
  formatWhen(us / 1000, zone.locale, zone.timeZone, anchorUs / 1000);

type Recheck = { at: number } | "due" | null;

// The served next ask: its time, "due" once past, null when none is planned or the server does not say.
const recheckOf = (cx: AutoObserveIssueContext, nowMs: number): Recheck => {
  const at = cx.recheck_at;
  if (at === null || at === undefined) return null;
  return at / 1000 <= nowMs ? "due" : { at };
};

const footerOf = (
  t: TranslateFn,
  cx: AutoObserveIssueContext,
  sources: I18nText,
  clock: (us: number) => I18nText,
  recheck: Recheck,
): I18nText => {
  const window = { sources, from: clock(cx.window[0]), to: clock(cx.window[1]) };
  const region = cx.region_only;
  if (cx.settled) {
    const time = clock(cx.asked_at ?? cx.window[1]);
    const key: I18nKey = region
      ? "autoobserve.context.footerRegionSettled"
      : "autoobserve.context.footerSettled";
    return t(key, { ...window, time });
  }
  if (recheck === null)
    return t(
      region
        ? "autoobserve.context.footerRegionAskingOpen"
        : "autoobserve.context.footerAskingOpen",
      window,
    );
  if (recheck === "due")
    return t(
      region
        ? "autoobserve.context.footerRegionAskingSoon"
        : "autoobserve.context.footerAskingSoon",
      window,
    );
  const key: I18nKey = region
    ? "autoobserve.context.footerRegionAsking"
    : "autoobserve.context.footerAsking";
  return t(key, { ...window, time: clock(recheck.at) });
};

const emptyOf = (
  t: TranslateFn,
  cx: AutoObserveIssueContext,
  okSources: string[],
  partly: boolean,
  locale: string,
  clock: (us: number) => I18nText,
): I18nText | null => {
  if (cx.causes.top.length || cx.hidden || !okSources.length) return null;
  const span = { from: clock(cx.window[0]), to: clock(cx.window[1]) };
  if (!cx.settled) return t("autoobserve.context.noneSoFar", span);
  // A check that did not run fully must not read as "nothing changed" (R3).
  if (partly)
    return t("autoobserve.context.nothingChangedIn", {
      ...span,
      sources: sourcesText(locale, okSources, true),
    });
  return t("autoobserve.context.nothingChanged", span);
};

const foldOf = (t: TranslateFn, rows: CauseFold, impactsFolded: number) => {
  const count = rows.folded.length + rows.unlisted;
  const less = t("autoobserve.context.foldLess");
  if (!rows.folded.length)
    return impactsFolded
      ? { more: t("autoobserve2.showMore", { count: impactsFolded }), less }
      : null;
  const used = rows.shown.some((c) => c.used) && !rows.folded.some((c) => c.used);
  return {
    more: used
      ? t("autoobserve.context.foldMoreUnused", { count }, count)
      : t("autoobserve.context.foldMore", { count }, count),
    less,
  };
};
