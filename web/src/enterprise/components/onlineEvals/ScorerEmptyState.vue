<template>
  <div
    data-test="scorer-empty-state"
    class="sr-empty"
    :class="{ 'sr-empty--dark': store.state.theme === 'dark' }"
  >
    <div class="sr-empty__icon-outer">
      <div
        class="sr-empty__icon-inner"
        :class="{ 'sr-empty__icon-inner--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="rule" size="lg" class="sr-empty__icon" />
      </div>
    </div>

    <div class="sr-empty__title">{{ t("onlineEvals.scorer.empty.title") }}</div>

    <div class="sr-empty__desc">
      {{ t("onlineEvals.scorer.empty.description") }}
    </div>

    <div class="sr-empty__chips">
      <span
        class="sr-empty__chip"
        :class="{ 'sr-empty__chip--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="smart-toy" size="xs" />
        {{ t("onlineEvals.scorer.empty.chipLlmJudge") }}
      </span>
      <span
        class="sr-empty__chip"
        :class="{ 'sr-empty__chip--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="cloud" size="xs" />
        {{ t("onlineEvals.scorer.empty.chipRemote") }}
      </span>
    </div>

    <OButton
      data-test="scorer-empty-create-btn"
      variant="primary"
      size="md"
      icon-left="add"
      class="sr-empty__btn"
      @click="$emit('create')"
    >
      {{ t("onlineEvals.scorer.newButton") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineEmits<{ (e: "create"): void }>();

const { t } = useI18n();
const store = useStore();
</script>

<style lang="scss" scoped>
.sr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 320px;
  padding: 48px 24px;
  text-align: center;

  &__icon-outer {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 1px dashed rgba(66, 133, 244, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;

    .sr-empty--dark & { border-color: rgba(66, 133, 244, 0.3); }
  }

  &__icon-inner {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: rgba(66, 133, 244, 0.09);
    border: 1.5px solid rgba(66, 133, 244, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;

    &--dark {
      background: rgba(66, 133, 244, 0.18);
      border-color: rgba(66, 133, 244, 0.35);
    }
  }

  &__icon {
    color: var(--q-primary);
    opacity: 0.85;
  }

  &__title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: var(--color-text-primary, #111827);
    margin-bottom: 10px;
  }

  &__desc {
    font-size: 0.88rem;
    line-height: 1.65;
    color: var(--color-text-secondary, #6b7280);
    max-width: 480px;
    margin-bottom: 24px;
  }

  &__chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 32px;
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary, #6b7280);
    background: color-mix(in srgb, var(--color-text-secondary) 8%, transparent);
    border: 1px solid var(--color-dialog-header-border, var(--o2-border));
    border-radius: 20px;
    padding: 4px 12px;

    &--dark {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.1);
    }
  }

  &__btn {
    height: 40px;
    padding: 0 24px;
    font-size: 0.92rem;
    font-weight: 600;
  }
}
</style>
