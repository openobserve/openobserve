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

import type { OrgRcaRun } from "@/services/rca_runs_org";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

/** How a run's state reads in a list: a working dot, a check, a plain stop, or the error glyph (never red text). */
export type RunMark = "working" | "done" | "stopped" | "failed";

/** The mark a run shows in its status slot. */
export function runMark(run: Pick<OrgRcaRun, "state">): RunMark {
  switch (run.state) {
    case "running":
    case "waiting_input":
      return "working";
    case "completed":
      return "done";
    case "cancelled":
      return "stopped";
    default:
      return "failed";
  }
}

/** The run's state in the words the incident page already uses. */
export function runStateLabel(run: Pick<OrgRcaRun, "state">, t: TranslateFn): I18nText {
  switch (run.state) {
    case "running":
      return t("alerts.incidents.rcaRun.state.investigating");
    case "waiting_input":
      return t("alerts.incidents.rcaRun.state.waitingInput");
    case "completed":
      return t("alerts.incidents.rcaRun.state.analyzed");
    case "cancelled":
      return t("alerts.incidents.rcaRun.state.cancelled");
    default:
      return t("alerts.incidents.rcaRun.state.failed");
  }
}

/** The run's title: the incident's own, else its id. */
export function runTitle(run: Pick<OrgRcaRun, "incident_title" | "incident_id">): I18nText {
  return raw(run.incident_title?.trim() || run.incident_id);
}

/** A run that ended without a report and can be started again. */
export function runFailed(run: Pick<OrgRcaRun, "state">): boolean {
  return run.state === "failed" || run.state === "refused";
}
