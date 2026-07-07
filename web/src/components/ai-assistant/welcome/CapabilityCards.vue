<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { CAPABILITY_CARDS } from "./welcomeContent";

const { t } = useI18n();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();
</script>

<template>
  <div class="grid w-full gap-[0.875rem] [grid-template-columns:repeat(4,minmax(0,1fr))] max-[64rem]:[grid-template-columns:repeat(2,minmax(0,1fr))] max-[40rem]:[grid-template-columns:1fr]">
    <OCard
      v-for="card in CAPABILITY_CARDS"
      :key="card.id"
      role="button"
      tabindex="0"
      class="capability-card group/card relative py-4 px-4 pb-[1.125rem] border border-(--color-border-default) rounded-xl cursor-pointer bg-(--color-card-bg) transition-[border-color,box-shadow,translate,background] duration-200 ease-[ease] isolate overflow-hidden min-h-[132px] [--accent:123,97,255] hover:border-[rgba(var(--accent),0.5)] hover:-translate-y-[3px] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-10px_rgba(var(--accent),0.35)] focus-visible:outline-none focus-visible:border-[rgba(var(--accent),0.7)] focus-visible:shadow-[0_0_0_2px_rgba(var(--accent),0.45)]"
      :class="{
        '[--accent:123,97,255]': card.id === 'query',
        '[--accent:245,158,11]': card.id === 'incident',
        '[--accent:16,185,129]': card.id === 'dashboard',
        '[--accent:239,68,68]': card.id === 'alert',
      }"
      @click="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.enter.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.space.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
    >
      <span
        class="capability-card__glow absolute [-inset-px] rounded-[inherit] bg-[linear-gradient(135deg,rgba(var(--accent),0.45),rgba(var(--accent),0.05)_60%)] opacity-0 transition-opacity duration-[250ms] ease-[ease] pointer-events-none z-[-1] blur-[8px] group-hover/card:opacity-100"
        aria-hidden="true"
      ></span>
      <div
        class="capability-card__icon relative z-[1] inline-flex items-center justify-center w-[38px] h-[38px] rounded-[0.625rem] mb-[0.625rem] shadow-[inset_0_0_0_1px_rgba(var(--accent),0.18)]"
        :class="card.iconBgClass"
      >
        <OIcon :name="card.icon" size="md" :class="card.iconColorClass" />
      </div>
      <div class="capability-card__title relative z-[1] m-0 text-sm font-semibold leading-[1.3] text-[var(--color-typography-body)] whitespace-nowrap overflow-hidden text-ellipsis">
        {{ t(`aiAssistant.capabilities.${card.id}.title`) }}
      </div>
      <div class="capability-card__desc relative z-[1] mt-[0.375rem] mb-0 text-xs leading-[1.45] text-[var(--color-text-secondary)]">
        {{ t(`aiAssistant.capabilities.${card.id}.description`) }}
      </div>
      <span
        class="capability-card__chevron z-[1] absolute top-[0.875rem] right-[0.875rem] w-[22px] h-[22px] inline-flex items-center justify-center rounded-full bg-[rgba(var(--accent),0.15)] text-[rgba(var(--accent),1)] opacity-0 translate-x-[-4px] translate-y-[4px] transition-[opacity,translate] duration-200 ease-[ease] group-hover/card:opacity-100 group-hover/card:translate-x-0 group-hover/card:translate-y-0"
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
