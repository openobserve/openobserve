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
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  APPLY_FIELDS,
  type ApplyCopy,
  type ApplyField,
} from "@/components/alert_calibration/applySuggestion";
import type { DigestRecord, RuleId } from "@/components/alert_calibration/digests";
import { formatEvidenceField } from "@/components/alert_calibration/format";
import { evidenceFor, RULE_META } from "@/components/alert_calibration/rules";
import type { AppliedEvidence, FieldChange } from "@/services/autoobserveDecisions";
import type { AppliedEntry } from "../decisions/appliedChanges";
import { dayKey, formatWhen } from "../live/liveCopy";

export type ChangeFilter = "all" | "inForce" | "undone";
export type ChangeState = "done" | "undone";

/** One field an apply changed, as the reader sees it. */
export interface ChangeShift {
  setting: I18nText;
  from: I18nText;
  to: I18nText;
}

export interface Change {
  entry: AppliedEntry;
  id: string;
  state: ChangeState;
  /** Milliseconds. */
  at: number;
  day: string;
  shifts: ChangeShift[];
}

export const CHANGE_FILTERS: ChangeFilter[] = ["all", "inForce", "undone"];

export const FILTER_LABEL: Record<ChangeFilter, I18nKey> = {
  all: "autoobserve2.activityPage.filters.all",
  inForce: "autoobserve.activityLive.filters.inForce",
  undone: "autoobserve.activityLive.filters.undone",
};

export type ChangeKind = "fix" | "permission" | "watching" | "tuning";
// A suggestion that notifies no one is a failure, a look no ledger change ever wears.
export type LookKind = ChangeKind | "notify";

export const KIND_LOOK: Record<LookKind, { icon: IconName; badge: string; accent: string }> = {
  fix: {
    icon: "build",
    badge:
      "from-badge-purple-soft-bg to-ingest-accent-purple/25 text-badge-purple-soft-text ring-ingest-accent-purple/30",
    accent: "bg-ingest-accent-purple",
  },
  permission: {
    icon: "verified-user",
    badge:
      "from-badge-blue-soft-bg to-ingest-accent-blue/25 text-badge-blue-soft-text ring-ingest-accent-blue/30",
    accent: "bg-ingest-accent-blue",
  },
  watching: {
    icon: "visibility",
    badge:
      "from-badge-teal-soft-bg to-ingest-accent-teal/25 text-badge-teal-soft-text ring-ingest-accent-teal/30",
    accent: "bg-ingest-accent-teal",
  },
  tuning: {
    icon: "tune",
    badge:
      "from-badge-amber-soft-bg to-ingest-accent-amber/25 text-badge-amber-soft-text ring-ingest-accent-amber/30",
    accent: "bg-ingest-accent-amber",
  },
  notify: {
    icon: "notifications",
    badge:
      "from-badge-amber-soft-bg to-badge-amber-soft-text/25 text-badge-amber-soft-text ring-badge-amber-soft-text/30",
    accent: "bg-badge-amber-soft-text",
  },
};

// Every change AutoObserve makes today is an alert setting, so every row wears the tuning look.
export const TUNING_LOOK = KIND_LOOK.tuning;

// A state tag carries no icon, so Undone never reads as the Undo button beside it.
export const STATE_LOOK: Record<ChangeState, { variant: BadgeVariant; key: I18nKey }> = {
  done: { variant: "blue-soft", key: "autoobserve.activityLive.status.inForce" },
  undone: { variant: "default-soft", key: "autoobserve2.activityPage.status.undone" },
};

const isApplyField = (field: string): field is ApplyField => field in APPLY_FIELDS;

export const shiftsOf = (copy: ApplyCopy, fields: readonly FieldChange[]): ChangeShift[] =>
  fields.flatMap((f) => {
    if (!isApplyField(f.field)) return [];
    const key = APPLY_FIELDS[f.field];
    return [
      { setting: copy.fieldLabel(key), from: copy.value(key, f.from), to: copy.value(key, f.to) },
    ];
  });

/** Applies newest first, each keyed to the reader's own calendar day. */
export const toChanges = (
  entries: readonly AppliedEntry[],
  copy: ApplyCopy,
  timeZone: string,
): Change[] =>
  entries
    .map((entry) => {
      const at = entry.view.decided_at / 1000;
      return {
        entry,
        id: entry.view.decision_id,
        state: (entry.view.state === "undone" ? "undone" : "done") as ChangeState,
        at,
        day: dayKey(at, timeZone),
        shifts: shiftsOf(copy, entry.fields),
      };
    })
    .sort((a, b) => b.at - a.at);

/** A long ledger shows this many changes first and says how many more there are. */
export const CHANGES_SHOWN = 20;

export const capList = <T>(items: readonly T[], all: boolean, limit = CHANGES_SHOWN) => ({
  shown: all ? [...items] : items.slice(0, limit),
  more: all ? 0 : Math.max(0, items.length - limit),
});

export const matches = (change: Change, filter: ChangeFilter) =>
  filter === "all" || (filter === "undone") === (change.state === "undone");

export const changeCounts = (changes: readonly Change[]): Record<ChangeFilter, number> => ({
  all: changes.length,
  inForce: changes.filter((c) => c.state === "done").length,
  undone: changes.filter((c) => c.state === "undone").length,
});

/** Today and yesterday by name, a day this week by weekday, older days by date. */
export const dayLabel = (
  t: TranslateFn,
  zone: { locale: string; timeZone: string },
  at: number,
  nowMs: number,
): I18nText => {
  const key = dayKey(at, zone.timeZone);
  if (key === dayKey(nowMs, zone.timeZone)) return t("autoobserve.activityLive.days.today");
  if (key === dayKey(nowMs - 86_400_000, zone.timeZone))
    return t("autoobserve.activityLive.days.yesterday");
  const recent = nowMs - at < 6 * 86_400_000;
  return raw(
    new Intl.DateTimeFormat(
      zone.locale,
      recent
        ? { weekday: "long", timeZone: zone.timeZone }
        : { dateStyle: "medium", timeZone: zone.timeZone },
    ).format(new Date(at)),
  );
};

export const dayGroups = (
  changes: readonly Change[],
  filter: ChangeFilter,
): { day: string; changes: Change[] }[] => {
  const groups: { day: string; changes: Change[] }[] = [];
  for (const change of changes) {
    if (!matches(change, filter)) continue;
    const last = groups[groups.length - 1];
    if (last?.day === change.day) last.changes.push(change);
    else groups.push({ day: change.day, changes: [change] });
  }
  return groups;
};

export const timeText = (zone: { locale: string; timeZone: string }, at: number, nowMs: number) =>
  formatWhen(at, zone.locale, zone.timeZone, nowMs);

/** Who made and who undid the change, in the reader's words; "you" for the reader's own. */
export const actorLines = (
  t: TranslateFn,
  zone: { locale: string; timeZone: string },
  entry: AppliedEntry,
  me: string | undefined,
  nowMs: number,
): I18nText[] => {
  const who = (actor: string) => (actor === me ? t("insight.decisions.applied.you") : raw(actor));
  const when = (us: number) => timeText(zone, us / 1000, nowMs);
  const { view } = entry;
  if (view.state !== "undone")
    return [
      t("autoobserve.activityLive.by", { actor: who(view.actor), when: when(view.decided_at) }),
    ];
  // Without undone_at the server moved decided_at and actor to the undo, so they describe the undo.
  if (view.undone_at == null)
    return [
      t("autoobserve.activityLive.undoneBy", {
        actor: who(view.actor),
        when: when(view.decided_at),
      }),
    ];
  return [
    t("autoobserve.activityLive.by", { actor: who(view.actor), when: when(view.decided_at) }),
    t("autoobserve.activityLive.undoneBy", {
      actor: who(view.undone_by ?? view.actor),
      when: when(view.undone_at),
    }),
  ];
};

/** What changed, naming the setting when there is one, so a list of changes reads apart. */
export const changeHeadline = (t: TranslateFn, change: Change): I18nText => {
  const alert = raw(change.entry.title || String(t("autoobserveLive.history.untitled")));
  const [first] = change.shifts;
  if (change.shifts.length === 1)
    return t("autoobserve.activityLive.headlineOne", { setting: first.setting, alert });
  if (change.shifts.length > 1)
    return t(
      "autoobserve.activityLive.headlineMany",
      { count: change.shifts.length, alert },
      change.shifts.length,
    );
  return t("autoobserve.activityLive.headline", { alert });
};

/** The ledger's Who cell: who made it, or who undid it; the When column carries the time. */
export const whoText = (t: TranslateFn, entry: AppliedEntry, me: string | undefined): I18nText => {
  const who = (actor: string) => (actor === me ? t("insight.decisions.applied.you") : raw(actor));
  const { view } = entry;
  if (view.state !== "undone") return who(view.actor);
  return t("autoobserve.activityLive.whoUndone", { actor: who(view.undone_by ?? view.actor) });
};

/** What AutoObserve saw when it made a change, in the finding card's own labels and formats. */
export interface ChangeEvidence {
  confidence: I18nText | null;
  summary: string | null;
  lines: { column: string; label: I18nText; value: I18nText }[];
}

const CONFIDENCE_KEY: Record<string, I18nKey> = {
  High: "autoobserve.issueLive.confidence.high",
  Medium: "autoobserve.issueLive.confidence.medium",
  Low: "autoobserve.issueLive.confidence.low",
};

const isRule = (rule: string | undefined): rule is RuleId =>
  rule !== undefined && Object.hasOwn(RULE_META, rule);

export const evidenceOf = (
  t: TranslateFn,
  locale: string,
  saw: AppliedEvidence,
): ChangeEvidence => {
  const { rule_id, pattern, schema_version } = saw;
  const confidence = saw.confidence && CONFIDENCE_KEY[saw.confidence];
  // A rule this build cannot name shows its confidence and summary without rows.
  const record = isRule(rule_id)
    ? ({ ...saw.columns, rule_id, pattern, schema_version } as DigestRecord & { rule_id: RuleId })
    : null;
  return {
    confidence: confidence ? t(confidence) : null,
    summary: saw.title || null,
    lines: record
      ? evidenceFor(record)
          .filter((field) => record[field.column] != null)
          .map((field) => ({
            column: field.column,
            label: t(field.labelKey),
            value: formatEvidenceField(t, record, field, locale),
          }))
      : [],
  };
};

/** The before and after the details show, one `setting: value` line per field. */
export const configText = (shifts: readonly ChangeShift[], side: "from" | "to"): string =>
  shifts.map((s) => `${s.setting}: ${s[side]}`).join("\n");
