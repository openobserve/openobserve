<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// The "+N" chip's tooltip is the only place the hidden people are named.

import { computed } from "vue";

import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import OAvatar from "./OAvatar.vue";
import type { AvatarGroupProps } from "./OAvatar.types";

const props = withDefaults(defineProps<AvatarGroupProps>(), { max: 3, size: "md" });

const shown = computed(() => props.people.slice(0, props.max));
const hidden = computed(() => props.people.slice(props.max));

/** The chip matches the faces' diameter, so the row reads as one stack. */
const CHIP_SIZES: Record<NonNullable<AvatarGroupProps["size"]>, string> = {
  sm: "h-5 min-w-5 text-3xs -ms-0.5",
  md: "h-6 min-w-6 text-2xs -ms-0.5",
  lg: "h-8 min-w-8 text-xs -ms-1",
};
// The overlap stays under the initials' side margin, so a neighbour never clips a letter.
const OVERLAP: Record<NonNullable<AvatarGroupProps["size"]>, string> = {
  sm: "-ms-0.5",
  md: "-ms-0.5",
  lg: "-ms-1",
};
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
    <span
      v-if="hidden.length"
      :class="[
        'bg-surface-subtle text-text-secondary ring-surface-base inline-flex items-center justify-center rounded-full px-1 font-medium ring-2',
        CHIP_SIZES[props.size],
      ]"
      data-test="o-avatar-group-more"
      >{{ raw(`+${hidden.length}`)
      }}<OTooltip side="bottom">
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
      </OTooltip></span
    >
  </span>
</template>
