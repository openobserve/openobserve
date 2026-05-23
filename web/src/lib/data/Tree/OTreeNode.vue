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
    :data-test="`o-tree-node-${String(key)}`"
    :data-test-checked="checkboxState === true ? 'true' : checkboxState === 'indeterminate' ? 'indeterminate' : 'false'"
    class="tw:list-none tw:m-0 tw:p-0"
  >
    <!-- Node row ────────────────────────────────────────────────────── -->
    <div
      class="tw:flex tw:items-center tw:gap-1 tw:min-h-7 tw:px-1 tw:rounded tw:select-none tw:transition-colors tw:duration-100"
      :class="
        !isLeaf
          ? 'tw:cursor-pointer tw:hover:bg-tree-node-hover-bg'
          : 'tw:cursor-default tw:hover:bg-tree-node-hover-bg'
      "
      @click="toggleExpand"
    >
      <!-- Expand / collapse arrow (parents only) -->
      <span
        v-if="!isLeaf"
        class="tw:flex tw:items-center tw:justify-center tw:size-4 tw:shrink-0 tw:text-text-secondary tw:transition-transform tw:duration-200 tw:ease-in-out"
        :class="isExpanded ? 'tw:rotate-0' : 'tw:-rotate-90'"
        aria-hidden="true"
      >
        <!-- Chevron-down SVG — crisp at all sizes -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          class="tw:size-3.5"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </span>

      <!-- Leaf connector — └ elbow anchored under the chevron center -->
      <!--
        The children <ul> has pl-5 (1.25rem = 20px) indentation, so the
        connector span starts 20px to the RIGHT of the parent row.
        The parent's chevron (size-4 = 16px) is centered at +8px from the
        parent tw:flex start, so relative to the connector span start:
          chevronCenterX = 8px - 20px = -12px = -0.75rem
        Accounting for the 1.5px border center (subtract 0.75px):
          left = calc(-0.75rem - 0.75px)
        Arm width from that X to the right edge of the connector span (1rem):
          width = 1rem - (-0.75rem - 0.75px) = calc(1.75rem + 0.75px)
        The negative left overflows into the ul's padding area which is
        NOT clipped by overflow:hidden (clips to padding box, not content box).
      -->
      <span
        v-else
        class="tw:relative tw:shrink-0 tw:self-stretch tw:opacity-35"
        style="width: 1rem;"
        aria-hidden="true"
      >
        <span
          style="
            position: absolute;
            left: calc(-0.75rem - 0.75px);
            top: 0;
            width: calc(1.75rem + 0.75px);
            height: calc(50% + 0.75px);
            border-left: 1.5px solid currentColor;
            border-bottom: 1.5px solid currentColor;
            border-bottom-left-radius: 3px;
          "
        />
      </span>

      <!-- Checkbox (leaf = real tick; parent = tick-all shortcut) -->
      <OCheckbox
        :model-value="checkboxState"
        :disabled="isDisabled"
        size="sm"
        class="tw:cursor-pointer"
        @click.stop
        @update:model-value="onTickChange"
      />

      <!-- Label -->
      <span
        class="tw:text-sm tw:text-text-primary tw:leading-snug tw:truncate"
        :class="isDisabled ? 'tw:opacity-50' : ''"
      >
        {{ node.label }}
      </span>
    </div>

    <!-- Children (recursive) — animated expand/collapse ──────────── -->
    <div
      v-if="!isLeaf"
      class="tw:overflow-hidden tw:transition-[grid-template-rows] tw:duration-200 tw:ease-in-out tw:grid"
      :style="{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }"
    >
      <ul
        role="group"
        class="tw:list-none tw:m-0 tw:p-0 tw:pl-5 tw:overflow-hidden tw:min-h-0"
      >
        <OTreeNode
          v-if="isExpanded"
          v-for="child in node.children"
          :key="child[ctx.nodeKey] as TreeNodeKey"
          :node="child"
          :depth="depth + 1"
        />
      </ul>
    </div>
  </li>
</template>
