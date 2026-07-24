<template>
  <div
    class="scorer-type-scrim fixed inset-0 z-6000 flex items-center justify-center bg-black/32"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div
      class="scorer-type-panel bg-card-bg border-dialog-header-border rounded-default w-[min(820px,calc(100vw-48px))] border px-5.5 pt-5 pb-6 shadow-(--shadow-lg,0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08))"
    >
      <header class="border-dialog-header-border mb-4 flex items-center gap-3 border-b pb-3">
        <h2 class="text-text-heading m-0 flex-1 text-base font-semibold">
          {{ t("onlineEvals.scorerTypeDialog.title") }}
        </h2>
        <button
          type="button"
          class="rounded-default inline-flex h-7 w-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-(--color-text-secondary,var(--color-text-secondary)) transition-[background,color] duration-150 hover:bg-[color-mix(in_srgb,var(--color-text-heading)_6%,transparent)] hover:text-(--color-primary-600,#3F7994)"
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

      <p class="text-text-secondary text-compact m-0 mb-4 leading-normal">
        {{ t("onlineEvals.scorerTypeDialog.intro") }}
      </p>

      <div class="grid grid-cols-3 gap-3 max-[720px]:grid-cols-1">
        <button
          type="button"
          class="rounded-default bg-card-bg relative flex min-h-45 cursor-pointer flex-col items-start gap-2.5 border border-(--color-dialog-header-border,var(--color-border-default)) px-4 py-4 pb-3.5 text-left text-(--color-text-heading,currentColor) transition-[border-color,background,box-shadow] duration-[120ms] hover:border-(--color-primary-600,#3F7994) hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)]"
          data-test="scorer-type-llm-judge"
          @click="$emit('select', 'llm_judge')"
        >
          <div
            class="rounded-default inline-flex h-9 w-9 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] text-(--color-primary-600,#3F7994)"
          >
            <OIcon name="smart-toy" size="md" />
          </div>
          <div class="text-sm font-semibold text-(--color-text-heading,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeTitle") }}
          </div>
          <div
            class="flex-1 text-xs leading-normal text-(--color-text-secondary,var(--color-text-secondary))"
          >
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeDescription") }}
          </div>
          <div
            class="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-(--color-primary-600,#3F7994)"
          >
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="rounded-default bg-card-bg relative flex min-h-45 cursor-pointer flex-col items-start gap-2.5 border border-(--color-dialog-header-border,var(--color-border-default)) px-4 py-4 pb-3.5 text-left text-(--color-text-heading,currentColor) transition-[border-color,background,box-shadow] duration-[120ms] hover:border-(--color-primary-600,#3F7994) hover:bg-[color-mix(in_srgb,var(--color-primary-600)_4%,var(--color-card-bg))] hover:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary-600)_12%,transparent)]"
          data-test="scorer-type-remote"
          @click="$emit('select', 'remote')"
        >
          <div
            class="rounded-default inline-flex h-9 w-9 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] text-(--color-primary-600,#3F7994)"
          >
            <OIcon name="cloud" size="md" />
          </div>
          <div class="text-sm font-semibold text-(--color-text-heading,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.remoteTitle") }}
          </div>
          <div
            class="flex-1 text-xs leading-normal text-(--color-text-secondary,var(--color-text-secondary))"
          >
            {{ t("onlineEvals.scorerTypeDialog.remoteDescription") }}
          </div>
          <div
            class="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-(--color-primary-600,#3F7994)"
          >
            {{ t("onlineEvals.scorerTypeDialog.remoteCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="rounded-default bg-card-bg relative flex min-h-45 cursor-not-allowed flex-col items-start gap-2.5 border border-(--color-dialog-header-border,var(--color-border-default)) px-4 py-4 pb-3.5 text-left text-(--color-text-heading,currentColor) opacity-60 transition-[border-color,background,box-shadow] duration-[120ms]"
          data-test="scorer-type-code"
          disabled
        >
          <span
            class="rounded-default text-2xs text-status-warning-text absolute top-3 right-3 bg-[color-mix(in_srgb,var(--color-status-warning-text)_14%,transparent)] px-2 py-0.5 leading-normal font-semibold"
          >
            {{ t("onlineEvals.scorerTypeDialog.comingSoonBadge") }}
          </span>
          <div
            class="rounded-default inline-flex h-9 w-9 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] text-(--color-primary-600,#3F7994)"
          >
            <OIcon name="code" size="md" />
          </div>
          <div class="text-sm font-semibold text-(--color-text-heading,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.codeTitle") }}
          </div>
          <div
            class="flex-1 text-xs leading-normal text-(--color-text-secondary,var(--color-text-secondary))"
          >
            {{ t("onlineEvals.scorerTypeDialog.codeDescription") }}
          </div>
          <div
            class="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-(--color-text-secondary,var(--color-text-secondary))"
          >
            {{ t("onlineEvals.scorerTypeDialog.codeCta") }}
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
