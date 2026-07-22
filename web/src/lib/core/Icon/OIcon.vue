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
const imgSrc = computed<string>(() => (props.name?.startsWith("img:") ? props.name.slice(4) : ""));

const iconComponent = computed(() => iconRegistry[props.name as keyof typeof iconRegistry]);

// Maps semantic size tokens to Tailwind size utilities (width + height).
// md = 24px matches the default OIcon rendering size.
const sizeClasses: Record<NonNullable<IconProps["size"]>, string> = {
  xs: "size-3", // 12px
  sm: "size-4", // 16px
  md: "size-6", // 24px
  lg: "size-8", // 32px
  xl: "size-10", // 40px
};

/** Project rule: every bin/delete icon renders in the destructive (red) color
 *  by default. The OIcon itself owns this so we don't have to thread a class
 *  through every consumer (`<OIcon name="delete" />` etc. — there are ~30+
 *  sites across the codebase). Consumers can still override by passing
 *  `class="text-..."` since custom class wins via attribute-fallthrough. */
const isDestructiveIcon = computed<boolean>(() =>
  Boolean(
    props.name &&
    (props.name === "delete" ||
      props.name === "delete-outline" ||
      props.name === "delete-forever" ||
      props.name === "delete-sweep" ||
      props.name === "bin-line" ||
      props.name === "bin-fill"),
  ),
);
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center justify-center align-middle"
    :class="[
      sizeClasses[size],
      isDestructiveIcon
        ? 'text-error-500 rounded-default transition-colors hover:bg-error-100'
        : '',
    ]"
    :data-destructive-icon="isDestructiveIcon ? 'true' : undefined"
    v-bind="label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }"
  >
    <!-- img: prefix → external image -->
    <img v-if="isImgIcon" :src="imgSrc" :alt="label || ''" class="size-full object-contain" />
    <!-- Registry icon (Material Symbols, regular weight — the main-branch look). -->
    <component v-else-if="iconComponent" :is="iconComponent" class="size-full" />
    <slot />
  </span>
</template>
