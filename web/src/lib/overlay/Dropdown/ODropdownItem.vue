<script setup lang="ts">
import type { DropdownItemProps, DropdownItemEmits, DropdownItemSlots } from "./ODropdown.types";
import { computed, useAttrs, useId } from "vue";
import { DropdownMenuItem } from "reka-ui";
import OMenuItemContent from "@/lib/overlay/shared/OMenuItemContent.vue";
import { menuItemClasses } from "@/lib/overlay/shared/menuItem";
import { useLockedDisabled } from "@/composables/useFeatureLock";

const props = withDefaults(defineProps<DropdownItemProps>(), {
  as: "div",
  disabled: false,
  tone: "default",
  checked: undefined,
});

const emit = defineEmits<DropdownItemEmits>();

defineSlots<DropdownItemSlots>();

const attrs = useAttrs();
const id = useId();
const isDisabled = useLockedDisabled(() => props.disabled);
// A disabled item that says why stays in the keyboard order, so the reason can be read.
const unavailable = computed(() => isDisabled.value && !!props.disabledReason);
const note = computed(() => (isDisabled.value ? props.disabledReason : null) || props.description);
const noteId = computed(() => `${attrs["data-test"] ?? id}-reason`);
// Only a single-choice item overrides the role; an undefined one would wipe reka's `menuitem` through as-child.
const choiceAttrs = computed(() =>
  props.checked === undefined ? {} : { role: "menuitemradio", "aria-checked": props.checked },
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
  <DropdownMenuItem
    :disabled="isDisabled && !unavailable"
    as-child
    :aria-describedby="note ? noteId : undefined"
    :text-value="textValue"
    :class="menuItemClasses(tone, unavailable, !!note)"
    @click.capture="blockActivation"
    @keydown.capture="onKeydown"
    @select="onSelect"
  >
    <component
      :is="as"
      :type="as === 'button' ? 'button' : undefined"
      :aria-disabled="isDisabled || undefined"
      v-bind="choiceAttrs"
    >
      <OMenuItemContent
        :icon="icon"
        :tone="tone"
        :checked="checked"
        :shortcut="shortcut"
        :keys="keys"
        :note="note"
        :note-id="noteId"
        :muted="unavailable"
      >
        <template v-if="$slots.icon" #icon><slot name="icon" /></template>
        <slot />
        <template v-if="$slots.end" #end><slot name="end" /></template>
      </OMenuItemContent>
    </component>
  </DropdownMenuItem>
</template>
