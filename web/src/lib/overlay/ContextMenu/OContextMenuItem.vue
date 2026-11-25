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
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { MENU_ROW_CLASS, MENU_ROW_SELECTED_CLASS, MENU_ROW_VARIANT_CLASS } from "../menuClasses";

const props = withDefaults(defineProps<ContextMenuItemProps>(), {
  disabled: false,
  focusableUnavailable: false,
  variant: "default",
  selected: undefined,
});

const emit = defineEmits<ContextMenuItemEmits>();

defineSlots<ContextMenuItemSlots>();

const isDisabled = useLockedDisabled(() => props.disabled);
const unavailable = computed(() => isDisabled.value && props.focusableUnavailable);
const reasonId = `${useId()}-reason`;

// Binding `role: undefined` would erase reka's own `menuitem` role, so plain rows get no keys at all.
const choiceAttrs = computed(() =>
  props.selected === undefined ? {} : { role: "menuitemradio", "aria-checked": props.selected },
);

const stateClass = computed(() =>
  props.selected && props.variant === "default"
    ? MENU_ROW_SELECTED_CLASS
    : MENU_ROW_VARIANT_CLASS[props.variant],
);

function blockActivation(event: Event) {
  if (!unavailable.value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") blockActivation(event);
}

function onSelect(event: Event) {
  if (isDisabled.value) {
    event.preventDefault();
    return;
  }
  emit("select", event);
}
</script>

<template>
  <ContextMenuItem
    :disabled="isDisabled && !focusableUnavailable"
    as-child
    :text-value="textValue"
    v-bind="choiceAttrs"
    :class="[
      MENU_ROW_CLASS,
      unavailable
        ? 'text-dropdown-item-disabled focus-visible:ring-focus-ring-accent cursor-not-allowed focus-visible:ring-2 focus-visible:ring-inset'
        : stateClass,
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
    ]"
    @click.capture="blockActivation"
    @keydown.capture="onKeydown"
    @select="onSelect"
  >
    <div
      :aria-disabled="isDisabled || undefined"
      :aria-describedby="unavailable && description ? reasonId : undefined"
    >
      <slot name="icon-left">
        <OIcon
          v-if="props.iconLeft"
          :name="props.iconLeft"
          size="sm"
          class="text-text-secondary shrink-0"
        />
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
      <OIcon
        v-if="selected"
        name="check"
        size="sm"
        data-test="o-context-menu-item-check"
        :class="['shrink-0', !(props.shortcut || props.shortcutId) && 'ms-auto']"
      />
    </div>
  </ContextMenuItem>
</template>
