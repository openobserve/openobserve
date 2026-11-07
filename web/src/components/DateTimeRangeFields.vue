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
  <div data-test="date-time-range-fields" class="flex flex-1 flex-col gap-2">
    <div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
      <template v-for="edge in edges" :key="edge.name">
        <span :id="`${uid}-${edge.name}-label`" class="text-input-label-text text-xs font-medium">{{
          edge.label
        }}</span>
        <div
          dir="ltr"
          :data-test="`date-time-range-${edge.name}`"
          :data-error-part="edge.error ? edge.errorPart : undefined"
          class="rounded-default flex w-full min-w-0 items-center border"
          :class="[
            edge.error ? 'border-input-border-error' : 'border-input-border',
            edge.name === 'end' && pendingEnd ? 'border-dashed' : '',
            pasted ? 'bg-surface-tint-accent' : 'bg-input-bg',
          ]"
        >
          <div :data-test="`date-time-range-${edge.name}-date`" class="flex items-center py-0.5">
            <OSegmentedField
              :ref="(el) => setFieldRef(`${edge.name}Date`, el)"
              pattern="date"
              :model-value="edge.value.date"
              :error="!!edge.error && edge.errorPart !== 'time'"
              :hide-error-icon="!!edge.error && edge.errorPart === 'both'"
              :error-id="edge.error ? `${uid}-${edge.name}-error` : undefined"
              :aria-label="edge.dateLabel"
              :described-by="`${uid}-date-hint ${uid}-key-hint`"
              :segment-labels="segmentLabels"
              :min="minDate"
              :max="maxDate"
              @update:model-value="onPart(edge.name, 'date', $event)"
              @update:status="emit('status', `${edge.name}Date`, $event)"
              @complete="focusPart(edge.name, 'time', 'first')"
              @edge="$event === 'next' && focusPart(edge.name, 'time', 'first')"
              @submit="emit('submit')"
              @paste-text="emit('paste-text', $event)"
              @step="announce"
            />
          </div>
          <template v-if="!dateOnly">
            <span class="bg-border-default w-px self-stretch" aria-hidden="true" />
            <div
              :data-test="edge.name === 'start' ? 'datetime-start-time' : 'datetime-end-time'"
              class="flex min-w-0 flex-1 items-center py-0.5"
            >
              <OSegmentedField
                :ref="(el) => setFieldRef(`${edge.name}Time`, el)"
                :pattern="hourFormat === '12h' ? 'time12' : 'time'"
                :model-value="edge.value.time"
                :offsets="edge.offsets"
                :offset="edge.value.offset"
                :error="!!edge.error && edge.errorPart !== 'date'"
                :hide-error-icon="!!edge.error && edge.errorPart === 'both'"
                :error-id="edge.error ? `${uid}-${edge.name}-error` : undefined"
                :aria-label="edge.timeLabel"
                :described-by="`${uid}-time-hint ${uid}-key-hint`"
                :segment-labels="segmentLabels"
                :day-periods="DAY_PERIODS"
                @update:model-value="onPart(edge.name, 'time', $event)"
                @update:offset="onOffset(edge.name, $event)"
                @update:status="emit('status', `${edge.name}Time`, $event)"
                @edge="$event === 'prev' && focusPart(edge.name, 'date', 'last')"
                @submit="emit('submit')"
                @paste-text="emit('paste-text', $event)"
                @step="announce"
              />
            </div>
          </template>
        </div>
        <p
          v-if="edge.error"
          :id="`${uid}-${edge.name}-error`"
          :data-test="`date-time-range-${edge.name}-error`"
          class="text-input-error-text col-start-2 text-xs"
        >
          {{ edge.error }}
        </p>
      </template>

      <div v-if="!dateOnly" class="col-span-2 flex flex-wrap items-center gap-1.5">
        <OButton
          data-test="date-time-range-start-sod"
          variant="outline"
          size="chip"
          :disabled="!start.date"
          @click="emit('start-of-day')"
        >
          <span class="text-2xs">{{ t("common.rangeStartOfDay") }}</span>
          <OTooltip :content="raw(chipTime(START_OF_DAY))" />
        </OButton>
        <OButton
          data-test="date-time-range-end-eod"
          variant="outline"
          size="chip"
          :disabled="!end.date"
          @click="emit('end-of-day')"
        >
          <span class="text-2xs">{{ t("common.rangeEndOfDay") }}</span>
          <OTooltip :content="raw(chipTime(END_OF_DAY))" />
        </OButton>
        <OButton
          v-if="!hideNow"
          data-test="date-time-range-end-now"
          variant="outline"
          size="chip"
          @click="emit('now')"
        >
          <span class="text-2xs">{{ t("common.rangeNow") }}</span>
        </OButton>
      </div>
    </div>

    <OButton
      ref="applyBtn"
      data-test="date-time-apply-btn"
      variant="primary"
      size="sm-action"
      class="mt-auto self-end"
      :disabled="applyDisabled"
      @click="emit('apply')"
    >
      {{ t("common.apply") }}
    </OButton>

    <span :id="`${uid}-date-hint`" class="sr-only">{{ t("common.rangeDateHint") }}</span>
    <span :id="`${uid}-time-hint`" class="sr-only">{{
      hourFormat === "12h" ? t("common.rangeTimeHint12") : t("common.rangeTimeHint24")
    }}</span>
    <span :id="`${uid}-key-hint`" class="sr-only">{{ t("common.rangeKeyHint") }}</span>
    <span class="sr-only" aria-live="polite">{{ liveText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId, type ComponentPublicInstance } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSegmentedField from "@/lib/forms/SegmentedField/OSegmentedField.vue";
import type {
  SegmentedFieldExposed,
  SegmentedFieldStatus,
  SegmentedFieldStep,
} from "@/lib/forms/SegmentedField/OSegmentedField.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import {
  END_OF_DAY,
  START_OF_DAY,
  type DraftEdge,
  type DraftEdgeName,
} from "@/utils/dateTimeDraft";

export type RangeFieldPart = "startDate" | "startTime" | "endDate" | "endTime";

type FieldPart = "date" | "time";

const props = withDefaults(
  defineProps<{
    start: DraftEdge;
    end: DraftEdge;
    hourFormat: "24h" | "12h";
    startError?: I18nText;
    endError?: I18nText;
    /** Which part of each edge the error is about, so only that part turns red. */
    startErrorPart?: FieldPart | "both";
    endErrorPart?: FieldPart | "both";
    startOffsets?: string[];
    endOffsets?: string[];
    pasted?: boolean;
    /** A first calendar click is waiting for its end day. */
    pendingEnd?: boolean;
    dateOnly?: boolean;
    /** Hides Now, for a picker whose End may not be in the future or has no time. */
    hideNow?: boolean;
    minDate?: string;
    maxDate?: string;
    /** Apply stays disabled until the panel holds a draft that reads. */
    applyDisabled?: boolean;
  }>(),
  {
    startError: undefined,
    endError: undefined,
    startErrorPart: "both",
    endErrorPart: "both",
    startOffsets: () => [],
    endOffsets: () => [],
    pasted: false,
    pendingEnd: false,
    dateOnly: false,
    hideNow: false,
    minDate: undefined,
    maxDate: undefined,
    applyDisabled: true,
  },
);

const emit = defineEmits<{
  (e: "update:start", value: DraftEdge): void;
  (e: "update:end", value: DraftEdge): void;
  (e: "status", part: RangeFieldPart, value: SegmentedFieldStatus): void;
  (e: "submit"): void;
  (e: "paste-text", value: string): void;
  (e: "start-of-day"): void;
  (e: "end-of-day"): void;
  (e: "now"): void;
  (e: "apply"): void;
}>();

const DAY_PERIODS: [string, string] = ["AM", "PM"];

const { t } = useI18nTyped();
const uid = useId();
const liveText = ref("");
const applyBtn = ref<{ $el?: HTMLElement } | null>(null);
const fields = new Map<string, SegmentedFieldExposed>();

const segmentLabels = computed(() => ({
  year: t("common.rangeSegmentYear"),
  month: t("common.rangeSegmentMonth"),
  day: t("common.rangeSegmentDay"),
  hour: t("common.rangeSegmentHour"),
  minute: t("common.rangeSegmentMinute"),
  second: t("common.rangeSegmentSecond"),
  period: t("common.rangeSegmentPeriod"),
  offset: t("common.rangeSegmentOffset"),
}));

const edges = computed(() => [
  {
    name: "start" as const,
    label: t("common.rangeStart"),
    dateLabel: t("common.rangeStartDate"),
    timeLabel: t("common.startTime"),
    value: props.start,
    error: props.startError,
    errorPart: props.startErrorPart,
    offsets: props.startOffsets,
  },
  {
    name: "end" as const,
    label: t("common.rangeEnd"),
    dateLabel: t("common.rangeEndDate"),
    timeLabel: t("common.endTime"),
    value: props.end,
    error: props.endError,
    errorPart: props.endErrorPart,
    offsets: props.endOffsets,
  },
]);

const setFieldRef = (key: string, el: Element | ComponentPublicInstance | null) => {
  if (el && "focusSegment" in el) fields.set(key, el as unknown as SegmentedFieldExposed);
  else fields.delete(key);
};

const focusPart = (edge: DraftEdgeName, part: FieldPart, which: "first" | "last" | "invalid") => {
  fields.get(`${edge}${part === "date" ? "Date" : "Time"}`)?.focusSegment(which);
};

const onPart = (edge: DraftEdgeName, part: FieldPart, value: string) => {
  const current = edge === "start" ? props.start : props.end;
  const next = { ...current, [part]: value, offset: part === "time" ? "" : current.offset };
  if (edge === "start") emit("update:start", next);
  else emit("update:end", next);
};

const onOffset = (edge: DraftEdgeName, offset: string) => {
  const current = edge === "start" ? props.start : props.end;
  if (edge === "start") emit("update:start", { ...current, offset });
  else emit("update:end", { ...current, offset });
};

const announce = (stepped: SegmentedFieldStep) => {
  liveText.value = t("common.rangeSegmentValue", { segment: stepped.label, value: stepped.value });
};

const chipTime = (time: string) => {
  if (props.hourFormat === "24h") return time;
  const [hour, minute, second] = time.split(":").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hour % 12 || 12)}:${pad(minute)}:${pad(second)} ${hour >= 12 ? "PM" : "AM"}`;
};

/** Moves focus into the Start field, or to the first part an error names. */
const focusField = (
  target: "start" | "invalid",
  edge: DraftEdgeName = "start",
  part: FieldPart = "date",
) => {
  if (target === "start") focusPart("start", "date", "first");
  else focusPart(edge, part, "invalid");
};

/** Moves focus to Apply, so Enter applies a draft that was just filled. */
const focusApply = () => applyBtn.value?.$el?.focus();

defineExpose({ focusField, focusApply });
</script>
