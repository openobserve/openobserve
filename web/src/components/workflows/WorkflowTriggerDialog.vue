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
  Trigger-type picker shown when creating a workflow — the same card-grid idea
  as onlineEvals' ScorerTypeDialog, but built on the ODialog primitive (overlay,
  header/close, animations) instead of hand-rolled chrome. Cards are driven by
  WORKFLOW_TRIGGER_TYPES; disabled kinds show a "Coming Soon" badge.
-->
<template>
  <ODialog
    :open="true"
    size="lg"
    :title="t('workflow.triggerType.dialogTitle')"
    data-test="workflow-trigger-dialog"
    @update:open="(v) => !v && $emit('close')"
  >
    <p class="tw:m-0 tw:mb-4 tw:text-text-secondary tw:text-[13px] tw:leading-normal">
      {{ t("workflow.triggerType.dialogIntro") }}
    </p>

    <div class="tw:grid tw:grid-cols-3 tw:max-[720px]:grid-cols-1 tw:gap-3">
      <button
        v-for="tt in triggerTypes"
        :key="tt.key"
        type="button"
        class="wf-trigger-card tw:relative tw:flex tw:flex-col tw:items-start tw:gap-[10px] tw:min-h-[180px] tw:py-4 tw:px-4 tw:pb-[14px] tw:border tw:border-border-default tw:rounded-lg tw:bg-card-bg tw:text-text-primary tw:text-left tw:transition-[border-color,background,box-shadow] tw:duration-[120ms]"
        :class="
          tt.enabled
            ? 'tw:cursor-pointer'
            : 'wf-trigger-card--disabled tw:cursor-not-allowed tw:opacity-60'
        "
        :disabled="!tt.enabled"
        :data-test="`workflow-trigger-card-${tt.key}`"
        @click="tt.enabled && $emit('select', tt.key)"
      >
        <span
          v-if="!tt.enabled"
          class="tw:absolute tw:top-3 tw:right-3 tw:py-[2px] tw:px-2 tw:rounded tw:text-[11px] tw:font-semibold tw:leading-normal tw:bg-[color-mix(in_srgb,var(--o2-status-warning-text)_14%,transparent)] tw:text-(--o2-status-warning-text)"
        >
          {{ t("workflow.triggerType.comingSoon") }}
        </span>

        <div
          class="tw:inline-flex tw:items-center tw:justify-center tw:w-9 tw:h-9 tw:rounded-lg tw:bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] tw:text-(--color-primary-600,#3F7994)"
        >
          <OIcon :name="tt.icon" size="md" />
        </div>
        <div class="tw:text-sm tw:font-semibold tw:text-text-primary">
          {{ t(tt.labelKey) }}
        </div>
        <div class="tw:flex-1 tw:text-xs tw:leading-normal tw:text-text-secondary">
          {{ t(tt.descKey) }}
        </div>
        <div
          class="tw:inline-flex tw:items-center tw:gap-1 tw:mt-auto tw:text-xs tw:font-semibold"
          :class="tt.enabled ? 'tw:text-(--color-primary-600,#3F7994)' : 'tw:text-text-secondary'"
        >
          {{ tt.enabled ? t("workflow.triggerType.cta") : t("workflow.triggerType.soonCta") }}
          <OIcon v-if="tt.enabled" name="chevron-right" size="xs" />
        </div>
      </button>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { WORKFLOW_TRIGGER_TYPES } from "@/plugins/workflows/useWorkflowCanvas";

defineEmits<{
  (e: "close"): void;
  (e: "select", triggerKind: string): void;
}>();

const { t } = useI18n();
const triggerTypes = WORKFLOW_TRIGGER_TYPES;
</script>

<style scoped>
.wf-trigger-card:hover:not(.wf-trigger-card--disabled) {
  border-color: var(--color-primary-600, #3f7994);
  background: color-mix(in srgb, var(--color-primary-600) 4%, var(--color-card-bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-600) 12%, transparent);
}
</style>
