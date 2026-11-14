<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { computed, inject, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { JSON_VIEWER_CONTEXT, type JsonViewerNodeProps } from "./OJsonViewer.types";

defineOptions({ name: "OJsonViewerNode" });

const props = withDefaults(defineProps<JsonViewerNodeProps>(), { last: false });

const { t } = useI18nTyped();
const context = inject(JSON_VIEWER_CONTEXT)!;

const isArray = computed(() => Array.isArray(props.value));
const isBranch = computed(() => props.value !== null && typeof props.value === "object");
const entries = computed<[string | number, unknown][]>(() => {
  if (!isBranch.value) return [];
  if (isArray.value) return (props.value as unknown[]).map((v, i) => [i, v]);
  return Object.entries(props.value as Record<string, unknown>);
});

const open = ref(props.depth < context.expandDepth);

const childPath = (key: string | number) => {
  if (typeof key === "number") return `${props.path}[${key}]`;
  return props.path ? `${props.path}.${key}` : key;
};

const brackets = computed(() => (isArray.value ? ["[", "]"] : ["{", "}"]));
const countLabel = computed(() =>
  isArray.value
    ? t("components.jsonViewer.itemCount", { count: entries.value.length }, entries.value.length)
    : t("components.jsonViewer.fieldCount", { count: entries.value.length }, entries.value.length),
);

const VALUE_CLASS: Record<string, string> = {
  string: "text-syntax-string",
  number: "text-syntax-number",
  bigint: "text-syntax-number",
  boolean: "text-syntax-keyword",
};
const leafClass = computed(() =>
  props.value === null || props.value === undefined
    ? "text-text-muted"
    : (VALUE_CLASS[typeof props.value] ?? "text-text-body"),
);
const leafText = computed(() => {
  if (props.value === undefined) return "undefined";
  return typeof props.value === "string" ? JSON.stringify(props.value) : String(props.value);
});
const copyText = () =>
  isBranch.value
    ? JSON.stringify(props.value, null, 2)
    : typeof props.value === "string"
      ? props.value
      : String(props.value);

const rowTest = computed(() => `${context.dataTest}-row-${props.path || "root"}`);
</script>

<template>
  <div role="treeitem" :aria-expanded="isBranch ? open : undefined">
    <div
      class="group rounded-chip hover:bg-surface-subtle-hover flex min-h-6 min-w-0 items-center gap-1 pe-1 leading-normal"
      :data-test="rowTest"
    >
      <OButton
        v-if="isBranch"
        variant="ghost"
        size="xs"
        icon-only
        :icon="open ? 'expand-more' : 'chevron-right'"
        :label="open ? t('common.collapse') : t('common.expand')"
        :data-test="`${rowTest}-toggle`"
        @click="open = !open"
      />
      <span v-else class="size-6 shrink-0" aria-hidden="true" />
      <span v-if="name !== null" class="text-text-secondary shrink-0"
        >{{ raw(String(name)) }}{{ raw(":") }}</span
      >
      <template v-if="isBranch">
        <span class="text-text-muted">{{ raw(brackets[0]) }}</span>
        <span v-if="!open" class="text-text-muted"
          >{{ countLabel }}{{ raw(` ${brackets[1]}`) }}{{ raw(last ? "" : ",") }}</span
        >
      </template>
      <span v-else :class="['min-w-0 wrap-anywhere', leafClass]"
        >{{ raw(leafText) }}<span class="text-text-muted">{{ raw(last ? "" : ",") }}</span></span
      >
      <span
        class="ms-auto flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
      >
        <OButton
          v-if="!isBranch && context.include"
          variant="ghost"
          size="xs"
          icon-only
          icon="add"
          :label="t('components.jsonViewer.include')"
          :data-test="`${rowTest}-include`"
          @click="context.include?.(path, value)"
        />
        <OButton
          v-if="!isBranch && context.exclude"
          variant="ghost"
          size="xs"
          icon-only
          icon="remove"
          :label="t('components.jsonViewer.exclude')"
          :data-test="`${rowTest}-exclude`"
          @click="context.exclude?.(path, value)"
        />
        <OCopyButton
          :value="copyText"
          size="xs"
          :label="t('components.jsonViewer.copyValue')"
          :data-test="`${rowTest}-copy`"
          @copied="context.copied(path, value)"
        />
      </span>
    </div>
    <div v-if="isBranch && open" role="group" class="ps-4">
      <OJsonViewerNode
        v-for="([key, child], index) in entries"
        :key="key"
        :name="key"
        :value="child"
        :path="childPath(key)"
        :depth="depth + 1"
        :last="index === entries.length - 1"
      />
      <div class="text-text-muted flex min-h-6 items-center ps-7">
        {{ raw(brackets[1]) }}{{ raw(last ? "" : ",") }}
      </div>
    </div>
  </div>
</template>
