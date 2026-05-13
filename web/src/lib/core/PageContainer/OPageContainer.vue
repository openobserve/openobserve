<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { PageContainerProps, PageContainerSlots } from "./OPageContainer.types";
import { Primitive } from "reka-ui";

/**
 * Page container component. Wraps page content using a renderless Reka UI
 * Primitive, forwarding attributes and rendering a default slot.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<PageContainerProps>(), {
  as: "div",
});

defineSlots<PageContainerSlots>();
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    v-bind="$attrs"
    data-o2-page-container
  >
    <slot />
  </Primitive>
</template>
