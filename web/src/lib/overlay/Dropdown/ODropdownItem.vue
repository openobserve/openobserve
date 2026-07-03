<script setup lang="ts">
import type {
  DropdownItemProps,
  DropdownItemEmits,
  DropdownItemSlots,
} from "./ODropdown.types";
import { DropdownMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";
import OShortcut from "../../core/Shortcut/OShortcut.vue";

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
    "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled"
    :text-value="textValue"
    :class="[
      'relative flex items-center gap-2',
      'w-full px-3 py-1.5 rounded-md',
      'cursor-pointer select-none outline-none',
      'transition-colors duration-150',
      variantClasses[variant],
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
    ]"
    @select="(e) => emit('select', e)"
  >
    <slot name="icon-left">
      <OIcon v-if="props.iconLeft" :name="props.iconLeft" size="sm" />
    </slot>
    <slot />
    <slot name="icon-right" />
    <OShortcut
      v-if="props.shortcut || props.shortcutId"
      :keys="props.shortcut"
      :id="props.shortcutId"
      class="ms-auto ps-4"
    />
  </DropdownMenuItem>
</template>
