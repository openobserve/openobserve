<template>
  <div
    class="tw:fixed tw:inset-0 tw:bg-black/32 tw:z-6000 tw:flex tw:items-center tw:justify-center tw:animate-[scorer-type-scrim-in_0.15s_ease-out]"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="tw:w-[min(820px,calc(100vw-48px))] tw:bg-card-bg tw:border tw:border-dialog-header-border tw:rounded-lg tw:shadow-(--o2-shadow-lg,0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)) tw:px-5.5 tw:pt-5 tw:pb-6 tw:animate-[scorer-type-pop-in_0.18s_ease-out]">
      <header class="tw:flex tw:items-center tw:gap-3 tw:pb-3 tw:border-b tw:border-dialog-header-border tw:mb-4">
        <h2 class="tw:flex-1 tw:m-0 tw:text-base tw:font-semibold tw:text-text-primary">{{ t("onlineEvals.scorerTypeDialog.title") }}</h2>
        <button
          type="button"
          class="tw:inline-flex tw:items-center tw:justify-center tw:w-7 tw:h-7 tw:p-0 tw:text-(--color-text-secondary,var(--o2-text-secondary)) tw:bg-transparent tw:border-0 tw:rounded-md tw:cursor-pointer tw:transition-[background,color] tw:duration-150 tw:hover:bg-[color-mix(in_srgb,var(--color-text-primary)_6%,transparent)] tw:hover:text-(--color-primary-600,#3F7994)"
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

      <p class="tw:m-0 tw:mb-4 tw:text-text-secondary tw:text-[13px] tw:leading-normal">{{ t("onlineEvals.scorerTypeDialog.intro") }}</p>

      <div class="tw:grid tw:grid-cols-3 max-[720px]:tw:grid-cols-1 tw:gap-3">
        <button
          type="button"
          class="scorer-type-card tw:relative tw:flex tw:flex-col tw:items-start tw:gap-[10px] tw:min-h-[180px] tw:py-4 tw:px-4 tw:pb-[14px] tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-lg tw:bg-(--color-card-bg) tw:text-(--color-text-primary,currentColor) tw:text-left tw:cursor-pointer tw:transition-[border-color,background,box-shadow] tw:duration-[120ms]"
          data-test="scorer-type-llm-judge"
          @click="$emit('select', 'llm_judge')"
        >
          <div class="tw:inline-flex tw:items-center tw:justify-center tw:w-9 tw:h-9 tw:rounded-lg tw:bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] tw:text-(--color-primary-600,#3F7994)">
            <OIcon name="smart-toy" size="md" />
          </div>
          <div class="tw:text-sm tw:font-semibold tw:text-(--color-text-primary,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeTitle") }}
          </div>
          <div class="tw:flex-1 tw:text-xs tw:leading-normal tw:text-(--color-text-secondary,var(--o2-text-secondary))">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeDescription") }}
          </div>
          <div class="tw:inline-flex tw:items-center tw:gap-1 tw:mt-auto tw:text-xs tw:font-semibold tw:text-(--color-primary-600,#3F7994)">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="scorer-type-card tw:relative tw:flex tw:flex-col tw:items-start tw:gap-[10px] tw:min-h-[180px] tw:py-4 tw:px-4 tw:pb-[14px] tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-lg tw:bg-(--color-card-bg) tw:text-(--color-text-primary,currentColor) tw:text-left tw:cursor-pointer tw:transition-[border-color,background,box-shadow] tw:duration-[120ms]"
          data-test="scorer-type-remote"
          @click="$emit('select', 'remote')"
        >
          <div class="tw:inline-flex tw:items-center tw:justify-center tw:w-9 tw:h-9 tw:rounded-lg tw:bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] tw:text-(--color-primary-600,#3F7994)">
            <OIcon name="cloud" size="md" />
          </div>
          <div class="tw:text-sm tw:font-semibold tw:text-(--color-text-primary,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.remoteTitle") }}
          </div>
          <div class="tw:flex-1 tw:text-xs tw:leading-normal tw:text-(--color-text-secondary,var(--o2-text-secondary))">
            {{ t("onlineEvals.scorerTypeDialog.remoteDescription") }}
          </div>
          <div class="tw:inline-flex tw:items-center tw:gap-1 tw:mt-auto tw:text-xs tw:font-semibold tw:text-(--color-primary-600,#3F7994)">
            {{ t("onlineEvals.scorerTypeDialog.remoteCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="scorer-type-card scorer-type-card--disabled tw:relative tw:flex tw:flex-col tw:items-start tw:gap-[10px] tw:min-h-[180px] tw:py-4 tw:px-4 tw:pb-[14px] tw:border tw:border-(--color-dialog-header-border,var(--o2-border)) tw:rounded-lg tw:bg-(--color-card-bg) tw:text-(--color-text-primary,currentColor) tw:text-left tw:cursor-not-allowed tw:opacity-60 tw:transition-[border-color,background,box-shadow] tw:duration-[120ms]"
          data-test="scorer-type-code"
          disabled
        >
          <span class="tw:absolute tw:top-3 tw:right-3 tw:py-[2px] tw:px-2 tw:rounded tw:text-[11px] tw:font-semibold tw:leading-normal tw:bg-[color-mix(in_srgb,var(--o2-status-warning-text)_14%,transparent)] tw:text-(--o2-status-warning-text)">
            {{ t("onlineEvals.scorerTypeDialog.comingSoonBadge") }}
          </span>
          <div class="tw:inline-flex tw:items-center tw:justify-center tw:w-9 tw:h-9 tw:rounded-lg tw:bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] tw:text-(--color-primary-600,#3F7994)">
            <OIcon name="code" size="md" />
          </div>
          <div class="tw:text-sm tw:font-semibold tw:text-(--color-text-primary,currentColor)">
            {{ t("onlineEvals.scorerTypeDialog.codeTitle") }}
          </div>
          <div class="tw:flex-1 tw:text-xs tw:leading-normal tw:text-(--color-text-secondary,var(--o2-text-secondary))">
            {{ t("onlineEvals.scorerTypeDialog.codeDescription") }}
          </div>
          <div class="tw:inline-flex tw:items-center tw:gap-1 tw:mt-auto tw:text-xs tw:font-semibold tw:text-(--color-text-secondary,var(--o2-text-secondary))">
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

<style>
.scorer-type-card:hover:not(.scorer-type-card--disabled) {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600) 4%, var(--color-card-bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-600) 12%, transparent);
}

@keyframes scorer-type-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scorer-type-pop-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
</style>
