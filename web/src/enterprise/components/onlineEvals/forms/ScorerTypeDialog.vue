<template>
  <div
    class="scorer-type-scrim fixed inset-0 bg-black/32 z-6000 flex items-center justify-center"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="scorer-type-panel w-[min(820px,calc(100vw-48px))] bg-card-bg border border-dialog-header-border rounded-default shadow-(--shadow-lg,0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)) px-5.5 pt-5 pb-6">
      <header class="flex items-center gap-3 pb-3 border-b border-dialog-header-border mb-4">
        <h2 class="flex-1 m-0 text-base font-semibold text-text-heading">{{ t("onlineEvals.scorerTypeDialog.title") }}</h2>
        <button
          type="button"
          class="inline-flex items-center justify-center w-7 h-7 p-0 text-(--color-text-secondary,var(--color-text-secondary)) bg-transparent border-0 rounded-default cursor-pointer transition-[background,color] duration-150 hover:bg-[color-mix(in_srgb,var(--color-text-heading)_6%,transparent)] hover:text-(--color-primary-600,#3F7994)"
          :aria-label="t('onlineEvals.buttons.cancel')"
          data-test="scorer-type-close-btn"
          @click="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <p class="m-0 mb-4 text-text-secondary text-compact leading-normal">{{ t("onlineEvals.scorerTypeDialog.intro") }}</p>

      <div class="grid grid-cols-2 max-[720px]:grid-cols-1 gap-3">
        <button
          type="button"
          class="relative flex flex-col items-start gap-2.5 min-h-45 py-4 px-4 pb-3.5 border border-(--color-dialog-header-border,var(--color-border-default)) rounded-default bg-card-bg text-(--color-text-heading,currentColor) text-left cursor-pointer transition-[border-color,background,box-shadow] duration-[120ms] hover:border-(--color-primary-600,#3F7994) hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)]"
          data-test="scorer-type-llm-judge"
          @click="$emit('select', 'llm_judge')"
        >
          <div class="inline-flex items-center justify-center w-9 h-9 rounded-default bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] text-(--color-primary-600,#3F7994)">
            <OIcon name="smart-toy" size="md" />
          </div>
          <div class="text-sm font-semibold text-(--color-text-heading,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeTitle") }}
          </div>
          <div class="flex-1 text-xs leading-normal text-(--color-text-secondary,var(--color-text-secondary))">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeDescription") }}
          </div>
          <div class="inline-flex items-center gap-1 mt-auto text-xs font-semibold text-(--color-primary-600,#3F7994)">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="relative flex flex-col items-start gap-2.5 min-h-45 py-4 px-4 pb-3.5 border border-(--color-dialog-header-border,var(--color-border-default)) rounded-default bg-card-bg text-(--color-text-heading,currentColor) text-left cursor-pointer transition-[border-color,background,box-shadow] duration-[120ms] hover:border-(--color-primary-600,#3F7994) hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)]"
          data-test="scorer-type-remote"
          @click="$emit('select', 'remote')"
        >
          <div class="inline-flex items-center justify-center w-9 h-9 rounded-default bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] text-(--color-primary-600,#3F7994)">
            <OIcon name="cloud" size="md" />
          </div>
          <div class="text-sm font-semibold text-(--color-text-heading,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.remoteTitle") }}
          </div>
          <div class="flex-1 text-xs leading-normal text-(--color-text-secondary,var(--color-text-secondary))">
            {{ t("onlineEvals.scorerTypeDialog.remoteDescription") }}
          </div>
          <div class="inline-flex items-center gap-1 mt-auto text-xs font-semibold text-(--color-primary-600,#3F7994)">
            {{ t("onlineEvals.scorerTypeDialog.remoteCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ScorerType } from "@/services/online-evals.service";

defineEmits<{
  (e: "close"): void;
  (e: "select", type: ScorerType): void;
}>();

const { t } = useI18n();
</script>

<style scoped>
/* keep(keyframes): the scrim fade and the panel pop are used only by this dialog.
   Both `animation`s are declared here, not as template `animate-[…]` utilities, so
   Vue's scoped compiler renames each keyframe and its reference together. */
.scorer-type-scrim {
  animation: scrim-in 0.15s ease-out;
}

.scorer-type-panel {
  animation: pop-in 0.18s ease-out;
}

@keyframes scrim-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>

