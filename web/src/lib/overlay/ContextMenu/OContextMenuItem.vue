<script setup lang="ts">
import type {
  ContextMenuItemProps,
  ContextMenuItemEmits,
  ContextMenuItemSlots,
} from "./OContextMenuItem.types";
import { computed, useId } from "vue";
import { ContextMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";
import OShortcut from "../../core/Shortcut/OShortcut.vue";

const props = withDefaults(defineProps<ContextMenuItemProps>(), {
  disabled: false,
  focusableUnavailable: false,
  variant: "default",
});

const emit = defineEmits<ContextMenuItemEmits>();

defineSlots<ContextMenuItemSlots>();

const unavailable = computed(() => props.disabled && props.focusableUnavailable);
const reasonId = `${useId()}-reason`;

const variantClasses: Record<NonNullable<ContextMenuItemProps["variant"]>, string> = {
  default: "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};

function blockActivation(event: Event) {
  if (!unavailable.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") blockActivation(event);
}

function onSelect(event: Event) {
  if (props.disabled) {
    event.preventDefault();
    return;
  }
  emit("select", event);
}
</script>

<template>
  <ContextMenuItem
    :disabled="disabled && !focusableUnavailable"
    as-child
    :text-value="textValue"
    :class="[
      'relative flex items-center gap-2',
      'rounded-default w-full px-3 py-1.5',
      'cursor-pointer outline-none select-none',
      'transition-colors duration-150',
      unavailable
        ? 'text-dropdown-item-disabled focus-visible:ring-focus-ring-accent cursor-not-allowed focus-visible:ring-2 focus-visible:ring-inset'
        : variantClasses[variant],
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
    ]"
    @click.capture="blockActivation"
    @keydown.capture="onKeydown"
    @select="onSelect"
  >
    <div
      :aria-disabled="disabled || undefined"
      :aria-describedby="unavailable && description ? reasonId : undefined"
    >
      <slot name="icon-left">
        <OIcon v-if="props.iconLeft" :name="props.iconLeft" size="sm" />
      </slot>
      <slot />
      <span v-if="unavailable && description" :id="reasonId" class="sr-only" aria-hidden="true">{{
        description
      }}</span>
      <slot name="icon-right" />
      <OShortcut
        v-if="props.shortcut || props.shortcutId"
        :keys="props.shortcut"
        :id="props.shortcutId"
        class="ms-auto ps-4"
      />
    </div>
  </ContextMenuItem>
</template>
