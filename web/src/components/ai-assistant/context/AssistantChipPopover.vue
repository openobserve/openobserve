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
  <OPopover
    :open="open"
    privacy="mask"
    side="top"
    align="start"
    :aria-label="chip.kind === 'time' ? t('assistant.context.time.swap') : chip.label"
    content-class="flex w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(32rem,70vh)] flex-col gap-3 overflow-y-auto p-3"
    @update:open="(value) => emit('update:open', value)"
  >
    <template #anchor>
      <slot name="anchor" />
    </template>

    <div
      ref="body"
      :data-test="chip.kind === 'time' ? 'assistant-context-time-picker' : 'assistant-chip-popover'"
      data-dd-privacy="mask"
      class="flex min-w-0 flex-col gap-3"
    >
      <header class="flex min-w-0 items-start gap-2">
        <OIcon :name="chipGlyph[chip.kind]" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <OText variant="body-strong" class="break-words">{{ chip.label }}</OText>
          <OText variant="meta" data-test="assistant-chip-provenance">{{ provenance }}</OText>
        </div>
      </header>

      <template v-if="chip.kind === 'time'">
        <OText
          v-if="window?.source === 'default'"
          variant="meta"
          data-test="assistant-context-time-default-note"
        >
          {{ t("assistant.context.time.defaultNote") }}
        </OText>
        <ODateTimeRange
          v-bind="pickerValue"
          :timezone="timezone"
          show-timezone
          :auto-apply="false"
          tabindex="0"
          data-test="assistant-context-time-range"
          @change="onPick"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <OButton
            variant="ghost"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :disabled="window?.source !== 'custom'"
            data-test="assistant-context-time-page"
            @click="emit('apply-time', null)"
          >
            {{ t("assistant.context.time.usePage") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            :disabled="!picked"
            data-test="assistant-context-time-apply"
            @click="picked && emit('apply-time', picked)"
          >
            {{ t("assistant.context.time.apply") }}
          </OButton>
        </div>
      </template>

      <template v-else>
        <img
          v-if="chip.kind === 'image' && imageSrc"
          :src="imageSrc"
          :alt="chip.label"
          class="rounded-default max-h-80 max-w-full self-start object-contain"
          data-test="assistant-chip-image"
        />
        <ul v-else-if="rows.length > 1" class="flex flex-col gap-2" data-test="assistant-chip-rows">
          <li v-for="(row, index) in rows" :key="index" class="flex min-w-0 items-start gap-1">
            <OCollapsible :label="rowTitle(row, index)" class="min-w-0 flex-1">
              <AssistantFieldList :row="row" :hide-internal="hideInternal" />
            </OCollapsible>
            <OButton
              v-if="!readonly"
              variant="ghost"
              size="icon-xs"
              class="max-md:size-11 pointer-coarse:size-11"
              :aria-label="t('assistant.context.removeRow', { n: index + 1 })"
              data-test="assistant-chip-remove-row"
              @click="emit('remove-row', index)"
            >
              <OIcon :name="assistantGlyph.close" size="xs" />
            </OButton>
          </li>
        </ul>
        <AssistantFieldList
          v-else-if="rows.length === 1"
          :row="rows[0]"
          :hide-internal="hideInternal"
        />
        <OCode
          v-else-if="codeText"
          block
          class="max-h-60 overflow-auto whitespace-pre-wrap"
          data-test="assistant-chip-code"
          >{{ codeText }}</OCode
        >
        <OText v-if="chip.truncated?.length" variant="meta" data-test="assistant-chip-truncated">
          {{ t("assistant.context.truncatedFields", { fields: truncatedList }) }}
        </OText>

        <div
          v-if="!readonly"
          class="flex flex-wrap items-center justify-between gap-2"
          data-chip-actions
        >
          <OSwitch
            v-if="hasInternal"
            :model-value="hideInternal"
            :label="t('assistant.context.trimInternal')"
            size="sm"
            data-test="assistant-chip-trim-internal"
            @update:model-value="(on) => emit('trim', !on)"
          />
          <span v-else />
          <OButton
            v-if="openLabel"
            variant="ghost"
            size="sm"
            :icon-right="assistantGlyph.openSource"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-chip-open-source"
            @click="emit('open-source')"
          >
            {{ openLabel }}
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            class="max-md:min-h-11 pointer-coarse:min-h-11"
            data-test="assistant-chip-remove"
            @click="emit('remove')"
          >
            {{ rows.length > 1 ? t("assistant.context.removeAll") : t("common.remove") }}
          </OButton>
        </div>
      </template>
    </div>
  </OPopover>
</template>

<script lang="ts">
import type { ComposerState, ContextChip, TimeWindow } from "@/composables/assistant";

export interface AssistantChipPopoverProps {
  chip: ContextChip;
  open: boolean;
  readonly?: boolean;
  /** `data:` URL of an image chip. */
  imageSrc?: string;
  window?: TimeWindow;
  timezone?: string;
  /** "Open in Logs": shown when the chip names something the explorer can open. */
  openLabel?: I18nText | null;
}

export interface AssistantChipPopoverEmits {
  (e: "update:open", open: boolean): void;
  (e: "remove"): void;
  (e: "remove-row", index: number): void;
  /** `true` sends `_o2_id` and `_original` too. */
  (e: "trim", includeInternal: boolean): void;
  /** `null` goes back to the page's time. */
  (e: "apply-time", range: ComposerState["timeOverride"]): void;
  /** Tab past the last control: the tray moves focus to the control after the chip. */
  (e: "tab-out"): void;
  /** Open in {page}: the tray opens it through the explorer applier. */
  (e: "open-source"): void;
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import { assistantGlyph, chipGlyph } from "@/components/ai-assistant/common/glyphs";
import { INTERNAL_FIELDS, periodMs } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import type {
  DateTimeRangeValue,
  RelativeUnit,
} from "@/lib/forms/DateTimeRange/ODateTimeRange.types";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { convertDateToTimestamp, formatTimestampInTimezone } from "@/utils/date";
import { formatCount, formatOrgTime } from "@/utils/formatters";

import AssistantFieldList from "./AssistantFieldList.vue";

const UNIT_OF: Record<string, RelativeUnit> = {
  s: "seconds",
  m: "minutes",
  h: "hours",
  d: "days",
  w: "weeks",
  M: "months",
};

const TABBABLE =
  "button:not([disabled]), [href], input:not([disabled]), [role='switch'], [tabindex='0']";

const LETTER_OF: Record<RelativeUnit, string> = {
  seconds: "s",
  minutes: "m",
  hours: "h",
  days: "d",
  weeks: "w",
  months: "M",
};

const props = withDefaults(defineProps<AssistantChipPopoverProps>(), {
  readonly: false,
  imageSrc: undefined,
  window: undefined,
  timezone: "UTC",
  openLabel: null,
});

const emit = defineEmits<AssistantChipPopoverEmits>();

defineSlots<{ anchor: () => unknown }>();

const { t } = useI18nTyped();
const picked = ref<ComposerState["timeOverride"]>(null);

const body = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) picked.value = null;
  },
);

// The body mounts with the open popover; focus then lands on the first action (the picker for the time chip), not a scroll box (CT-03 AC 5).
watch(body, async (el, _old, onCleanup) => {
  if (!el) return;
  el.addEventListener("keydown", onTab);
  onCleanup(() => el.removeEventListener("keydown", onTab));
  await nextTick();
  const first =
    el.querySelector<HTMLElement>('[data-test="datetimerange-trigger"]') ??
    el.querySelector("[data-chip-actions]")?.querySelector<HTMLElement>(TABBABLE) ??
    tabbables()[0];
  first?.focus();
});

function tabbables(): HTMLElement[] {
  return Array.from(body.value?.querySelectorAll<HTMLElement>(TABBABLE) ?? []);
}

// The popover is non-modal and portalled, so Tab at its edges goes back to the tray (APG, U3).
function onTab(event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const items = tabbables();
  if (items.length === 0) return;
  const active = document.activeElement;
  if (event.shiftKey && active === items[0]) {
    event.preventDefault();
    emit("update:open", false);
  } else if (!event.shiftKey && active === items[items.length - 1]) {
    event.preventDefault();
    emit("update:open", false);
    emit("tab-out");
  }
}

const hideInternal = computed(() => !props.chip.includeInternal);

const rows = computed<Record<string, unknown>[]>(() => {
  const data = props.chip.data;
  if (props.chip.kind === "image" || props.chip.kind === "time") return [];
  const isRow = (row: unknown): row is Record<string, unknown> =>
    !!row && typeof row === "object" && !Array.isArray(row);
  if (Array.isArray(data) && data.every(isRow)) return data;
  return isRow(data) && props.chip.kind !== "query" ? [data] : [];
});

const hasInternal = computed(() =>
  rows.value.some((row) => Object.keys(row).some((key) => INTERNAL_FIELDS.has(key))),
);

const codeText = computed(() => {
  const data = props.chip.data;
  if (rows.value.length > 0 || data === undefined || data === null) return "";
  return typeof data === "string" ? data : JSON.stringify(data, null, 2);
});

const truncatedList = computed(() => raw((props.chip.truncated ?? []).join(", ")));

const provenance = computed<I18nText>(() => {
  const from =
    props.chip.provenance === "page"
      ? t("assistant.context.fromPage")
      : t("assistant.context.fromChat");
  const parts: string[] = [from];
  if (props.chip.secondary) parts.push(props.chip.secondary);
  const characters = characterCount(props.chip.data);
  if (characters > 0 && props.chip.kind !== "time" && props.chip.kind !== "image")
    parts.push(
      t("assistant.context.characters", { count: raw(formatCount(characters)) }, characters),
    );
  return raw(parts.join(" · "));
});

// The picker opens on the window the chip shows: relative stays relative, a range shows its ends in the org zone.
const pickerValue = computed(() => {
  const window = props.window;
  const match = window?.period ? /^(\d+)([smhdwM])$/.exec(window.period) : null;
  if (window && match)
    return {
      mode: "relative" as const,
      relativeAmount: Number(match[1]),
      relativeUnit: UNIT_OF[match[2]],
    };
  if (!window)
    return { mode: "relative" as const, relativeAmount: 15, relativeUnit: "minutes" as const };
  const at = (ms: number, format: string) =>
    formatTimestampInTimezone(ms * 1000, format, props.timezone);
  return {
    mode: "absolute" as const,
    startDate: at(window.from, "YYYY-MM-DD"),
    startTime: at(window.from, "HH:mm"),
    endDate: at(window.to, "YYYY-MM-DD"),
    endTime: at(window.to, "HH:mm"),
  };
});

function onPick(value: DateTimeRangeValue): void {
  if (value.type === "relative") {
    const period = `${value.amount}${LETTER_OF[value.unit]}`;
    const to = Date.now();
    const from = to - periodMs(period);
    picked.value = { from, to, period };
    return;
  }
  const ms = (date: string, time: string) => {
    const [year, month, day] = date.split("-");
    return (
      convertDateToTimestamp(
        `${day}-${month}-${year}`,
        time || "00:00",
        value.timezone || props.timezone,
      ).timestamp / 1000
    );
  };
  const from = ms(value.startDate, value.startTime);
  const to = ms(value.endDate, value.endTime);
  picked.value = from > 0 && to > from ? { from, to } : null;
}

// Characters of the attached value as the assistant reads it, not its UTF-8 bytes.
function characterCount(data: unknown): number {
  if (data === undefined || data === null) return 0;
  return typeof data === "string" ? data.length : (JSON.stringify(data)?.length ?? 0);
}

function rowTitle(row: Record<string, unknown>, index: number): I18nText {
  const ts = Number(row._timestamp);
  const time =
    Number.isFinite(ts) && ts > 0
      ? formatOrgTime(ts > 1e14 ? ts / 1000 : ts, { precision: "second" })
      : String(index + 1);
  const service = typeof row.service_name === "string" ? ` · ${row.service_name}` : "";
  return raw(`${time}${service}`);
}
</script>
