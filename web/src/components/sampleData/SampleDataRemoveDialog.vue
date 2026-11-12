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
    :open="session.removeDialogOpen.value"
    size="md"
    :aria-title="title"
    :show-close="false"
    data-test="sample-remove-dialog"
    @update:open="(open) => !open && session.closeRemoveDialog()"
  >
    <div class="flex flex-col gap-5" :data-view="phase">
      <span class="sr-only" role="status" aria-live="polite" data-test="sample-remove-announcer">{{
        title
      }}</span>
      <div class="flex items-center gap-3">
        <span
          class="rounded-surface flex size-12 shrink-0 items-center justify-center"
          :class="headerTint"
          data-test="sample-remove-icon"
        >
          <OIcon :name="headerIcon" size="md" :class="{ 'animate-spin': phase === 'removing' }" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h2 class="text-text-heading m-0 text-2xl" data-test="sample-remove-title">
            {{ title }}
          </h2>
          <span class="text-text-secondary text-sm" data-test="sample-remove-body">{{ body }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-end justify-between gap-3">
          <strong class="text-text-heading text-sm" data-test="sample-remove-label">{{
            label
          }}</strong>
          <span
            class="text-text-heading text-3xl leading-none font-semibold tabular-nums"
            data-test="sample-remove-percent"
            >{{ percent }}</span
          >
        </div>
        <OProgressBar
          :value="phase === 'done' ? 1 : session.removeFraction.value"
          :variant="barVariant"
          size="xs"
          :aria-label="label"
        />
      </div>

      <ul class="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        <li
          v-for="step in steps"
          :key="step.id"
          class="rounded-default flex min-w-0 items-center gap-2 border px-2.5 py-1 text-xs"
          :class="chipClass(step.status)"
          :data-test="`sample-remove-step-${step.id}`"
          :data-status="step.status"
        >
          <OIcon
            :name="stepIcon(step.status)"
            size="sm"
            class="shrink-0"
            :class="stepIconClass(step.status)"
            :label="step.status === 'failed' ? t('sampleData.progress.skipped') : undefined"
          />
          <span class="truncate" :title="step.label">{{ step.label }}</span>
        </li>
      </ul>

      <div
        v-if="phase === 'done' && session.removeKept.value.length"
        class="rounded-default border-border-default text-text-body border p-3 text-sm"
        data-test="sample-remove-kept"
      >
        <strong>{{ t("sampleData.removeDialog.done.keptLabel") }}</strong>
        {{ session.removeKept.value.join(", ") }}
      </div>

      <p
        v-if="phase === 'failed'"
        role="alert"
        class="text-status-error-text m-0 text-sm"
        data-test="sample-remove-error"
      >
        {{ errorMessage }}
      </p>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <OButton
          v-if="phase === 'removing'"
          variant="outline"
          size="sm"
          data-test="sample-remove-background"
          @click="session.closeRemoveDialog()"
        >
          {{ t("sampleData.welcome.continueInBackground") }}
        </OButton>
        <OButton
          v-else-if="phase === 'done'"
          variant="primary"
          size="sm"
          data-test="sample-remove-done"
          @click="session.closeRemoveDialog()"
        >
          {{ t("sampleData.removeDialog.done.done") }}
        </OButton>
        <template v-else>
          <OButton
            variant="outline"
            size="sm"
            data-test="sample-remove-close"
            @click="session.closeRemoveDialog()"
          >
            {{ t("sampleData.removeDialog.failed.close") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            data-test="sample-remove-retry"
            @click="session.removeInDialog(session.removeOrg.value)"
          >
            {{ t("sampleData.removeDialog.failed.tryAgain") }}
          </OButton>
        </template>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  SampleLoadRunningError,
  useSampleDataSession,
} from "@/composables/sampleData/useSampleDataSession";
import { chipClass, stepIcon, stepIconClass } from "./sampleStepStyle";

const { t } = useI18nTyped();
const session = useSampleDataSession();

// idle only shows while the closing animation runs, so it reads like the removing view
const phase = computed(() =>
  session.removePhase.value === "idle" ? "removing" : session.removePhase.value,
);

const title = computed(() => t(`sampleData.removeDialog.${phase.value}.title`));
const body = computed(() => t(`sampleData.removeDialog.${phase.value}.body`));
const label = computed(() => t(`sampleData.removeDialog.${phase.value}.label`));
const percent = computed(() =>
  raw(`${phase.value === "done" ? 100 : Math.round(session.removeFraction.value * 100)}%`),
);
const barVariant = computed(() =>
  phase.value === "done" ? "success" : phase.value === "failed" ? "danger" : "default",
);

const headerIcon = computed<IconName>(() => {
  if (phase.value === "done") return "check-circle";
  if (phase.value === "failed") return "error";
  return "progress-activity";
});
const headerTint = computed(() => {
  if (phase.value === "done") return "bg-icon-chip-success-bg text-status-success-text";
  if (phase.value === "failed") return "bg-icon-chip-error-bg text-icon-chip-error-text";
  return "bg-accent/10 text-accent";
});

const steps = computed(() =>
  session.removeSteps.value.map((s) => ({
    ...s,
    label: t(`sampleData.removeSteps.${s.id}`),
  })),
);

const errorText = (e: any): I18nText =>
  e instanceof SampleLoadRunningError
    ? t("sampleData.toast.removeWhileLoading")
    : raw(e?.response?.data?.message) || t("sampleData.toast.removeFailed");
const errorMessage = computed(() => errorText(session.removeError.value));

// a removal that ends while the dialog is closed is reported by toast instead
watch(session.removePhase, (value) => {
  if (session.removeDialogOpen.value) return;
  if (value === "done") {
    const kept = session.removeKept.value.length;
    toast({
      variant: "success",
      message: kept ? t("sampleData.toast.removedWithKept", kept) : t("sampleData.toast.removed"),
    });
  } else if (value === "failed") {
    toast({ variant: "error", message: errorText(session.removeError.value) });
  } else {
    return;
  }
  session.closeRemoveDialog();
});
</script>
