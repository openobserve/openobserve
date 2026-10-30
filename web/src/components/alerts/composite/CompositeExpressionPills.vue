<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import { raw } from "@/types/i18n";
import { type CompositeChildOption, letterFor, tokenizeExpression } from "./expression";

const props = defineProps<{
  expression: string;
  children: CompositeChildOption[];
}>();

const tokens = computed(() => tokenizeExpression(props.expression));
const childById = computed(() => new Map(props.children.map((c) => [c.alert_id, c])));
const letterById = computed(
  () => new Map(props.children.map((c, index) => [c.alert_id, letterFor(index)])),
);

const levelFor = (id: string): string => {
  const child = childById.value.get(id);
  return child?.accessible && child.level ? child.level : "nodata";
};
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5 font-mono">
    <template v-for="(token, index) in tokens" :key="index">
      <OTag
        v-if="token.kind === 'operand'"
        type="alertLevel"
        :value="levelFor(token.id)"
        :label="raw(letterById.get(token.id) ?? '?')"
        size="sm"
      />
      <span v-else class="text-text-secondary font-semibold">{{ raw(token.text) }}</span>
    </template>
  </span>
</template>
