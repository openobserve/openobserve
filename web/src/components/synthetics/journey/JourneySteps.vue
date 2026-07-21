<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  JourneySteps — Thin OTable wrapper for synthetic monitoring step lists.

  Two modes:
    editor  — draggable, selectable, expandable step editor (BrowserJourney)
    results — read-only step timeline with pass/fail indicators (RunDetail)

  This component owns the OTable configuration (columns, density, borders,
  etc.) and renders step-specific cell content via OTable cell slots.
  Recording, replay, data fetching, and screenshot resolution stay in the
  parent views or composables.
-->

<script lang="ts">
// Named export for consumers (BrowserJourney, RunDetail). Lives in a plain
// <script> block because `export` is illegal inside <script setup>.
export type StepDotState = "pending" | "active" | "pass" | "fail" | "skip";
</script>

<script setup lang="ts" generic="TData extends Record<string, any>">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StepAction } from "@/types/synthetics";
import { ACTION_LABELS, ACTION_ICONS } from "@/constants/synthetics";

const { t } = useI18n();

// ── Props ──────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    /** Step data rows. Each row must have an `id` field for selection/expansion keys. */
    data: TData[];
    /** Render mode: editor (editable) or results (read-only). */
    mode: "editor" | "results";
    /** Accessor for the action field on each row. */
    actionKey?: string;
    /** Accessor for the step name field on each row. */
    nameKey?: string;
    /** Accessor for the selector/details field on each row. */
    detailKey?: string;
    /** Accessor for the icon name field on each row (results mode). */
    iconKey?: string;
    /** When set, renders colored status dots per step during replay. */
    dotStateFn?: (row: TData) => StepDotState | undefined;
    /** When true, hides row action buttons (during replay). */
    locked?: boolean;
    /** When true, the step list is read-only (no drag, no selection). */
    readonly?: boolean;
    /** Whether drag reorder is enabled (editor mode, disabled during record/replay/filter). */
    enableReorder?: boolean;
    /** Per-row predicate: return false to disable the drag handle for that row. */
    disableRowReorder?: (row: TData) => boolean;
    /** When true, the global filter is active and reorder auto-disables. */
    filterActive?: boolean;
    /** When true, selection checkboxes are shown. */
    selectionEnabled?: boolean;
    /** Selected row ids (v-model). */
    selectedIds?: string[];
    /** Expanded row ids (v-model). */
    expandedIds?: string[];
    /** Per-step replay results for error cards. */
    getReplayResult?: (row: TData) =>
      | { passed: boolean; durationMs: number; error?: string; structuredError?: any }
      | undefined;
    /** Returns a CSS color for the 4px left status bar per row (e.g. validation errors). */
    getRowStatusColor?: (row: TData) => string | undefined;
  }>(),
  {
    actionKey: "action",
    nameKey: "name",
    detailKey: "detail",
    iconKey: "icon",
    enableReorder: false,
    filterActive: false,
    locked: false,
    readonly: false,
    selectionEnabled: false,
  },
);

const emit = defineEmits<{
  "update:data": [value: TData[]];
  "update:selected-ids": [ids: string[]];
  "update:expanded-ids": [ids: string[]];
  "row-click": [row: TData, event: MouseEvent];
  // Row actions emitted for parent handling
  "expand": [row: TData];
  "delete": [row: TData];
  "duplicate": [row: TData];
  "insert-below": [row: TData];
  "retry-replay": [];
}>();

defineSlots<{
  expansion: (props: { row: TData }) => any;
  empty: () => any;
  "screenshot-thumb": (props: { row: TData }) => any;
}>();

// Type guard: narrows an arbitrary row value to a known StepAction key.
function isStepAction(value: string): value is StepAction {
  return value in ACTION_ICONS;
}

function actionIcon(row: TData): string {
  const action: string = row[props.actionKey] ?? "";
  return isStepAction(action) ? ACTION_ICONS[action] : "ads-click";
}

function actionLabel(row: TData): string {
  const action: string = row[props.actionKey] ?? "";
  return isStepAction(action)
    ? ACTION_LABELS[action]
    : action.charAt(0).toUpperCase() + action.slice(1);
}

function stepName(row: TData): string {
  return (row[props.nameKey] as string) || actionLabel(row);
}

function stepDetail(row: TData): string {
  return (row[props.detailKey] as string) ?? "";
}

// ── Status dot rendering ───────────────────────────────────────────
function dotClass(state: StepDotState | undefined): string {
  if (!state) {
    return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-[var(--color-text-muted)] text-text-muted text-xs font-semibold";
  }
  switch (state) {
    case "active":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-primary-soft-bg)] text-[var(--color-badge-primary-soft-text)] border border-[var(--color-badge-primary-soft-text)] text-xs font-semibold";
    case "pass":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-success-soft-bg)] text-[var(--color-badge-success-soft-text)] border border-[var(--color-badge-success-soft-text)] text-xs font-semibold";
    case "fail":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-error-soft-bg)] text-[var(--color-badge-error-soft-text)] border border-[var(--color-badge-error-soft-text)] text-xs font-semibold";
    case "skip":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-badge-default-soft-bg)] text-[var(--color-badge-default-soft-text)] border border-[var(--color-badge-default-soft-text)] text-xs font-semibold opacity-50";
    default:
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-[var(--color-text-muted)] text-text-muted text-xs font-semibold";
  }
}

function getDotState(row: TData): StepDotState | undefined {
  return props.dotStateFn?.(row);
}

// ── Column definitions ─────────────────────────────────────────────
const isEditor = computed(() => props.mode === "editor");

const columns = computed<OTableColumnDef<TData>[]>(() => {
  if (isEditor.value) {
    return [
      { id: "details", header: t('synthetics.journey.stepHeader'), size: 200, meta: { autoWidth: true } },
      { id: "actions", header: "", size: 128, isAction: true },
    ];
  }
  // Results mode
  return [
    { id: "step", header: "", size: 44 },
    { id: "screenshot", header: "", size: 90 },
    { id: "details", header: t('synthetics.journey.stepHeader'), size: 200, meta: { autoWidth: true } },
    { id: "progress", header: "", size: 100 },
    { id: "duration", header: t('synthetics.journey.durationHeader'), size: 80 },
  ];
});

// ── Derived OTable props ───────────────────────────────────────────
const reorderEnabled = computed(() => props.enableReorder && !props.filterActive);

const isLocked = computed(() => props.locked);

function handleRowReorder(data: TData[]) {
  emit("update:data", data);
}

function handleUpdateSelected(ids: string[]) {
  emit("update:selected-ids", ids);
}

function handleUpdateExpanded(ids: string[]) {
  emit("update:expanded-ids", ids);
}
</script>

<template>
  <OTable
    class="border-t border-table-row-divider"
    :data="data"
    :columns="columns"
    row-key="id"
    :show-header="false"
    :selection="selectionEnabled ? 'multiple' : 'none'"
    :selected-ids="selectedIds"
    :expansion="'multiple'"
    :expanded-ids="expandedIds"
    :enable-row-reorder="reorderEnabled"
    :disable-row-reorder="disableRowReorder"
    :global-filter-active="filterActive"
    :pagination="'none'"
    :sorting="'none'"
    :show-global-filter="false"
    :dense="true"
    :bordered="true"
    :default-columns="false"
    :fill-height="false"
    :expand-on-row-click="true"
    :get-row-status-color="getRowStatusColor"
    @row-reorder="handleRowReorder"
    @update:selected-ids="handleUpdateSelected"
    @update:expanded-ids="handleUpdateExpanded"
    @row-click="(row: TData, evt: MouseEvent) => emit('row-click', row, evt)"
  >
    <!-- ── cell-step: Status dot (results mode) ───────────────── -->
    <template v-if="mode === 'results'" #cell-step="{ row }">
      <div class="flex items-center justify-center">
        <span :class="dotClass(getDotState(row))">
          {{ (row as any).id ?? "" }}
        </span>
      </div>
    </template>

    <!-- ── cell-screenshot: Thumbnail (results mode) ───────────── -->
    <template v-if="mode === 'results'" #cell-screenshot="{ row }">
      <div
        class="w-18 h-12 shrink-0 rounded-default border border-border-default bg-surface-subtle flex items-center justify-center overflow-hidden"
      >
        <slot name="screenshot-thumb" :row="row">
          <OIcon name="image" size="xs" class="text-text-secondary" />
        </slot>
      </div>
    </template>

    <!-- ── cell-details: Step content (both modes) ─────────────── -->
    <template #cell-details="{ row }">
      <div class="flex items-center gap-2 min-w-0">
        <!-- Step number (editor mode — circle during replay, plain text otherwise) -->
        <span
          v-if="mode === 'editor'"
          :class="[
            getDotState(row) ? dotClass(getDotState(row)) : '',
            'shrink-0 tabular-nums',
            getDotState(row) ? '' : 'text-sm text-text-muted w-6 text-center',
          ]"
        >
          <OSpinner
            v-if="getDotState(row) === 'active'"
            variant="ring"
            size="xs"
            class="text-primary-500"
          />
          <template v-else>{{ (data as any[]).indexOf(row) + 1 }}</template>
        </span>

        <!-- Selection is handled by OTable's built-in checkbox column when selection="multiple" -->

        <!-- Action icon chip -->
        <span
          class="bg-primary-50 rounded-default p-1 shrink-0 flex items-center"
        >
          <OIcon
            :name="actionIcon(row)"
            size="sm"
            class="text-primary-500"
            aria-hidden="true"
          />
        </span>

        <!-- Action label badge -->
        <div class="w-24!">
            <OBadge variant="default" size="sm">{{ actionLabel(row) }}</OBadge>
        </div>

        <!-- Step display name -->
        <span class="text-sm text-text-body flex-1 truncate min-w-0">
          {{ stepName(row) }}
        </span>

        <!-- Selector/value preview (editor mode only) -->
        <span
          v-if="mode === 'editor' && stepDetail(row)"
          class="font-mono text-xs text-text-secondary truncate max-w-[25%] shrink-0"
        >
          {{ stepDetail(row) }}
        </span>
      </div>
    </template>

    <!-- ── cell-progress: Progress bar (results mode) ──────────── -->
    <template v-if="mode === 'results'" #cell-progress="{ row }">
      <OProgressBar
        :value="((row as any).duration ?? 0) / Math.max((row as any)._totalDuration ?? 1, 1)"
        :variant="(row as any).status === 'fail' ? 'danger' : 'default'"
        size="xs"
        class="w-20! shrink-0 h-2!"
      />
    </template>

    <!-- ── cell-duration: Duration text (results mode) ─────────── -->
    <template v-if="mode === 'results'" #cell-duration="{ row }">
      <span class="text-xs text-text-secondary shrink-0 font-mono tabular-nums">
        {{ (row as any).durStr ?? "" }}
      </span>
    </template>

    <!-- ── cell-actions: Row action buttons (editor mode) ──────── -->
    <template v-if="mode === 'editor'" #cell-actions="{ row }">
      <div
        class="flex items-center gap-0.5 shrink-0"
        :class="{ invisible: isLocked }"
      >
        <!-- Expand/collapse is handled by OTable's built-in expand button when expansion="multiple" -->

        <OButton
          v-if="!readonly"
          variant="ghost"
          size="xs"
          :aria-label="t('synthetics.journey.insertStepBelow')"
          data-test="synthetics-journey-step-insert-btn"
          :disabled="isLocked"
          @click="emit('insert-below', row)"
        >
          <OIcon name="add" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          v-if="!readonly"
          variant="ghost"
          size="xs"
          :aria-label="t('synthetics.journey.duplicateStep')"
          data-test="synthetics-journey-step-duplicate-btn"
          data-row-action="duplicate"
          :disabled="isLocked"
          @click="emit('duplicate', row)"
        >
          <OIcon name="content-copy" size="sm" aria-hidden="true" />
        </OButton>

        <OButton
          v-if="!readonly"
          variant="ghost"
          size="xs"
          :aria-label="t('synthetics.journey.deleteStepAria')"
          data-test="synthetics-journey-step-delete-btn"
          data-row-action="delete"
          :disabled="isLocked"
          class="hover:text-status-error-text"
          @click="emit('delete', row)"
        >
          <OIcon name="delete" size="sm" aria-hidden="true" />
        </OButton>
      </div>
    </template>

    <!-- ── expansion: Expanded content passthrough ─────────────── -->
    <template #expansion="{ row }">
      <slot name="expansion" :row="row" />
    </template>

    <!-- ── empty: Custom empty state ───────────────────────────── -->
    <template #empty>
      <slot name="empty" />
    </template>
  </OTable>
</template>
