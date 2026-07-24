<!--
  Copyright 2026 OpenObserve Inc.

  New-scorer type picker. Standard ODialog (the shared overlay) — the panel,
  scrim, close button, Esc/overlay-dismiss and open animation all come from
  ODialog, so this only supplies the intro + the selectable type cards.

  Controlled component: the parent keeps it mounted and drives `open` (v-model),
  so ODialog can play its close animation on dismiss — a `v-if` would unmount the
  panel synchronously and cut the exit animation. Emits `select` with the chosen
  ScorerType.
-->
<template>
  <ODialog
    :open="open"
    :title="t('onlineEvals.scorerTypeDialog.title')"
    size="lg"
    data-test="scorer-type-dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-text-secondary text-compact leading-normal">
        {{ t("onlineEvals.scorerTypeDialog.intro") }}
      </p>

      <div class="grid grid-cols-2 max-md:grid-cols-1 gap-3">
        <button
          v-for="opt in typeOptions"
          :key="opt.type"
          type="button"
          class="flex flex-col items-start gap-2.5 min-h-45 p-4 border border-border-default rounded-default bg-surface-base text-left cursor-pointer transition-colors hover:border-accent"
          :data-test="`scorer-type-${opt.testKey}`"
          @click="select(opt.type)"
        >
          <span
            class="inline-flex items-center justify-center w-9 h-9 rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text"
          >
            <OIcon :name="opt.icon" size="md" />
          </span>
          <span class="text-sm font-semibold text-text-heading">{{ opt.title }}</span>
          <span class="flex-1 text-xs leading-normal text-text-secondary">{{
            opt.description
          }}</span>
          <span class="inline-flex items-center gap-1 mt-auto text-xs font-semibold text-accent">
            {{ opt.cta }}
            <OIcon name="chevron-right" size="xs" />
          </span>
        </button>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { ScorerType } from "@/services/online-evals.service";

defineProps<{ open?: boolean }>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "select", type: ScorerType): void;
}>();

const { t } = useI18n();

function select(type: ScorerType) {
  emit("select", type);
}

interface TypeOption {
  type: ScorerType;
  testKey: string;
  icon: IconName;
  title: string;
  description: string;
  cta: string;
}

const typeOptions = computed<TypeOption[]>(() => [
  {
    type: "llm_judge",
    testKey: "llm-judge",
    icon: "smart-toy",
    title: t("onlineEvals.scorerTypeDialog.llmJudgeTitle"),
    description: t("onlineEvals.scorerTypeDialog.llmJudgeDescription"),
    cta: t("onlineEvals.scorerTypeDialog.llmJudgeCta"),
  },
  {
    type: "remote",
    testKey: "remote",
    icon: "cloud",
    title: t("onlineEvals.scorerTypeDialog.remoteTitle"),
    description: t("onlineEvals.scorerTypeDialog.remoteDescription"),
    cta: t("onlineEvals.scorerTypeDialog.remoteCta"),
  },
]);
</script>
