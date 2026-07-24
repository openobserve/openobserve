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
      <p class="text-text-secondary text-compact m-0 leading-normal">
        {{ t("onlineEvals.scorerTypeDialog.intro") }}
      </p>

      <div class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <button
          v-for="opt in typeOptions"
          :key="opt.type"
          type="button"
          class="border-border-default rounded-default bg-surface-base hover:border-accent flex min-h-45 cursor-pointer flex-col items-start gap-2.5 border p-4 text-left transition-colors"
          :data-test="`scorer-type-${opt.testKey}`"
          @click="select(opt.type)"
        >
          <span
            class="rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text inline-flex h-9 w-9 items-center justify-center"
          >
            <OIcon :name="opt.icon" size="md" />
          </span>
          <span class="text-text-heading text-sm font-semibold">{{ opt.title }}</span>
          <span class="text-text-secondary flex-1 text-xs leading-normal">{{
            opt.description
          }}</span>
          <span class="text-accent mt-auto inline-flex items-center gap-1 text-xs font-semibold">
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
