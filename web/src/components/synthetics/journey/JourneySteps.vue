<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

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
import { computed, ref, useId } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StepAction } from "@/types/synthetics";
import { ACTION_ICONS, stepActionLabelKey } from "@/constants/synthetics";

const { t } = useI18nTyped();

// ── Props ──────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    /** Step data rows. Each row must have an `id` field for selection/expansion keys. */
    data: TData[];
    /** Row 0 — the Starting URL, which is not a Step: rendered above the rows, never among them. */
    startRow?: TData | null;
    /** Render mode: editor (editable), results (read-only) or preview (a child's steps, no run). */
    mode: "editor" | "results" | "preview";
    /** Preview mode: the reference row's number, so child rows read `2.1`, `2.2`, … */
    numberPrefix?: string;
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
    /** When set, renders a "{done}/{total}" counter on a collapsed reference row. */
    stepProgressFn?: (row: TData) => { done: number; total: number } | null;
    /** When set, renders a badge on an editor row where the progress counter would sit. */
    stepBadgeFn?: (row: TData) => { label: string; variant: "default" | "error" } | null;
    /** When true, hides row action buttons (during replay). */
    locked?: boolean;
    /**
     * Step id the recording marker sits above, or null when unanchored.
     *
     * The marker answers "where will my steps go" for the whole session, which the
     * button label alone cannot: the label is gone the moment recording starts.
     */
    anchorId?: string | null;
    /**
     * Whether the installed extension can restore the journey before recording.
     *
     * The row action promises a restore, so without it the button is offered and cannot
     * be honoured. Defaults true, leaving the results-mode caller unaffected.
     */
    canRecordFrom?: boolean;
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
    getReplayResult?: (
      row: TData,
    ) => { passed: boolean; durationMs: number; error?: string; structuredError?: any } | undefined;
    /** Returns a CSS color for the 4px left status bar per row (e.g. validation errors). */
    getRowStatusColor?: (row: TData) => string | undefined;
    /**
     * Total run duration in ms — the scale every timeline bar is drawn against
     * (results mode). Supplies the column header's window and the denominator
     * for each bar, so the row data carries only its own offset and duration.
     */
    totalDurationMs?: number;
  }>(),
  {
    actionKey: "action",
    nameKey: "name",
    detailKey: "detail",
    iconKey: "icon",
    canRecordFrom: true,
    enableReorder: false,
    filterActive: false,
    locked: false,
    readonly: false,
    selectionEnabled: false,
    totalDurationMs: 0,
  },
);

const emit = defineEmits<{
  "update:data": [value: TData[]];
  /** Row 0's URL edit — the check's Starting URL, which the host owns. */
  "update:start-url": [value: string];
  "update:selected-ids": [ids: string[]];
  "update:expanded-ids": [ids: string[]];
  "row-click": [row: TData, event: MouseEvent];
  // Row actions emitted for parent handling
  expand: [row: TData];
  delete: [row: TData];
  duplicate: [row: TData];
  /**
   * Restore the journey up to this row, then record new steps BEFORE it.
   *
   * Named for the direction it inserts, not for "here": the two neighbouring row
   * actions (insert-below, duplicate) both act downward, so an ambiguous name would
   * be read the wrong way. See design §7.1.
   */
  "record-before": [row: TData];
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

// A right or double click is a `click` carrying `button`/`clickCount`, so the
// action alone labelled all three "Click". Results rows carry neither field and
// fall back to exactly that.
function actionLabel(row: TData): string {
  const action: string = row[props.actionKey] ?? "";
  return isStepAction(action)
    ? t(stepActionLabelKey(action, row.button, row.clickCount))
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
    return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-text-muted text-text-muted text-xs font-semibold";
  }
  switch (state) {
    case "active":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-badge-primary-soft-bg text-badge-primary-soft-text border border-badge-primary-soft-text text-xs font-semibold";
    case "pass":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-badge-success-soft-bg text-badge-success-soft-text border border-badge-success-soft-text text-xs font-semibold";
    case "fail":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-badge-error-soft-bg text-badge-error-soft-text border border-badge-error-soft-text text-xs font-semibold";
    case "skip":
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-badge-default-soft-bg text-badge-default-soft-text border border-badge-default-soft-text text-xs font-semibold opacity-50";
    default:
      return "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-text-muted text-text-muted text-xs font-semibold";
  }
}

function getDotState(row: TData): StepDotState | undefined {
  return props.dotStateFn?.(row);
}

/** Row's position in `data` — the same 0-based unit the dot/progress hooks are keyed by. */
function rowIndex(row: TData): number {
  return (props.data as TData[]).indexOf(row);
}

function stepProgress(row: TData): { done: number; total: number } | null {
  return props.stepProgressFn?.(row) ?? null;
}

function stepBadge(row: TData): { label: string; variant: "default" | "error" } | null {
  return props.stepBadgeFn?.(row) ?? null;
}

function isSkippedPreview(row: TData): boolean {
  return props.mode === "preview" && getDotState(row) === "skip";
}

function stepNumber(row: TData): string {
  const n = rowIndex(row) + 1;
  return props.numberPrefix ? `${props.numberPrefix}.${n}` : String(n);
}

// ── Column definitions ─────────────────────────────────────────────
const isEditor = computed(() => props.mode === "editor");

/**
 * The scale every timeline bar shares, never zero.
 *
 * A run with no recorded duration would otherwise divide by zero and paint
 * every bar full-width, which reads as "everything took the whole run".
 */
const timelineTotal = computed(() => Math.max(props.totalDurationMs || 0, 1));

const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * "Timeline · 0 – 35.8s".
 *
 * The window belongs in the header rather than on each row: it is the one fact
 * that makes a bar's position mean anything, and repeating it per row would say
 * it once per step.
 */
const timelineHeader = computed(() =>
  props.totalDurationMs
    ? t("synthetics.journey.timelineHeaderWindow", { end: fmtSeconds(props.totalDurationMs) })
    : t("synthetics.journey.timelineHeader"),
);

const columns = computed<OTableColumnDef<TData>[]>(() => {
  if (isEditor.value) {
    return [
      {
        id: "details",
        header: t("synthetics.journey.stepHeader"),
        size: 200,
        // `relative` so the recording marker positions against the CELL rather
        // than the truncating wrapper inside it — the marker sits on the row's
        // top edge, which only the cell's own box can locate.
        meta: { autoWidth: true, cellClass: "relative" },
      },
      // Sized to the buttons it holds, which is now four: record-before, insert,
      // duplicate, delete. An `xs` button is h-7 with ps-2.5/pe-2.5 around a 1rem
      // icon — 36px — and they sit in a gap-0.5 row, so four need 150px against the
      // three that needed 112px. Left at 128 the last button (delete) was clipped
      // out of the column entirely.
      { id: "actions", header: raw(""), size: 168, isAction: true },
    ];
  }
  // A child's steps are a definition, not a run: no shot, timeline, time or actions.
  if (props.mode === "preview") {
    return [{ id: "details", header: raw(""), meta: { autoWidth: true } }];
  }
  // Results mode. Headers are named here because results mode renders them —
  // the run's steps are a table an engineer reads down, and an unlabelled
  // timeline column cannot say what its bars are drawn against.
  return [
    { id: "step", header: raw(""), size: 44 },
    { id: "screenshot", header: t("synthetics.journey.shotHeader"), size: 90 },
    {
      id: "details",
      header: t("synthetics.journey.stepHeader"),
      size: 200,
      meta: { autoWidth: true },
    },
    { id: "progress", header: timelineHeader.value, size: 260 },
    { id: "duration", header: t("synthetics.journey.timeHeader"), size: 80 },
  ];
});

// ── Derived OTable props ───────────────────────────────────────────
const reorderEnabled = computed(() => props.enableReorder && !props.filterActive);

const isLocked = computed(() => props.locked);

/** Whether the recording marker belongs above `row`. */
function rowId(row: TData): string | null {
  return (row as { id?: string }).id ?? null;
}

function isAnchor(row: TData): boolean {
  return !!props.anchorId && rowId(row) === props.anchorId;
}

// Pointer and keyboard are tracked apart. Sharing one slot meant whichever left
// first cleared the preview for both, so tabbing to a control and then moving
// the mouse across the row lost the marker while the control was still focused.
const hoverAnchorId = ref<string | null>(null);
const focusAnchorId = ref<string | null>(null);

/**
 * One rule for the control's `:disabled` and for whether it may be previewed.
 *
 * The button is what gets disabled, but the span around it is what reports the
 * hover — so a second copy of the condition would preview a click that cannot
 * happen. The pointer/focus handlers deliberately do NOT consult it: `markerTone`
 * gates the render, which also covers the case no handler can see.
 */
function recordBeforeDisabled(): boolean {
  return isLocked.value || !props.canRecordFrom;
}

function onRecordBeforeEnter(row: TData) {
  hoverAnchorId.value = rowId(row);
}

function onRecordBeforeLeave() {
  hoverAnchorId.value = null;
}

function onRecordBeforeFocus(row: TData) {
  focusAnchorId.value = rowId(row);
}

function onRecordBeforeBlur() {
  focusAnchorId.value = null;
}

/**
 * Which marker a row shows, if any. Hover is a preview; anchor is committed.
 *
 * The single gate on previewing. Checking `recordBeforeDisabled` here rather than
 * in the handlers covers the case they cannot see: a replay started from the
 * toolbar locks the table while the pointer rests on a control, and with nothing
 * moving no `mouseleave` ever arrives to clear it.
 * Results rows are excluded outright — a finished run has nothing to insert into,
 * and only the editor's details column is positioned to host the marker.
 */
function markerTone(row: TData): "anchor" | "hover" | null {
  if (!isEditor.value) return null;
  if (isAnchor(row)) return "anchor";
  const id = rowId(row);
  if (!id) return null;
  const previewed = id === hoverAnchorId.value || id === focusAnchorId.value;
  return previewed && !recordBeforeDisabled() ? "hover" : null;
}

/**
 * Let the marker's label overhang the row boundary.
 *
 * The cell clips by default so long step names truncate, and the label is the one
 * thing that has to escape — so the clip is lifted only on the row carrying a
 * marker, and only on the cell hosting it.
 */
function markerCellStyle({ columnId, row }: { columnId: string; row: TData }) {
  if (columnId !== "details" || !markerTone(row)) return {};
  return { overflow: "visible" };
}

/** What the record-before action does, or why it cannot. */
const recordBeforeTooltip = computed(() =>
  props.canRecordFrom
    ? t("synthetics.journey.recordBeforeStepHint")
    : t("synthetics.journey.recordBeforeNeedsNewerExtension"),
);

function handleRowReorder(data: TData[]) {
  emit("update:data", data);
}

function handleUpdateSelected(ids: string[]) {
  emit("update:selected-ids", ids);
}

function handleUpdateExpanded(ids: string[]) {
  emit("update:expanded-ids", ids);
}

const startUrlInputId = useId();

/** Preview mode is a child's definition run inside the parent's page, so it has no row 0. */
const showStartRow = computed(() => !!props.startRow && props.mode !== "preview");

const startRowStatusColor = computed(() =>
  props.startRow ? props.getRowStatusColor?.(props.startRow) || undefined : undefined,
);

/** Row 0 spans the data columns plus OTable's own expand, select and drag cells. */
const startRowColspan = computed(
  () =>
    columns.value.length +
    (props.mode === "preview" ? 0 : 1) +
    (props.selectionEnabled ? 1 : 0) +
    (reorderEnabled.value ? 1 : 0),
);
</script>

<template>
  <OTable
    class="border-table-row-divider border-t"
    :data="data"
    :columns="columns"
    row-key="id"
    :show-header="mode === 'results'"
    :selection="selectionEnabled ? 'multiple' : 'none'"
    :selected-ids="selectedIds"
    :expansion="mode === 'preview' ? 'none' : 'multiple'"
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
    :expand-on-row-click="mode !== 'preview'"
    :get-row-status-color="getRowStatusColor"
    :get-cell-style="markerCellStyle"
    @row-reorder="handleRowReorder"
    @update:selected-ids="handleUpdateSelected"
    @update:expanded-ids="handleUpdateExpanded"
    @row-click="(row: TData, evt: MouseEvent) => emit('row-click', row, evt)"
  >
    <!-- Row 0 is not a data row (never numbered, counted, selected, moved), so it is OTable's leading body row. -->
    <template v-if="showStartRow" #body-start>
      <tr data-test="synthetics-journey-start-row" :data-status-color="startRowStatusColor">
        <td :colspan="startRowColspan" class="border-table-row-divider border-b px-3">
          <div :class="['flex items-center gap-2', isEditor ? 'py-1.5' : 'py-2']">
            <template v-if="isEditor">
              <span class="w-6 shrink-0" aria-hidden="true" />
              <span class="bg-tabs-active-bg rounded-default flex shrink-0 items-center p-1">
                <OIcon name="language" size="sm" class="text-tabs-active-text" aria-hidden="true" />
              </span>
              <label :for="startUrlInputId" class="text-text-body shrink-0 text-sm">
                {{ t("synthetics.journey.startRowLabel") }}
              </label>
              <OInput
                :id="startUrlInputId"
                :model-value="startRow!.value ?? ''"
                :readonly="readonly || isLocked"
                size="sm"
                :placeholder="t('synthetics.checkDetails.startingUrlPlaceholder')"
                class="min-w-0 flex-1"
                data-test="synthetics-journey-start-url-input"
                @update:model-value="(v: string | number) => emit('update:start-url', String(v))"
              />
            </template>
            <template v-else>
              <div class="flex w-11 shrink-0 items-center justify-center">
                <span :class="dotClass(getDotState(startRow!))" aria-hidden="true" />
              </div>
              <div
                class="rounded-default border-border-default bg-surface-subtle flex h-12 w-18 shrink-0 items-center justify-center overflow-hidden border"
              >
                <slot name="screenshot-thumb" :row="startRow!">
                  <OIcon name="image" size="xs" class="text-text-secondary" />
                </slot>
              </div>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-text-body truncate text-sm">{{ startRow!.name }}</span>
                <span
                  v-if="startRow!.error"
                  class="text-status-error-text truncate font-mono text-xs"
                  :title="startRow!.error"
                >
                  {{ startRow!.error }}
                </span>
              </div>
              <span class="text-text-secondary shrink-0 font-mono text-xs tabular-nums">
                {{ startRow!.durStr ?? "" }}
              </span>
            </template>
          </div>
        </td>
      </tr>
    </template>

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
        class="rounded-default border-border-default bg-surface-subtle flex h-12 w-18 shrink-0 items-center justify-center overflow-hidden border"
      >
        <slot name="screenshot-thumb" :row="row">
          <OIcon name="image" size="xs" class="text-text-secondary" />
        </slot>
      </div>
    </template>

    <!-- ── cell-details: Step content (both modes) ─────────────── -->
    <template #cell-details="{ row }">
      <div class="flex min-w-0 items-center gap-2">
        <span
          v-if="mode !== 'results'"
          :class="[
            getDotState(row) ? dotClass(getDotState(row)) : '',
            'shrink-0 tabular-nums',
            getDotState(row) ? '' : 'text-text-muted w-6 text-center text-sm',
          ]"
          :data-test="
            mode === 'preview'
              ? `synthetics-journey-preview-step-${stepNumber(row)}`
              : getDotState(row)
                ? `synthetics-journey-step-dot-${rowIndex(row)}`
                : undefined
          "
          :data-dot-state="mode === 'preview' ? getDotState(row) : undefined"
        >
          <OSpinner
            v-if="getDotState(row) === 'active'"
            variant="ring"
            size="xs"
            class="text-accent"
          />
          <template v-else>{{ stepNumber(row) }}</template>
        </span>

        <!-- Selection is handled by OTable's built-in checkbox column when selection="multiple" -->

        <!-- Action icon chip -->
        <span class="bg-tabs-active-bg rounded-default flex shrink-0 items-center p-1">
          <OIcon
            :name="actionIcon(row)"
            size="sm"
            class="text-tabs-active-text"
            aria-hidden="true"
          />
        </span>

        <!-- Action label badge -->
        <div class="w-24!">
          <OBadge variant="default" size="sm">{{ actionLabel(row) }}</OBadge>
        </div>

        <!-- Step display name -->
        <span
          :class="[
            isSkippedPreview(row) ? 'text-text-muted' : 'text-text-body',
            'min-w-0 flex-1 truncate text-sm',
          ]"
        >
          {{ stepName(row) }}
        </span>

        <!-- Sub-step progress on a collapsed reference row while its children run
             (§7.3) — nothing auto-expands during `running`, so this is the only
             place progress is visible until the author opens the row. -->
        <span
          v-if="mode === 'editor' && stepProgress(row)"
          class="text-text-secondary shrink-0 font-mono text-xs tabular-nums"
          :data-test="`synthetics-journey-subtest-progress-${rowIndex(row)}`"
          :aria-label="
            t('synthetics.journey.subtest.progressAria', {
              done: stepProgress(row)!.done,
              total: stepProgress(row)!.total,
            })
          "
          >{{ stepProgress(row)!.done }}/{{ stepProgress(row)!.total }}</span
        >
        <OBadge
          v-else-if="mode === 'editor' && stepBadge(row)"
          :variant="stepBadge(row)!.variant"
          size="sm"
          :data-test="`synthetics-journey-step-badge-${rowIndex(row)}`"
          >{{ stepBadge(row)!.label }}</OBadge
        >

        <span
          v-if="mode !== 'results' && (stepDetail(row) || isSkippedPreview(row))"
          class="text-text-secondary max-w-[25%] shrink-0 truncate font-mono text-xs"
        >
          {{ isSkippedPreview(row) ? t("synthetics.journey.subtest.notRun") : stepDetail(row) }}
        </span>

        <!-- Insertion marker: recorded steps land ABOVE this row. Absolutely
             positioned against the cell, so previewing it on hover repaints
             rather than reflowing — a rule that nudged every row would jitter
             the whole table as the pointer crossed the action column. Last in
             the cell so it paints over the step content it straddles. -->
        <!-- Two segments with the label between them, not one rule behind it:
             with no background to punch a hole, a continuous rule would run
             straight through the words. Equal `flex-1` segments centre the
             label without measuring anything. Tone sits on the container so the
             segments and the label cannot disagree about it. -->
        <span
          v-if="markerTone(row)"
          :class="[
            'absolute inset-x-0 top-0 flex -translate-y-1/2 items-center gap-2',
            markerTone(row) === 'hover' ? 'text-accent/50' : 'text-accent',
          ]"
          data-test="synthetics-journey-recording-marker"
        >
          <span
            class="h-0.5 flex-1 bg-current"
            data-test="synthetics-journey-recording-marker-rule"
            aria-hidden="true"
          />
          <!-- Opts out of the container's tone: only the rule fades for a
               preview, because a half-opacity word at this size is just hard
               to read. -->
          <span
            class="text-accent text-2xs shrink-0 font-semibold capitalize"
            data-test="synthetics-journey-recording-marker-label"
          >
            {{ t("synthetics.journey.newStepsLandHere") }}
          </span>
          <span
            class="h-0.5 flex-1 bg-current"
            data-test="synthetics-journey-recording-marker-rule"
            aria-hidden="true"
          />
        </span>
      </div>
    </template>

    <!-- ── cell-progress: Timeline segment (results mode) ──────── -->
    <!-- A segment, not a fill: the bar starts where the step started within the
         run, so reading down the column shows where the time went rather than
         six bars all anchored to the same left edge. -->
    <template v-if="mode === 'results'" #cell-progress="{ row }">
      <OProgressBar
        :start="((row as any).offsetMs ?? 0) / timelineTotal"
        :value="(((row as any).offsetMs ?? 0) + ((row as any).duration ?? 0)) / timelineTotal"
        :variant="(row as any).status === 'fail' ? 'danger' : 'default'"
        size="xs"
        class="w-full"
        data-test="synthetics-journey-step-timeline-bar"
      />
    </template>

    <!-- ── cell-duration: Duration text (results mode) ─────────── -->
    <template v-if="mode === 'results'" #cell-duration="{ row }">
      <span class="text-text-secondary shrink-0 font-mono text-xs tabular-nums">
        {{ (row as any).durStr ?? "" }}
      </span>
    </template>

    <!-- ── cell-actions: Row action buttons (editor mode) ──────── -->
    <template v-if="mode === 'editor'" #cell-actions="{ row }">
      <!-- Locked leaves these on screen and unavailable, rather than hiding them.
           Hidden, a running replay or restore looked like the row had lost actions it
           still has, and the author had nothing to point at to explain why. Each
           button carries its own `isLocked` disable, so unavailability is stated per
           control rather than by making the whole cluster vanish. -->
      <div class="flex shrink-0 items-center gap-0.5">
        <!-- Expand/collapse is handled by OTable's built-in expand button when expansion="multiple" -->

        <!-- Disabled without `canRecordFrom` because the action promises a restore the
             installed extension cannot perform. -->
        <OTooltip v-if="!readonly" :content="recordBeforeTooltip">
          <!-- The span is the hover target, not the button: a disabled control
               dispatches no pointer events, so a tooltip bound straight to it would
               stay shut in the one state that has something to explain. The marker
               preview rides the same span for the same reason, and focus is bound
               alongside hover so the destination is not mouse-only. -->
          <span
            class="inline-flex max-md:hidden"
            @mouseenter="onRecordBeforeEnter(row)"
            @mouseleave="onRecordBeforeLeave"
            @focusin="onRecordBeforeFocus(row)"
            @focusout="onRecordBeforeBlur"
          >
            <OButton
              variant="ghost"
              size="xs"
              :aria-label="t('synthetics.journey.recordBeforeStep')"
              data-test="synthetics-journey-step-record-before-btn"
              :disabled="recordBeforeDisabled()"
              @click="emit('record-before', row)"
            >
              <!-- The same icon as the toolbar's Record button: this row action starts a
                   recording too, just anchored, so the two must read as one action. -->
              <OIcon name="smart-display" size="sm" aria-hidden="true" />
            </OButton>
          </span>
        </OTooltip>

        <OButton
          v-if="!readonly"
          variant="ghost"
          size="xs"
          class="max-md:hidden"
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
          class="max-md:hidden"
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
          class="hover:text-status-error-text max-md:hidden"
          @click="emit('delete', row)"
        >
          <OIcon name="delete" size="sm" aria-hidden="true" />
        </OButton>

        <ODropdown v-if="!readonly" side="bottom" align="end">
          <template #trigger>
            <OButton
              icon-left="more-vert"
              variant="ghost"
              size="icon-xs-sq"
              class="md:hidden"
              data-test="synthetics-journey-step-row-more-actions"
              @click.stop
            />
          </template>
          <ODropdownItem
            icon-left="smart-display"
            class="md:hidden"
            :disabled="recordBeforeDisabled()"
            data-test="synthetics-journey-step-record-before-btn-menu"
            @select="emit('record-before', row)"
          >
            <span>{{ t("synthetics.journey.recordBeforeStep") }}</span>
          </ODropdownItem>
          <ODropdownItem
            icon-left="add"
            class="md:hidden"
            :disabled="isLocked"
            data-test="synthetics-journey-step-insert-btn-menu"
            @select="emit('insert-below', row)"
          >
            <span>{{ t("synthetics.journey.insertStepBelow") }}</span>
          </ODropdownItem>
          <ODropdownItem
            icon-left="content-copy"
            class="md:hidden"
            :disabled="isLocked"
            data-test="synthetics-journey-step-duplicate-btn-menu"
            @select="emit('duplicate', row)"
          >
            <span>{{ t("synthetics.journey.duplicateStep") }}</span>
          </ODropdownItem>
          <ODropdownItem
            icon-left="delete"
            variant="destructive"
            class="md:hidden"
            :disabled="isLocked"
            data-test="synthetics-journey-step-delete-btn-menu"
            @select="emit('delete', row)"
          >
            <span>{{ t("synthetics.journey.deleteStepAria") }}</span>
          </ODropdownItem>
        </ODropdown>
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
