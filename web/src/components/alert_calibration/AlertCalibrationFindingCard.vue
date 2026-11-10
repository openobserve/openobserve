<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <OCard variant="glass" :data-test="`alert-calibration-finding-${finding.rule_id}`">
    <OCardSection role="header" class="items-start gap-3 py-3">
      <span
        class="rounded-default inline-flex size-7 shrink-0 items-center justify-center"
        :class="SEVERITY_TILE[finding.severity]"
        data-test="alert-calibration-finding-tile"
      >
        <OIcon :name="meta.icon" size="sm" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <OText variant="body-strong" as="div">{{ finding.title }}</OText>
        <div class="flex flex-wrap items-center gap-1.5">
          <OBadge :variant="SEVERITY_BADGE[finding.severity]" size="sm" shape="rounded">
            {{ t(SEVERITY_LABEL[finding.severity]) }}
          </OBadge>
          <OBadge variant="default-soft" size="sm" shape="rounded">
            {{ t(CONFIDENCE_LABEL[finding.confidence]) }}
          </OBadge>
          <OBadge
            v-if="tier"
            variant="primary-soft"
            size="sm"
            shape="rounded"
            data-test="alert-calibration-finding-tier"
          >
            {{ t(TIER_LABEL[tier]) }}
            <OTooltip :content="t(TIER_HINT[tier])" />
          </OBadge>
          <OBadge
            v-if="quality"
            variant="warning-soft"
            size="sm"
            shape="rounded"
            data-test="alert-calibration-finding-quality"
          >
            {{ t(QUALITY_LABEL[quality]) }}
          </OBadge>
          <OBadge
            variant="default-outline"
            size="sm"
            shape="rounded"
            data-test="alert-calibration-finding-rule"
            >{{ t(ruleLabelKey(finding.rule_id, schemaVersion(finding))) }}</OBadge
          >
          <OBadge
            v-if="folded"
            variant="default-soft"
            size="sm"
            shape="rounded"
            data-test="alert-calibration-finding-dismissed"
          >
            {{ dismissal ? dismissCopy.badge(dismissal) : t("alertCalibration.dismiss.badge") }}
          </OBadge>
        </div>
        <OText
          v-if="qualityReasons"
          variant="meta"
          as="div"
          data-test="alert-calibration-finding-quality-reasons"
        >
          {{ qualityReasons }}
        </OText>
      </div>
      <OButton
        v-if="finding.alert_id"
        variant="ghost-primary"
        size="xs"
        class="shrink-0"
        data-test="alert-calibration-finding-open-alert"
        @click="openAlert"
      >
        {{ t("alertCalibration.detail.openAlert") }}
      </OButton>
    </OCardSection>

    <OSeparator />

    <OCardSection
      v-if="folded && dismissal"
      role="body"
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3"
      data-test="alert-calibration-finding-fold"
    >
      <OText variant="meta" as="p" class="flex min-w-0 flex-wrap gap-x-1.5">
        <template v-for="(part, index) in dismissCopy.foldParts(dismissal)" :key="index">
          <span v-if="index > 0" aria-hidden="true">·</span>
          <span>{{ part }}</span>
        </template>
      </OText>
      <OButton
        variant="outline"
        size="xs"
        class="shrink-0"
        :loading="isPending(dismissal.id)"
        data-test="alert-calibration-finding-reopen"
        @click="reopen(dismissal)"
      >
        {{ t("alertCalibration.dismiss.reopen") }}
      </OButton>
    </OCardSection>

    <OCardSection v-else role="body" class="flex flex-col gap-3 pt-3">
      <dl class="flex flex-wrap gap-x-8 gap-y-2">
        <div
          v-for="row in evidence"
          :key="row.column"
          class="flex min-w-0 flex-col"
          :class="row.wide ? 'basis-full' : ''"
        >
          <dt class="text-text-secondary text-xs">{{ row.label }}</dt>
          <OTruncatedText as="dd" class="text-text-body min-w-0 text-sm font-medium tabular-nums">
            {{ row.value }}
          </OTruncatedText>
        </div>
      </dl>

      <div
        v-if="limitations.length"
        class="flex flex-col gap-0.5"
        data-test="alert-calibration-finding-limitations"
      >
        <OText variant="label" as="div">{{ t("alertCalibration.detail.limitations") }}</OText>
        <OText v-for="(line, index) in limitations" :key="index" variant="meta" as="div">{{
          line
        }}</OText>
      </div>

      <div v-if="advice" class="flex flex-col gap-0.5" data-test="alert-calibration-finding-advice">
        <OText variant="label" as="div">{{ t("alertCalibration.detail.advice") }}</OText>
        <OText variant="meta" as="div">{{ advice }}</OText>
        <ul
          v-if="options.length"
          class="text-text-secondary flex list-disc flex-col gap-0.5 ps-4 text-xs"
          data-test="alert-calibration-finding-options"
        >
          <li
            v-for="option in options"
            :key="option.key"
            :data-test="`alert-calibration-finding-option-${option.key}`"
          >
            <i18n-t keypath="alertCalibration.resourceOption.line" tag="span">
              <template #option>
                <span class="text-text-body font-medium">{{ option.label }}</span>
              </template>
              <template #cost>{{ option.cost }}</template>
            </i18n-t>
          </li>
        </ul>
      </div>

      <div v-if="lagLists.length" class="grid gap-3 lg:grid-cols-2">
        <div
          v-for="list in lagLists"
          :key="list.column"
          class="border-border-default rounded-default grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1.5 border px-3 py-2"
          :data-test="`alert-calibration-finding-${list.key}-list`"
        >
          <OText variant="label" as="div" class="min-w-0">{{ list.label }}</OText>
          <OText
            v-for="column in LAG_COLUMNS"
            :key="column.field"
            variant="label"
            as="div"
            class="text-end"
          >
            {{ t(column.labelKey) }}
          </OText>
          <div
            v-for="row in list.rows"
            :key="row.key"
            class="contents"
            data-test="alert-calibration-finding-lag-row"
          >
            <OTruncatedText
              class="text-text-body min-w-0 text-xs font-medium"
              data-test="alert-calibration-finding-lag-cell"
            >
              {{ row.label }}
            </OTruncatedText>
            <span
              v-for="column in LAG_COLUMNS"
              :key="column.field"
              class="text-text-body text-end text-xs tabular-nums"
              data-test="alert-calibration-finding-lag-cell"
            >
              {{ formatEvidence(t, row[column.field], "count") }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="actions.length || dismissable"
        class="rounded-default bg-surface-subtle border-s-border-strong flex flex-col gap-1 border-s-4 px-3 py-2"
        data-test="alert-calibration-finding-actions"
      >
        <OText variant="label" as="div">{{ t("alertCalibration.detail.proposedActions") }}</OText>
        <div
          v-for="action in actions"
          :key="action.key"
          class="flex min-w-0 flex-wrap items-baseline gap-x-2"
          :data-test="`alert-calibration-finding-action-${action.type}`"
        >
          <OButton
            v-if="action.run"
            :variant="action.type === 'apply_suggestion' ? 'primary' : 'outline'"
            size="xs"
            :loading="action.pending"
            :data-test="`alert-calibration-finding-action-${action.type}-button`"
            @click="action.run"
          >
            {{ action.label }}
          </OButton>
          <span v-else class="text-text-body text-xs font-medium">{{ action.label }}</span>
          <OText v-if="action.description" variant="meta" as="span">{{ action.description }}</OText>
        </div>
        <div v-if="dismissable" class="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <OButton
            variant="outline"
            size="xs"
            data-test="alert-calibration-finding-dismiss"
            @click="openDismiss"
          >
            {{ dismissCopy.button() }}
          </OButton>
          <OButton
            v-if="markable"
            variant="outline"
            size="xs"
            data-test="alert-calibration-finding-mark-report"
            @click="openMark"
          >
            {{ t("insight.decisions.mark.action") }}
          </OButton>
        </div>
      </div>
    </OCardSection>

    <ReviewChangeDialog v-if="changeTarget" v-model:open="changeOpen" :target="changeTarget" />
    <AlertCalibrationApplyDialog
      v-if="applyAction"
      v-model:open="applyOpen"
      :action="applyAction"
      :finding="finding"
    />
    <AlertCalibrationDismissDialog
      v-if="dismissTarget && dismissRequested"
      :key="dismissTarget.finding_id"
      v-model:open="dismissOpen"
      :finding="dismissTarget"
      :refresh="refresh"
    />
    <MarkIntendedReportsDialog
      v-if="markable && markRequested"
      v-model:open="markOpen"
      :alerts="[{ finding_id: markable.finding_id, alert_name: markable.alert_name ?? null }]"
    />
  </OCard>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { format } from "date-fns";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOrgId } from "@/composables/query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import {
  adviceOf,
  insightActionsOf,
  limitationsOf,
  parseLagRows,
  qualityReasonsOf,
  schemaVersion,
  type FindingRecord,
  type LagRow,
} from "./digests";
import {
  ACTION_META,
  evidenceFor,
  insightActionLabel,
  isProposedAction,
  RULE_META,
  ruleLabelKey,
} from "./rules";
import {
  CONFIDENCE_LABEL,
  formatEvidence,
  formatEvidenceField,
  isDegradedQuality,
  QUALITY_LABEL,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  SEVERITY_TILE,
  TIER_HINT,
  TIER_LABEL,
  resourceOptions,
} from "./format";
import AlertCalibrationApplyDialog from "./AlertCalibrationApplyDialog.vue";
import ReviewChangeDialog from "@/components/autoobserve/decisions/ReviewChangeDialog.vue";
import type { ReviewChangeTarget } from "@/components/autoobserve/decisions/appliedChanges";
import AlertCalibrationDismissDialog from "./AlertCalibrationDismissDialog.vue";
import { useReopenDismissal } from "@/composables/alertCalibration/useDismissals";
import { useDecisionRoute } from "@/composables/autoobserve/useDecisionRoute";
import MarkIntendedReportsDialog from "@/components/autoobserve/decisions/MarkIntendedReportsDialog.vue";
import { dismissalCopy, isDismissable, type DismissalView } from "./dismissals";
import { openAlertReview } from "./reviewAlert";
import {
  applyCopy,
  applySuggestionsOf,
  type ApplySuggestion,
  type ReviewAlertAction,
} from "./applySuggestion";

const props = defineProps<{
  finding: FindingRecord;
  /** This finding's active dismissal, which folds the card. */
  dismissal?: DismissalView | null;
  /** Re-reads the records behind the dismiss dialog after a 404 or 409. */
  refresh?: () => void;
}>();

const LAG_COLUMNS: { field: keyof LagRow; labelKey: I18nKey }[] = [
  { field: "skipped_windows", labelKey: "alertCalibration.evidence.skippedWindows" },
  { field: "late_evaluations", labelKey: "alertCalibration.evidence.lateEvaluations" },
  { field: "evaluations", labelKey: "alertCalibration.evidence.evaluations" },
];

const { t, locale } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const meta = computed(() => RULE_META[props.finding.rule_id]);

const dismissCopy = computed(() => dismissalCopy(t, locale.value));
const folded = computed(() => props.dismissal?.state === "active");
const dismissTarget = computed(() => (isDismissable(props.finding) ? props.finding : null));
// The fold must not unmount an open dialog, or its close is lost and Reopen would show it again.
const dismissable = computed(() => (folded.value ? null : dismissTarget.value));
const { reopen, isPending } = useReopenDismissal();
// The dialog mounts on first use, so a page of many cards holds no idle forms.
const dismissRequested = ref(false);
const dismissOpen = ref(false);
const openDismiss = () => {
  dismissRequested.value = true;
  dismissOpen.value = true;
};
const decisionRoute = useDecisionRoute();
/** m11: an always-firing alert may be a report someone wants; the route records that, the alert keeps sending. */
const markable = computed(() =>
  decisionRoute.enabled.value && props.finding.rule_id === "noise" ? dismissable.value : null,
);
const markRequested = ref(false);
const markOpen = ref(false);
const openMark = () => {
  markRequested.value = true;
  markOpen.value = true;
};

/** Version-2 fields, shown only when the record carries a value this build knows. */
const tier = computed(() => {
  const value = props.finding.tier;
  return value && value in TIER_LABEL ? value : null;
});
const quality = computed(() => {
  const value = props.finding.quality;
  return isDegradedQuality(value) ? value : null;
});
const limitations = computed(() => limitationsOf(t, props.finding));
const advice = computed(() => adviceOf(t, props.finding));
const options = computed(() => resourceOptions(t, props.finding));
/** Usable evidence has no badge, so its reasons would explain nothing on screen. */
const qualityReasons = computed(() => {
  const reasons = quality.value ? qualityReasonsOf(t, props.finding) : [];
  if (reasons.length === 0) return null;
  const list = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(reasons);
  return t("alertCalibration.detail.qualityReasons", { reasons: raw(list) }, reasons.length);
});

/** A new tab, so the digest stays where it was while the alert is fixed. */
const openAlert = () => {
  analytics.track("alert_calibration_finding_alert_opened", {
    rule: props.finding.rule_id,
    source: "digest",
  });
  const { href } = router.resolve({
    name: "alertDetail",
    params: { alert_id: props.finding.alert_id },
    query: { org_identifier: orgId.value },
  });
  window.open(href, "_blank", "noopener,noreferrer");
};

const evidence = computed(() =>
  evidenceFor(props.finding).map((field) => ({
    column: field.column,
    label: t(field.labelKey),
    value: formatEvidenceField(t, props.finding, field),
    // Free text and the time sentences run long, so each takes its own line.
    wide:
      field.format === "text" || field.format === "evaluationTimes" || field.format === "nearLimit",
  })),
);

/** Only lists that name something show, each row labelled by its org or its hour. */
const lagLists = computed(() =>
  (meta.value.lagLists ?? [])
    .map((list) => ({
      column: list.column,
      key: list.key,
      label: t(list.labelKey),
      rows: parseLagRows(props.finding[list.column], list.key).map((row) => ({
        ...row,
        label:
          list.key === "org_id"
            ? raw(String(row.key))
            : raw(format(Number(row.key) / 1000, "MMM d, HH:mm")),
      })),
    }))
    .filter((list) => list.rows.length > 0),
);

interface ActionRow {
  key: string;
  type: string;
  label: I18nText;
  description?: I18nText;
  /** Set for an action that opens the editor; the rest stay labels until their target page exists. */
  run?: () => void;
  /** The editor link is waiting for the alert's folder. */
  pending?: boolean;
}

const applyAction = ref<ApplySuggestion | null>(null);
const applyOpen = ref(false);

const changeTarget = shallowRef<ReviewChangeTarget | null>(null);
const changeOpen = ref(false);

/** With the decision route on, Review change is the dialog every surface opens; the editor handoff is for today's routes. */
const openApply = (action: ApplySuggestion) => {
  const { finding_id: findingId, alert_id: alertId } = props.finding;
  if (decisionRoute.transport.value === "decision" && findingId && alertId) {
    changeTarget.value = {
      findingId,
      alertId,
      alertName: props.finding.alert_name ?? alertId,
      action,
    };
    changeOpen.value = true;
    return;
  }
  applyAction.value = action;
  applyOpen.value = true;
};

const reviewPending = ref<string | null>(null);
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
});

const openReview = async (key: string, action: ReviewAlertAction) => {
  if (reviewPending.value) return;
  reviewPending.value = key;
  await openAlertReview(router, orgId.value, action, props.finding, () => !unmounted);
  reviewPending.value = null;
};

/** A v2 record carries typed actions only; its `actions` column is never read. Apply comes first. */
const insightActions = (): ActionRow[] => [
  ...applySuggestionsOf(props.finding).map((action, index) => ({
    key: `apply-${index}`,
    type: action.type,
    label: applyCopy(t, locale.value).button(),
    run: () => openApply(action),
  })),
  // Every focus reads "Review alert", so one button per card; the editor shows the focus.
  ...insightActionsOf(props.finding)
    .flatMap((action, index, all) =>
      action.type === "review_alert" && all.findIndex((a) => a.type === "review_alert") !== index
        ? []
        : [action],
    )
    .map((action, index) => ({
      key: `${index}`,
      type: action.type,
      label: t(insightActionLabel(action)),
      run: action.type === "review_alert" ? () => void openReview(`${index}`, action) : undefined,
      pending: reviewPending.value === `${index}`,
    })),
];

/** `actions` is comma-joined; an action this build does not know still shows, by its raw name. */
const v1Actions = (): ActionRow[] =>
  (props.finding.actions ?? "")
    .split(",")
    .filter(Boolean)
    .map((name) =>
      isProposedAction(name)
        ? {
            key: name,
            type: name,
            label: t(ACTION_META[name].labelKey),
            description: t(
              ACTION_META[name].descriptionKey,
              ACTION_META[name].descriptionParams ?? {},
            ),
          }
        : { key: name, type: name, label: raw(name) },
    );

const actions = computed<ActionRow[]>(() =>
  schemaVersion(props.finding) >= 2 ? insightActions() : v1Actions(),
);
</script>
