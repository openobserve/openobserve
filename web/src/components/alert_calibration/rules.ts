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
import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import type { DigestRecord, InsightAction, ReviewFocus, RuleId } from "./digests";

export type EvidenceFormat = "count" | "ratio" | "seconds" | "text" | "boolean" | "time";

export interface EvidenceField {
  column: `evidence_${string}`;
  labelKey: I18nKey;
  format: EvidenceFormat;
  /** Written only by some records, so a record without it shows no row rather than a dash. */
  optional?: true;
}

export interface LagListField {
  column: `evidence_${string}`;
  labelKey: I18nKey;
  /** The field naming each row: an org, or the start of an hour in microseconds. */
  key: "org_id" | "hour_start_micros";
}

export interface RuleMeta {
  labelKey: I18nKey;
  icon: IconName;
  /** The rule's `min_history`: a window shorter than this makes every run decline the rule for every alert. */
  minHistoryMinutes: number;
  evidence: EvidenceField[];
  /** A cluster-wide finding names no alert, so per-alert counts do not apply to it. */
  clusterWide?: true;
  lagLists?: LagListField[];
}

/** Its stream receives every org's trigger rows, so only its runs can judge the whole cluster. */
export const META_ORG_ID = "_meta";

/** Ordered as the engine registers its default rules. */
export const RULE_IDS: RuleId[] = [
  "failure",
  "no_destination",
  "noise",
  "notify_failed",
  "scheduler_health",
  "silent",
];

export const isRuleId = (value: string): value is RuleId => (RULE_IDS as string[]).includes(value);

/** Why a version-2 `failure` record's alert cannot fire, as AutoObserve's definition check found it. */
export type NotWorkingPattern =
  "stream_missing" | "field_missing" | "ignored_matcher" | "empty_scope" | "source_inactive";

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
      {
        column: "evidence_nodestination_candidate",
        labelKey: "alertCalibration.evidence.suggestedDestination",
        format: "text",
        optional: true,
      },
      {
        column: "evidence_nodestination_candidate_alerts",
        labelKey: "alertCalibration.evidence.folderAlertsUsingIt",
        format: "count",
        optional: true,
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
  scheduler_health: {
    labelKey: "alertCalibration.rules.schedulerHealth",
    icon: "hourglass-empty",
    minHistoryMinutes: 0,
    clusterWide: true,
    evidence: [
      {
        column: "evidence_schedulerhealth_affected_orgs",
        labelKey: "alertCalibration.evidence.affectedOrgs",
        format: "count",
      },
      {
        column: "evidence_schedulerhealth_congested_hours",
        labelKey: "alertCalibration.evidence.congestedHours",
        format: "count",
      },
      {
        column: "evidence_schedulerhealth_skipped_windows",
        labelKey: "alertCalibration.evidence.skippedWindows",
        format: "count",
      },
      {
        column: "evidence_schedulerhealth_late_evaluations",
        labelKey: "alertCalibration.evidence.lateEvaluations",
        format: "count",
      },
      {
        column: "evidence_schedulerhealth_evaluations",
        labelKey: "alertCalibration.evidence.evaluations",
        format: "count",
      },
      {
        column: "evidence_schedulerhealth_late_ratio",
        labelKey: "alertCalibration.evidence.lateRatio",
        format: "ratio",
      },
      {
        column: "evidence_schedulerhealth_max_delay_secs",
        labelKey: "alertCalibration.evidence.longestDelay",
        format: "seconds",
      },
    ],
    lagLists: [
      {
        column: "evidence_schedulerhealth_top_orgs",
        labelKey: "alertCalibration.detail.topOrgs",
        key: "org_id",
      },
      {
        column: "evidence_schedulerhealth_worst_hours",
        labelKey: "alertCalibration.detail.worstHours",
        key: "hour_start_micros",
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

const CHECKED_AT: EvidenceField = {
  column: "evidence_notworking_checked_at_micros",
  labelKey: "alertCalibration.evidence.checkedAt",
  format: "time",
};
const NOT_WORKING_ERRORS: EvidenceField[] = [
  {
    column: "evidence_notworking_evaluation_errors",
    labelKey: "alertCalibration.evidence.errors",
    format: "count",
  },
  {
    column: "evidence_notworking_evaluations",
    labelKey: "alertCalibration.evidence.evaluations",
    format: "count",
  },
];
const STREAM: EvidenceField = {
  column: "evidence_notworking_stream",
  labelKey: "alertCalibration.evidence.stream",
  format: "text",
};

/** The rows each definition-check pattern shows, in the evidence grid the card already has (spec §4). */
export const PATTERN_EVIDENCE: Record<NotWorkingPattern, EvidenceField[]> = {
  stream_missing: [STREAM, ...NOT_WORKING_ERRORS, CHECKED_AT],
  field_missing: [
    {
      column: "evidence_notworking_field",
      labelKey: "alertCalibration.evidence.field",
      format: "text",
    },
    ...NOT_WORKING_ERRORS,
    CHECKED_AT,
  ],
  ignored_matcher: [
    {
      column: "evidence_notworking_field",
      labelKey: "alertCalibration.evidence.label",
      format: "text",
    },
    CHECKED_AT,
  ],
  empty_scope: [CHECKED_AT],
  source_inactive: [
    STREAM,
    {
      column: "evidence_notworking_last_data_at_micros",
      labelKey: "alertCalibration.evidence.lastDataAt",
      format: "time",
    },
    CHECKED_AT,
  ],
};

const isNotWorkingPattern = (value: unknown): value is NotWorkingPattern =>
  typeof value === "string" && Object.hasOwn(PATTERN_EVIDENCE, value);

/** A version-2 `failure` record with a pattern is AutoObserve's definition finding, shown as far as it was stated. */
export const evidenceFor = (record: DigestRecord & { rule_id: RuleId }): EvidenceField[] =>
  record.rule_id === "failure" &&
  (record.schema_version ?? 1) >= 2 &&
  isNotWorkingPattern(record.pattern)
    ? PATTERN_EVIDENCE[record.pattern].filter((field) => record[field.column] != null)
    : RULE_META[record.rule_id].evidence.filter(
        (field) => !field.optional || record[field.column] != null,
      );

/** Version 2 reports a broken alert under `failure`; historical runs keep their legacy label (M2). */
export const ruleLabelKey = (rule: RuleId, version: number): I18nKey =>
  rule === "failure" && version >= 2
    ? "alertCalibration.rules.notWorking"
    : RULE_META[rule].labelKey;

/** The advice codes findings carry (ENT not_working.rs `advice`, no_destination.rs `ADVICE_*`). */
export const ADVICE_LABEL: Record<string, I18nKey> = {
  check_missing_stream: "alertCalibration.advice.checkMissingStream",
  check_missing_field: "alertCalibration.advice.checkMissingField",
  check_ignored_label: "alertCalibration.advice.checkIgnoredLabel",
  check_filter_values: "alertCalibration.advice.checkFilterValues",
  confirm_quiet_source: "alertCalibration.advice.confirmQuietSource",
  attach_folder_destination: "alertCalibration.advice.attachFolderDestination",
  add_destination: "alertCalibration.advice.addDestination",
};

/** Limitation codes (ENT not_working.rs `LIMIT_*`). */
export const LIMITATION_LABEL: Record<string, I18nKey> = {
  quiet_source: "alertCalibration.limitation.quietSource",
  scan_truncated: "alertCalibration.limitation.scanTruncated",
};

/** Quality-reason codes (ENT not_working.rs `QUALITY_SCAN_TRUNCATED`). */
export const QUALITY_REASON_LABEL: Record<string, I18nKey> = {
  scan_truncated: "alertCalibration.qualityReason.scanTruncated",
};

export type ProposedAction =
  | "RaiseThreshold"
  | "LengthenEvaluationWindow"
  | "EnableDeduplication"
  | "ReviewForDeletion"
  | "FixAlertQuery"
  | "RepairDestination"
  | "AttachDestination"
  | "ScaleAlertScheduler";

export interface ActionMeta {
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  /** Settings named inside the description, kept out of the catalogue so no translation alters them. */
  descriptionParams?: Record<string, I18nText>;
}

export const ACTION_META: Record<ProposedAction, ActionMeta> = {
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
  ScaleAlertScheduler: {
    labelKey: "alertCalibration.actions.scaleAlertScheduler",
    descriptionKey: "alertCalibration.actions.scaleAlertSchedulerDesc",
    descriptionParams: {
      concurrency: raw("ZO_ALERT_SCHEDULE_CONCURRENCY"),
      pullers: raw("ZO_SCHEDULER_PER_MODULE_PULLERS"),
    },
  },
};

export const isProposedAction = (name: string): name is ProposedAction => name in ACTION_META;

/** A v2 action's button label, by type and then focus; the design maps them one to one (D:L289-300). */
export const INSIGHT_ACTION_LABEL: {
  review_alert: Record<ReviewFocus | "unfocused", I18nKey>;
  review_source: I18nKey;
  review_platform: I18nKey;
} = {
  review_alert: {
    unfocused: "alertCalibration.insightActions.reviewAlert",
    query: "alertCalibration.insightActions.reviewQuery",
    settings: "alertCalibration.insightActions.reviewSettings",
    threshold: "alertCalibration.insightActions.reviewThreshold",
    grouping: "alertCalibration.insightActions.reviewGrouping",
  },
  review_source: "alertCalibration.insightActions.reviewSource",
  review_platform: "alertCalibration.insightActions.inspectPlatform",
};

export function insightActionLabel(action: InsightAction): I18nKey {
  if (action.type === "review_platform") return INSIGHT_ACTION_LABEL.review_platform;
  if (action.type === "review_source") return INSIGHT_ACTION_LABEL.review_source;
  return INSIGHT_ACTION_LABEL.review_alert[action.focus ?? "unfocused"];
}

/** Version 2 writes no silent finding, so an always-empty Silent group would read as a clearance (Q2). */
export const rulesOfVersion = (version: number): RuleId[] =>
  RULE_IDS.filter((rule) => rule !== "silent" || version < 2);

/** A cluster-wide rule never runs for an ordinary org, so it is shown only in `_meta`. */
export const rulesShownFor = (orgId: string, version = 1): RuleId[] =>
  rulesOfVersion(version).filter((rule) => !RULE_META[rule].clusterWide || orgId === META_ORG_ID);

/** Rules whose `min_history` the window cannot cover, so every run declines them for every alert. */
export const rulesStarvedBy = (windowMinutes: number): RuleId[] =>
  RULE_IDS.filter((rule) => RULE_META[rule].minHistoryMinutes > windowMinutes);
