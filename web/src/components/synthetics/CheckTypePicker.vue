<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { CHECK_TYPE_CARDS, type CheckTypeCard } from "@/constants/synthetics";
import type { SyntheticCheckType } from "@/types/synthetics";

const props = withDefaults(
  defineProps<{
    variant: "modal" | "inline";
    layout: "row" | "grid";
    disabledTypes?: SyntheticCheckType[];
    comingSoonTypes?: SyntheticCheckType[];
  }>(),
  {
    disabledTypes: () => [],
    comingSoonTypes: () => [],
  },
);

const emit = defineEmits<{
  select: [type: SyntheticCheckType];
}>();

const { t } = useI18n();

function isDisabled(card: CheckTypeCard): boolean {
  return props.disabledTypes.includes(card.type);
}

function isComingSoon(card: CheckTypeCard): boolean {
  return props.comingSoonTypes.includes(card.type);
}

function isClickable(card: CheckTypeCard): boolean {
  return !isDisabled(card) && !isComingSoon(card);
}

function onSelect(card: CheckTypeCard) {
  if (isClickable(card)) {
    emit("select", card.type);
  }
}
</script>

<template>
  <div
    :class="layout === 'grid' ? 'flex flex-wrap justify-center gap-4' : 'flex flex-col gap-2'"
    :data-test="`check-type-picker-${layout}`"
  >
    <div
      v-for="card in CHECK_TYPE_CARDS"
      :key="card.type"
      class="relative"
      :class="{
        'cursor-not-allowed opacity-50': isDisabled(card),
        'cursor-not-allowed opacity-70': isComingSoon(card) && !isDisabled(card),
        'cursor-pointer': isClickable(card),
      }"
      :data-test="`check-type-picker-${layout}-card-${card.type}`"
      @click="onSelect(card)"
    >
      <OTag
        v-if="isComingSoon(card) && !isDisabled(card)"
        variant="primary-soft"
        size="xs"
        class="absolute top-2 right-2 z-10"
        data-test="check-type-picker-coming-soon-badge"
      >
        Coming Soon
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
