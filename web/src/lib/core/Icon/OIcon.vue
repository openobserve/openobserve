<script setup lang="ts">
import type { IconProps, IconSlots } from "./OIcon.types";
import { computed } from "vue";
import { iconRegistry } from "./OIcon.icons";

const props = withDefaults(defineProps<IconProps>(), {
  size: "md",
});

defineSlots<IconSlots>();

/** True when the icon prop uses the `img:` prefix (renders as <img>) */
const isImgIcon = computed<boolean>(() => Boolean(props.name?.startsWith("img:")));

/** The src path stripped of the `img:` prefix */
const imgSrc = computed<string>(() =>
  props.name?.startsWith("img:") ? props.name.slice(4) : "",
);

const iconComponent = computed(() => iconRegistry[props.name as keyof typeof iconRegistry]);

// Maps semantic size tokens to Tailwind size utilities (width + height).
// md = 24px matches the default OIcon rendering size.
const sizeClasses: Record<NonNullable<IconProps["size"]>, string> = {
  xs: "tw:size-3",   // 12px
  sm: "tw:size-4",   // 16px
  md: "tw:size-6",   // 24px
  lg: "tw:size-8",   // 32px
  xl: "tw:size-10",  // 40px
};
</script>

<template>
  <span
    class="tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:align-middle"
    :class="sizeClasses[size]"
    v-bind="
      label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': 'true' }
    "
  >
    <!-- img: prefix → external image (Quasar-compat) -->
    <img
      v-if="isImgIcon"
      :src="imgSrc"
      :alt="label || ''"
      class="tw:size-full tw:object-contain"
    />
    <!-- Registry icon -->
    <component v-else-if="iconComponent" :is="iconComponent" class="tw:size-full" />
    <slot />
  </span>
</template>
