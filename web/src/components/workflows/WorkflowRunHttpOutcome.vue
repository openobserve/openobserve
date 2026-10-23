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
  <div v-if="neverRan" data-test="workflow-run-never-ran" class="flex shrink-0 flex-col gap-2">
    <div class="flex items-center gap-2">
      <OTag type="hookRunStatus" :value="status" size="sm" />
      <span class="text-text-secondary inline-flex items-center gap-1 text-xs">
        {{ t("workflow.http.requestReceived") }}
        <OTimeCell
          :value="receivedAt"
          unit="us"
          mode="absolute"
          :format="RUN_TIME_LONG"
          :timezone="store.state.timezone"
          :empty-label="dash"
        />
      </span>
    </div>
    <OBanner
      v-if="reason === 'expired'"
      variant="info"
      dense
      data-test="workflow-run-expired-banner"
      :content="t('workflow.http.runExpiredBanner')"
    />
    <OBanner
      v-else-if="reason === 'worker_lost'"
      variant="error-soft"
      dense
      data-test="workflow-run-worker-lost-banner"
      :content="t('workflow.http.runWorkerLostBanner')"
    />
    <span v-else-if="reason" class="text-text-secondary text-xs">
      {{ t(RUN_REASON_KEYS[reason]) }}
    </span>
  </div>
  <div v-else-if="failedStep" class="flex shrink-0 flex-col gap-1">
    <OBanner
      variant="error-soft"
      dense
      inline-actions
      data-test="workflow-run-error"
      :content="t('workflow.http.runFailedAt', { step: failedStep.label, error: error ?? '' })"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          data-test="workflow-run-error-open-step"
          @click="emit('open-step', failedStep.id)"
        >
          {{ t("workflow.http.openStep") }}
        </OButton>
      </template>
    </OBanner>
    <!-- JS errors rarely name the missing path, so the hint keys off the failing step's type. -->
    <div
      v-if="failedStep.isFunction"
      data-test="workflow-run-http-guard-hint"
      class="text-text-secondary text-xs"
    >
      {{ t("workflow.http.runGuardHint", { fields: guardFields, guard: guardCondition }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { HookRunStatus } from "@/services/workflows";
import {
  RUN_REASON_KEYS,
  RUN_TIME_LONG,
  hasStoredRunData,
  type RunReason,
} from "@/plugins/workflows/runStatus";

const props = defineProps<{
  status: HookRunStatus;
  reason: RunReason | null;
  receivedAt: number | null;
  failedStep: { id: string; label: string; isFunction: boolean } | null;
  error: string | null;
}>();
const emit = defineEmits<{ (e: "open-step", nodeId: string): void }>();

const { t } = useI18nTyped();
const store = useStore();
const dash = raw("—");
const guardFields = raw("meta.alert_*");
const guardCondition = raw("meta.trigger_source is empty");

// A reason code doubles as the ledger error, so the shared "nothing stored" rule applies as is.
const neverRan = computed(() => !hasStoredRunData({ status: props.status, error: props.reason }));
</script>
