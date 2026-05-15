<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { LayoutProps, LayoutSlots } from "./OLayout.types";
import { Primitive } from "reka-ui";

/**
 * Root layout component. Wraps the application shell using a renderless
 * Reka UI Primitive, forwarding attributes and rendering a default slot.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<LayoutProps>(), {
  as: "div",
});

defineSlots<LayoutSlots>();
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    v-bind="$attrs"
    data-o2-layout
  >
    <slot />
  </Primitive>
</template>
