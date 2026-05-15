<script setup lang="ts">
import type { OSeparatorProps } from "./OSeparator.types";
import { Separator } from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<OSeparatorProps>(), {
  vertical: false,
  inset: false,
  spaced: false,
  strong: false,
});

const classes = computed(() =>
  [
    props.vertical
      ? "tw:block tw:self-stretch tw:w-separator tw:min-h-0"
      : "tw:block tw:w-full tw:h-separator",
    "tw:border-0",
    props.strong ? "tw:bg-separator-strong" : "tw:bg-separator",
    props.inset ? (props.vertical ? "tw:my-2" : "tw:mx-4") : "",
    props.spaced ? (props.vertical ? "tw:mx-2" : "tw:my-2") : "",
  ].filter(Boolean),
);
</script>

<template>
  <Separator
    :orientation="vertical ? 'vertical' : 'horizontal'"
    :class="classes"
  />
</template>
