<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { LayoutProps, LayoutSlots } from "./OLayout.types";
import { Primitive } from "reka-ui";
/**
 * Root layout component. Provides Quasar-compatible layout injections (_q_pc_, _q_l_)
 * so legacy Quasar child components continue to function during the transition.
 */
import { provide } from "vue";

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<LayoutProps>(), {
  as: "div",
});

defineSlots<LayoutSlots>();

// Provide Quasar-compatible layout injections so child Quasar components
// (q-dialog, q-page, etc.) continue to function during the transition.
provide("_q_pc_", false);
provide("_q_l_", {
  header: { size: 0, offset: 0, space: false },
  right: { size: 0, offset: 0, space: false },
  footer: { size: 0, offset: 0, space: false },
  left: { size: 0, offset: 0, space: false },
  isContainer: true,
});
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
