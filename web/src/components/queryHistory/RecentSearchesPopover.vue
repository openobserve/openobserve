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

<template>
  <div
    ref="rootRef"
    tabindex="-1"
    class="text-select-item-text flex min-h-0 w-[min(26.75rem,calc(100vw-1rem))] max-w-full flex-col font-sans text-[0.8125rem] outline-none"
    data-test="recent-searches-popover"
    @keydown="onKeydown"
  >
    <div
      class="border-border-subtle text-dropdown-label text-2xs flex h-6 shrink-0 items-center gap-1.5 border-b ps-2 pe-1 font-semibold uppercase"
    >
      <OIcon name="history" size="xs" />
      <span class="truncate">{{ t(`recentSearches.pageTitle.${source}`) }}</span>
      <OButton
        variant="ghost"
        size="icon-xs"
        icon-left="info-outline"
        class="ms-auto normal-case"
        :aria-label="`${about} ${t('recentSearches.keyHints')}`"
        data-test="recent-searches-about"
      >
        <OTooltip>
          <template #content>
            <span class="flex flex-col gap-1">
              <span>{{ about }}</span>
              <span data-test="recent-searches-key-hints">{{ t("recentSearches.keyHints") }}</span>
            </span>
          </template>
        </OTooltip>
      </OButton>
    </div>

    <OEmptyState
      v-if="list.isError.value"
      size="inline"
      icon="error"
      :title="t('recentSearches.loadError')"
      :action-label="t('recentSearches.retry')"
      action-icon="refresh"
      data-test="recent-searches-error"
      @action="list.refetch()"
    />
    <div v-else-if="list.isPending.value" class="flex flex-col gap-2 p-2">
      <OSkeleton v-for="n in 4" :key="n" type="text" />
    </div>
    <div v-else-if="isEmpty" class="flex flex-col items-center gap-2 p-3">
      <OEmptyState
        size="inline"
        icon="history"
        :title="t('recentSearches.emptyTitle')"
        data-test="recent-searches-empty"
      />
      <div v-if="examples.length" class="flex flex-wrap justify-center gap-2">
        <OButton
          v-for="(example, index) in examples"
          :key="index"
          variant="outline"
          size="xs"
          icon-left="lightbulb"
          :data-test="`recent-searches-example-${index}`"
          @click="emit('example', example)"
        >
          <OTruncatedText class="max-w-60 font-mono">{{ example }}</OTruncatedText>
        </OButton>
      </div>
    </div>
    <div
      v-else
      ref="listRef"
      role="listbox"
      :aria-label="t('recentSearches.title')"
      class="max-h-72 min-h-0 overflow-auto"
      data-test="recent-searches-list"
      @pointerenter="keepHover"
      @pointerleave="onPointerLeave"
    >
      <div
        v-if="view.pinnedFailure"
        :class="[ROW_ACTIVE_CLASSES, 'flex flex-col gap-0.5 py-0.5 ps-1.5 pe-1']"
        :data-highlighted="highlighted(view.pinnedFailure.entry.id)"
        data-test="recent-searches-pinned-failure"
        @pointerenter="onRowEnter(view.pinnedFailure.entry.id)"
      >
        <div class="flex h-6 min-w-0 items-center gap-2">
          <button
            type="button"
            role="option"
            data-recent-row
            :data-recent-id="view.pinnedFailure.entry.id"
            :aria-selected="activeId === view.pinnedFailure.entry.id"
            class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none"
            @focus="onRowFocus(view.pinnedFailure.entry.id)"
            @blur="onRowBlur"
            @click="pick(view.pinnedFailure.entry, $event, true)"
            @keydown.enter.exact.prevent="pick(view.pinnedFailure.entry, $event, true)"
            @keydown.shift.enter.exact.prevent="pick(view.pinnedFailure.entry, $event, true)"
          >
            <span class="flex size-4 shrink-0 items-center justify-center">
              <OIcon name="error" size="xs" class="text-status-error-text" />
            </span>
            <OTruncatedText class="flex-1 font-mono text-xs">
              {{ oneLine(view.pinnedFailure.entry.query) }}
            </OTruncatedText>
          </button>
          <OButton
            variant="outline"
            size="xs"
            data-test="recent-searches-load-to-fix"
            @click="emit('load', view.pinnedFailure.entry, 'original')"
          >
            {{ t("recentSearches.loadToFix") }}
          </OButton>
        </div>
        <OTruncatedText
          v-if="view.pinnedFailure.entry.context.error"
          :tooltip="raw(view.pinnedFailure.entry.context.error)"
          class="text-status-error-text text-2xs ps-6"
          data-test="recent-searches-pinned-error"
        >
          {{ view.pinnedFailure.entry.context.error }}
        </OTruncatedText>
      </div>
      <button
        v-for="row in view.rows"
        :key="row.entry.id"
        type="button"
        role="option"
        data-recent-row
        :data-recent-id="row.entry.id"
        :aria-selected="activeId === row.entry.id"
        :data-highlighted="highlighted(row.entry.id)"
        :class="[
          ROW_ACTIVE_CLASSES,
          'flex h-6 w-full cursor-pointer items-center gap-2 ps-1.5 pe-2 text-left outline-none',
        ]"
        :data-test="`recent-searches-row-${row.entry.id}`"
        @focus="onRowFocus(row.entry.id)"
        @blur="onRowBlur"
        @pointerenter="onRowEnter(row.entry.id)"
        @click="pick(row.entry, $event, false)"
        @keydown.enter.exact.prevent="pick(row.entry, $event, false)"
        @keydown.shift.enter.exact.prevent="pick(row.entry, $event, false)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <OIcon
            :name="row.starred ? 'star' : 'history'"
            size="xs"
            :class="row.starred ? 'text-accent' : 'text-select-item-selected-text'"
          />
        </span>
        <OTruncatedText :tooltip="false" class="flex-1 font-mono text-xs">
          {{ oneLine(row.entry.query) }}
        </OTruncatedText>
        <span
          v-if="row.entry.context.warning !== undefined"
          class="bg-status-warning-text size-2 shrink-0 rounded-full"
          data-test="recent-searches-warning-dot"
        >
          <OTooltip :content="t('recentSearches.warning')" />
        </span>
        <OTimeCell
          :value="row.entry.updated_at"
          unit="us"
          mode="relative"
          class="text-text-secondary text-2xs shrink-0"
        />
      </button>
    </div>

    <div
      class="border-border-subtle text-text-secondary flex h-7 shrink-0 items-center gap-1 border-t px-1 text-xs"
    >
      <OButton
        variant="ghost-primary"
        size="xs"
        icon-left="history"
        data-test="recent-searches-view-all"
        @click="emit('view-all', null)"
      >
        {{ t("recentSearches.viewAll") }}
      </OButton>
      <OButton
        v-if="failedCount > 0"
        variant="ghost-muted"
        size="xs"
        data-test="recent-searches-view-failed"
        @click="emit('view-all', 'error')"
      >
        {{ t("recentSearches.failedCount", { count: failedCount }) }}
      </OButton>
    </div>

    <RecentSearchesDetails
      v-if="activeEntry"
      ref="detailsRef"
      :entry="activeEntry"
      :anchor="rootRef"
      @enter="onPaneEnter"
      @leave="onPointerLeave"
      @focus-leave="onPaneFocusLeave"
      @back="focusHeldRow"
      @escape="emit('close')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  useRecentFailedCount,
  useRecentSearches,
  useRecentSearchesList,
} from "@/composables/queryHistory/useRecentSearches";
import { useRecentEntryText } from "@/composables/queryHistory/useRecentEntryText";
import {
  buildRecents,
  defaultRestoreTime,
  type RestoreTime,
} from "@/utils/queryHistory/recentSearches";
import type { HistorySource, HistoryStatus, QueryHistoryEntry } from "@/services/query_history";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import RecentSearchesDetails from "./RecentSearchesDetails.vue";

const ROW_ACTIVE_CLASSES =
  "border-s-2 border-transparent data-[highlighted]:border-accent data-[highlighted]:bg-select-item-selected-bg";
const HOVER_LEAVE_GRACE_MS = 200;

const props = withDefaults(
  defineProps<{
    source: HistorySource;
    /** Fetches while true, so a closed popover costs nothing. */
    active: boolean;
    /** Example queries for the first-time empty state. */
    examples?: string[];
  }>(),
  { examples: () => [] },
);

const emit = defineEmits<{
  run: [entry: QueryHistoryEntry, when: RestoreTime];
  load: [entry: QueryHistoryEntry, when: RestoreTime];
  "view-all": [status: HistoryStatus | null];
  example: [query: string];
  close: [];
}>();

const { t } = useI18nTyped();
const { zone } = useRecentEntryText();
const { about } = useRecentSearches();
const list = useRecentSearchesList(props.source, toRef(props, "active"));
const failed = useRecentFailedCount(props.source, toRef(props, "active"));
const rootRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const detailsRef = ref<InstanceType<typeof RecentSearchesDetails> | null>(null);

const view = computed(() => buildRecents(list.data.value ?? []));
// The server counts the pinned failure too, and the two answers can land apart.
const failedCount = computed(() =>
  Math.max(0, (failed.data.value ?? 0) - (view.value.pinnedFailure ? 1 : 0)),
);
const isEmpty = computed(() => !view.value.pinnedFailure && view.value.rows.length === 0);

const oneLine = (query: string) => query.replace(/\s+/g, " ").trim();

// One row at a time carries the menu's active state: the hovered one, else the keyboard-focused one, else the one whose details hold the pointer or focus.
const focusedId = ref<string | null>(null);
const hoveredId = ref<string | null>(null);
const heldId = ref<string | null>(null);
const activeId = computed(() => hoveredId.value ?? focusedId.value ?? heldId.value);
const highlighted = (id: string) => (activeId.value === id ? "" : undefined);

const activeEntry = computed(() => {
  const id = activeId.value;
  if (!id) return null;
  if (view.value.pinnedFailure?.entry.id === id) return view.value.pinnedFailure.entry;
  return view.value.rows.find((row) => row.entry.id === id)?.entry ?? null;
});

// The pointer crosses the gap to the details pane, or brushes the list's edge, without meaning to drop the row.
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
const keepHover = () => clearTimeout(leaveTimer);
const onPointerLeave = (event: PointerEvent) => {
  const to = event.relatedTarget as Node | null;
  if (to && (detailsRef.value?.contains(to) || listRef.value?.contains(to))) return;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => {
    hoveredId.value = null;
    if (!detailsRef.value?.hasFocus()) heldId.value = null;
  }, HOVER_LEAVE_GRACE_MS);
};
onBeforeUnmount(() => clearTimeout(leaveTimer));

// Moving to the pane blurs or un-hovers the row before the pane is used, which would unmount it under the pointer or focus.
const holdActive = () => {
  if (activeId.value) heldId.value = activeId.value;
};

const onRowEnter = (id: string) => {
  keepHover();
  hoveredId.value = id;
  heldId.value = null;
};

const onRowFocus = (id: string) => {
  focusedId.value = id;
  heldId.value = null;
};

const onRowBlur = (event: FocusEvent) => {
  if (detailsRef.value?.contains(event.relatedTarget as Node | null)) holdActive();
  focusedId.value = null;
};

const onPaneEnter = () => {
  keepHover();
  holdActive();
};

const onPaneFocusLeave = (to: Node | null) => {
  if (listRef.value?.contains(to)) return;
  if (!detailsRef.value?.hasPointer()) heldId.value = null;
};

const focusHeldRow = () => {
  const id = activeId.value;
  rows()
    .find((row) => row.dataset.recentId === id)
    ?.focus();
};

// Shift loads without running; a failed row always loads, since running it again fails again.
const pick = (entry: QueryHistoryEntry, event: MouseEvent | KeyboardEvent, failed: boolean) => {
  const when = defaultRestoreTime(entry, Date.now(), zone.value);
  if (failed || event.shiftKey) emit("load", entry, when);
  else emit("run", entry, when);
};

const rows = () => [...(rootRef.value?.querySelectorAll<HTMLElement>("[data-recent-row]") ?? [])];

const moveFocus = (step: number) => {
  const all = rows();
  if (!all.length) return;
  const at = all.indexOf(document.activeElement as HTMLElement);
  const next = at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length;
  all[next].focus();
};

/** Pages the active row's details; false when no row is active, so the key stays with its owner. */
const scrollDetails = (step: 1 | -1) => detailsRef.value?.scrollPage(step) ?? false;

/** Whether a node belongs to the list, including its details pane outside the list's DOM. */
const ownsNode = (node: Node | null) =>
  !!node && (!!rootRef.value?.contains(node) || !!detailsRef.value?.contains(node));

const isPlainEnter = (event: KeyboardEvent) =>
  event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey;

const onKeydown = (event: KeyboardEvent) => {
  const onRow = event.target instanceof HTMLElement && event.target.hasAttribute("data-recent-row");
  // With focus on the list itself, Enter belongs to the hovered row and must not reach the page's run shortcut.
  if (isPlainEnter(event) && event.target === rootRef.value) {
    if (pickActive(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  } else if (event.key === "Tab" && !event.shiftKey && onRow && activeEntry.value) {
    holdActive();
    if (detailsRef.value?.focusCopy()) event.preventDefault();
  } else if (event.key === "PageDown" || event.key === "PageUp") {
    if (scrollDetails(event.key === "PageDown" ? 1 : -1)) event.preventDefault();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
};

/** Moves keyboard focus into the list, for the editor's ArrowDown handoff. */
const focusFirst = () => {
  const first = rows()[0];
  if (!first) return false;
  first.focus();
  return true;
};

/** Runs, or with Shift loads, the active row, as Enter would on it; false when no row is active. */
const pickActive = (event: KeyboardEvent) => {
  const entry = activeEntry.value;
  if (!entry) return false;
  pick(entry, event, entry.id === view.value.pinnedFailure?.entry.id);
  return true;
};

/** Handles a key pressed while focus is still outside the list; true when it was used. */
const handleOutsideKey = (event: KeyboardEvent) => {
  if (isPlainEnter(event)) return hoveredId.value !== null && pickActive(event);
  if (event.key === "PageDown" || event.key === "PageUp") {
    onKeydown(event);
    return event.defaultPrevented;
  }
  if (!["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) return false;
  onKeydown(event);
  return true;
};

/** Focuses the list itself rather than its first control, so Enter reaches the hovered row. */
const focusRoot = () => rootRef.value?.focus();

defineExpose({ focusFirst, focusRoot, pickActive, handleOutsideKey, scrollDetails, ownsNode });
</script>
