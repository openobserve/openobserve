<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import type { Cell, Row } from "@tanstack/vue-table";
import { computed, ref } from "vue";
import { FlexRender } from "@tanstack/vue-table";
import { useSanitizedHtml } from "../composables/useSanitizedHtml";

const { sanitize } = useSanitizedHtml();

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function handleCopy(event: MouseEvent) {
  event.stopPropagation();
  const value = String(props.cell.getValue() ?? "");
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // clipboard write failed — silently ignore
  }
}

const props = defineProps<{
  cell: Cell<any, any>;
  row: Row<any>;
  highlightText?: string;
  shouldHighlight?: boolean;
  getHighlightedHtml?: (columnId: string, cellValue: any) => string | null;
  wrap?: boolean;
  dense?: boolean;
  bordered?: boolean;
  enableCellCopy?: boolean;
}>();

const emit = defineEmits<{
  "cell-click": [
    params: { columnId: string; row: any; value: any },
  ];
}>();

const meta = computed(() => props.cell.column.columnDef.meta as any);
const align = computed(() => meta.value?.align ?? "left");

const alignClass = computed(() => {
  if (align.value === "center") return "tw:text-center";
  if (align.value === "right") return "tw:text-right";
  return "tw:text-left";
});

const isAction = computed(() => meta.value?.isAction ?? false);

const highlightedHtml = computed(() => {
  if (!props.highlightText || !props.shouldHighlight || !props.getHighlightedHtml) {
    return null;
  }
  const raw = props.getHighlightedHtml(props.cell.column.id, props.cell.getValue());
  return raw ? sanitize(raw) : null;
});

function handleClick() {
  emit("cell-click", {
    columnId: props.cell.column.id,
    row: props.row.original,
    value: props.cell.getValue(),
  });
}
</script>

<template>
  <td
    :data-test="`o2-table-cell-${cell.column.id}`"
    :class="[
      'tw:px-2',
      dense ? 'tw:py-1' : 'tw:py-2',
      alignClass,
      bordered ? 'tw:border-r tw:border-border-default' : '',
      isAction ? 'tw:w-0 tw:whitespace-nowrap' : '',
      wrap ? 'tw:break-words tw:whitespace-normal' : 'tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis',
      meta?.cellClass ?? '',
    ]"
    :style="{
      width: `calc(var(--header-${cell.column.id.replace(/[^a-zA-Z0-9]/g, '-')}-size) * 1px)`,
    }"
    @click="handleClick"
  >
    <slot v-if="$slots.default" />
    <!-- Custom cell render via TanStack FlexRender -->
    <FlexRender
      v-else-if="cell.column.columnDef.cell"
      :render="cell.column.columnDef.cell"
      :props="cell.getContext()"
    />
    <!-- Highlighted HTML (safe: composable escapes user content before wrapping) -->
    <span
      v-else-if="highlightedHtml"
      class="tw:text-text-primary tw:text-sm"
      v-html="highlightedHtml"
    />
    <!-- Default: plain text -->
    <span v-else class="tw:text-text-primary tw:text-sm">
      {{ cell.renderValue() }}
    </span>

    <!-- Cell copy button (visible on hover) -->
    <button
      v-if="enableCellCopy && !$slots.default"
      type="button"
      :data-test="`o2-table-cell-copy-${cell.column.id}`"
      class="tw:absolute tw:right-1 tw:opacity-0 group-hover:tw:opacity-100 tw:bg-[var(--color-surface-default)] tw:border tw:border-[var(--color-border-default)] tw:rounded tw:cursor-pointer tw:p-0.5 tw:text-[var(--color-text-muted)] tw:hover:text-[var(--color-text-primary)] tw:leading-none tw:transition-opacity"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="handleCopy"
    >
      <q-icon :name="copied ? 'check' : 'content_copy'" size="0.8rem" />
    </button>
  </td>
</template>
