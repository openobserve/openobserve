<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { RadioGroupItem, RadioGroupRoot, type AcceptableValue } from "reka-ui";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ChoiceCardsEmits, ChoiceCardsProps } from "./OChoiceCards.types";

withDefaults(defineProps<ChoiceCardsProps>(), { disabled: false, modelValue: undefined });

const emit = defineEmits<ChoiceCardsEmits>();

const onUpdate = (value: AcceptableValue) => emit("update:modelValue", String(value));
</script>

<template>
  <RadioGroupRoot
    :model-value="modelValue"
    :disabled="disabled"
    :aria-label="label"
    class="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2"
    @update:model-value="onUpdate"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :disabled="option.disabled"
      :data-test="option.dataTest"
      class="group border-border-default rounded-default hover:bg-surface-subtle data-[state=checked]:border-accent data-[state=checked]:ring-accent focus-visible:ring-accent/40 flex cursor-pointer items-start gap-2 border p-3 text-start focus-visible:ring-2 focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[state=checked]:ring-1"
    >
      <OIcon
        v-if="option.icon"
        :name="option.icon"
        size="sm"
        class="text-text-secondary group-data-[state=checked]:text-accent mt-0.5 shrink-0"
      />
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="text-text-heading text-sm font-medium">{{ option.label }}</span>
        <span v-if="option.description" class="text-text-secondary text-xs">
          {{ option.description }}
        </span>
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
