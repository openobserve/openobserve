<script lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// Recursive renderer for one node of the composite expression tree: a group
// (joiner pills + bracketed nesting + add button) or, via its children, term
// pills. Mutations go through the injected CompositeExprApi by path.
import { defineComponent, inject } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ExprNode as ExprNodeType } from "@/utils/alerts/compositeExpressionAst";
import { COMPOSITE_EXPR_API, type CompositeExprApi } from "./compositeExprApi";

export default defineComponent({
  name: "ExprNode",
  components: { OIcon },
  props: {
    node: { type: Object as () => ExprNodeType, required: true },
    path: { type: Array as () => number[], required: true },
    depth: { type: Number, default: 0 },
  },
  setup() {
    const { t } = useI18n();
    const api = inject(COMPOSITE_EXPR_API) as CompositeExprApi;
    return { t, api };
  },
});
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 flex-wrap"
    :class="depth ? 'rounded-default border border-border-default px-1.5 py-1 bg-surface-subtle' : ''"
  >
    <span v-if="depth" class="font-mono text-text-secondary select-none">(</span>

    <template v-for="(child, i) in (node.type === 'group' ? node.children : [])" :key="i">
      <!-- Joiner between siblings — click to toggle AND ⇄ OR. -->
      <button
        v-if="i"
        type="button"
        class="rounded-default border border-border-default px-1.5 py-0.5 text-2xs font-mono font-semibold text-text-secondary hover:bg-hover-gray cursor-pointer"
        :title="t('alerts.composite.toggleJoiner')"
        data-test="composite-expr-joiner"
        @click="api.toggleOp(path)"
      >{{ node.type === 'group' ? node.op : '' }}</button>

      <!-- Term pill -->
      <span
        v-if="child.type === 'term'"
        class="inline-flex items-center gap-1 rounded-default px-2 py-0.5 text-xs font-medium bg-badge-primary-soft-bg text-badge-primary-soft-text"
        :data-test="`composite-expr-token-${child.alias}`"
      >
        {{ api.labelOf(child.alias) }}
        <button
          type="button"
          class="inline-flex items-center opacity-60 hover:opacity-100 cursor-pointer"
          :title="t('alerts.composite.removeTerm')"
          :data-test="`composite-expr-remove-${child.alias}`"
          @click="api.removeAt(path.concat(i))"
        ><OIcon name="close" size="xs" /></button>
      </span>

      <!-- Nested group -->
      <ExprNode v-else :node="child" :path="path.concat(i)" :depth="depth + 1" />
    </template>

    <!-- Add a query or a group. Labelled when the group is empty so it clearly
         reads as a button; compact "+" among existing pills. -->
    <button
      type="button"
      class="inline-flex items-center gap-1 rounded-default border border-border-default bg-surface-subtle hover:bg-hover-gray text-text-secondary hover:text-text-body px-2 py-1 cursor-pointer"
      data-test="composite-expr-add"
      @click="api.requestAdd(path, $event)"
    >
      <OIcon name="add" size="xs" />
      <span
        v-if="node.type === 'group' && !node.children.length"
        class="text-xs font-medium"
      >{{ t("alerts.composite.addQuery") }}</span>
    </button>

    <span v-if="depth" class="font-mono text-text-secondary select-none">)</span>
  </span>
</template>
