<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
// Internal component — not exported from lib/index.ts directly.
// Rendered recursively by OTree for each node in the tree.

import { computed, inject } from "vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import { TREE_CONTEXT_KEY } from "./OTree.context";
import type { TreeNode, TreeNodeKey } from "./OTree.types";

const props = defineProps<{
  node: TreeNode;
  depth: number;
}>();

const ctx = inject(TREE_CONTEXT_KEY)!;

const key = computed<TreeNodeKey>(() => props.node[ctx.nodeKey] as TreeNodeKey);

const isLeaf = computed(
  () => !props.node.children || props.node.children.length === 0,
);

const isExpanded = computed(() => ctx.expanded.has(key.value));

const isDisabled = computed(() => !!props.node.disabled);

// ── Visibility (filter) ────────────────────────────────────────────────────

/**
 * Whether this node itself matches the current filter.
 */
const selfMatches = computed((): boolean => {
  if (!ctx.filter) return true;
  return ctx.filterMethod(props.node, ctx.filter);
});

/**
 * Whether any descendant matches — used to keep parent nodes visible
 * even when the parent's own label doesn't match.
 */
function anyDescendantMatches(node: TreeNode): boolean {
  if (!node.children?.length) {
    return ctx.filterMethod(node, ctx.filter);
  }
  return node.children.some(
    (child) =>
      ctx.filterMethod(child, ctx.filter) || anyDescendantMatches(child),
  );
}

const visible = computed((): boolean => {
  if (!ctx.filter) return true;
  return selfMatches.value || anyDescendantMatches(props.node);
});

// ── Tick state ────────────────────────────────────────────────────────────

const leafKeys = computed<TreeNodeKey[]>(() => {
  function collect(node: TreeNode): TreeNodeKey[] {
    if (!node.children?.length) return [node[ctx.nodeKey] as TreeNodeKey];
    return node.children.flatMap(collect);
  }
  return collect(props.node);
});

const tickedSet = computed(() => new Set(ctx.ticked));

/** How many of this node's leaves are ticked */
const tickedLeafCount = computed(
  () => leafKeys.value.filter((k) => tickedSet.value.has(k)).length,
);

const checkboxState = computed<boolean | "indeterminate">(() => {
  if (isLeaf.value) return tickedSet.value.has(key.value);
  const count = tickedLeafCount.value;
  if (count === 0) return false;
  if (count === leafKeys.value.length) return true;
  return "indeterminate";
});

// ── Handlers ──────────────────────────────────────────────────────────────

function toggleExpand() {
  if (isLeaf.value) return;
  ctx.toggleExpanded(key.value);
}

function onTickChange(newVal: CheckboxModelValue) {
  const ticked = newVal === true;
  if (isLeaf.value) {
    ctx.setLeafTicked(key.value, ticked);
  } else {
    // Tick or untick all descendant leaves
    const targetState = checkboxState.value !== true;
    ctx.setLeavesTicked(leafKeys.value, targetState);
  }
}
</script>

<template>
  <li
    v-if="visible"
    role="treeitem"
    :aria-expanded="!isLeaf ? isExpanded : undefined"
    class="tw:list-none tw:m-0 tw:p-0"
  >
    <!-- Node row ────────────────────────────────────────────────────── -->
    <div
      class="tw:flex tw:items-center tw:gap-1 tw:min-h-7 tw:rounded tw:select-none"
      :class="[
        !isLeaf
          ? 'tw:cursor-pointer tw:hover:bg-tree-node-hover-bg'
          : 'tw:cursor-default',
      ]"
      @click="toggleExpand"
    >
      <!-- Expand / collapse triangle (parents only) -->
      <span
        v-if="!isLeaf"
        class="tw:flex tw:items-center tw:justify-center tw:size-4 tw:shrink-0 tw:text-text-secondary tw:transition-transform tw:duration-150"
        :class="isExpanded ? '' : 'tw:-rotate-90'"
        aria-hidden="true"
      >
        <span class="tw:text-[10px] tw:leading-none">▼</span>
      </span>

      <!-- Tree connector for leaf nodes — draws └─ using CSS borders -->
      <span
        v-else
        class="tw:flex tw:items-end tw:shrink-0 tw:self-stretch tw:opacity-40"
        style="width: 1rem; min-height: 1.75rem;"
        aria-hidden="true"
      >
        <!-- Vertical segment (top half) + horizontal arm -->
        <span
          style="
            display: block;
            width: 0.5rem;
            height: 50%;
            border-left: 1.5px solid currentColor;
            border-bottom: 1.5px solid currentColor;
            border-bottom-left-radius: 2px;
            margin-bottom: 0.45rem;
          "
        />
      </span>

      <!-- Checkbox (leaf = real tick; parent = tick-all shortcut) -->
      <OCheckbox
        :model-value="checkboxState"
        :disabled="isDisabled"
        size="sm"
        @click.stop
        @update:model-value="onTickChange"
      />

      <!-- Label -->
      <span
        class="tw:text-sm tw:text-text-primary tw:leading-none tw:truncate"
        :class="isDisabled ? 'tw:opacity-50' : ''"
      >
        {{ node.label }}
      </span>
    </div>

    <!-- Children (recursive) ──────────────────────────────────────── -->
    <ul
      v-if="!isLeaf && isExpanded"
      role="group"
      class="tw:list-none tw:m-0 tw:p-0 tw:pl-4"
    >
      <OTreeNode
        v-for="child in node.children"
        :key="child[ctx.nodeKey] as TreeNodeKey"
        :node="child"
        :depth="depth + 1"
      />
    </ul>
  </li>
</template>
