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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";
import type { RuleId } from "./digests";

export type EvidenceFormat = "count" | "ratio" | "seconds" | "text" | "boolean";

export interface EvidenceField {
  column: `evidence_${string}`;
  labelKey: I18nKey;
  format: EvidenceFormat;
}

export interface RuleMeta {
  labelKey: I18nKey;
  icon: IconName;
  /** The rule's `min_history`: a window shorter than this makes every run decline the rule for every alert. */
  minHistoryMinutes: number;
  evidence: EvidenceField[];
}

/** Ordered as the engine registers its default rules. */
export const RULE_IDS: RuleId[] = ["failure", "no_destination", "noise", "notify_failed", "silent"];

export const isRuleId = (value: string): value is RuleId => (RULE_IDS as string[]).includes(value);

export const RULE_META: Record<RuleId, RuleMeta> = {
  failure: {
    labelKey: "alertCalibration.rules.failure",
    icon: "error-outline",
    minHistoryMinutes: 24 * 60,
    evidence: [
      {
        column: "evidence_failure_evaluation_errors",
        labelKey: "alertCalibration.evidence.errors",
        format: "count",
      },
      {
        column: "evidence_failure_evaluations",
        labelKey: "alertCalibration.evidence.evaluations",
        format: "count",
      },
      {
        column: "evidence_failure_error_ratio",
        labelKey: "alertCalibration.evidence.errorRatio",
        format: "ratio",
      },
      {
        column: "evidence_failure_top_error",
        labelKey: "alertCalibration.evidence.topError",
        format: "text",
      },
      {
        column: "evidence_failure_top_error_count",
        labelKey: "alertCalibration.evidence.topErrorCount",
        format: "count",
      },
    ],
  },
  no_destination: {
    labelKey: "alertCalibration.rules.noDestination",
    icon: "block",
    minHistoryMinutes: 60,
    evidence: [
      {
        column: "evidence_nodestination_firings",
        labelKey: "alertCalibration.evidence.firings",
        format: "count",
      },
      {
        column: "evidence_nodestination_creates_incident",
        labelKey: "alertCalibration.evidence.deliveredThroughIncidents",
        format: "boolean",
      },
    ],
  },
  noise: {
    labelKey: "alertCalibration.rules.noise",
    icon: "campaign",
    minHistoryMinutes: 168 * 60,
    evidence: [
      {
        column: "evidence_noise_firings",
        labelKey: "alertCalibration.evidence.firings",
        format: "count",
      },
      {
        column: "evidence_noise_mean_time_to_normal_secs",
        labelKey: "alertCalibration.evidence.meanTimeToNormal",
        format: "seconds",
      },
      {
        column: "evidence_noise_incident_linkage_ratio",
        labelKey: "alertCalibration.evidence.incidentLinkage",
        format: "ratio",
      },
    ],
  },
  notify_failed: {
    labelKey: "alertCalibration.rules.notifyFailed",
    icon: "sync-problem",
    minHistoryMinutes: 24 * 60,
    evidence: [
      {
        column: "evidence_notifyfailed_delivery_failures",
        labelKey: "alertCalibration.evidence.failedDeliveries",
        format: "count",
      },
      {
        column: "evidence_notifyfailed_delivery_attempts",
        labelKey: "alertCalibration.evidence.attemptedDeliveries",
        format: "count",
      },
      {
        column: "evidence_notifyfailed_failure_ratio",
        labelKey: "alertCalibration.evidence.failureRatio",
        format: "ratio",
      },
    ],
  },
  silent: {
    labelKey: "alertCalibration.rules.silent",
    icon: "history-toggle-off",
    minHistoryMinutes: 30 * 24 * 60,
    evidence: [
      {
        column: "evidence_silent_evaluations",
        labelKey: "alertCalibration.evidence.evaluations",
        format: "count",
      },
      {
        column: "evidence_silent_firings",
        labelKey: "alertCalibration.evidence.firings",
        format: "count",
      },
      {
        column: "evidence_silent_history_secs",
        labelKey: "alertCalibration.evidence.history",
        format: "seconds",
      },
    ],
  },
};

export type ProposedAction =
  | "RaiseThreshold"
  | "LengthenEvaluationWindow"
  | "EnableDeduplication"
  | "ReviewForDeletion"
  | "FixAlertQuery"
  | "RepairDestination"
  | "AttachDestination";

export const ACTION_META: Record<ProposedAction, { labelKey: I18nKey; descriptionKey: I18nKey }> = {
  RaiseThreshold: {
    labelKey: "alertCalibration.actions.raiseThreshold",
    descriptionKey: "alertCalibration.actions.raiseThresholdDesc",
  },
  LengthenEvaluationWindow: {
    labelKey: "alertCalibration.actions.lengthenEvaluationWindow",
    descriptionKey: "alertCalibration.actions.lengthenEvaluationWindowDesc",
  },
  EnableDeduplication: {
    labelKey: "alertCalibration.actions.enableDeduplication",
    descriptionKey: "alertCalibration.actions.enableDeduplicationDesc",
  },
  ReviewForDeletion: {
    labelKey: "alertCalibration.actions.reviewForDeletion",
    descriptionKey: "alertCalibration.actions.reviewForDeletionDesc",
  },
  FixAlertQuery: {
    labelKey: "alertCalibration.actions.fixAlertQuery",
    descriptionKey: "alertCalibration.actions.fixAlertQueryDesc",
  },
  RepairDestination: {
    labelKey: "alertCalibration.actions.repairDestination",
    descriptionKey: "alertCalibration.actions.repairDestinationDesc",
  },
  AttachDestination: {
    labelKey: "alertCalibration.actions.attachDestination",
    descriptionKey: "alertCalibration.actions.attachDestinationDesc",
  },
};

export const isProposedAction = (name: string): name is ProposedAction => name in ACTION_META;

/** Rules whose `min_history` the window cannot cover, so every run declines them for every alert. */
export const rulesStarvedBy = (windowMinutes: number): RuleId[] =>
  RULE_IDS.filter((rule) => RULE_META[rule].minHistoryMinutes > windowMinutes);
