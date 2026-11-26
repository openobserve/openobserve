<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type {
  ListboxOptionEmits,
  ListboxOptionProps,
  ListboxOptionSlots,
} from "./OListboxOption.types";

const props = withDefaults(defineProps<ListboxOptionProps>(), {
  href: undefined,
  highlighted: false,
  disabled: false,
  icon: undefined,
});
const emit = defineEmits<ListboxOptionEmits>();
const slots = defineSlots<ListboxOptionSlots>();

// Focus never lands on a row: the owning field moves the highlight and names it via aria-activedescendant.
const link = computed(() => !!props.href && !props.disabled);

function onClick(event: MouseEvent) {
  if (props.disabled) {
    event.preventDefault();
    return;
  }
  emit("select", event);
}
</script>

<template>
  <component
    :is="link ? 'a' : 'div'"
    :href="link ? href : undefined"
    role="option"
    tabindex="-1"
    :aria-selected="highlighted"
    :aria-disabled="disabled || undefined"
    :data-highlighted="highlighted || undefined"
    class="rounded-default flex h-8 min-w-0 shrink-0 items-center gap-2 px-2 text-sm no-underline outline-none select-none"
    :class="[
      disabled ? 'text-dropdown-item-disabled cursor-not-allowed' : 'cursor-pointer',
      highlighted
        ? 'bg-dropdown-item-hover-bg text-text-heading'
        : disabled
          ? ''
          : 'text-dropdown-item-text',
    ]"
    data-test="o-listbox-option"
    @click="onClick"
  >
    <OIcon
      v-if="icon"
      :name="icon"
      size="sm"
      class="shrink-0"
      :class="highlighted ? 'text-text-heading' : 'text-text-secondary'"
    />
    <OTruncatedText class="min-w-0 flex-1" data-test="o-listbox-option-label"
      ><slot
    /></OTruncatedText>
    <OTruncatedText
      v-if="slots.meta"
      class="max-w-2/5 shrink text-xs"
      :class="highlighted ? 'text-text-body' : 'text-text-secondary'"
      data-test="o-listbox-option-meta"
      ><slot name="meta"
    /></OTruncatedText>
    <span v-if="slots.trailing" class="flex shrink-0 items-center gap-1">
      <slot name="trailing" />
    </span>
  </component>
</template>
