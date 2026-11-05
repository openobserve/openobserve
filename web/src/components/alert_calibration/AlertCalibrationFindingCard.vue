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
          <OBadge :variant="SEVERITY_BADGE[finding.severity]" size="xs" shape="rounded">
            {{ t(SEVERITY_LABEL[finding.severity]) }}
          </OBadge>
          <OBadge variant="default-soft" size="xs" shape="rounded">
            {{ t(CONFIDENCE_LABEL[finding.confidence]) }}
          </OBadge>
          <OBadge
            v-if="tier"
            variant="primary-soft"
            size="xs"
            shape="rounded"
            data-test="alert-calibration-finding-tier"
          >
            {{ t(TIER_LABEL[tier]) }}
          </OBadge>
          <OBadge
            v-if="quality"
            variant="warning-soft"
            size="xs"
            shape="rounded"
            data-test="alert-calibration-finding-quality"
          >
            {{ t(QUALITY_LABEL[quality]) }}
          </OBadge>
          <OBadge
            variant="default-outline"
            size="xs"
            shape="rounded"
            data-test="alert-calibration-finding-rule"
            >{{ t(ruleLabelKey(finding.rule_id, schemaVersion(finding))) }}</OBadge
          >
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
        variant="ghost-muted"
        size="xs"
        icon-left="open-in-new"
        class="shrink-0"
        data-test="alert-calibration-finding-open-alert"
        @click="openAlert"
      >
        {{ t("alertCalibration.detail.openAlert") }}
      </OButton>
    </OCardSection>

    <OSeparator />

    <OCardSection role="body" class="flex flex-col gap-3 pt-3">
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
        v-if="actions.length"
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
      </div>
    </OCardSection>

    <AlertCalibrationApplyDialog
      v-if="applyAction"
      v-model:open="applyOpen"
      :action="applyAction"
      :finding="finding"
    />
  </OCard>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
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
import { useOrgId } from "@/composables/query";
import { writeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
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
  TIER_LABEL,
  resourceOptions,
} from "./format";
import AlertCalibrationApplyDialog from "./AlertCalibrationApplyDialog.vue";
import { alertFolderOf, editAlertRoute } from "./alertEditorLink";
import {
  applyCopy,
  applySuggestionsOf,
  toEditHandoff,
  type ApplySuggestion,
  type ReviewAlertAction,
} from "./applySuggestion";

const props = defineProps<{ finding: FindingRecord }>();

const LAG_COLUMNS: { field: keyof LagRow; labelKey: I18nKey }[] = [
  { field: "skipped_windows", labelKey: "alertCalibration.evidence.skippedWindows" },
  { field: "late_evaluations", labelKey: "alertCalibration.evidence.lateEvaluations" },
  { field: "evaluations", labelKey: "alertCalibration.evidence.evaluations" },
];

const { t, locale } = useI18nTyped();
const router = useRouter();
const orgId = useOrgId();

const meta = computed(() => RULE_META[props.finding.rule_id]);

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

const openApply = (action: ApplySuggestion) => {
  applyAction.value = action;
  applyOpen.value = true;
};

const reviewPending = ref<string | null>(null);
let unmounted = false;
onBeforeUnmount(() => {
  unmounted = true;
});

/** The same tab, so the editor's Cancel comes back to this finding (P6-D10). */
const openReview = async (key: string, action: ReviewAlertAction) => {
  if (reviewPending.value) return;
  reviewPending.value = key;
  // Looked up on click, not per card: a digest page can hold many cards.
  const folder = await alertFolderOf(orgId.value, action.alert_id, props.finding.alert_name);
  reviewPending.value = null;
  if (unmounted) return;
  writeAlertEditHandoff(toEditHandoff(action, props.finding));
  void router.push(editAlertRoute(orgId.value, action.alert_id, folder));
};

/** A v2 record carries typed actions only; its `actions` column is never read. Apply comes first. */
const insightActions = (): ActionRow[] => [
  ...applySuggestionsOf(props.finding).map((action, index) => ({
    key: `apply-${index}`,
    type: action.type,
    label: applyCopy(t, locale.value).button(),
    run: () => openApply(action),
  })),
  ...insightActionsOf(props.finding).map((action, index) => ({
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
