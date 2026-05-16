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
  getCellStyle?: (params: {
    columnId: string;
    row: any;
    value: any;
  }) => Record<string, any>;
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

const isPinned = computed(() => props.cell.column.getIsPinned?.() ?? false);

const pinOffset = computed(() => {
  if (!isPinned.value) return 0;
  if (isPinned.value === "left")
    return props.cell.column.getStart?.("left") ?? 0;
  if (isPinned.value === "right")
    return props.cell.column.getAfter?.("right") ?? 0;
  return 0;
});

const rawValue = computed(() => props.cell.getValue());

const displayValue = computed(() => {
  const formatFn = meta.value?.format as
    | ((value: any, row: any) => any)
    | undefined;
  if (rawValue.value === null || rawValue.value === undefined)
    return rawValue.value;
  return formatFn ? formatFn(rawValue.value, props.row.original) : rawValue.value;
});

const cellStyle = computed(() => {
  const base: Record<string, any> = {
    width: `calc(var(--header-${props.cell.column.id.replace(/[^a-zA-Z0-9]/g, "-")}-size) * 1px)`,
  };
  if (isPinned.value === "left") {
    base.position = "sticky";
    base.left = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "2px 0 4px -2px var(--color-border-default)";
  }
  if (isPinned.value === "right") {
    base.position = "sticky";
    base.right = `${pinOffset.value}px`;
    base.zIndex = 1;
    base.boxShadow = "-2px 0 4px -2px var(--color-border-default)";
  }
  const extra = props.getCellStyle?.({
    columnId: props.cell.column.id,
    row: props.row.original,
    value: rawValue.value,
  });
  return extra ? { ...base, ...extra } : base;
});

const highlightedHtml = computed(() => {
  if (!props.highlightText || !props.shouldHighlight || !props.getHighlightedHtml) {
    return null;
  }
  const raw = props.getHighlightedHtml(props.cell.column.id, displayValue.value);
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
      isPinned ? 'tw:bg-[var(--color-table-cell-bg)]' : '',
      wrap ? 'tw:break-words tw:whitespace-normal' : 'tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis',
      meta?.cellClass ?? '',
    ]"
    :style="cellStyle"
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
      {{ displayValue }}
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
