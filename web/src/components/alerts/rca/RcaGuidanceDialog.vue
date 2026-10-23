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
  <ODialog
    v-model:open="isOpen"
    size="md"
    data-test="rca-guidance-dialog"
    :title="t('alerts.incidents.rcaReanalyze')"
    :secondary-button-label="t('confirmDialog.cancel')"
    :primary-button-label="t('alerts.incidents.rcaSteer.guidanceDialog.start')"
    :primary-button-disabled="!canStart"
    :primary-button-loading="triggering"
    @click:secondary="isOpen = false"
    @click:primary="start"
  >
    <div class="flex flex-col gap-4">
      <ORadioGroup
        v-model="mode"
        orientation="horizontal"
        :label="t('alerts.incidents.rcaSteer.guidanceDialog.mode')"
        data-test="rca-guidance-mode"
      >
        <ORadio value="fresh" variant="card" data-test="rca-guidance-mode-fresh">
          <template #label>
            <span class="flex flex-col gap-0.5">
              <span class="text-text-heading text-sm font-semibold">
                {{ t("alerts.incidents.rcaSteer.guidanceDialog.freshTitle") }}
              </span>
              <span class="text-text-secondary text-xs">
                {{ t("alerts.incidents.rcaSteer.guidanceDialog.freshHint") }}
              </span>
            </span>
          </template>
        </ORadio>
        <ORadio
          value="build"
          variant="card"
          :disabled="!canBuildOnPrevious"
          data-test="rca-guidance-mode-build"
        >
          <template #label>
            <span class="flex flex-col gap-0.5">
              <span class="text-text-heading text-sm font-semibold">
                {{ t("alerts.incidents.rcaSteer.guidanceDialog.buildTitle") }}
              </span>
              <span class="text-text-secondary text-xs">
                {{ t("alerts.incidents.rcaSteer.guidanceDialog.buildHint") }}
              </span>
            </span>
          </template>
        </ORadio>
      </ORadioGroup>

      <OTextarea
        v-model="guidance"
        data-test="rca-guidance-input"
        :label="t('alerts.incidents.rcaSteer.guidanceDialog.guidanceLabel')"
        :placeholder="t('alerts.incidents.rcaSteer.guidanceDialog.guidancePlaceholder')"
        :rows="5"
        :maxlength="MAX_GUIDANCE_CHARS"
      />

      <p
        data-test="rca-guidance-note"
        class="text-text-secondary m-0 flex items-start gap-1.5 text-xs"
      >
        <OIcon name="history" size="sm" class="shrink-0" />
        {{ t("alerts.incidents.rcaSteer.guidanceDialog.note") }}
        <span v-if="costLabel" data-test="rca-guidance-cost">· {{ costLabel }}</span>
      </p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

/** 1 to 2,000 characters. */
const MAX_GUIDANCE_CHARS = 2_000;

const props = withDefaults(
  defineProps<{
    /** The text the dialog opens with (the message the run did not take). */
    initialGuidance?: string;
    /** A completed run exists to build on. */
    canBuildOnPrevious: boolean;
    triggering?: boolean;
    /** The incident's latest run; a new id after Start means the run started. */
    latestRunId?: string | null;
    /** AI credits a re-analysis uses; unset outside cloud, where no cost shows. */
    creditCost?: number | null;
  }>(),
  { initialGuidance: "", triggering: false, latestRunId: null, creditCost: null },
);

const isOpen = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
  /** `guidance` only when the box has text. */
  start: [options: { buildOnPrevious: boolean; guidance?: string }];
}>();

const { t } = useI18nTyped();

// ORadioGroup's v-model carries a RadioValue: "fresh" or "build".
const mode = ref<string | number | boolean>("fresh");
const guidance = ref("");

// Each opening starts from the given text; Build on previous when there is a report.
watch(
  isOpen,
  (open) => {
    if (!open) return;
    guidance.value = props.initialGuidance;
    mode.value = props.canBuildOnPrevious ? "build" : "fresh";
  },
  { immediate: true },
);

// Guidance is optional in both modes.
const canStart = computed(
  () => guidance.value.trim().length <= MAX_GUIDANCE_CHARS && !props.triggering,
);

const costLabel = computed<I18nText | null>(() => {
  const cost = props.creditCost;
  return cost ? t("alerts.incidents.rcaCreditCost", { cost }, cost) : null;
});

// The run before Start; null while no start is pending.
const pendingFrom = ref<{ runId: string | null } | null>(null);

const start = () => {
  if (!canStart.value) return;
  pendingFrom.value = { runId: props.latestRunId };
  const buildOnPrevious = mode.value === "build";
  const text = guidance.value.trim();
  emit("start", text ? { buildOnPrevious, guidance: text } : { buildOnPrevious });
};

// Close once a new run exists (it can land after the request settles); a failed start keeps the guidance.
watch(
  () => props.latestRunId,
  (runId) => {
    if (pendingFrom.value && runId !== pendingFrom.value.runId) isOpen.value = false;
  },
);

watch(isOpen, (open) => {
  if (!open) pendingFrom.value = null;
});
</script>
