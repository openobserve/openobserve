<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { PageProps, PageSlots } from "./OPage.types";
/**
 * Page wrapper component. Renders a Primitive element with the .oo-page class and
 * rounded-md corners for consistent page-level styling across the application.
 */
import { Primitive } from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<PageProps>(), {
  as: "div",
});

defineSlots<PageSlots>();
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    v-bind="$attrs"
    class="oo-page tw:rounded-md"
    data-o2-page
  >
    <slot />
  </Primitive>
</template>
