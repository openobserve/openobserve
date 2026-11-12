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
    :id="id"
    ref="scroller"
    role="listbox"
    tabindex="-1"
    :aria-label="t('dateTime.timeRanges')"
    data-test="date-time-list"
    class="h-full overflow-y-auto overscroll-contain py-1 outline-none"
    :class="CUE_CLASSES[cue ?? 'none']"
    @scroll.passive="updateCue"
  >
    <div
      v-if="heading"
      class="text-text-secondary px-3 pt-1 pb-1.5 text-xs"
      data-test="date-time-list-heading"
    >
      {{ heading }}
    </div>
    <template v-for="(row, index) in rows" :key="row.id">
      <div
        v-if="index > 0 && row.group !== rows[index - 1].group"
        aria-hidden="true"
        class="border-border-subtle mx-3 my-1 border-t"
      />
      <!-- Focus stays in the bar, so a press must not blur it before the click lands. -->
      <div
        :id="`${id}-${index}`"
        role="option"
        :aria-selected="index === active"
        :aria-disabled="row.disabled || undefined"
        :aria-label="row.meta ? `${row.label}, ${row.meta}` : row.label"
        :data-test="row.testId"
        :data-active="index === active ? 'true' : undefined"
        class="o-range-list__row rounded-default text-compact relative mx-1 flex h-7 items-center gap-2 px-2 max-md:h-10"
        :class="[
          index === active ? 'bg-surface-subtle' : '',
          row.disabled
            ? 'text-text-disabled cursor-not-allowed'
            : 'text-text-heading cursor-pointer',
        ]"
        @mousedown.prevent
        @mousemove="onRowPointer(index, row)"
        @click="!row.disabled && emit('pick', index)"
      >
        <OTooltip
          v-if="row.tooltip && row.kind !== 'example'"
          side="left"
          :side-offset="12"
          :content="raw(row.tooltip)"
        />
        <span
          v-if="row.kind !== 'example'"
          class="inline-flex size-5 shrink-0 items-center justify-center"
        >
          <OButton
            v-if="row.kind === 'pinned' && row.id !== editingId"
            variant="ghost"
            size="icon-chip"
            icon-left="star"
            tabindex="-1"
            :data-test="`${row.testId}-unpin`"
            :aria-label="t('dateTime.unpinRange', { range: row.label })"
            class="text-accent!"
            @click.stop="emit('unpin', row.id)"
          >
            <OTooltip side="left" :content="t('dateTime.unpin')" />
          </OButton>
          <OButton
            v-else-if="row.kind === 'recent' && showsActions(index)"
            variant="ghost"
            size="icon-chip"
            icon-left="star-outline"
            tabindex="-1"
            :data-test="`${row.testId}-pin`"
            :aria-label="t('dateTime.pinRange', { range: row.label })"
            class="text-text-secondary! hover:text-text-heading!"
            @click.stop="emit('pin', row.id)"
          >
            <OTooltip side="left" :content="t('dateTime.pinSavedInBrowser')" shortcut="alt+p" />
          </OButton>
          <OIcon
            v-else
            :name="ICONS[row.kind]"
            size="sm"
            :class="row.kind === 'pinned' ? 'text-accent' : 'text-text-secondary'"
          />
        </span>
        <div v-if="row.id === editingId" class="min-w-0 flex-1" @mousedown.stop @click.stop>
          <OInlineEdit
            ref="pinNameEdit"
            :model-value="''"
            size="sm"
            class="text-compact font-normal"
            :maxlength="80"
            :placeholder="t('dateTime.name')"
            :aria-label="t('dateTime.nameRange', { range: row.label })"
            :submit-on-enter="false"
            data-test="date-time-list-pin-name"
            @commit="emit('rename', row.id, $event)"
            @cancel="emit('rename-cancel', row.id)"
          />
        </div>
        <span
          v-else
          class="min-w-0 flex-1 truncate tabular-nums"
          :class="{ 'font-mono text-xs': row.kind === 'example' }"
        >
          <template v-for="(piece, pieceIndex) in pieces(row)" :key="pieceIndex">
            <strong v-if="piece.matched" class="font-semibold">{{ piece.text }}</strong>
            <template v-else>{{ piece.text }}</template>
          </template>
        </span>
        <span v-if="row.hint" class="text-text-secondary shrink-0 tabular-nums">{{
          row.hint
        }}</span>
        <span
          v-if="row.id === editingId"
          class="text-text-secondary shrink-0 text-xs tabular-nums"
          data-test="date-time-list-pin-range"
          >{{ row.meta || row.label }}</span
        >
        <span
          v-else-if="row.meta"
          class="inline-flex max-w-[60%] shrink-0 items-center gap-1 text-xs tabular-nums"
          :class="row.reason ? 'text-text-disabled' : 'text-text-secondary'"
          :data-test="row.reason ? `${row.testId}-reason` : undefined"
        >
          <OIcon v-if="row.reason" name="lock" size="xs" class="shrink-0" />
          <span class="truncate">{{ row.meta }}</span>
        </span>
        <span
          v-if="row.kind !== 'example'"
          class="inline-flex size-5.5 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          <OButton
            v-if="row.kind === 'recent' && showsActions(index)"
            variant="ghost"
            size="icon-chip"
            icon-left="close"
            tabindex="-1"
            :data-test="`${row.testId}-remove`"
            :aria-label="t('common.timeRangeRemoveRecent', { range: row.label })"
            class="text-text-secondary! hover:text-text-heading!"
            @click.stop="emit('remove', row.id)"
          />
          <OShortcut
            v-else-if="index === active && (row.id === editingId || ENTER_KINDS.includes(row.kind))"
            keys="enter"
            size="sm"
          />
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import {
  scrollCue,
  splitLabelMatches,
  type ScrollCue,
  type TimeRangeListKind,
  type TimeRangeListRow,
} from "@/utils/timeRangeList";

const ICONS: Record<Exclude<TimeRangeListKind, "example">, string> = {
  pinned: "star",
  recent: "history",
  calendar: "calendar-month",
  suggestion: "schedule",
  anchor: "target",
  "to-now": "arrow-forward",
  reading: "schedule",
};

// Rows whose cursor shows the Enter key in the trailing slot.
const ENTER_KINDS: readonly TimeRangeListKind[] = [
  "calendar",
  "suggestion",
  "anchor",
  "to-now",
  "reading",
];

const CUE_CLASSES: Record<NonNullable<ScrollCue> | "none", string> = {
  none: "",
  top: "shadow-[var(--shadow-scroll-top)]",
  bottom: "shadow-[var(--shadow-scroll-bottom)]",
  both: "shadow-[var(--shadow-scroll-top),var(--shadow-scroll-bottom)]",
};

const props = defineProps<{
  id: string;
  rows: TimeRangeListRow[];
  /** Index of the one cursor row, set by keys and by the pointer alike; -1 when none. */
  active: number;
  /** The pinned row whose name is being typed, if any. */
  editingId?: string | null;
  /** A line above the rows, such as the examples' lead-in. */
  heading?: string;
}>();

const emit = defineEmits<{
  pick: [index: number];
  cursor: [index: number];
  pin: [rowId: string];
  unpin: [rowId: string];
  remove: [rowId: string];
  rename: [rowId: string, name: string];
  "rename-cancel": [rowId: string];
}>();

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();
const pinNameEdit = ref<{ focus: () => void }[] | { focus: () => void } | null>(null);
const scroller = ref<HTMLElement | null>(null);
const cue = ref<ScrollCue>(null);

const pieces = (row: TimeRangeListRow) => splitLabelMatches(row.label, row.match);

// A phone has no hover, so its Recent rows always show pin and remove.
const showsActions = (index: number) => index === props.active || isMobile.value;

// The pointer moves the same cursor the arrow keys do, so only one row is ever lit (D1).
const onRowPointer = (index: number, row: TimeRangeListRow) => {
  if (row.disabled || row.kind === "example" || index === props.active) return;
  emit("cursor", index);
};

const updateCue = () => {
  const box = scroller.value;
  cue.value = box ? scrollCue(box) : null;
};

onMounted(updateCue);
watch(
  () => props.rows,
  async () => {
    await nextTick();
    updateCue();
  },
);

// The cursor moves while focus stays in the bar, so its row is scrolled into view by hand.
watch(
  () => props.active,
  async (index) => {
    if (index < 0) return;
    await nextTick();
    document.getElementById(`${props.id}-${index}`)?.scrollIntoView?.({ block: "nearest" });
  },
);

// A just-pinned row opens straight into its name field.
watch(
  () => props.editingId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const edit = Array.isArray(pinNameEdit.value) ? pinNameEdit.value[0] : pinNameEdit.value;
    edit?.focus();
  },
  { immediate: true },
);
</script>

<style scoped>
/* Forced colours drop backgrounds, so the cursor row keeps a system highlight. */
@media (forced-colors: active) {
  .o-range-list__row[data-active] {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
  .o-range-list__row[aria-disabled] {
    color: GrayText;
  }
}
</style>
