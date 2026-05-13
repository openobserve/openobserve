<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { PageContainerProps, PageContainerSlots } from "./OPageContainer.types";
import { Primitive } from "reka-ui";
/**
 * Page container component. Provides Quasar-compatible _q_pc_ injection for child
 * Quasar components (q-page, q-dialog) to detect they are inside a page container.
 */
import { provide } from "vue";

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<PageContainerProps>(), {
  as: "div",
});

defineSlots<PageContainerSlots>();

// Provide Quasar-compatible injection so child Quasar components
// (e.g., q-page, q-dialog) continue to work during the transition.
provide("_q_pc_", true);
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
