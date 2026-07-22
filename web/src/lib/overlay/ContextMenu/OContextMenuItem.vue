<script setup lang="ts">
import type {
  ContextMenuItemProps,
  ContextMenuItemEmits,
  ContextMenuItemSlots,
} from "./OContextMenuItem.types";
import { ContextMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";
import OShortcut from "../../core/Shortcut/OShortcut.vue";

const props = withDefaults(defineProps<ContextMenuItemProps>(), {
  disabled: false,
  variant: "default",
});

const emit = defineEmits<ContextMenuItemEmits>();

defineSlots<ContextMenuItemSlots>();

const variantClasses: Record<
  NonNullable<ContextMenuItemProps["variant"]>,
  string
> = {
  default:
    "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};
</script>

<template>
  <ContextMenuItem
    :disabled="disabled"
    :text-value="textValue"
    :class="[
      'relative flex items-center gap-2',
      'w-full px-3 py-1.5 rounded-default',
      'cursor-pointer select-none outline-none',
      'transition-colors duration-150',
      variantClasses[variant],
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
    ]"
    @select="(e: Event) => emit('select', e)"
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
  </ContextMenuItem>
</template>
