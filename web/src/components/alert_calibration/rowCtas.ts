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

import type { RouteLocationRaw } from "vue-router";
import { raw, type TranslateFn } from "@/types/i18n";
import type { AiFinding } from "@/components/autoobserve/insight/insightCta";
import { logsForFinding } from "@/components/autoobserve/insight/targets/logsTargets";
import type { ReviewAlertAction } from "./applySuggestion";
import { insightActionsOf, schemaVersion, titleAfterName, type FindingRecord } from "./digests";

/** The next steps a calibration list row offers beside Open alert and Dismiss. */
export interface RowCtas {
  review: ReviewAlertAction | null;
  logs: RouteLocationRaw | null;
  ai: AiFinding | null;
}

const failureAi = (t: TranslateFn, finding: FindingRecord): AiFinding | null => {
  const alert = finding.alert_name ?? "";
  if (finding.rule_id !== "failure" || !alert) return null;
  const what = titleAfterName(finding).replace(/[.\s]+$/, "");
  return {
    kind: "alert_not_working",
    subject: alert,
    request: t("insight.ai.calibration.failure", { alert: raw(alert), what: raw(what) }),
    facts: [
      ["Alert", alert],
      ["Finding", finding.title],
    ],
  };
};

export const rowCtas = (t: TranslateFn, finding: FindingRecord, nowUs: number): RowCtas => {
  const actions = schemaVersion(finding) >= 2 ? insightActionsOf(finding) : [];
  const review = actions.find((a): a is ReviewAlertAction => a.type === "review_alert") ?? null;
  const source = actions.find((a) => a.type === "review_source");
  const logs =
    source?.type === "review_source"
      ? logsForFinding(
          {
            stream_type: source.stream_type,
            stream_name: source.stream_name,
            signal_at: finding._timestamp,
          },
          nowUs,
        )
      : null;
  return { review, logs, ai: failureAi(t, finding) };
};
