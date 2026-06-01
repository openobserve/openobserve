<template>
  <div
    data-test="score-config-empty-state"
    class="sc-empty"
    :class="{ 'sc-empty--dark': store.state.theme === 'dark' }"
  >
    <div class="sc-empty__icon-outer">
      <div
        class="sc-empty__icon-inner"
        :class="{ 'sc-empty__icon-inner--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="fact-check" size="lg" class="sc-empty__icon" />
      </div>
    </div>

    <div class="sc-empty__title">{{ t("onlineEvals.scoreConfig.empty.title") }}</div>

    <div class="sc-empty__desc">
      {{ t("onlineEvals.scoreConfig.empty.description") }}
    </div>

    <div class="sc-empty__chips">
      <span
        class="sc-empty__chip"
        :class="{ 'sc-empty__chip--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="data-array" size="xs" />
        {{ t("onlineEvals.scoreConfig.empty.chipTypes") }}
      </span>
      <span
        class="sc-empty__chip"
        :class="{ 'sc-empty__chip--dark': store.state.theme === 'dark' }"
      >
        <OIcon name="favorite" size="xs" />
        {{ t("onlineEvals.scoreConfig.empty.chipThreshold") }}
      </span>
    </div>

    <OButton
      data-test="score-config-empty-create-btn"
      variant="primary"
      size="md"
      class="sc-empty__btn"
      @click="$emit('create')"
    >
      {{ t("onlineEvals.scoreConfig.newButton") }}
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
.sc-empty {
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

    .sc-empty--dark & { border-color: rgba(66, 133, 244, 0.3); }
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
    max-width: 440px;
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
