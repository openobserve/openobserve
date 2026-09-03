<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { CAPABILITY_CARDS } from "./welcomeContent";

const { t } = useI18nTyped();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();
</script>

<template>
  <div
    class="grid w-full [grid-template-columns:repeat(4,minmax(0,1fr))] gap-3.5 max-[64rem]:[grid-template-columns:repeat(2,minmax(0,1fr))] max-[40rem]:[grid-template-columns:1fr]"
  >
    <OCard
      v-for="card in CAPABILITY_CARDS"
      :key="card.id"
      role="button"
      tabindex="0"
      class="capability-card group/card border-border-default rounded-default bg-card-bg hover:shadow-glow-lg relative isolate min-h-33 cursor-pointer overflow-hidden border px-4 py-4 pb-[1.125rem] transition-[border-color,box-shadow,translate,background] duration-200 ease-[ease] [--card-tint:linear-gradient(155deg,color-mix(in_srgb,var(--glow-color)_10%,transparent)_0%,color-mix(in_srgb,var(--glow-color)_2%,transparent)_40%,transparent_70%)] [--glow-color:var(--color-indigo-500)] hover:-translate-y-[0.1875rem] hover:border-[color-mix(in_srgb,var(--glow-color)_50%,transparent)] hover:shadow-lg focus-visible:border-[color-mix(in_srgb,var(--glow-color)_70%,transparent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--glow-color)_45%,transparent)] focus-visible:outline-none"
      :class="{
        '[--glow-color:var(--color-indigo-500)]': card.id === 'query',
        '[--glow-color:var(--color-amber-500)]': card.id === 'incident',
        '[--glow-color:var(--color-success-500)]': card.id === 'dashboard',
        '[--glow-color:var(--color-error-500)]': card.id === 'alert',
      }"
      @click="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.enter.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.space.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
    >
      <!-- eslint-disable local/no-hardcoded-px -- optical effect (blur radius), not layout — scaling it with text makes the glow bloom -->
      <span
        class="capability-card__glow [-inset-px] rounded-default pointer-events-none absolute z-[-1] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--glow-color)_45%,transparent),color-mix(in_srgb,var(--glow-color)_5%,transparent)_60%)] opacity-0 blur-[8px] transition-opacity duration-[250ms] ease-[ease] group-hover/card:opacity-100"
        aria-hidden="true"
      ></span>
      <!-- eslint-enable local/no-hardcoded-px -->
      <div
        class="capability-card__icon rounded-default relative z-1 mb-2.5 inline-flex h-9.5 w-9.5 items-center justify-center ring-1 ring-[color-mix(in_srgb,var(--glow-color)_18%,transparent)] ring-inset"
        :class="card.iconBgClass"
      >
        <OIcon :name="card.icon" size="md" :class="card.iconColorClass" />
      </div>
      <div
        class="capability-card__title text-typography-body relative z-1 m-0 overflow-hidden text-sm leading-[1.3] font-semibold text-ellipsis whitespace-nowrap"
      >
        {{ t(`aiAssistant.capabilities.${card.id}.title`) }}
      </div>
      <div
        class="capability-card__desc text-text-secondary relative z-1 mt-1.5 mb-0 text-xs leading-[1.45]"
      >
        {{ t(`aiAssistant.capabilities.${card.id}.description`) }}
      </div>
      <span
        class="capability-card__chevron absolute top-3.5 right-3.5 z-1 inline-flex h-5.5 w-5.5 translate-x-[-0.25rem] translate-y-[0.25rem] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--glow-color)_15%,transparent)] text-[color-mix(in_srgb,var(--glow-color)_100%,transparent)] opacity-0 transition-[opacity,translate] duration-200 ease-[ease] group-hover/card:translate-x-0 group-hover/card:translate-y-0 group-hover/card:opacity-100"
        aria-hidden="true"
      >
        <OIcon name="arrow-forward" size="xs" />
      </span>
    </OCard>
  </div>
</template>

<style scoped>
/* keep(brand): decorative per-card accent gradient overlay driven by the
   inline --glow-color token (built in the template as the --card-tint
   custom property so no colour literal lives in this block); the accent-alpha
   idiom matches the sibling glow/chevron elements and is not a design token. */
.capability-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--card-tint);
  pointer-events: none;
  z-index: 0;
}
</style>
