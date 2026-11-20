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

<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from "vue";

import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { localeFileMap } from "@/locales";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";
import {
  formatInstant,
  formatRangeText,
  formatSpan,
  useTimeRangeInput,
} from "@/composables/useTimeRangeInput";
import type {
  InputSource,
  RangeLimits,
  RelativeUnit,
  TimeRangeParseResult,
  TimeRangeReading,
  ZoneNote,
} from "@/utils/timeRangeInput";
import { offsetAtInstant, offsetLabel as zoneOffsetLabel } from "@/utils/timeRangeInput/zone";

interface AppliedRange {
  startUs: number;
  endUs: number;
}

interface ReadingRow {
  reading: TimeRangeReading;
  label: string;
  range: string;
  duration: string;
  hint?: I18nText;
  blocked?: string;
}

interface StatusNote {
  text: string;
  warn: boolean;
}

const props = defineProps<{
  zone: string;
  locale: string;
  intlLocale: string;
  applied: AppliedRange | null;
  limits: RangeLimits;
  kinds: { relative: boolean; calendar: boolean; absolute: boolean };
  units: RelativeUnit[];
  canCopy: boolean;
  spanLimit: string;
  /** The longest rolling range the picker keeps for a reading over its cap, else null. */
  capRolling?: (reading: TimeRangeReading) => TimeRangeReading | null;
}>();

const emit = defineEmits<{
  apply: [reading: TimeRangeReading];
  dirty: [blocksApply: boolean];
  valid: [hasReading: boolean];
  "escape-empty": [];
  copy: [];
  paste: [];
}>();

const { t } = useI18nTyped();
const listId = useId();
const input = ref<InstanceType<typeof OInput> | null>(null);
const root = ref<HTMLElement | null>(null);
const highlighted = ref(-1);
let nextSource: InputSource = "typed";

const bar = useTimeRangeInput({
  context: () => ({
    locale: props.locale,
    zone: props.zone,
    units: props.units,
    kinds: props.kinds,
    limits: props.limits,
  }),
});

const capOf = (reading: TimeRangeReading) => props.capRolling?.(reading) ?? null;

// The picker cannot keep a rolling range over its cap, so it offers the capped range instead.
const overCap = computed(() => {
  const res = bar.result.value;
  return res.state === "valid" ? capOf(res.reading) : null;
});

const result = computed<TimeRangeParseResult>(() => {
  const res = bar.result.value;
  if (res.state !== "valid" || !overCap.value) return res;
  return { state: "blocked", reason: "max-span", reading: res.reading, fix: overCap.value };
});
const state = computed(() => result.value.state);

const offsetLabel = (offset: string) => raw(`${props.zone} · UTC${offset}`);

// An unknown zone has no offset to show, and the parser's zone module throws on it.
const zoneOffsetAt = (us: number): string => {
  try {
    return zoneOffsetLabel(offsetAtInstant(props.zone, us));
  } catch {
    return "";
  }
};

const rangeOf = (startUs: number, endUs: number) =>
  formatRangeText(startUs, endUs, props.zone, props.intlLocale, bar.nowUs.value);

const durationOf = (startUs: number, endUs: number) =>
  endUs > startUs ? formatSpan(endUs - startUs, props.intlLocale) : "";

const instantText = (us: number) =>
  formatInstant(us, props.zone, props.intlLocale, bar.nowUs.value, true);

// A window cut short at now no longer reaches the same distance on both sides of the stamp.
const instantWindowText = (
  note: Extract<ZoneNote, { kind: "instant-window" }>,
  reading: TimeRangeReading,
): StatusNote => {
  const time = instantText(note.instantUs);
  const before = note.instantUs - reading.startUs;
  const after = reading.endUs - note.instantUs;
  if (before === note.halfWidthUs && after === note.halfWidthUs)
    return {
      text: t("timeRangeInput.instantWindow", {
        duration: formatSpan(note.halfWidthUs, props.intlLocale),
        time,
      }),
      warn: true,
    };
  const duration = formatSpan(before, props.intlLocale);
  if (after <= 0)
    return { text: t("timeRangeInput.instantWindowBefore", { duration, time }), warn: true };
  return {
    text: t("timeRangeInput.instantWindowClipped", {
      duration,
      after: formatSpan(after, props.intlLocale),
    }),
    warn: true,
  };
};

const noteText = (note: ZoneNote, reading: TimeRangeReading): StatusNote | null => {
  if (note.kind === "dst-gap")
    return {
      text: t("timeRangeInput.dstGap", { typed: note.typedLocal, readAs: note.readAsLocal }),
      warn: true,
    };
  if (note.kind === "converted")
    return { text: t("timeRangeInput.converted", { offset: note.fromOffset }), warn: false };
  if (note.kind === "instant-window") return instantWindowText(note, reading);
  if (note.kind === "log-line") return { text: t("timeRangeInput.logLine"), warn: false };
  if (note.kind === "partial-retention")
    return {
      text: t("timeRangeInput.retentionHint", { date: instantText(note.keptFromUs) }),
      warn: true,
    };
  return null;
};

// One note fits the line: a warning first, and no "converted" from the zone the range is shown in.
const readingNote = (reading: TimeRangeReading): StatusNote | null => {
  const notes = reading.notes
    .filter((n) => n.kind !== "converted" || n.fromOffset !== reading.startOffset)
    .map((n) => noteText(n, reading))
    .filter((n): n is StatusNote => n !== null);
  const note = notes.find((n) => n.warn) ?? notes[0];
  if (note) return note;
  return reading.fixedToNow ? { text: t("timeRangeInput.fixedToNow"), warn: false } : null;
};

const PAST_KEYS: Record<RelativeUnit, string> = {
  s: "common.pastSecond",
  m: "common.pastMinute",
  h: "common.pastHour",
  d: "common.pastDay",
  w: "common.pastWeek",
  M: "common.pastMonth",
};

// A suggested row (the longest allowed range) comes without a name, so a rolling one borrows the trigger's.
const rollingName = (reading: TimeRangeReading) =>
  reading.rolling
    ? t(PAST_KEYS[reading.rolling.unit], { count: reading.rolling.value }, reading.rolling.value)
    : undefined;

// Two readings of a repeated hour differ only at one end, so that end names each row.
const repeatedEnd = (readings: TimeRangeReading[]): "start" | "end" =>
  readings.length > 1 && readings[0].startUs !== readings[1].startUs ? "start" : "end";

// The parser lists the loaded pack's day-month order first, which may still be English while a pack loads.
const monthFirstLocale = computed(() => {
  const parts = new Intl.DateTimeFormat(localeFileMap[bar.pack.value.locale] ?? "en-US", {
    day: "numeric",
    month: "numeric",
  }).formatToParts(0);
  return parts.findIndex((p) => p.type === "month") < parts.findIndex((p) => p.type === "day");
});

const orderLabel = (index: number) => {
  if (index === 0)
    return t(monthFirstLocale.value ? "timeRangeInput.monthFirst" : "timeRangeInput.dayFirst");
  return t(
    monthFirstLocale.value ? "timeRangeInput.dayFirstPlain" : "timeRangeInput.monthFirstPlain",
  );
};

// A lone stamp reads as a window around it, so the stamp, not the window's start, names the repeated hour.
const typedInstant = (reading: TimeRangeReading): number | null => {
  const note = reading.notes.find((n) => n.kind === "instant-window");
  return note?.kind === "instant-window" ? note.instantUs : null;
};

const rowLabel = (reading: TimeRangeReading, index: number, readings: TimeRangeReading[]) => {
  const res = result.value;
  if (res.state === "ambiguous" && res.reason === "day-month-order" && index < 2)
    return orderLabel(index);
  if (res.state === "ambiguous" && res.reason === "zone-abbreviation") {
    const note = reading.notes.find((n) => n.kind === "converted");
    if (note?.kind === "converted") return raw(`UTC${note.fromOffset}`);
  }
  if (res.state === "ambiguous" && res.reason === "repeated-hour") {
    const end = repeatedEnd(readings);
    const instant = typedInstant(reading);
    const offset =
      instant !== null
        ? zoneOffsetAt(instant)
        : end === "start"
          ? reading.startOffset
          : reading.endOffset;
    return t(index === 0 ? "timeRangeInput.firstTime" : "timeRangeInput.secondTime", { offset });
  }
  return reading.name ?? rollingName(reading) ?? rangeOf(reading.startUs, reading.endUs);
};

const toRow = (
  reading: TimeRangeReading,
  index: number,
  readings: TimeRangeReading[],
  hint?: I18nText,
): ReadingRow => {
  const label = rowLabel(reading, index, readings);
  const range = rangeOf(reading.startUs, reading.endUs);
  return {
    reading,
    label,
    range: label === range ? "" : range,
    duration: durationOf(reading.startUs, reading.endUs),
    hint,
    blocked: reading.blocked ?? (capOf(reading) ? "max-span" : undefined),
  };
};

const rows = computed<ReadingRow[]>(() => {
  const res = result.value;
  if (res.state === "ambiguous") return res.readings.map((r, i) => toRow(r, i, res.readings));
  if (res.state === "incomplete")
    return res.completions.map((r, i) => toRow(r, i, res.completions));
  if (res.state !== "blocked") return [];
  const list = [...(res.fix ? [res.fix] : []), ...(res.others ?? [])];
  const hint = res.reason === "max-span" ? t("timeRangeInput.longestAllowed") : undefined;
  return list.map((r, i) => toRow(r, i, list, res.fix && i === 0 ? hint : undefined));
});

const blockedMessage = (res: Extract<TimeRangeParseResult, { state: "blocked" }>) => {
  const { reading } = res;
  if (overCap.value) return t("timeRangeInput.overCap");
  if (res.reason === "max-span") return t("timeRangeInput.blockedSpan", { limit: props.spanLimit });
  if (res.reason === "future")
    return t("timeRangeInput.blockedFuture", {
      date: instantText(reading.endUs > bar.nowUs.value ? reading.endUs : reading.startUs),
    });
  if (res.reason === "after-max")
    return t("timeRangeInput.blockedAfterMax", { date: instantText(reading.endUs) });
  if (res.reason === "before-min")
    return t("timeRangeInput.blockedBeforeMin", { date: instantText(reading.startUs) });
  return t("timeRangeInput.blockedRetention", {
    range: rangeOf(reading.startUs, reading.endUs),
    retention: props.limits.retentionStartUs ? instantText(props.limits.retentionStartUs) : "",
  });
};

const blockedHint = (res: Extract<TimeRangeParseResult, { state: "blocked" }>) => {
  if (res.reason === "future") return t("timeRangeInput.blockedFutureHint");
  // maxEndUs is the exclusive midnight after maxDate, so the hint names maxDate's last second.
  if (res.reason === "after-max" && props.limits.maxEndUs !== undefined)
    return t("timeRangeInput.blockedFutureMaxHint", {
      date: instantText(props.limits.maxEndUs - 1_000_000),
    });
  if (res.reason === "retention" && props.limits.retentionStartUs)
    return t("timeRangeInput.retentionHint", { date: instantText(props.limits.retentionStartUs) });
  return undefined;
};

const unitInText = () => [...bar.text.value].reverse().find((c) => c === "m" || c === "M") ?? "M";

const ambiguousMessage = (res: Extract<TimeRangeParseResult, { state: "ambiguous" }>) => {
  if (res.reason === "unit-case") return t("timeRangeInput.ambiguousUnit", { unit: unitInText() });
  if (res.reason === "log-stamps") return t("timeRangeInput.ambiguousStamps");
  if (res.reason === "zone-abbreviation") return t("timeRangeInput.ambiguousZone");
  if (res.reason === "repeated-hour" || res.reason === "am-pm") {
    const first = res.readings[0];
    const us =
      typedInstant(first) ?? (repeatedEnd(res.readings) === "start" ? first.startUs : first.endUs);
    const time = formatInstant(us, props.zone, props.intlLocale, bar.nowUs.value, false);
    if (res.reason === "am-pm") return t("timeRangeInput.ambiguousAmPm", { time });
    return t("timeRangeInput.ambiguousRepeat", {
      time,
      date: formatInstant(us, props.zone, props.intlLocale, bar.nowUs.value, true),
    });
  }
  return t("timeRangeInput.ambiguousOrder", { text: bar.text.value.trim() });
};

const invalidMessage = (res: Extract<TimeRangeParseResult, { state: "invalid" }>) => {
  if (res.reason === "too-long") return t("timeRangeInput.tooLong");
  if (res.reason === "reversed" || res.reason === "zero-length")
    return t("timeRangeInput.gateOrder");
  if (res.reason === "out-of-range") return t("timeRangeInput.gateInvalid");
  return t("timeRangeInput.invalid");
};

const examplesText = computed(() => raw(bar.examples.value.join(", ")));

const status = computed(() => {
  const res = result.value;
  if (res.state === "invalid")
    return {
      message: invalidMessage(res),
      secondary: res.examples.length
        ? t("timeRangeInput.examples", { examples: res.examples.slice(0, 3).join(", ") })
        : undefined,
    };
  if (res.state === "blocked") return { message: blockedMessage(res), secondary: blockedHint(res) };
  if (res.state === "ambiguous") return { message: ambiguousMessage(res) };
  if (res.state === "incomplete")
    return {
      message: res.completions.length
        ? t("timeRangeInput.incomplete")
        : t("timeRangeInput.keepTyping"),
    };
  return {};
});

const summary = computed(() => {
  const res = result.value;
  if (res.state === "valid") {
    const r = res.reading;
    return {
      lead: undefined,
      name: r.name,
      range: rangeOf(r.startUs, r.endUs),
      duration: durationOf(r.startUs, r.endUs),
      zone: offsetLabel(r.startOffset),
      note: readingNote(r),
    };
  }
  if (res.state !== "empty" || !props.applied) return null;
  const { startUs, endUs } = props.applied;
  return {
    lead: t("timeRangeInput.applied"),
    name: undefined,
    range: rangeOf(startUs, endUs),
    duration: durationOf(startUs, endUs),
    zone: offsetLabel(zoneOffsetAt(startUs)),
    note: null,
  };
});

const isMessage = computed(() => state.value !== "empty" && state.value !== "valid");
const canApplyRow = (i: number) => i >= 0 && i < rows.value.length && !rows.value[i].blocked;
const activeId = computed(() =>
  highlighted.value >= 0 ? `${listId}-${highlighted.value}` : undefined,
);

watch(
  () => bar.text.value !== "" && state.value !== "valid",
  (blocksApply) => emit("dirty", blocksApply),
);
watch(
  () => state.value === "valid" && bar.ready.value,
  (hasReading) => emit("valid", hasReading),
);
watch(result, () => {
  highlighted.value = -1;
});

// A native paste fires its input event next, which must read as pasted text.
// One that would overflow the cap is refused whole, since maxlength would cut it into another range.
const onPaste = (event: ClipboardEvent) => {
  const text = event.clipboardData?.getData("text") ?? "";
  const field = event.target instanceof HTMLInputElement ? event.target : null;
  const replaced = field ? (field.selectionEnd ?? 0) - (field.selectionStart ?? 0) : 0;
  const kept = field ? field.value.length - replaced : 0;
  if (kept + text.length <= MAX_RANGE_TEXT_UNITS) {
    nextSource = "paste";
    return;
  }
  event.preventDefault();
  submitWhenReady = false;
  bar.setText(null, "paste");
};

const onInput = (value: string | number) => {
  submitWhenReady = false;
  bar.setText(String(value), nextSource);
  nextSource = "typed";
};

const applyRow = (i: number) => {
  if (canApplyRow(i)) emit("apply", rows.value[i].reading);
};

// Enter before the locale's pack loads would apply an English reading of the text.
let submitWhenReady = false;
watch(bar.ready, (ready) => {
  if (!ready || !submitWhenReady) return;
  submitWhenReady = false;
  submit();
});

/** Applies the valid reading or the highlighted row; false when there is nothing to apply. */
const submit = (): boolean => {
  if (!bar.ready.value && bar.text.value !== "") {
    submitWhenReady = true;
    return true;
  }
  const res = result.value;
  if (res.state === "valid") {
    emit("apply", res.reading);
    return true;
  }
  if (!canApplyRow(highlighted.value)) return false;
  applyRow(highlighted.value);
  return true;
};

const moveHighlight = (dir: 1 | -1) => {
  const count = rows.value.length;
  // With nothing highlighted, Arrow Up starts past the end so it lands on the last row.
  const from = highlighted.value === -1 && dir === -1 ? count : highlighted.value;
  for (let step = 1; step <= count; step++) {
    const i = (((from + dir * step) % count) + count) % count;
    if (canApplyRow(i)) {
      highlighted.value = i;
      return;
    }
  }
};

const onKeydown = (event: KeyboardEvent) => {
  // An IME composition owns Enter and the arrows until it is confirmed.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter") {
    event.preventDefault();
    submit();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!rows.value.length) return;
    event.preventDefault();
    moveHighlight(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Escape") {
    if (bar.text.value === "") {
      emit("escape-empty");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    bar.clear();
  }
};

const focus = () => input.value?.focus();

// OInput's maxlength prop also draws a character counter, so the cap goes on the native field.
onMounted(() => {
  root.value?.querySelector("input")?.setAttribute("maxlength", String(MAX_RANGE_TEXT_UNITS));
  focus();
});

defineExpose({
  setText: (text: string, source: InputSource) => {
    bar.setText(text, source);
    focus();
  },
  clear: () => {
    submitWhenReady = false;
    bar.clear();
  },
  focus,
  submit,
});
</script>

<template>
  <div
    ref="root"
    class="border-border-default relative flex flex-col gap-1.5 border-b px-3 pt-2.5 pb-2"
    data-test="date-time-range-bar"
    data-o2-privacy="mask"
  >
    <OInput
      ref="input"
      data-test="date-time-range-input"
      :model-value="bar.text.value"
      :placeholder="
        examplesText ? t('timeRangeInput.placeholder', { examples: examplesText }) : undefined
      "
      :error="state === 'invalid'"
      autocomplete="off"
      class="min-w-0"
      role="combobox"
      aria-autocomplete="list"
      :aria-label="t('timeRangeInput.label')"
      :aria-expanded="rows.length > 0"
      :aria-controls="rows.length ? listId : undefined"
      :aria-activedescendant="activeId"
      @update:model-value="onInput"
      @paste="onPaste"
      @keydown="onKeydown"
    >
      <template v-if="state === 'valid'" #icon-right>
        <OTooltip :content="t('timeRangeInput.pressEnter')">
          <OButton
            data-test="date-time-range-enter-hint"
            variant="ghost"
            size="icon"
            class="pointer-coarse:size-9"
            :aria-label="t('timeRangeInput.pressEnter')"
            @click="submit"
          >
            <OShortcut keys="enter" size="sm" />
          </OButton>
        </OTooltip>
      </template>
    </OInput>
    <div class="flex min-w-0 items-center gap-2" :class="isMessage ? 'max-sm:items-start' : ''">
      <div
        class="flex min-h-6 min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs whitespace-nowrap tabular-nums"
        :class="isMessage ? 'max-sm:items-start max-sm:py-1 max-sm:whitespace-normal' : ''"
        data-test="date-time-range-status"
        :data-state="state"
        aria-live="polite"
        :aria-busy="bar.announcing.value"
      >
        <template v-if="state === 'invalid' || state === 'blocked'">
          <OIcon
            :name="state === 'invalid' ? 'error-outline' : 'do-not-disturb-on'"
            size="sm"
            class="text-input-error-text shrink-0"
          />
          <span
            class="text-input-error-text shrink-0 font-medium max-sm:min-w-0 max-sm:shrink max-sm:text-balance"
            data-test="date-time-range-message"
            >{{ status.message }}</span
          >
          <span
            v-if="status.secondary"
            class="text-text-secondary min-w-0 truncate max-sm:hidden"
            data-test="date-time-range-examples"
            >{{ status.secondary }}</span
          >
        </template>
        <template v-else-if="state === 'ambiguous' || state === 'incomplete'">
          <OIcon
            v-if="state === 'ambiguous'"
            name="help-outline"
            size="sm"
            class="text-status-warning-text shrink-0"
          />
          <span
            :class="
              state === 'ambiguous' ? 'text-status-warning-text font-medium' : 'text-text-secondary'
            "
            class="min-w-0 truncate max-sm:text-balance max-sm:whitespace-normal"
            data-test="date-time-range-message"
            >{{ status.message }}</span
          >
        </template>
        <template v-else-if="summary">
          <span v-if="summary.lead" class="text-text-secondary shrink-0">{{ summary.lead }}</span>
          <span
            v-if="summary.name"
            class="text-text-heading text-compact shrink-0 font-semibold"
            data-test="date-time-range-name"
            >{{ summary.name }}</span
          >
          <span
            class="text-compact shrink-0 max-sm:min-w-0 max-sm:shrink max-sm:truncate"
            :class="state === 'valid' ? 'text-text-heading' : 'text-text-secondary'"
            data-test="date-time-range-resolved"
            ><bdi>{{ summary.range }}</bdi></span
          >
          <OBadge
            v-if="summary.duration"
            variant="default-soft"
            size="sm"
            class="shrink-0"
            :class="summary.name || summary.lead ? 'max-sm:hidden' : ''"
            data-test="date-time-range-duration"
            >{{ summary.duration }}</OBadge
          >
          <span
            class="text-text-secondary shrink-0 max-sm:hidden"
            data-test="date-time-range-zone"
            >{{ summary.zone }}</span
          >
          <span
            v-if="summary.note"
            class="min-w-0 truncate max-sm:hidden"
            :class="summary.note.warn ? 'text-status-warning-text' : 'text-text-secondary'"
            data-test="date-time-range-note"
            :data-warn="summary.note.warn || undefined"
          >
            <OIcon
              v-if="summary.note.warn"
              name="warning-amber"
              size="xs"
              class="me-0.5 inline align-[-0.125rem]"
            />{{ summary.note.text }}</span
          >
        </template>
      </div>
      <div class="flex shrink-0 items-center" data-test="date-time-range-actions">
        <OTooltip :content="t('common.copyRange')">
          <OButton
            data-test="date-time-copy-btn"
            variant="ghost"
            size="icon"
            icon-left="content-copy"
            :aria-label="t('common.copyRange')"
            :disabled="state !== 'empty' || !canCopy"
            @click="emit('copy')"
          />
        </OTooltip>
        <OTooltip :content="t('common.pasteRange')">
          <OButton
            data-test="date-time-paste-btn"
            variant="ghost"
            size="icon"
            icon-left="content-paste"
            :aria-label="t('common.pasteRange')"
            @click="emit('paste')"
          />
        </OTooltip>
      </div>
    </div>
    <div
      v-if="rows.length"
      :id="listId"
      role="listbox"
      :aria-label="t('timeRangeInput.readings')"
      data-test="date-time-range-readings"
      class="bg-surface-base border-border-default rounded-default absolute inset-x-3 top-full z-50 -mt-1 flex flex-col overflow-hidden border py-1 shadow-md"
    >
      <div
        v-for="(row, i) in rows"
        :id="`${listId}-${i}`"
        :key="i"
        role="option"
        :aria-selected="highlighted === i"
        :aria-disabled="row.blocked ? true : undefined"
        :data-blocked="row.blocked"
        :data-test="`date-time-range-reading-${i}`"
        class="flex min-w-0 items-center gap-2 px-3 py-1.5 tabular-nums"
        :class="[
          highlighted === i ? 'bg-surface-accent-active' : '',
          row.blocked ? 'opacity-50' : 'hover:bg-surface-accent-hover cursor-pointer',
        ]"
        @mousedown.prevent
        @click="applyRow(i)"
      >
        <span
          class="text-text-heading text-compact font-medium"
          :class="row.range ? 'shrink-0' : 'min-w-0 truncate'"
          >{{ row.label }}</span
        >
        <span v-if="row.range" class="text-text-secondary min-w-0 truncate text-xs"
          ><bdi>{{ row.range }}</bdi></span
        >
        <span class="ms-auto flex shrink-0 items-center gap-1.5">
          <span v-if="row.hint" class="text-text-secondary text-2xs max-md:hidden">{{
            row.hint
          }}</span>
          <OBadge v-if="row.duration" variant="default-soft" size="sm">{{ row.duration }}</OBadge>
        </span>
      </div>
    </div>
  </div>
</template>
