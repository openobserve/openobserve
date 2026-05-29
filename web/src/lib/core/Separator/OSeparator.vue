<script setup lang="ts">
import type { OSeparatorProps } from "./OSeparator.types";
import { Separator } from "reka-ui";

const props = withDefaults(defineProps<OSeparatorProps>(), {
  vertical: false,
});
</script>

<template>
  <Separator
    :orientation="vertical ? 'vertical' : 'horizontal'"
    :class="
      vertical
        ? 'tw:block tw:self-stretch tw:w-separator tw:min-h-0 tw:border-0 tw:bg-separator'
        : 'tw:block tw:w-full tw:h-separator tw:border-0 tw:bg-separator'
    "
  />
</template>
