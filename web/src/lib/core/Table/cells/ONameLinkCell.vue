<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from "vue-router";

defineProps<{
  /** A route to open, or a callback; undefined renders plain text for a row that cannot be opened. */
  to?: RouteLocationRaw | (() => void);
}>();

// `data-o2-cell-clip` lets the table's cut-off tooltip measure the link, which truncates on its own.
const LINK_CLASS =
  "text-text-link hover:text-text-link-hover focus-visible:ring-focus-ring-accent rounded-default inline-block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 align-middle font-medium no-underline outline-none hover:underline focus-visible:underline focus-visible:ring-2";
</script>

<template>
  <button
    v-if="typeof to === 'function'"
    type="button"
    :class="LINK_CLASS"
    data-o2-cell-clip
    @click.stop="to()"
  >
    <slot />
  </button>
  <RouterLink v-else-if="to" :to="to" :class="LINK_CLASS" data-o2-cell-clip @click.stop>
    <slot />
  </RouterLink>
  <span v-else><slot /></span>
</template>
