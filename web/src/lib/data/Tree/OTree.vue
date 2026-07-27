<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, provide, ref } from "vue";
import type { TreeProps, TreeEmits, TreeNodeKey, TreeNode } from "./OTree.types";
import { TREE_CONTEXT_KEY } from "./OTree.context";
import OTreeNode from "./OTreeNode.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<TreeProps>(), {
  nodeKey: "label",
  tickStrategy: "leaf",
  ticked: () => [],
  expanded: () => [],
  filter: "",
  defaultExpandAll: false,
});

const emit = defineEmits<TreeEmits>();

// ── Initial expanded set — computed synchronously so first render is correct ──

function collectParentKeys(nodes: TreeNode[], nodeKey: string): TreeNodeKey[] {
  const keys: TreeNodeKey[] = [];
  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (node.children?.length) {
        keys.push(node[nodeKey] as TreeNodeKey);
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return keys;
}

const internalExpanded = ref<Set<TreeNodeKey>>(
  props.defaultExpandAll
    ? new Set(collectParentKeys(props.nodes, props.nodeKey))
    : new Set(props.expanded),
);

// ── Filter method ─────────────────────────────────────────────────────────

const defaultFilterMethod = (node: TreeNode, filter: string): boolean => {
  if (!filter) return true;
  const label = String(node[props.nodeKey] ?? "");
  return label.toLowerCase().includes(filter.toLowerCase());
};

const resolvedFilterMethod = computed(() => props.filterMethod ?? defaultFilterMethod);

// ── Tick handlers ─────────────────────────────────────────────────────────

function setLeafTicked(key: TreeNodeKey, ticked: boolean) {
  const next = new Set(props.ticked);
  if (ticked) {
    next.add(key);
  } else {
    next.delete(key);
  }
  emit("update:ticked", [...next]);
}

function setLeavesTicked(keys: TreeNodeKey[], ticked: boolean) {
  const next = new Set(props.ticked);
  for (const k of keys) {
    if (ticked) next.add(k);
    else next.delete(k);
  }
  emit("update:ticked", [...next]);
}

// ── Expand handlers ───────────────────────────────────────────────────────

function toggleExpanded(key: TreeNodeKey) {
  const next = new Set(internalExpanded.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  internalExpanded.value = next;
  emit("update:expanded", [...next]);
}

// ── Provide context to OTreeNode descendants ──────────────────────────────

provide(TREE_CONTEXT_KEY, {
  nodeKey: props.nodeKey,
  get ticked() {
    return props.ticked;
  },
  get expanded() {
    return internalExpanded.value;
  },
  get filter() {
    return props.filter ?? "";
  },
  get filterMethod() {
    return resolvedFilterMethod.value;
  },
  setLeafTicked,
  setLeavesTicked,
  toggleExpanded,
});
</script>

<template>
  <ul role="tree" class="m-0 list-none p-0" v-bind="$attrs">
    <OTreeNode v-for="node in nodes" :key="node[nodeKey] as TreeNodeKey" :node="node" :depth="0" />
  </ul>
</template>
