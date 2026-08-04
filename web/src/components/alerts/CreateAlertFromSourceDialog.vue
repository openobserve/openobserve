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

<!--
  The confirmation step shared by EVERY "create an alert from here" entry point.

  It exists because two of the conversions are lossy in ways the user must see
  before landing in the form: a surface with several streams has to pick one
  (alerts are single-stream), and an absolute time range becomes a rolling
  window. Showing the resolved query alongside them also settles the "why does
  my alert query differ from my search?" question at the point it arises.

  Every section renders off the prefill, so a single-stream source with no
  warnings sees a minimal dialog rather than ceremony.
-->

<template>
  <ODialog
    v-model:open="isOpen"
    size="md"
    :title="t('alerts.prefill.dialog.title')"
    :sub-title="prefill?.sourceLabel"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('alerts.prefill.dialog.continue')"
    :primary-button-disabled="isBlocked"
    data-test="create-alert-from-source-dialog"
    @click:secondary="onCancel"
    @click:primary="onConfirm"
  >
    <div v-if="prefill" class="flex flex-col gap-5">
      <!-- Stream picker — only when the surface offered a choice. Alerts are
           single-stream; silently taking the first one is a trap. -->
      <div v-if="hasStreamChoice" class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs font-medium">
          {{ t("alerts.prefill.dialog.streamLabel") }}
        </span>
        <ORadioGroup
          v-model="selectedStream"
          orientation="horizontal"
          :label="t('alerts.prefill.dialog.streamLabel')"
          data-test="create-alert-stream-picker"
        >
          <ORadio
            v-for="candidate in prefill.streamCandidates"
            :key="candidate.name"
            :value="candidate.name"
            :label="candidate.name"
            :data-test="`create-alert-stream-option-${candidate.name}`"
          />
        </ORadioGroup>
      </div>

      <!-- How the alert counts what the query returns. -->
      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs font-medium">
          {{ t("alerts.prefill.dialog.thresholdLabel") }}
        </span>
        <OToggleGroup
          v-model="thresholdShape"
          type="single"
          data-test="create-alert-threshold-shape"
        >
          <OToggleGroupItem value="matching-rows" size="xs" data-test="create-alert-threshold-rows">
            {{ t("alerts.prefill.dialog.thresholdMatchingRows") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="count" size="xs" data-test="create-alert-threshold-count">
            {{ t("alerts.prefill.dialog.thresholdCount") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <!-- The rolling window the alert will evaluate. -->
      <div v-if="prefill.periodMinutes" class="flex flex-col gap-1">
        <span class="text-text-secondary text-xs font-medium">
          {{ t("alerts.prefill.dialog.windowLabel") }}
        </span>
        <span class="text-text-body text-sm" data-test="create-alert-window">
          {{ t("alerts.prefill.dialog.windowValue", { minutes: prefill.periodMinutes }) }}
        </span>
      </div>

      <!-- The resolved query, so nothing about the alert is a surprise. -->
      <div v-if="showQuery" class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs font-medium">
          {{ t("alerts.prefill.dialog.queryLabel") }}
        </span>
        <OCodeBlock
          :code="previewQuery"
          :lang="prefill.queryType === 'promql' ? 'promql' : 'sql'"
          :copy-message="t('alerts.prefill.dialog.queryCopied')"
          data-test="create-alert-query-preview"
        />
      </div>

      <!-- Every lossy transform the adapters performed, stated plainly. -->
      <div v-if="prefill.warnings.length" class="flex flex-col gap-2">
        <OBanner
          v-for="(warning, index) in prefill.warnings"
          :key="`${warning.key}-${index}`"
          dense
          :variant="bannerVariant(warning.level)"
          :content="warningText(warning)"
          :data-test="`create-alert-warning-${warning.key}`"
        />
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import type {
  AlertPrefill,
  AlertPrefillThresholdShape,
  AlertPrefillWarning,
  AlertPrefillWarningLevel,
} from "@/ts/interfaces/alertPrefill";
import { isPrefillBlocked } from "@/utils/alerts/alertPrefill";
import { getAlertSource } from "@/utils/alerts/alertSourceRegistry";

const props = defineProps<{
  open: boolean;
  prefill: AlertPrefill | null;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /** The prefill with the user's dialog choices folded in. */
  (e: "confirm", prefill: AlertPrefill): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();

const selectedStream = ref("");
const thresholdShape = ref<AlertPrefillThresholdShape>("matching-rows");

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isBlocked = computed(() => (props.prefill ? isPrefillBlocked(props.prefill) : true));

const hasStreamChoice = computed(() => (props.prefill?.streamCandidates?.length ?? 0) > 1);

const showQuery = computed(() => {
  if (!props.prefill) return false;
  return getAlertSource(props.prefill.source).showQueryPreview && !!previewQuery.value;
});

const previewQuery = computed(
  () => (props.prefill?.queryType === "promql" ? props.prefill?.promql : props.prefill?.sql) ?? "",
);

// Seed the controls from the incoming prefill each time the dialog opens, so a
// second run never inherits the previous run's answers.
watch(
  () => [props.open, props.prefill] as const,
  ([open, prefill]) => {
    if (!open || !prefill) return;
    selectedStream.value = prefill.streamName;
    thresholdShape.value = prefill.thresholdShape ?? getAlertSource(prefill.source).defaultThreshold;
  },
  { immediate: true },
);

const bannerVariant = (level: AlertPrefillWarningLevel) =>
  level === "blocking" ? "error" : level === "info" ? "info" : "warning";

const warningText = (warning: AlertPrefillWarning) =>
  t(`alerts.prefill.warnings.${warning.key}`, warning.params ?? {});

const onCancel = () => {
  emit("cancel");
  emit("update:open", false);
};

const onConfirm = () => {
  if (!props.prefill || isBlocked.value) return;

  emit("confirm", {
    ...props.prefill,
    streamName: selectedStream.value || props.prefill.streamName,
    thresholdShape: thresholdShape.value,
  });
  emit("update:open", false);
};
</script>
