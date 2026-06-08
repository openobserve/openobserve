<template>
  <div
    class="scorer-type-scrim"
    role="dialog"
    aria-modal="true"
    @click.self="$emit('close')"
  >
    <div class="scorer-type-dialog">
      <header class="scorer-type-dialog__header">
        <h2 class="scorer-type-dialog__title">{{ t("onlineEvals.scorerTypeDialog.title") }}</h2>
        <button
          type="button"
          class="scorer-type-dialog__close"
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

      <p class="scorer-type-dialog__intro">{{ t("onlineEvals.scorerTypeDialog.intro") }}</p>

      <div class="scorer-type-dialog__cards">
        <button
          type="button"
          class="scorer-type-card"
          data-test="scorer-type-llm-judge"
          @click="$emit('select', 'llm_judge')"
        >
          <div class="scorer-type-card__icon">
            <OIcon name="smart-toy" size="md" />
          </div>
          <div class="scorer-type-card__title">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeTitle") }}
          </div>
          <div class="scorer-type-card__desc">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeDescription") }}
          </div>
          <div class="scorer-type-card__cta">
            {{ t("onlineEvals.scorerTypeDialog.llmJudgeCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="scorer-type-card"
          data-test="scorer-type-remote"
          @click="$emit('select', 'remote')"
        >
          <div class="scorer-type-card__icon">
            <OIcon name="cloud" size="md" />
          </div>
          <div class="scorer-type-card__title">
            {{ t("onlineEvals.scorerTypeDialog.remoteTitle") }}
          </div>
          <div class="scorer-type-card__desc">
            {{ t("onlineEvals.scorerTypeDialog.remoteDescription") }}
          </div>
          <div class="scorer-type-card__cta">
            {{ t("onlineEvals.scorerTypeDialog.remoteCta") }}
            <OIcon name="chevron-right" size="xs" />
          </div>
        </button>

        <button
          type="button"
          class="scorer-type-card scorer-type-card--disabled"
          data-test="scorer-type-code"
          disabled
        >
          <span class="scorer-type-card__badge">
            {{ t("onlineEvals.scorerTypeDialog.comingSoonBadge") }}
          </span>
          <div class="scorer-type-card__icon">
            <OIcon name="code" size="md" />
          </div>
          <div class="scorer-type-card__title">
            {{ t("onlineEvals.scorerTypeDialog.codeTitle") }}
          </div>
          <div class="scorer-type-card__desc">
            {{ t("onlineEvals.scorerTypeDialog.codeDescription") }}
          </div>
          <div class="scorer-type-card__cta scorer-type-card__cta--muted">
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

<style lang="scss" scoped>
.scorer-type-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: scorer-type-scrim-in 0.15s ease-out;
}

.scorer-type-dialog {
  width: min(820px, calc(100vw - 48px));
  background: var(--color-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 8px;
  box-shadow: var(--o2-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08));
  padding: 20px 22px 24px;
  animation: scorer-type-pop-in 0.18s ease-out;
}

.scorer-type-dialog__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  margin-bottom: 16px;
}

.scorer-type-dialog__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.scorer-type-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.scorer-type-dialog__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.scorer-type-dialog__intro {
  margin: 0 0 16px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 13px;
  line-height: 1.5;
}

.scorer-type-dialog__cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.scorer-type-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-height: 180px;
  padding: 16px 16px 14px;
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 8px;
  background: var(--color-card-bg);
  color: var(--color-text-primary, currentColor);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.15s;
}

.scorer-type-card:hover:not(.scorer-type-card--disabled) {
  border-color: var(--color-primary-600, #3F7994);
  background: color-mix(in srgb, var(--color-primary-600) 4%, var(--color-card-bg));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-600) 12%, transparent);
}

.scorer-type-card--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.scorer-type-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary-600) 10%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.scorer-type-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.scorer-type-card__desc {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-type-card__cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary-600, #3F7994);
}

.scorer-type-card__cta--muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-type-card__badge {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  font: 600 11px/1.5 inherit;
  background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent);
  color: var(--o2-status-warning-text);
}

@keyframes scorer-type-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scorer-type-pop-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@media (max-width: 720px) {
  .scorer-type-dialog__cards {
    grid-template-columns: 1fr;
  }
}
</style>
