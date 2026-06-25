<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { CAPABILITY_CARDS } from "./welcomeContent";

const { t } = useI18n();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();
</script>

<template>
  <div class="tw:grid tw:w-full tw:gap-[0.875rem] tw:[grid-template-columns:repeat(4,minmax(0,1fr))] tw:max-[64rem]:[grid-template-columns:repeat(2,minmax(0,1fr))] tw:max-[40rem]:[grid-template-columns:1fr]">
    <OCard
      v-for="card in CAPABILITY_CARDS"
      :key="card.id"
      role="button"
      tabindex="0"
      class="capability-card tw:group/card tw:relative tw:py-4 tw:px-4 tw:pb-[1.125rem] tw:border tw:border-(--color-border-default) tw:rounded-xl tw:cursor-pointer tw:bg-(--color-card-bg) tw:transition-[border-color,box-shadow,transform,background] tw:duration-200 tw:isolate tw:overflow-hidden tw:min-h-[132px] tw:[--accent:123,97,255] tw:hover:border-[rgba(var(--accent),0.5)] tw:hover:-translate-y-[3px] tw:hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-10px_rgba(var(--accent),0.35)] tw:focus-visible:outline-none tw:focus-visible:border-[rgba(var(--accent),0.7)] tw:focus-visible:shadow-[0_0_0_2px_rgba(var(--accent),0.45)]"
      :class="{
        'tw:[--accent:123,97,255]': card.id === 'query',
        'tw:[--accent:245,158,11]': card.id === 'incident',
        'tw:[--accent:16,185,129]': card.id === 'dashboard',
        'tw:[--accent:239,68,68]': card.id === 'alert',
      }"
      @click="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.enter.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.space.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
    >
      <span
        class="capability-card__glow tw:absolute tw:[-inset-px] tw:rounded-[inherit] tw:bg-[linear-gradient(135deg,rgba(var(--accent),0.45),rgba(var(--accent),0.05)_60%)] tw:opacity-0 tw:transition-opacity tw:duration-[250ms] tw:ease-[ease] tw:pointer-events-none tw:z-[-1] tw:blur-[8px] tw:group-hover/card:opacity-100"
        aria-hidden="true"
      ></span>
      <div
        class="capability-card__icon tw:relative tw:z-[1] tw:inline-flex tw:items-center tw:justify-center tw:w-[38px] tw:h-[38px] tw:rounded-[0.625rem] tw:mb-[0.625rem] tw:shadow-[inset_0_0_0_1px_rgba(var(--accent),0.18)]"
        :class="card.iconBgClass"
      >
        <OIcon :name="card.icon" size="md" :class="card.iconColorClass" />
      </div>
      <div class="capability-card__title tw:relative tw:z-[1] tw:m-0 tw:text-sm tw:font-semibold tw:leading-[1.3] tw:text-[var(--color-typography-body)] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">
        {{ t(`aiAssistant.capabilities.${card.id}.title`) }}
      </div>
      <div class="capability-card__desc tw:relative tw:z-[1] tw:mt-[0.375rem] tw:mb-0 tw:text-xs tw:leading-[1.45] tw:text-[var(--color-text-secondary)]">
        {{ t(`aiAssistant.capabilities.${card.id}.description`) }}
      </div>
      <span
        class="capability-card__chevron tw:z-[1] tw:absolute tw:top-[0.875rem] tw:right-[0.875rem] tw:w-[22px] tw:h-[22px] tw:inline-flex tw:items-center tw:justify-center tw:rounded-full tw:bg-[rgba(var(--accent),0.15)] tw:text-[rgba(var(--accent),1)] tw:opacity-0 tw:translate-x-[-4px] tw:translate-y-[4px] tw:transition-[opacity,transform] tw:duration-200 tw:ease-[ease] tw:group-hover/card:opacity-100 tw:group-hover/card:translate-x-0 tw:group-hover/card:translate-y-0"
        aria-hidden="true"
      >
        <OIcon name="arrow-forward" size="xs" />
      </span>
    </OCard>
  </div>
</template>

<style>
.capability-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    155deg,
    rgba(var(--accent), 0.1) 0%,
    rgba(var(--accent), 0.02) 40%,
    transparent 70%
  );
  pointer-events: none;
  z-index: 0;
}
</style>
