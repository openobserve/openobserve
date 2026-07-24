<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Entry picker for "what kind of alert" — Simple / Composite / Anomaly. Mirrors
// the Synthetics CheckTypePicker: a stack (or grid) of EmptyStateActionCard
// options, data-driven from ALERT_TYPE_CARDS, with disabled + "Coming Soon"
// states so callers can gate enterprise-only kinds gracefully.
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { ALERT_TYPE_CARDS, type AlertTypeCard } from "@/constants/alerts";
import type { AlertKind } from "@/constants/alerts";

const props = withDefaults(
  defineProps<{
    variant?: "modal" | "inline";
    layout?: "row" | "grid";
    disabledTypes?: AlertKind[];
    comingSoonTypes?: AlertKind[];
  }>(),
  {
    variant: "modal",
    layout: "row",
    disabledTypes: () => [],
    comingSoonTypes: () => [],
  },
);

const emit = defineEmits<{
  select: [type: AlertKind];
}>();

const { t } = useI18n();

function isDisabled(card: AlertTypeCard): boolean {
  return props.disabledTypes.includes(card.type);
}

function isComingSoon(card: AlertTypeCard): boolean {
  return props.comingSoonTypes.includes(card.type);
}

function isClickable(card: AlertTypeCard): boolean {
  return !isDisabled(card) && !isComingSoon(card);
}

function onSelect(card: AlertTypeCard) {
  if (isClickable(card)) {
    emit("select", card.type);
  }
}
</script>

<template>
  <div
    :class="
      layout === 'grid'
        ? 'flex flex-wrap justify-center gap-4'
        : 'flex flex-col gap-2'
    "
    :data-test="`alert-type-picker-${layout}`"
  >
    <div
      v-for="card in ALERT_TYPE_CARDS"
      :key="card.type"
      class="relative"
      :class="{
        'opacity-50 cursor-not-allowed': isDisabled(card),
        'opacity-70 cursor-not-allowed': isComingSoon(card) && !isDisabled(card),
        'cursor-pointer': isClickable(card),
      }"
      :data-test="`alert-type-picker-${layout}-card-${card.type}`"
      @click="onSelect(card)"
    >
      <OTag
        v-if="isComingSoon(card) && !isDisabled(card)"
        variant="primary-soft"
        size="xs"
        class="absolute top-2 right-2 z-10"
        data-test="alert-type-picker-coming-soon-badge"
      >
        {{ t("alerts.newAlert.comingSoon") }}
      </OTag>
      <EmptyStateActionCard
        :icon="card.icon"
        :label="t(card.labelKey)"
        :sublabel="t(card.descKey)"
        :hide-chevron="variant === 'inline'"
        class="w-full max-w-full"
        :class="{ 'pointer-events-none': !isClickable(card) }"
      />
    </div>
  </div>
</template>
