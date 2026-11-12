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

// List display reads only incident metadata; stale state is computed by the server.

import { gt, raw, type I18nKey, type I18nText } from "@/types/i18n";
import type { Incident, RcaBand, RcaOutcome, RcaRunState, RcaSummary } from "@/services/incidents";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { formatTimestampInTimezone } from "@/utils/date";
import { timezoneAbbr } from "@/utils/formatters";

export type RcaCellTone = "muted" | "warn" | "warn-strong" | "ok" | "err";

// Strong warning uses the orange family of the list's P2 row rail.
export const RCA_BADGE_VARIANT: Record<RcaCellTone, BadgeVariant> = {
  muted: "default",
  warn: "warning",
  "warn-strong": "orange-outline",
  ok: "success",
  err: "error",
};

export interface RcaCellModel {
  /** `analyze`: the ghost "Analyze" button; `state`: a label pill with detail. */
  kind: "analyze" | "state";
  label: I18nText;
  tone: RcaCellTone;
  /** Muted text after the label; empty when none. */
  detail: I18nText;
  /** Warning-text suffix when a newer run did not finish; empty when none. */
  rerunNote: I18nText;
  spinner: boolean;
  /** The label is a license lock reason. */
  locked: boolean;
  /** The row shows a ghost "Analyze" on hover (RCA off for this incident). */
  showAnalyzeOnHover: boolean;
}

export interface RcaCellOptions {
  /** `incidents_rca_enabled` from `/config`. */
  rcaEnabled: boolean;
  /** Why the license keeps RCA off; replaces the disabled label when RCA is off. */
  lockedReason?: I18nText;
  /** Epoch milliseconds. */
  now: number;
  /** Zone of the "until HH:mm <zone>" answer deadline; UTC when not given. */
  timezone?: string;
}

const EMPTY = raw("");

/** Compact "45s" / "4m" / "2h 5m" / "4d" label from a millisecond delta. */
export function humanizeElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/** "18:49 GMT+5:30": the viewer's zone, named because the other RCA times are UTC. */
export const formatRcaLocalClock = (us: number, timezone: string): string =>
  `${formatTimestampInTimezone(us, "HH:mm", timezone)} ${timezoneAbbr(timezone, new Date(us / 1000))}`;

/** "a.rao@acme.io" → "a.rao"; a value without "@" is returned unchanged. */
export function userLocalPart(user: string): string {
  const at = user.indexOf("@");
  return at > 0 ? user.slice(0, at) : user;
}

const sinceMicros = (micros: number, now: number) => humanizeElapsed(now - micros / 1000);

const state = (
  label: I18nText,
  tone: RcaCellTone,
  detail: I18nText = EMPTY,
  extra: Partial<Pick<RcaCellModel, "rerunNote" | "spinner">> = {},
): RcaCellModel => ({
  kind: "state",
  label,
  tone,
  detail,
  rerunNote: extra.rerunNote ?? EMPTY,
  spinner: extra.spinner ?? false,
  locked: false,
  showAnalyzeOnHover: false,
});

export const OUTCOME: Record<RcaOutcome, { key: I18nKey; tone: RcaCellTone }> = {
  root_cause_identified: {
    key: "alerts.incidents.aiAnalysis.outcome.rootCauseIdentified",
    tone: "ok",
  },
  multiple_root_causes: {
    key: "alerts.incidents.aiAnalysis.outcome.multipleRootCauses",
    tone: "ok",
  },
  contributing_factor: {
    key: "alerts.incidents.aiAnalysis.outcome.contributingFactor",
    tone: "warn",
  },
  inconclusive: { key: "alerts.incidents.aiAnalysis.outcome.inconclusive", tone: "warn" },
  blocked: { key: "alerts.incidents.aiAnalysis.outcome.blocked", tone: "warn-strong" },
};

// Mirrors the reasons stored in `rca_off_reason` (`src/core/src/alerts/incidents.rs:48-57`), bar `l0_off`.
export type StoredNotRunReason =
  "rca_disabled" | "ai_unavailable" | "quota_exceeded" | "cooling_down" | "start_failed";

// Stored when the incident opened, so each detail reads in the past tense.
export const NOT_RUN: Record<
  StoredNotRunReason,
  { label: I18nKey; tone: RcaCellTone; detail: I18nKey }
> = {
  rca_disabled: {
    label: "alerts.incidents.aiAnalysis.notAnalyzed",
    tone: "muted",
    detail: "alerts.incidents.aiAnalysis.reason.rcaDisabled",
  },
  ai_unavailable: {
    label: "alerts.incidents.aiAnalysis.notAnalyzed",
    tone: "muted",
    detail: "alerts.incidents.aiAnalysis.reason.aiUnavailable",
  },
  quota_exceeded: {
    label: "alerts.incidents.aiAnalysis.notAnalyzed",
    tone: "warn",
    detail: "alerts.incidents.aiAnalysis.reason.quotaExceeded",
  },
  cooling_down: {
    label: "alerts.incidents.aiAnalysis.notAnalyzed",
    tone: "muted",
    detail: "alerts.incidents.aiAnalysis.reason.coolingDown",
  },
  start_failed: {
    label: "alerts.incidents.aiAnalysis.failed",
    tone: "err",
    detail: "alerts.incidents.aiAnalysis.reason.startFailed",
  },
};

export const isStoredNotRunReason = (
  reason: string | null | undefined,
): reason is StoredNotRunReason =>
  !!reason && Object.prototype.hasOwnProperty.call(NOT_RUN, reason);

const BAND_KEY: Record<RcaBand, I18nKey> = {
  high: "alerts.incidents.aiAnalysis.band.high",
  medium: "alerts.incidents.aiAnalysis.band.medium",
  low: "alerts.incidents.aiAnalysis.band.low",
};

/** The band as list detail ("High"), or empty when the run has none. */
const bandDetail = (band: RcaBand | null): I18nText => (band ? gt(BAND_KEY[band]) : EMPTY);

/** Joins the non-empty detail parts with " · ". */
const joinDetail = (...parts: I18nText[]): I18nText => raw(parts.filter(Boolean).join(" · "));

/** "steered by j.okafor, a.rao", or empty. */
const steeredByDetail = (rca: RcaSummary): I18nText =>
  rca.summary.steered_by.length > 0
    ? gt("alerts.incidents.aiAnalysis.steeredBy", {
        names: rca.summary.steered_by.map(userLocalPart).join(", "),
      })
    : EMPTY;

export function rcaCellModel(
  incident: Pick<Incident, "rca" | "rca_off_reason" | "severity">,
  { rcaEnabled, lockedReason, now, timezone = "UTC" }: RcaCellOptions,
): RcaCellModel {
  const rca = incident.rca;

  if (!rca) {
    if (!rcaEnabled) {
      return lockedReason
        ? { ...state(lockedReason, "muted"), locked: true }
        : state(gt("alerts.incidents.aiAnalysis.rcaDisabled"), "muted");
    }
    if (incident.rca_off_reason === "l0_off") {
      return {
        ...state(
          gt("alerts.incidents.aiAnalysis.rcaOff"),
          "muted",
          gt("alerts.incidents.aiAnalysis.noAiSreFor", {
            severity: String(incident.severity).toUpperCase(),
          }),
        ),
        showAnalyzeOnHover: true,
      };
    }
    if (isStoredNotRunReason(incident.rca_off_reason)) {
      const notRun = NOT_RUN[incident.rca_off_reason];
      return {
        ...state(gt(notRun.label), notRun.tone, gt(notRun.detail)),
        showAnalyzeOnHover: true,
      };
    }
    return {
      kind: "analyze",
      label: gt("alerts.incidents.aiAnalysis.analyze"),
      tone: "muted",
      detail: EMPTY,
      rerunNote: EMPTY,
      spinner: false,
      locked: false,
      showAnalyzeOnHover: false,
    };
  }

  const previous = rca.summary.previous;

  switch (rca.state) {
    case "running": {
      const investigating = gt("alerts.incidents.aiAnalysis.investigating");
      if (rca.stale) {
        return state(
          investigating,
          "warn",
          gt("alerts.incidents.aiAnalysis.noUpdateFor", {
            elapsed: sinceMicros(rca.updated_at, now),
          }),
        );
      }
      const elapsed = rca.summary.stage_index
        ? gt("alerts.incidents.aiAnalysis.stageProgress", {
            index: rca.summary.stage_index,
            count: rca.summary.stage_count,
          })
        : sinceMicros(rca.started_at, now);
      return state(
        investigating,
        "muted",
        joinDetail(
          previous ? gt("alerts.incidents.aiAnalysis.rerunElapsed", { elapsed }) : raw(elapsed),
          steeredByDetail(rca),
        ),
        { spinner: true },
      );
    }
    case "waiting_input": {
      // "Blocked · Needs change history · until 14:40 GMT+5:30".
      const deadline = rca.summary.deadline_at;
      return state(
        gt("alerts.incidents.aiAnalysis.blocked"),
        "warn-strong",
        joinDetail(
          raw(rca.summary.detail),
          deadline
            ? gt("alerts.incidents.aiAnalysis.until", {
                time: formatRcaLocalClock(deadline, timezone),
              })
            : EMPTY,
        ),
      );
    }
    case "completed": {
      if (!rca.outcome) {
        // A legacy run with no outcome reads "Analyzed".
        return state(
          gt("alerts.incidents.aiAnalysis.analyzed"),
          "ok",
          gt("alerts.incidents.aiAnalysis.ago", { ago: sinceMicros(rca.updated_at, now) }),
        );
      }
      const outcome = OUTCOME[rca.outcome];
      // A blocked run names what it needs; the others show the band.
      const detail =
        rca.outcome === "blocked" ? raw(rca.summary.detail) : bandDetail(rca.confidence);
      // "Root cause identified · Medium · unblocked by a.rao".
      const unblockedBy = rca.summary.unblocked_by
        ? gt("alerts.incidents.aiAnalysis.unblockedBy", {
            user: userLocalPart(rca.summary.unblocked_by),
          })
        : EMPTY;
      return state(gt(outcome.key), outcome.tone, joinDetail(detail, unblockedBy));
    }
    case "failed":
    case "cancelled": {
      const cancelledBy = rca.summary.cancelled_by ? userLocalPart(rca.summary.cancelled_by) : null;
      if (previous) {
        // A newer run that did not finish never hides the earlier result.
        const rerunNote =
          rca.state === "failed"
            ? gt("alerts.incidents.aiAnalysis.rerunFailed")
            : cancelledBy
              ? gt("alerts.incidents.aiAnalysis.rerunCancelledBy", { user: cancelledBy })
              : gt("alerts.incidents.aiAnalysis.rerunCancelled");
        if (!previous.outcome) {
          return state(gt("alerts.incidents.aiAnalysis.analyzed"), "ok", EMPTY, { rerunNote });
        }
        const outcome = OUTCOME[previous.outcome];
        return state(gt(outcome.key), outcome.tone, bandDetail(previous.confidence), {
          rerunNote,
        });
      }
      // The server's reason wins; the count is the drawer's Resume count when stored.
      const finished = rca.summary.reusable_steps ?? Math.max(rca.summary.steps - 1, 0);
      const detail =
        rca.state === "failed" || rca.summary.detail
          ? raw(rca.summary.detail)
          : cancelledBy
            ? gt(
                "alerts.incidents.aiAnalysis.cancelledByAfterChecks",
                { user: cancelledBy, count: finished },
                finished,
              )
            : gt("alerts.incidents.aiAnalysis.cancelledAfterChecks", { count: finished }, finished);
      const label =
        rca.state === "failed"
          ? gt("alerts.incidents.aiAnalysis.failed")
          : gt("alerts.incidents.rcaRun.state.cancelled");
      return state(label, "err", detail);
    }
  }
}

/** True for a run the list polls for. */
export const isLiveRca = (rca: { state: RcaRunState | null } | null | undefined): boolean =>
  rca?.state === "running" || rca?.state === "waiting_input";
