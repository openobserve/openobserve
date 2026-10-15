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

// The "AI analysis" cell of the incidents list (01 §12.1, Phase 1 rows). The
// model reads only `incident.rca`, `incident.rca_off_reason` and the severity;
// `stale` comes from the server and is never computed here (RR-9).

import { gt, raw, type I18nText } from "@/types/i18n";
import type { Incident, RcaSummary } from "@/services/incidents";

export type RcaCellTone = "muted" | "warn" | "warn-strong" | "ok" | "err";

export interface RcaCellModel {
  /** `analyze`: the ghost "Analyze" button; `state`: a label pill with detail. */
  kind: "analyze" | "state";
  label: I18nText;
  tone: RcaCellTone;
  /** Muted text after the label; empty when none. */
  detail: I18nText;
  /** Warning-text suffix when a newer run did not finish (RR-42); empty when none. */
  rerunNote: I18nText;
  spinner: boolean;
  /** The row shows a ghost "Analyze" on hover (RCA off for this incident). */
  showAnalyzeOnHover: boolean;
}

export interface RcaCellOptions {
  /** `incidents_rca_enabled` from `/config` (RR-43). */
  rcaEnabled: boolean;
  /** Epoch milliseconds. */
  now: number;
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
  showAnalyzeOnHover: false,
});

export function rcaCellModel(
  incident: Pick<Incident, "rca" | "rca_off_reason" | "severity">,
  { rcaEnabled, now }: RcaCellOptions,
): RcaCellModel {
  const rca = incident.rca;

  if (!rca) {
    if (!rcaEnabled) return state(gt("alerts.incidents.aiAnalysis.rcaDisabled"), "muted");
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
    return {
      kind: "analyze",
      label: gt("alerts.incidents.aiAnalysis.analyze"),
      tone: "muted",
      detail: EMPTY,
      rerunNote: EMPTY,
      spinner: false,
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
      const elapsed = sinceMicros(rca.started_at, now);
      return state(
        investigating,
        "muted",
        previous ? gt("alerts.incidents.aiAnalysis.rerunElapsed", { elapsed }) : raw(elapsed),
        { spinner: true },
      );
    }
    case "waiting_input":
      return state(
        gt("alerts.incidents.aiAnalysis.blocked"),
        "warn-strong",
        raw(rca.summary.detail),
      );
    case "completed":
      return state(
        gt("alerts.incidents.aiAnalysis.analyzed"),
        "ok",
        gt("alerts.incidents.aiAnalysis.ago", { ago: sinceMicros(rca.updated_at, now) }),
      );
    case "failed":
    case "cancelled": {
      const cancelledBy = rca.summary.cancelled_by ? userLocalPart(rca.summary.cancelled_by) : null;
      if (previous) {
        // A newer run that did not finish never hides the earlier result (RR-42).
        // Phase 1 has no outcome label and no band: a finished result reads "Analyzed".
        const rerunNote =
          rca.state === "failed"
            ? gt("alerts.incidents.aiAnalysis.rerunFailed")
            : cancelledBy
              ? gt("alerts.incidents.aiAnalysis.rerunCancelledBy", { user: cancelledBy })
              : gt("alerts.incidents.aiAnalysis.rerunCancelled");
        return state(gt("alerts.incidents.aiAnalysis.analyzed"), "ok", EMPTY, { rerunNote });
      }
      // A cancelled run reads "Failed"; the detail tells it apart from a broken run.
      const detail =
        rca.state === "failed"
          ? raw(rca.summary.detail)
          : cancelledBy
            ? gt("alerts.incidents.aiAnalysis.cancelledBy", { user: cancelledBy })
            : gt("alerts.incidents.aiAnalysis.cancelled");
      return state(gt("alerts.incidents.aiAnalysis.failed"), "err", detail);
    }
  }
}

/** True for a run the list polls for (RR-34). */
export const isLiveRca = (rca: RcaSummary | null | undefined): boolean =>
  rca?.state === "running" || rca?.state === "waiting_input";
