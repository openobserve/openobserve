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
  <span
    v-if="loading"
    class="inline-flex shrink-0 items-center"
    aria-hidden="true"
    data-test="assistant-context-chip-time-skeleton"
  >
    <OSkeleton type="rect" class="h-6 w-24" />
  </span>
  <template v-else>
    <!-- The popover positions on this, not on a trigger: a set range carries a ✕ beside its label -->
    <span ref="anchor" class="flex min-w-0">
      <OTooltip>
        <OTag
          type="assistantContext"
          :label="text"
          :icon="assistantGlyph.chipTime"
          clickable
          :disabled="disabled"
          :removable="removable"
          label-button
          :remove-label="t('assistant.context.remove', { label: text })"
          remove-data-test="assistant-context-chip-time-remove"
          :aria-label="name"
          aria-haspopup="dialog"
          :aria-expanded="open"
          :class="['h-7 min-w-0 motion-safe:transition-colors', CHIP_HIT_AREA_CLASS]"
          data-test="assistant-context-chip-time"
          @click="setOpen(!open)"
          @remove="pick(null)"
        >
          <span class="truncate">{{ text }}</span
          ><OIcon :name="assistantGlyph.expand" size="xs" />
        </OTag>
        <!-- A long range is cut in a narrow composer, so the tooltip carries it in full -->
        <template #content>
          <span class="block">{{ text }}</span
          >{{ t("assistant.context.time.hint") }}
        </template>
      </OTooltip>
    </span>
    <OPopover
      :open="open"
      :anchor="anchor"
      side="top"
      :align="align"
      :aria-label="t('assistant.context.time.swap')"
      :collision-padding="COLLISION_PADDING"
      :content-class="contentClass"
      :z-index="zIndex"
      @update:open="onOpenChange"
      @pointer-down-outside="onPointerOutside"
    >
      <!-- The content is portalled out of the assistant root, so it carries the root's masking and colour roles itself -->
      <div
        ref="picker"
        class="flex flex-col gap-0.5"
        data-dd-privacy="mask"
        data-assistant-surface
        data-test="assistant-context-time-picker"
      >
        <!-- Custom Range… swaps the presets for the range picker, so only one surface is ever open. -->
        <div v-if="ranging" ref="range" data-test="assistant-context-time-range">
          <AssistantTimeRangePanel
            :window="window"
            :timezone="timezone"
            @period="pickPeriod"
            @range="onRange"
          />
        </div>
        <div
          v-else
          ref="group"
          role="radiogroup"
          tabindex="-1"
          :aria-label="t('assistant.context.time.swap')"
          class="flex flex-col gap-0.5"
          @keydown="onGroupKeydown"
        >
          <AssistantMenuRow
            v-if="pageWindow"
            :label="t('assistant.composer.mention.pageTime')"
            :meta="textOf(pageWindow)"
            :selected="window.source === 'page'"
            :tabbable="tabbableId === 'page'"
            data-test="assistant-context-time-page"
            @click="pick(null)"
          />
          <AssistantMenuRow
            v-for="period in PERIODS"
            :key="period"
            :label="periodLabel(period)"
            :selected="isSelected(period)"
            :tabbable="tabbableId === period"
            :data-test="`assistant-context-time-${period}`"
            @click="pickPeriod(period)"
          />
          <div class="border-border-default mt-0.5 border-t pt-0.5">
            <AssistantMenuRow
              :label="t('assistant.context.time.customRange')"
              :selected="customSelected"
              :tabbable="tabbableId === 'custom'"
              data-test="assistant-context-time-custom"
              @click="openRange"
            />
          </div>
        </div>
      </div>
    </OPopover>
  </template>
</template>

<script lang="ts">
import type { ComposerState, TimeWindow } from "@/composables/assistant";

export interface AssistantTimePrefixProps {
  window: TimeWindow;
  /** The page's own window, offered as "Page time"; null where the page has none. */
  pageWindow?: TimeWindow | null;
  timezone?: string;
  align?: "start" | "end";
  disabled?: boolean;
  /** The page range is still loading, so the chip would name a window that is about to change. */
  loading?: boolean;
  /** The chip has no ✕: the default window is always one pick away, so there is nothing to remove. */
  fixed?: boolean;
}

export interface AssistantTimePrefixEmits {
  /** `null` goes back to the page's time or the default. */
  (e: "change", range: ComposerState["timeOverride"]): void;
}

const PERIODS = ["15m", "1h", "24h", "7d"] as const;

// The main time picker's room rules: clear the app header, and never grow past the space on the open side.
const COLLISION_PADDING = { top: 48, right: 8, bottom: 8, left: 8 };
const FIT_CLASS =
  "max-h-[calc(var(--reka-popper-available-height,37.5rem)-0.75rem)] overflow-y-auto";

const DEFAULT_PERIOD = "15m";

// The popup takes the top layer of the dialog or sheet it opens in, on ODialog's ladder.
const LAYER_BASE = 6000;
const LAYER_STEP = 1000;
</script>

<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import {
  CHIP_HIT_AREA_CLASS,
  composerPopoverClass,
  useComposerLayout,
} from "@/components/ai-assistant/composer/composerUi";
import { periodMs, timeRangeShortText } from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantMenuRow from "./AssistantMenuRow.vue";
import AssistantTimeRangePanel from "./AssistantTimeRangePanel.vue";

const props = withDefaults(defineProps<AssistantTimePrefixProps>(), {
  pageWindow: null,
  timezone: "UTC",
  align: "start",
  disabled: false,
  loading: false,
  fixed: false,
});

const emit = defineEmits<AssistantTimePrefixEmits>();

/** The picker; a + menu opens it from outside. */
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const layout = useComposerLayout();
const zIndex = LAYER_BASE + LAYER_STEP * inject<number>(DIALOG_DEPTH_KEY, 0);
/** The popup shows the range picker in place of the presets. */
const ranging = ref(false);
const group = ref<HTMLElement | null>(null);
const range = ref<HTMLElement | null>(null);
const anchor = ref<HTMLElement | null>(null);
const picker = ref<HTMLElement | null>(null);
/** The popup closed on a press elsewhere, which keeps focus where the user put it. */
let pressedOutside = false;

// Presets keep the composer's popup width; the range picker keeps its own so the relative grid never wraps.
const contentClass = computed(() =>
  ranging.value
    ? `w-80 max-w-[calc(100vw-1rem)] ${FIT_CLASS}`
    : `${composerPopoverClass(layout.value.tight)} ${FIT_CLASS} flex flex-col gap-0.5 p-1`,
);

// Reset on open, not close, so the exit animation never flashes the presets.
watch(open, (value) => {
  if (!value) return;
  ranging.value = false;
});

const text = computed(() => textOf(props.window));
// Only a range the user picked can be dropped; its ✕ goes back to the page's time or the default.
const removable = computed(
  () => props.window.source === "custom" && !props.disabled && !props.fixed,
);
const name = computed(() =>
  t("assistant.context.time.name", {
    range: text.value,
    source: t(`assistant.context.time.source.${props.window.source}`),
  }),
);

// A range the user set that no preset names: an absolute range, or a relative one picked in the range picker.
const customSelected = computed(
  () => props.window.source === "custom" && !PERIODS.some((period) => isSelected(period)),
);

// Roving tabindex: Tab reaches the checked row.
const tabbableId = computed(() => {
  if (props.pageWindow && props.window.source === "page") return "page";
  const checked = PERIODS.find((period) => isSelected(period));
  if (checked) return checked;
  if (customSelected.value) return "custom";
  return props.pageWindow ? "page" : PERIODS[0];
});

function textOf(window: TimeWindow): I18nText {
  const short = timeRangeShortText(window);
  return window.period ? t("assistant.context.time.last", { period: short }) : short;
}

function periodLabel(period: string): I18nText {
  return textOf({ from: 0, to: 0, period, source: "custom" });
}

function isSelected(period: string): boolean {
  if (props.window.source === "page") return false;
  return props.window.period === period;
}

function setOpen(value: boolean): void {
  open.value = value;
}

// The row that opened the picker is gone, so focus moves into the picker for keyboard users.
async function openRange(): Promise<void> {
  ranging.value = true;
  await nextTick();
  range.value?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
}

// A press on the chip toggles the picker itself, so it must not also count as a press outside.
function onPointerOutside(event: Event): void {
  if (event.defaultPrevented) return;
  if (event.target instanceof Node && anchor.value?.contains(event.target))
    return event.preventDefault();
  pressedOutside = true;
}

// The popover hands focus back only to a trigger, and the chip is an anchor, so it takes focus back here.
async function returnFocus(): Promise<void> {
  const inPicker = picker.value;
  // After the host redraws the chip: a picked range swaps its button for one with a ✕.
  await nextTick();
  const active = document.activeElement;
  const movedOn =
    active &&
    active !== document.body &&
    !inPicker?.contains(active) &&
    !anchor.value?.contains(active);
  if (!movedOn) anchor.value?.querySelector<HTMLElement>("button")?.focus();
}

function onOpenChange(value: boolean): void {
  setOpen(value);
  if (!value && !pressedOutside) void returnFocus();
  pressedOutside = false;
}

function pick(range: ComposerState["timeOverride"]): void {
  emit("change", range);
  onOpenChange(false);
}

function pickPeriod(period: string): void {
  if (period === DEFAULT_PERIOD && !props.pageWindow) return pick(null);
  const to = Date.now();
  pick({ from: to - periodMs(period), to, period });
}

// A time edit applies and leaves the picker open for the next one; two dates or Enter finish the entry.
function onRange(value: { from: number; to: number }, done: boolean): void {
  if (done) return pick(value);
  emit("change", value);
}

// Arrows move focus only; picking a row applies it and closes the picker, so selection cannot follow focus.
function onGroupKeydown(event: KeyboardEvent): void {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
  const isEdge = event.key === "Home" || event.key === "End";
  if (!step && !isEdge) return;
  const rows = Array.from(group.value?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []);
  if (!rows.length) return;
  event.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : (Math.max(at, 0) + (step ?? 0) + rows.length) % rows.length;
  rows[next].focus();
}
</script>
