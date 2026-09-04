<script setup lang="ts">
import type { OSeparatorProps } from "./OSeparator.types";
import { Separator } from "reka-ui";

withDefaults(defineProps<OSeparatorProps>(), {
  vertical: false,
});
</script>

<template>
  <Separator
    :orientation="vertical ? 'vertical' : 'horizontal'"
    :class="
      vertical
        ? 'w-separator bg-separator block min-h-0 self-stretch border-0'
        : 'h-separator bg-separator block w-full border-0'
    "
  />
</template>
