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
import type { DigestRecord, InsightAction, RuleId } from "./digests";

export type EvidenceFormat =
  | "count"
  | "ratio"
  | "seconds"
  | "text"
  | "boolean"
  | "time"
  | "errorClass"
  | "durationMs"
  | "evaluationTimes"
  | "nearLimit";

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

/** The evaluation-error classes a version-2 `failure` record names (ENT context.rs `ErrorClass`). */
export type ErrorClass =
  "stream_missing" | "field_missing" | "syntax" | "resource_timeout" | "resource_memory" | "other";

/** Why a version-2 `failure` record's alert cannot fire: a definition check or its recorded errors. */
export type NotWorkingPattern = ErrorClass | "ignored_matcher" | "empty_scope" | "source_inactive";

export const ERROR_CLASS_LABEL: Record<ErrorClass, I18nKey> = {
  stream_missing: "alertCalibration.errorClass.streamMissing",
  field_missing: "alertCalibration.errorClass.fieldMissing",
  syntax: "alertCalibration.errorClass.syntax",
  resource_timeout: "alertCalibration.errorClass.resourceTimeout",
  resource_memory: "alertCalibration.errorClass.resourceMemory",
  other: "alertCalibration.errorClass.other",
};

export const isErrorClass = (value: unknown): value is ErrorClass =>
  typeof value === "string" && Object.hasOwn(ERROR_CLASS_LABEL, value);

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
/** The recorded-error rows after the counts; each shows only when its column is written (spec §10). */
const ERROR_BLOCK: EvidenceField[] = [
  {
    column: "evidence_notworking_error_class",
    labelKey: "alertCalibration.evidence.errorClass",
    format: "errorClass",
  },
  {
    column: "evidence_notworking_class_errors",
    labelKey: "alertCalibration.evidence.classErrors",
    format: "count",
  },
  {
    column: "evidence_notworking_first_failure_micros",
    labelKey: "alertCalibration.evidence.firstFailure",
    format: "time",
  },
  {
    column: "evidence_notworking_last_failure_micros",
    labelKey: "alertCalibration.evidence.lastFailure",
    format: "time",
  },
  {
    column: "evidence_notworking_last_success_micros",
    labelKey: "alertCalibration.evidence.lastSuccess",
    format: "time",
  },
  {
    column: "evidence_notworking_last_edit_micros",
    labelKey: "alertCalibration.evidence.lastEdit",
    format: "time",
  },
  {
    column: "evidence_notworking_error_sample",
    labelKey: "alertCalibration.evidence.errorSample",
    format: "text",
  },
];
const ERROR_ROWS: EvidenceField[] = [...NOT_WORKING_ERRORS, ...ERROR_BLOCK];
/** A resource card's times against the limit, written only when the times read answered (P7b §7). */
const TIME_ROWS: EvidenceField[] = [
  {
    column: "evidence_notworking_query_limit_secs",
    labelKey: "alertCalibration.evidence.queryTimeLimit",
    format: "seconds",
  },
  {
    column: "evidence_notworking_ok_p50_ms",
    labelKey: "alertCalibration.evidence.successTimes",
    format: "evaluationTimes",
  },
  {
    column: "evidence_notworking_ok_near_limit",
    labelKey: "alertCalibration.evidence.nearLimit",
    format: "nearLimit",
  },
];
const RESOURCE_ROWS: EvidenceField[] = [...ERROR_ROWS, ...TIME_ROWS];

/** The rows each definition-check pattern shows, in the evidence grid the card already has (spec §4). */
export const PATTERN_EVIDENCE: Record<NotWorkingPattern, EvidenceField[]> = {
  stream_missing: [STREAM, ...NOT_WORKING_ERRORS, CHECKED_AT, ...ERROR_BLOCK],
  field_missing: [
    {
      column: "evidence_notworking_field",
      labelKey: "alertCalibration.evidence.field",
      format: "text",
    },
    ...NOT_WORKING_ERRORS,
    CHECKED_AT,
    ...ERROR_BLOCK,
  ],
  syntax: ERROR_ROWS,
  resource_timeout: RESOURCE_ROWS,
  resource_memory: RESOURCE_ROWS,
  other: ERROR_ROWS,
  ignored_matcher: [
    {
      column: "evidence_notworking_field",
      labelKey: "alertCalibration.evidence.label",
      format: "text",
    },
    CHECKED_AT,
  ],
  empty_scope: [
    {
      column: "evidence_notworking_searched_secs",
      labelKey: "alertCalibration.evidence.searchedWindow",
      format: "seconds",
    },
    CHECKED_AT,
  ],
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

/** A short-blips noise finding writes its own columns and none of the noise ones. */
const SHORT_BLIPS_EVIDENCE: EvidenceField[] = [
  {
    column: "evidence_shortblips_complete_episodes",
    labelKey: "alertCalibration.evidence.blipEpisodes",
    format: "count",
  },
  {
    column: "evidence_shortblips_would_not_alert",
    labelKey: "alertCalibration.evidence.blipsWouldNotAlert",
    format: "count",
  },
  {
    column: "evidence_shortblips_interval_secs",
    labelKey: "alertCalibration.evidence.checkInterval",
    format: "seconds",
  },
  {
    column: "evidence_shortblips_current_pending_secs",
    labelKey: "alertCalibration.evidence.holdNow",
    format: "seconds",
  },
  {
    column: "evidence_shortblips_suggested_pending_secs",
    labelKey: "alertCalibration.evidence.holdSuggested",
    format: "seconds",
  },
];

const isNotWorkingPattern = (value: unknown): value is NotWorkingPattern =>
  typeof value === "string" && Object.hasOwn(PATTERN_EVIDENCE, value);

/** A written column shows; an error class this build cannot name shows no row at all. */
const isShown = (record: DigestRecord, field: EvidenceField): boolean =>
  record[field.column] != null &&
  (field.format !== "errorClass" || isErrorClass(record[field.column])) &&
  // "0 of 0 took longer" says nothing, so a read without successes shows no near row.
  (field.format !== "nearLimit" || Number(record.evidence_notworking_ok_evaluations_timed) > 0);

/** A version-2 `failure` record shows its pattern's rows, or the error rows when it has none it knows. */
export const evidenceFor = (record: DigestRecord & { rule_id: RuleId }): EvidenceField[] => {
  if (record.rule_id === "failure" && (record.schema_version ?? 1) >= 2) {
    if (isNotWorkingPattern(record.pattern)) {
      return PATTERN_EVIDENCE[record.pattern].filter((field) => isShown(record, field));
    }
    // Version-2 runs written before error classes (and older backends mid-rollout) carry v1 failure columns.
    if (record.evidence_failure_evaluation_errors == null) {
      return ERROR_ROWS.filter((field) => isShown(record, field));
    }
  }
  if (record.rule_id === "noise" && record.pattern === "short_blips") {
    return SHORT_BLIPS_EVIDENCE.filter((field) => isShown(record, field));
  }
  return RULE_META[record.rule_id].evidence.filter(
    (field) => !field.optional || record[field.column] != null,
  );
};

/** Version 2 reports a broken alert under `failure`; historical runs keep their legacy label (M2). */
export const ruleLabelKey = (rule: RuleId, version: number): I18nKey =>
  rule === "failure" && version >= 2
    ? "alertCalibration.rules.notWorking"
    : RULE_META[rule].labelKey;

/** The advice codes findings carry (ENT not_working.rs `advice`, failure.rs and no_destination.rs `ADVICE_*`). */
export const ADVICE_LABEL: Record<string, I18nKey> = {
  check_stream_not_found: "alertCalibration.advice.checkStreamNotFound",
  check_field_not_found: "alertCalibration.advice.checkFieldNotFound",
  check_query_syntax: "alertCalibration.advice.checkQuerySyntax",
  check_missing_stream: "alertCalibration.advice.checkMissingStream",
  check_missing_field: "alertCalibration.advice.checkMissingField",
  check_ignored_label: "alertCalibration.advice.checkIgnoredLabel",
  check_filter_values: "alertCalibration.advice.checkFilterValues",
  confirm_quiet_source: "alertCalibration.advice.confirmQuietSource",
  attach_folder_destination: "alertCalibration.advice.attachFolderDestination",
  add_destination: "alertCalibration.advice.addDestination",
  reduce_query_time: "alertCalibration.advice.reduceQueryTime",
  reduce_query_memory: "alertCalibration.advice.reduceQueryMemory",
};

export const LIMITATION_LABEL: Record<string, I18nKey> = {
  searched_window: "alertCalibration.limitation.searchedWindow",
  quiet_source: "alertCalibration.limitation.quietSource",
  scan_truncated: "alertCalibration.limitation.scanTruncated",
  no_success_in_window: "alertCalibration.limitation.noSuccessInWindow",
  failure_may_predate_window: "alertCalibration.limitation.failureMayPredateWindow",
  edit_timing_only: "alertCalibration.limitation.editTimingOnly",
  limit_may_differ: "alertCalibration.limitation.limitMayDiffer",
};

/** Quality-reason codes (ENT not_working.rs `QUALITY_*`). */
export const QUALITY_REASON_LABEL: Record<string, I18nKey> = {
  scan_truncated: "alertCalibration.qualityReason.scanTruncated",
  error_classes_capped: "alertCalibration.qualityReason.errorClassesCapped",
  error_classes_timed_out: "alertCalibration.qualityReason.errorClassesTimedOut",
  error_classes_failed: "alertCalibration.qualityReason.errorClassesFailed",
  evaluation_times_unread: "alertCalibration.qualityReason.evaluationTimesUnread",
  schedule_unreadable: "alertCalibration.qualityReason.scheduleUnreadable",
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

/** A v2 action's button label: every focus is one "Review alert" (the note names the focus), from the shared CTA glossary. */
export const INSIGHT_ACTION_LABEL: {
  review_alert: I18nKey;
  review_source: I18nKey;
  review_platform: I18nKey;
} = {
  review_alert: "insight.cta.reviewAlert",
  review_source: "insight.cta.openInLogs",
  review_platform: "alertCalibration.insightActions.inspectPlatform",
};

export function insightActionLabel(action: InsightAction): I18nKey {
  if (action.type === "review_platform") return INSIGHT_ACTION_LABEL.review_platform;
  if (action.type === "review_source") return INSIGHT_ACTION_LABEL.review_source;
  return INSIGHT_ACTION_LABEL.review_alert;
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
