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

import type { I18nText, TranslateFn } from "@/types/i18n";
import type { SlackInsightsDigestCounts, SlackInsightsLastDigest } from "@/types/slack";
import { serverMessageOf, statusOf } from "@/utils/slackLink";

/** The AutoObserve form's values; `channel_id` null is no channel. */
export interface InsightsFormValues extends Record<string, unknown> {
  installation_id: string;
  channel_id: string | null;
  digest_time: string;
  digest_time_zone: string;
  post_trial_findings: boolean;
  allow_changes_from_slack: boolean;
}

export type InsightsSaveFailureKind = "stale" | "noAnswer" | "notInChannel" | "forbidden" | "other";

export interface InsightsSaveFailure {
  kind: InsightsSaveFailureKind;
  message: I18nText;
  /** The reader's own edits, kept so a refresh that drops them leaves a record. */
  detail: I18nText | null;
}

/** Today's open work from the AutoObserve routes; `attentionAtLeast` when the page was capped. */
export interface InsightsTodayCounts {
  attention: number;
  attentionAtLeast: boolean;
  suggestions: number;
}

export type InsightsReadOnlyField = "trial" | "allow";

const NOT_IN_CHANNEL = "not_in_channel";
// A gateway that gave up is the same "didn't answer" to the reader as a dropped connection.
const NO_ANSWER_STATUSES = new Set([502, 503, 504]);

const listOf = (locale: string, parts: readonly string[]): string =>
  new Intl.ListFormat(locale, { style: "short", type: "unit" }).format(parts);

const dayIn = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);

const timeIn = (locale: string, ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);

const codeOf = (error: unknown): string | null => {
  const data = (error as { response?: { data?: { code?: unknown } } } | null)?.response?.data;
  return typeof data?.code === "string" ? data.code : null;
};

export const channelLabel = (name: string): string => `#${name}`;

/** "today 09:00" or "Nov 8 09:00", in the digest's own zone. */
export function digestWhen(
  t: TranslateFn,
  locale: string,
  timeUs: number,
  timeZone: string,
  nowMs: number,
): I18nText {
  const ms = Math.floor(timeUs / 1000);
  const time = timeIn(locale, ms, timeZone);
  if (dayIn(ms, timeZone) === dayIn(nowMs, timeZone)) {
    return t("slackApp.insights.today", { time });
  }
  const date = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }).format(
    ms,
  );
  return t("slackApp.insights.onDate", { date, time });
}

/** The digest's non-zero counts as one list: "2 need attention, 30 suggestions". */
export function digestCounts(
  t: TranslateFn,
  locale: string,
  counts: SlackInsightsDigestCounts,
): string {
  const parts: string[] = [];
  if (counts.needs_attention > 0) {
    parts.push(
      t(
        "slackApp.insights.counts.needsAttention",
        { count: counts.needs_attention },
        counts.needs_attention,
      ),
    );
  }
  if (counts.suggestions > 0) {
    parts.push(
      t("slackApp.insights.counts.suggestions", { count: counts.suggestions }, counts.suggestions),
    );
  }
  if (counts.calibration_findings !== undefined) {
    if (counts.calibration_findings > 0) {
      parts.push(
        t(
          "slackApp.insights.counts.calibrationFindings",
          { count: counts.calibration_findings },
          counts.calibration_findings,
        ),
      );
    }
  } else if (counts.calibration_runs > 0) {
    parts.push(
      t(
        "slackApp.insights.counts.calibrationRuns",
        { count: counts.calibration_runs },
        counts.calibration_runs,
      ),
    );
  }
  return listOf(locale, parts);
}

export function lastDigestLine(
  t: TranslateFn,
  locale: string,
  digest: SlackInsightsLastDigest,
  timeZone: string,
  nowMs: number,
): I18nText {
  const when = digestWhen(t, locale, digest.time_us, timeZone, nowMs);
  const counts = digestCounts(t, locale, digest.counts);
  return counts
    ? t("slackApp.insights.lastDigest", { when, counts })
    : t("slackApp.insights.lastDigestNoCounts", { when });
}

export function lastDigestInLine(
  t: TranslateFn,
  locale: string,
  digest: SlackInsightsLastDigest,
  timeZone: string,
  nowMs: number,
  channelName: string,
): I18nText {
  const when = digestWhen(t, locale, digest.time_us, timeZone, nowMs);
  return t("slackApp.insights.lastDigestIn", { when, channel: channelLabel(channelName) });
}

/** One organization posts to one channel; names the other workspace when there is exactly one. */
export function moveLine(t: TranslateFn, otherWorkspaces: readonly string[]): I18nText {
  const workspace =
    otherWorkspaces.length === 1 ? otherWorkspaces[0] : t("slackApp.insights.anotherWorkspace");
  return t("slackApp.insights.moveNote", { workspace });
}

/** Today's counts in the no-channel line, or null when they are unknown or both zero. */
export function todayCountsSentence(
  t: TranslateFn,
  counts: InsightsTodayCounts | null,
  org: string,
): I18nText | null {
  if (!counts || (counts.attention === 0 && !counts.attentionAtLeast && counts.suggestions === 0)) {
    return null;
  }
  const attention = counts.attentionAtLeast
    ? t("slackApp.insights.thingsNeedAttentionAtLeast", { count: counts.attention })
    : t("slackApp.insights.thingsNeedAttention", { count: counts.attention }, counts.attention);
  const suggestions = t(
    "slackApp.insights.counts.suggestions",
    { count: counts.suggestions },
    counts.suggestions,
  );
  return t("slackApp.insights.noChannelCounts", { attention, suggestions, org });
}

export function removedLine(
  t: TranslateFn,
  workspace: string,
  counts: InsightsTodayCounts | null,
): I18nText {
  if (!counts || (counts.attention === 0 && !counts.attentionAtLeast)) {
    return t("slackApp.insights.removed", { workspace });
  }
  const attention = counts.attentionAtLeast ? `${counts.attention}+` : String(counts.attention);
  return t("slackApp.insights.removedWithCounts", {
    workspace,
    counts: t(
      "slackApp.insights.counts.needsAttention",
      { count: attention },
      counts.attentionAtLeast ? 2 : counts.attention,
    ),
  });
}

/** The short read-only line under a switch, saying what its current value does. */
export function readOnlyHelp(t: TranslateFn, field: InsightsReadOnlyField, on: boolean): I18nText {
  if (field === "trial") {
    return on ? t("slackApp.insights.trialOnShort") : t("slackApp.insights.trialOffShort");
  }
  return on ? t("slackApp.insights.allowOnShort") : t("slackApp.insights.allowOffShort");
}

/** Each changed field as "Label → value", in the form's order. */
export function editSummary(
  t: TranslateFn,
  saved: InsightsFormValues,
  edited: InsightsFormValues,
  channelName: string,
): string[] {
  const onOff = (on: boolean) => (on ? t("slackApp.insights.on") : t("slackApp.insights.off"));
  const edit = (field: I18nText, value: string) => t("slackApp.insights.edit", { field, value });
  const edits: string[] = [];
  if (saved.channel_id !== edited.channel_id || saved.installation_id !== edited.installation_id) {
    edits.push(
      edit(
        t("slackApp.insights.editLabel.channel"),
        edited.channel_id ? channelLabel(channelName) : t("slackApp.insights.noChannelValue"),
      ),
    );
  }
  if (
    saved.digest_time !== edited.digest_time ||
    saved.digest_time_zone !== edited.digest_time_zone
  ) {
    edits.push(
      edit(
        t("slackApp.insights.editLabel.digestTime"),
        `${edited.digest_time} ${edited.digest_time_zone}`,
      ),
    );
  }
  if (saved.post_trial_findings !== edited.post_trial_findings) {
    edits.push(edit(t("slackApp.insights.editLabel.trial"), onOff(edited.post_trial_findings)));
  }
  if (saved.allow_changes_from_slack !== edited.allow_changes_from_slack) {
    edits.push(
      edit(t("slackApp.insights.editLabel.allow"), onOff(edited.allow_changes_from_slack)),
    );
  }
  return edits;
}

export function classifySaveFailure(error: unknown): InsightsSaveFailureKind {
  const status = statusOf(error);
  if (status === undefined || NO_ANSWER_STATUSES.has(status)) return "noAnswer";
  if (status === 409) return "stale";
  if (codeOf(error) === NOT_IN_CHANNEL) return "notInChannel";
  if (status === 403) return "forbidden";
  return "other";
}

/** The red footer line for a failed save: what failed, and what the reader does next. */
export function saveFailure(
  t: TranslateFn,
  locale: string,
  error: unknown,
  edits: readonly string[],
  channelName: string,
): InsightsSaveFailure {
  const kind = classifySaveFailure(error);
  if (kind === "stale") {
    const detail = edits.length
      ? t("slackApp.insights.failed.yourEdits", { edits: listOf(locale, edits) }, edits.length)
      : null;
    return { kind, message: t("slackApp.insights.failed.stale"), detail };
  }
  if (kind === "noAnswer") {
    return { kind, message: t("slackApp.insights.failed.noAnswer"), detail: null };
  }
  if (kind === "notInChannel") {
    return {
      kind,
      message: t("slackApp.insights.failed.notInChannel", { channel: channelLabel(channelName) }),
      detail: null,
    };
  }
  if (kind === "forbidden") {
    return { kind, message: t("slackApp.insights.failed.forbidden"), detail: null };
  }
  // The template ends the reason's sentence, so a server message's own full stop is dropped.
  const reason = serverMessageOf(error)?.replace(/[.!?]+\s*$/, "");
  return {
    kind,
    message: reason
      ? t("slackApp.insights.failed.refused", { reason })
      : t("slackApp.insights.failed.unknown"),
    detail: null,
  };
}
