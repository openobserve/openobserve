<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { CAPABILITY_CARDS } from "./welcomeContent";

const { t } = useI18n();

const emit = defineEmits<{ (e: "select", prompt: string): void }>();
</script>

<template>
  <div class="capability-grid">
    <OCard
      v-for="card in CAPABILITY_CARDS"
      :key="card.id"
      role="button"
      tabindex="0"
      class="capability-card"
      :data-accent="card.id"
      @click="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.enter.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
      @keydown.space.prevent="emit('select', t(`aiAssistant.capabilities.${card.id}.prompt`))"
    >
      <span class="capability-card__glow" aria-hidden="true"></span>
      <div class="capability-card__icon" :class="card.iconBgClass">
        <OIcon :name="card.icon" size="md" :class="card.iconColorClass" />
      </div>
      <h3 class="capability-card__title">
        {{ t(`aiAssistant.capabilities.${card.id}.title`) }}
      </h3>
      <p class="capability-card__desc">
        {{ t(`aiAssistant.capabilities.${card.id}.description`) }}
      </p>
      <span class="capability-card__chevron" aria-hidden="true">
        <OIcon name="arrow-forward" size="xs" />
      </span>
    </OCard>
  </div>
</template>

<style scoped lang="scss">
.capability-grid {
  display: grid;
  width: 100%;
  gap: 0.875rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

@media (max-width: 64rem) {
  .capability-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 40rem) {
  .capability-grid {
    grid-template-columns: 1fr;
  }
}

.capability-card {
  --accent: 123, 97, 255;
  position: relative;
  padding: 1rem 1rem 1.125rem;
  border: 1px solid var(--color-border-default);
  border-radius: 0.75rem;
  cursor: pointer;
  background: var(--color-card-bg);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease,
    background 0.2s ease;
  isolation: isolate;
  overflow: hidden;
  min-height: 132px;
}

.capability-card[data-accent="query"] {
  --accent: 123, 97, 255;
}
.capability-card[data-accent="incident"] {
  --accent: 245, 158, 11;
}
.capability-card[data-accent="dashboard"] {
  --accent: 16, 185, 129;
}
.capability-card[data-accent="alert"] {
  --accent: 239, 68, 68;
}

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

.capability-card__glow {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(var(--accent), 0.45),
    rgba(var(--accent), 0.05) 60%
  );
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
  z-index: -1;
  filter: blur(8px);
}

.capability-card > * {
  position: relative;
  z-index: 1;
}

.capability-card:hover {
  border-color: rgba(var(--accent), 0.5);
  transform: translateY(-3px);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 12px 28px -10px rgba(var(--accent), 0.35);
}

.capability-card:hover .capability-card__glow {
  opacity: 1;
}

.capability-card:hover .capability-card__chevron {
  opacity: 1;
  transform: translate(0, 0);
}

.capability-card:focus-visible {
  outline: none;
  border-color: rgba(var(--accent), 0.7);
  box-shadow: 0 0 0 2px rgba(var(--accent), 0.45);
}

.capability-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 0.625rem;
  margin-bottom: 0.625rem;
  box-shadow: inset 0 0 0 1px rgba(var(--accent), 0.18);
}

.capability-card__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-typography-body);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capability-card__desc {
  margin: 0.375rem 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.capability-card__chevron {
  position: absolute;
  top: 0.875rem;
  right: 0.875rem;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: rgba(var(--accent), 0.15);
  color: rgba(var(--accent), 1);
  opacity: 0;
  transform: translate(-4px, 4px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
</style>
