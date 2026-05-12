<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { PageProps, PageSlots } from "./OPage.types";
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
    class="oo-page"
    data-o2-page
  >
    <slot />
  </Primitive>
</template>
