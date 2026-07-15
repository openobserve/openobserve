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
        ? 'block self-stretch w-separator min-h-0 border-0 bg-separator'
        : 'block w-full h-separator border-0 bg-separator'
    "
  />
</template>
