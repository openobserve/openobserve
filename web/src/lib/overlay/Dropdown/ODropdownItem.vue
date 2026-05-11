<script setup lang="ts">
import type {
  DropdownItemProps,
  DropdownItemEmits,
  DropdownItemSlots,
} from "./ODropdown.types";
import { DropdownMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";

const props = withDefaults(defineProps<DropdownItemProps>(), {
  disabled: false,
  variant: "default",
});

const emit = defineEmits<DropdownItemEmits>();

defineSlots<DropdownItemSlots>();

const variantClasses: Record<
  NonNullable<DropdownItemProps["variant"]>,
  string
> = {
  default:
    "tw:text-dropdown-item-text tw:data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "tw:text-dropdown-item-destructive-text tw:data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    :text-value="textValue"
    :class="[
      'tw:relative tw:flex tw:items-center tw:gap-2',
      'tw:w-full tw:px-3 tw:py-1.5 tw:rounded-md',
      'tw:cursor-pointer tw:select-none tw:outline-none',
      variantClasses[variant],
      'tw:data-[disabled]:text-dropdown-item-disabled tw:data-[disabled]:cursor-not-allowed tw:data-[disabled]:pointer-events-none',
    ]"
    @select="(e) => emit('select', e)"
  >
    <slot name="icon-left">
      <OIcon v-if="props.iconLeft" :name="props.iconLeft" size="sm" />
    </slot>
    <slot />
    <slot name="icon-right" />
  </DropdownMenuItem>
</template>
