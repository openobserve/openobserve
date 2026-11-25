<script setup lang="ts">
import type { DropdownItemProps, DropdownItemEmits, DropdownItemSlots } from "./ODropdown.types";
import { computed, useAttrs, useId } from "vue";
import OText from "../../core/Typography/OText.vue";
import { DropdownMenuItem } from "reka-ui";
import OIcon from "../../core/Icon/OIcon.vue";
import OShortcut from "../../core/Shortcut/OShortcut.vue";
import { useLockedDisabled } from "@/composables/useFeatureLock";
import { MENU_ROW_CLASS, MENU_ROW_SELECTED_CLASS, MENU_ROW_VARIANT_CLASS } from "../menuClasses";

const props = withDefaults(defineProps<DropdownItemProps>(), {
  as: "div",
  disabled: false,
  focusableUnavailable: false,
  variant: "default",
  selected: undefined,
});

const emit = defineEmits<DropdownItemEmits>();

defineSlots<DropdownItemSlots>();

const attrs = useAttrs();
const id = useId();
const isDisabled = useLockedDisabled(() => props.disabled);
const unavailable = computed(() => isDisabled.value && props.focusableUnavailable);
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
  if (isDisabled.value) {
    event.preventDefault();
    return;
  }
  emit("select", event);
}

// Binding `role: undefined` would erase reka's own `menuitem` role, so plain rows get no keys at all.
const choiceAttrs = computed(() =>
  props.selected === undefined ? {} : { role: "menuitemradio", "aria-checked": props.selected },
);

const stateClass = computed(() =>
  props.selected && props.variant === "default"
    ? MENU_ROW_SELECTED_CLASS
    : MENU_ROW_VARIANT_CLASS[props.variant],
);
</script>

<template>
  <DropdownMenuItem
    :disabled="isDisabled && !focusableUnavailable"
    as-child
    :aria-describedby="description ? reasonId : undefined"
    :text-value="textValue"
    v-bind="choiceAttrs"
    :class="[
      'group/item',
      MENU_ROW_CLASS,
      stateClass,
      'data-[disabled]:text-dropdown-item-disabled data-[disabled]:cursor-not-allowed',
      unavailable &&
        'text-text-secondary! data-[highlighted]:text-text-heading! focus-visible:ring-focus-ring-accent cursor-not-allowed focus-visible:ring-2 focus-visible:ring-inset',
    ]"
    @click.capture="blockActivation"
    @keydown.capture="onKeydown"
    @select="onSelect"
  >
    <component
      :is="as"
      :type="as === 'button' ? 'button' : undefined"
      :aria-disabled="isDisabled || undefined"
    >
      <slot name="icon-left">
        <OIcon
          v-if="props.iconLeft"
          :name="props.iconLeft"
          size="sm"
          :class="['text-text-secondary shrink-0', props.iconLeft === 'lock' && 'lock-chip']"
        />
      </slot>
      <span v-if="description" class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span><slot /></span>
        <OText
          :id="reasonId"
          aria-hidden="true"
          :data-test="reasonId"
          as="span"
          variant="meta"
          class="text-text-secondary! group-data-[highlighted]/item:text-text-heading! leading-snug! whitespace-normal"
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
      <OIcon
        v-if="selected"
        name="check"
        size="sm"
        data-test="o-dropdown-item-check"
        :class="['shrink-0', !(props.shortcut || props.shortcutId) && 'ms-auto']"
      />
    </component>
  </DropdownMenuItem>
</template>
