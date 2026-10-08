<script setup lang="ts">
import type { DropdownItemProps, DropdownItemEmits, DropdownItemSlots } from "./ODropdown.types";
import { computed, useAttrs, useId } from "vue";
import OText from "../../core/Typography/OText.vue";
import { DropdownMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";
import OShortcut from "../../core/Shortcut/OShortcut.vue";

const props = withDefaults(defineProps<DropdownItemProps>(), {
  as: "div",
  disabled: false,
  focusableUnavailable: false,
  variant: "default",
});

const emit = defineEmits<DropdownItemEmits>();

defineSlots<DropdownItemSlots>();

const attrs = useAttrs();
const id = useId();
const unavailable = computed(() => props.disabled && props.focusableUnavailable);
const reasonId = computed(() => props.descriptionId ?? `${attrs["data-test"] ?? id}-reason`);

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

const variantClasses: Record<NonNullable<DropdownItemProps["variant"]>, string> = {
  default: "text-dropdown-item-text data-[highlighted]:bg-dropdown-item-hover-bg",
  destructive:
    "text-dropdown-item-destructive-text data-[highlighted]:bg-dropdown-item-destructive-hover-bg",
};
</script>

<template>
  <DropdownMenuItem
    :disabled="disabled && !focusableUnavailable"
    as-child
    :aria-describedby="description ? reasonId : undefined"
    :text-value="textValue"
    :class="[
      'relative flex items-center gap-2',
      'rounded-default w-full px-3 py-1.5',
      'cursor-pointer outline-none select-none',
      'transition-colors duration-150',
      variantClasses[variant],
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
      unavailable &&
        'group/unavailable text-text-secondary! data-[highlighted]:text-text-heading! focus-visible:ring-focus-ring-accent cursor-not-allowed focus-visible:ring-2 focus-visible:ring-inset',
    ]"
    @click.capture="blockActivation"
    @keydown.capture="onKeydown"
    @select="onSelect"
  >
    <component
      :is="as"
      :type="as === 'button' ? 'button' : undefined"
      :aria-disabled="disabled || undefined"
    >
      <slot name="icon-left">
        <OIcon v-if="props.iconLeft" :name="props.iconLeft" size="sm" />
      </slot>
      <span v-if="description" class="flex min-w-0 flex-1 flex-col gap-1">
        <span><slot /></span>
        <OText
          :id="reasonId"
          :data-test="reasonId"
          as="span"
          variant="meta"
          class="text-text-secondary! leading-snug! whitespace-normal"
          :class="unavailable && 'group-data-[highlighted]/unavailable:text-text-heading!'"
          >{{ description }}</OText
        >
      </span>
      <slot v-else />
      <slot name="icon-right" />
      <OShortcut
        v-if="props.shortcut || props.shortcutId"
        :keys="props.shortcut"
        :id="props.shortcutId"
        class="ms-auto ps-4"
      />
    </component>
  </DropdownMenuItem>
</template>
