<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// The "+N" chip's tooltip is the only place the hidden people are named.

import { computed } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeSize } from "@/lib/core/Badge/OBadge.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";

import OAvatar from "./OAvatar.vue";
import type { AvatarGroupPerson, AvatarGroupProps } from "./OAvatar.types";

const props = withDefaults(defineProps<AvatarGroupProps>(), { max: 3, size: "md" });

const shown = computed(() => props.people.slice(0, props.max));
const hidden = computed(() => props.people.slice(props.max));

const CHIP_SIZES: Record<NonNullable<AvatarGroupProps["size"]>, string> = {
  sm: "h-5 min-w-5 justify-center",
  md: "h-6 min-w-6 justify-center",
  lg: "h-8 min-w-8 justify-center",
};
const CHIP_BADGE_SIZE: Record<NonNullable<AvatarGroupProps["size"]>, BadgeSize> = {
  sm: "xs",
  md: "xs",
  lg: "sm",
};
const OVERLAP: Record<NonNullable<AvatarGroupProps["size"]>, string> = {
  sm: "-ms-0.5",
  md: "-ms-0.5",
  lg: "-ms-1",
};

const { t } = useI18nTyped();

const label = (person: AvatarGroupPerson) => {
  const name = person.name?.trim();
  return name && name !== person.value
    ? t("common.personWithEmail", { name, email: person.value })
    : person.value;
};
// The tooltip is hover- and focus-only, so a screen reader is handed the same names as the chip's name.
const hiddenLabel = computed(() =>
  raw(`+${hidden.value.length}: ${hidden.value.map(label).join(", ")}`),
);
</script>

<template>
  <span class="inline-flex items-center" data-test="o-avatar-group">
    <OAvatar
      v-for="(person, index) in shown"
      :key="person.value"
      :value="person.value"
      :name="person.name"
      :size="props.size"
      :class="['ring-surface-base ring-2', index > 0 ? OVERLAP[props.size] : '']"
    />
    <OBadge
      v-if="hidden.length"
      variant="default-soft"
      :size="CHIP_BADGE_SIZE[props.size]"
      shape="pill"
      :class="[CHIP_SIZES[props.size], OVERLAP[props.size]]"
      tabindex="0"
      :aria-label="hiddenLabel"
      data-test="o-avatar-group-more"
    >
      {{ raw(`+${hidden.length}`) }}
      <OTooltip side="bottom">
        <template #content>
          <span class="flex flex-col gap-1.5">
            <span v-for="person in hidden" :key="person.value" class="flex flex-col">
              <span>{{ raw(person.name?.trim() || person.value) }}</span>
              <span
                v-if="person.name?.trim() && person.name.trim() !== person.value"
                class="text-text-secondary font-normal"
                >{{ raw(person.value) }}</span
              >
            </span>
          </span>
        </template>
      </OTooltip>
    </OBadge>
  </span>
</template>
