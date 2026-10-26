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
    class="flex flex-col gap-3"
    data-test="dashboard-config-thresholds"
    @pointerdown.capture="onPointerDown"
  >
    <OSelect
      v-if="supportsShowAs"
      :model-value="showAsValue"
      :options="showAsOptions"
      :label="t('dashboard.thresholdShowAs')"
      :help-text="isStacked ? t('dashboard.thresholdStackedHint') : undefined"
      data-test="dashboard-config-thresholds-show-as"
      @update:model-value="onShowAs"
    />

    <OToggleGroup
      type="single"
      :model-value="modeValue"
      :aria-label="t('dashboard.thresholdMode')"
      data-test="dashboard-config-thresholds-mode"
      @update:model-value="onMode"
    >
      <OToggleGroupItem
        value="absolute"
        size="sm"
        data-test="dashboard-config-thresholds-mode-absolute"
        >{{ t("dashboard.thresholdModeAbsolute") }}</OToggleGroupItem
      >
      <OToggleGroupItem
        value="percentage"
        size="sm"
        :disabled="isMetric"
        :tooltip="isMetric ? t('dashboard.thresholdPercentageNoRange') : undefined"
        data-test="dashboard-config-thresholds-mode-percentage"
        >{{ t("dashboard.thresholdModePercentage") }}</OToggleGroupItem
      >
    </OToggleGroup>

    <div class="flex flex-col gap-1.5" data-test="dashboard-config-thresholds-base">
      <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">{{
        t("dashboard.thresholdBase")
      }}</span>
      <ColorSwatchPicker
        :model-value="baseColorValue"
        :swatches="swatches"
        data-test="dashboard-config-thresholds-base-color"
        @update:model-value="onBaseColor"
      />
      <span class="text-text-secondary text-xs">{{ baseCaption }}</span>
    </div>

    <div
      ref="listRef"
      class="flex flex-col gap-3"
      data-test="dashboard-config-thresholds-steps"
      @focusout="onListFocusOut"
    >
      <!-- Keyed by a row id, not the index, so focus and pending text follow a step when the list re-sorts. -->
      <div
        v-for="row in rows"
        :key="row.id"
        class="border-border-default flex flex-col gap-1.5 border-t pt-3"
        :data-test="`dashboard-config-thresholds-step-${row.index}`"
      >
        <div class="flex items-center justify-between gap-2">
          <label
            :for="`${uid}-step-${row.id}`"
            class="o-input-label text-compact text-input-label-text leading-tight font-medium"
            >{{ t("dashboard.thresholdStep", { n: row.index + 1 }) }}</label
          >
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="close"
            :title="t('dashboard.thresholdRemoveStep')"
            :aria-label="t('dashboard.thresholdRemoveStep')"
            :data-test="`dashboard-config-thresholds-step-${row.index}-remove`"
            @mousedown.prevent
            @click="removeStep(row.index)"
          />
        </div>
        <OInput
          :id="`${uid}-step-${row.id}`"
          :model-value="rowText(row)"
          :placeholder="placeholder"
          :help-text="rowEcho(row)"
          :error="!!errors[row.id]"
          :error-message="errors[row.id]"
          autocomplete="off"
          :data-test="`dashboard-config-thresholds-step-${row.index}-value`"
          @update:model-value="(v) => onInput(row.index, String(v ?? ''))"
          @focus="onFocus(row.index)"
          @blur="onBlur(row.index)"
        />
        <ColorSwatchPicker
          :model-value="row.step.color"
          :swatches="swatches"
          :allow-none="false"
          :data-test="`dashboard-config-thresholds-step-${row.index}-color`"
          @update:model-value="(c) => onStepColor(row.index, c)"
        />
      </div>

      <p
        v-if="!rows.length"
        class="text-text-secondary text-xs"
        data-test="dashboard-config-thresholds-empty"
      >
        {{ t("dashboard.thresholdNoSteps") }}
      </p>

      <div class="self-start">
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          data-test="dashboard-config-thresholds-add-step"
          @click="addStep"
          >{{ t("dashboard.thresholdAddStep") }}</OButton
        >
      </div>
    </div>

    <div
      v-if="isMetric && hasColouredValueMappings"
      class="text-text-secondary flex items-center gap-1.5 text-xs"
      data-test="dashboard-config-thresholds-mapping-note"
    >
      <OIcon name="info-outline" size="xs" class="shrink-0" />
      <span>{{ t("dashboard.thresholdValueMappingsWin") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { chartColor } from "@/utils/chartTheme";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

type ThresholdMode = "absolute" | "percentage";
type ThresholdShowAs = "color_line" | "color" | "line" | "color_band";

interface ThresholdStep {
  value: number;
  color: string;
}

interface Thresholds {
  mode?: ThresholdMode;
  showAs?: ThresholdShowAs;
  baseColor?: string | null;
  steps?: ThresholdStep[];
}

interface Draft {
  mode: ThresholdMode;
  showAs: ThresholdShowAs | undefined;
  baseColor: string | null;
  steps: ThresholdStep[];
}

interface Row {
  id: number;
  index: number;
  step: ThresholdStep;
}

const props = withDefaults(
  defineProps<{
    modelValue?: Thresholds;
    chartType?: string;
    unit?: string | null;
    unitCustom?: string | null;
    decimals?: number | string | null;
    hasColouredValueMappings?: boolean;
  }>(),
  {
    modelValue: undefined,
    chartType: "line",
    unit: null,
    unitCustom: null,
    decimals: null,
    hasColouredValueMappings: false,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: Thresholds | undefined] }>();

const FIRST_STEP_VALUE = 80;
const STEP_GAP = 10;
const PALETTE_PRESETS = 5;

const { t } = useI18nTyped();
const store = useStore();
const uid = useId();
const rootRef = ref<HTMLElement | null>(null);

const isMetric = computed(() => props.chartType === "metric");
const isStacked = computed(() => props.chartType === "area-stacked");
const SHOW_AS_CHART_TYPES = ["line", "area", "area-stacked", "bar", "h-bar", "scatter"];
const supportsShowAs = computed(() => SHOW_AS_CHART_TYPES.includes(props.chartType));

// Mode, Show as and Base picked before the first step wait here, since the key is only written once a step exists.
const pending = reactive<Omit<Draft, "steps">>({
  mode: "absolute",
  showAs: undefined,
  baseColor: null,
});

const steps = computed<ThresholdStep[]>(() => props.modelValue?.steps ?? []);
const storedMode = computed<ThresholdMode>(() =>
  props.modelValue ? (props.modelValue.mode ?? "absolute") : pending.mode,
);
const isPercent = computed(() => !isMetric.value && storedMode.value === "percentage");
const modeValue = computed<ThresholdMode>(() => (isPercent.value ? "percentage" : "absolute"));
const storedShowAs = computed(() => (props.modelValue ? props.modelValue.showAs : pending.showAs));
const stackedShowAs = (value: ThresholdShowAs | undefined): ThresholdShowAs =>
  value === "color_band" ? "color_band" : "line";
const showAsValue = computed<ThresholdShowAs>(() =>
  isStacked.value ? stackedShowAs(storedShowAs.value) : (storedShowAs.value ?? "color_line"),
);
const baseColorValue = computed(() =>
  props.modelValue ? (props.modelValue.baseColor ?? null) : pending.baseColor,
);

const presets = computed(() => {
  void store.state.theme;
  return {
    green: chartColor("--color-success-500"),
    amber: chartColor("--color-amber-500"),
    red: chartColor("--color-error-500"),
    palette: getColorPalette().slice(0, PALETTE_PRESETS),
  };
});
const swatches = computed(() => {
  const { green, amber, red, palette } = presets.value;
  return [...new Set([green, amber, red, ...palette].filter(Boolean))];
});

const showAsOptions = computed(() =>
  isStacked.value
    ? [
        { label: t("dashboard.thresholdShowAsLine"), value: "line" },
        { label: t("dashboard.thresholdShowAsBand"), value: "color_band" },
      ]
    : [
        { label: t("dashboard.thresholdShowAsColorLine"), value: "color_line" },
        { label: t("dashboard.thresholdShowAsColor"), value: "color" },
        { label: t("dashboard.thresholdShowAsLine"), value: "line" },
        { label: t("dashboard.thresholdShowAsColorBand"), value: "color_band" },
      ],
);

const baseCaption = computed(() =>
  isMetric.value
    ? t("dashboard.thresholdBaseNoneMetric", {
        section: t("dashboard.configSectionBackground"),
      })
    : t("dashboard.thresholdBaseNoneSeries"),
);

const placeholder = computed(() => t("dashboard.thresholdPlaceholder", { example: raw("500") }));
const errorText = (): I18nText =>
  isPercent.value ? t("dashboard.thresholdErrorPercent") : t("dashboard.thresholdErrorEnterNumber");
const decimalsValue = computed(() => {
  const n = Number(props.decimals);
  return props.decimals === null || props.decimals === "" || !Number.isFinite(n) ? 2 : n;
});

let nextRowId = 0;
const newRowId = () => ++nextRowId;
const rowIds = ref<number[]>(steps.value.map(newRowId));
const texts = ref<Record<number, string>>({});
const errors = ref<Record<number, I18nText>>({});

const rows = computed<Row[]>(() =>
  steps.value.map((step, index) => ({ id: rowIds.value[index] ?? -(index + 1), index, step })),
);

let lastEmitted = JSON.stringify(props.modelValue ?? null);
watch(
  () => props.modelValue,
  (next) => {
    const incoming = JSON.stringify(next ?? null);
    if (incoming === lastEmitted) return;
    lastEmitted = incoming;
    rowIds.value = steps.value.map(newRowId);
    texts.value = {};
    errors.value = {};
  },
  { deep: true },
);

const draft = (): Draft => ({
  mode: storedMode.value,
  showAs: storedShowAs.value,
  baseColor: baseColorValue.value,
  steps: steps.value.map((s) => ({ value: s.value, color: s.color })),
});

const emitValue = (value: Thresholds | undefined) => {
  lastEmitted = JSON.stringify(value ?? null);
  emit("update:modelValue", value);
};

const commit = (next: Draft) => {
  if (!next.steps.length) {
    pending.mode = next.mode;
    pending.showAs = next.showAs;
    pending.baseColor = next.baseColor;
    emitValue(undefined);
    return;
  }
  const value: Thresholds = { mode: next.mode };
  if (supportsShowAs.value) {
    value.showAs = isStacked.value ? stackedShowAs(next.showAs) : (next.showAs ?? "color_line");
  }
  if (next.baseColor) value.baseColor = next.baseColor;
  value.steps = next.steps.map((s) => ({ value: s.value, color: s.color }));
  emitValue(value);
};

const clearRowState = (id: number) => {
  const { [id]: _text, ...restTexts } = texts.value;
  const { [id]: _error, ...restErrors } = errors.value;
  texts.value = restTexts;
  errors.value = restErrors;
};

const onMode = (value: unknown) => {
  if (value !== "absolute" && value !== "percentage") return;
  if (isMetric.value || value === modeValue.value) return;
  texts.value = {};
  errors.value = {};
  if (!steps.value.length) {
    pending.mode = value;
    return;
  }
  if (value === "absolute") {
    commit({ ...draft(), mode: value });
    return;
  }
  // Raw values rarely mean anything as 0-100 shares, so going to Percentage starts over; commit keeps the mode pending.
  rowIds.value = [];
  commit({ ...draft(), mode: value, steps: [] });
};

const onShowAs = (value: unknown) => {
  const showAs = value as ThresholdShowAs;
  if (!steps.value.length) {
    pending.showAs = showAs;
    return;
  }
  commit({ ...draft(), showAs });
};

const onBaseColor = (color: string | null) => {
  if (!steps.value.length) {
    pending.baseColor = color || null;
    return;
  }
  commit({ ...draft(), baseColor: color || null });
};

const onStepColor = (index: number, color: string | null) => {
  if (!color) return;
  const next = draft();
  next.steps[index] = { ...next.steps[index], color };
  commit(next);
};

const defaultStepColor = (count: number) => {
  const { amber, red, palette } = presets.value;
  if (count === 0) return amber;
  if (count === 1 || !palette.length) return red;
  return palette[(count - 2) % palette.length];
};

const focusRow = (index: number) => {
  const input = rootRef.value?.querySelector<HTMLInputElement>(
    `[data-test="dashboard-config-thresholds-step-${index}-value-field"]`,
  );
  input?.focus();
  input?.select();
};

// Percent units have a fixed top, so new steps stay inside it; other units step by the previous value's magnitude.
const nextStepValue = (highest: number | null): number => {
  const fraction = !isPercent.value && props.unit === "percent-1";
  const top = fraction ? 1 : 100;
  const scale = fraction ? 0.01 : 1;
  if (isPercent.value || fraction || props.unit === "percent") {
    const value = highest === null ? FIRST_STEP_VALUE * scale : highest + STEP_GAP * scale;
    return Math.min(top, Number(value.toPrecision(12)));
  }
  if (highest === null) return FIRST_STEP_VALUE;
  const magnitude = highest === 0 ? STEP_GAP : 10 ** Math.floor(Math.log10(Math.abs(highest)));
  return Number((highest + magnitude).toPrecision(12));
};

const addStep = () => {
  const next = draft();
  const highest = next.steps.length ? Math.max(...next.steps.map((s) => s.value)) : null;
  next.steps.push({ value: nextStepValue(highest), color: defaultStepColor(next.steps.length) });
  rowIds.value = [...rowIds.value.slice(0, steps.value.length), newRowId()];
  commit(next);
  nextTick(() => focusRow(next.steps.length - 1));
};

const removeStep = (index: number) => {
  const next = draft();
  next.steps.splice(index, 1);
  const id = rowIds.value[index];
  if (id !== undefined) clearRowState(id);
  rowIds.value = rowIds.value.filter((_, i) => i !== index);
  commit(next);
};

type ParseResult = { ok: true; value: number } | { ok: false; empty: boolean };

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

const parseValue = (text: string): ParseResult => {
  const input = text.trim();
  if (!input) return { ok: false, empty: true };
  if (!PLAIN_NUMBER.test(input)) return { ok: false, empty: false };
  const value = Number(input);
  if (isPercent.value && !(value >= 0 && value <= 100)) return { ok: false, empty: false };
  return { ok: true, value };
};

// The value a step had when its field was focused; invalid text puts it back so a half-typed value never reaches the chart.
const editStart = new Map<number, number>();

const onFocus = (index: number) => {
  const id = rowIds.value[index];
  if (id !== undefined && steps.value[index]) editStart.set(id, steps.value[index].value);
};

const revertStep = (index: number, id: number) => {
  const start = editStart.get(id);
  if (start === undefined || steps.value[index]?.value === start) return;
  const next = draft();
  next.steps[index] = { ...next.steps[index], value: start };
  commit(next);
};

const onInput = (index: number, text: string) => {
  const id = rowIds.value[index];
  if (id === undefined || !steps.value[index]) return;
  texts.value = { ...texts.value, [id]: text };
  const result = parseValue(text);
  if (!result.ok) {
    const { [id]: _error, ...rest } = errors.value;
    errors.value = result.empty ? rest : { ...errors.value, [id]: errorText() };
    revertStep(index, id);
    return;
  }
  const { [id]: _error, ...rest } = errors.value;
  errors.value = rest;
  if (steps.value[index].value === result.value) return;
  const next = draft();
  next.steps[index] = { ...next.steps[index], value: result.value };
  commit(next);
};

let pointerDown = false;
let sortPending = false;
let unmounted = false;

const listRef = ref<HTMLElement | null>(null);

const sortSteps = () => {
  if (!sortPending || unmounted) return;
  if (listRef.value?.contains(document.activeElement)) return;
  sortPending = false;
  const list = steps.value;
  const order = list.map((_, i) => i).sort((a, b) => list[a].value - list[b].value || a - b);
  if (order.every((from, to) => from === to)) return;
  rowIds.value = order.map((from) => rowIds.value[from] ?? newRowId());
  commit({ ...draft(), steps: order.map((from) => ({ ...list[from] })) });
};

const onBlur = (index: number) => {
  const id = rowIds.value[index];
  if (id !== undefined && texts.value[id] !== undefined) {
    if (!errors.value[id] || !texts.value[id].trim()) clearRowState(id);
  }
};

// Rows re-sort only once focus leaves the whole list, so tabbing from one step to the next never moves them.
const onListFocusOut = (event: FocusEvent) => {
  const target = event.relatedTarget as Node | null;
  if (target && listRef.value?.contains(target)) return;
  sortPending = true;
  if (!pointerDown) sortSteps();
};

// A blur caused by a click waits for that click, so a swatch or remove button acts on the row the user saw.
const onPointerDown = () => {
  pointerDown = true;
};
const onPointerUp = () => {
  if (!pointerDown) return;
  pointerDown = false;
  setTimeout(sortSteps, 0);
};

onMounted(() => {
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
});
onBeforeUnmount(() => {
  if (sortPending && listRef.value) {
    listRef.value = null;
    sortSteps();
  }
  unmounted = true;
  document.removeEventListener("pointerup", onPointerUp);
  document.removeEventListener("pointercancel", onPointerUp);
});

// Six significant digits hide float noise (0.366667), but never cut the integer part of a large value.
const plainNumber = (value: number) => {
  if (Number.isInteger(value)) return String(value);
  const integerDigits = Math.max(1, Math.floor(Math.log10(Math.abs(value))) + 1);
  return String(Number(value.toPrecision(Math.min(21, Math.max(6, integerDigits)))));
};

const rowText = (row: Row): string => {
  const typed = texts.value[row.id];
  if (typed !== undefined) return typed;
  return plainNumber(row.step.value);
};

const rowEcho = (row: Row): I18nText | undefined => {
  const typed = texts.value[row.id];
  if (errors.value[row.id] || (typed !== undefined && !typed.trim())) return undefined;
  if (isPercent.value) {
    return t("dashboard.thresholdEchoPercent", { value: raw(plainNumber(row.step.value)) });
  }
  const formatted = formatUnitValue(
    getUnitValue(
      row.step.value,
      props.unit || "default",
      props.unitCustom ?? "",
      decimalsValue.value,
    ),
  );
  return t("dashboard.thresholdHint", { value: raw(String(formatted)) });
};
</script>
