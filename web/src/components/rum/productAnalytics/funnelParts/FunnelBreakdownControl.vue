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
  <FunnelSectionRow
    :title="t('rum.analytics.funnel.railBreakdown')"
    :caption="t('rum.analytics.funnel.breakdownCaption')"
    stacked
    :boxed="!!def.breakdown"
    test-id="rum-analytics-funnel-breakdown-section"
  >
    <OTag
      v-if="def.breakdown"
      ref="chip"
      :label="valueLabel"
      variant="primary-outline"
      size="sm"
      clickable
      removable
      class="max-w-full min-w-0"
      :remove-label="t('rum.analytics.funnel.breakdownRemove')"
      data-test="rum-analytics-funnel-breakdown-chip"
      @click="setOpen(true)"
      @remove="remove"
    >
      <OTruncatedText as="span" class="min-w-0" :class="attribute ? 'font-mono' : ''">{{
        valueLabel
      }}</OTruncatedText>
    </OTag>
    <template v-if="attribute" #trailing>
      <span class="text-text-secondary text-xs">{{
        t("rum.analytics.funnel.breakdownValueFrom")
      }}</span>
      <ODropdown align="start">
        <template #trigger>
          <OButton
            variant="outline"
            size="xs"
            icon-right="arrow-drop-down"
            data-test="rum-analytics-funnel-breakdown-from-step"
            >{{ fromLabel }}</OButton
          >
        </template>
        <ODropdownItem
          :icon-left="attribute.s === undefined ? 'check' : undefined"
          data-test="rum-analytics-funnel-breakdown-from-auto"
          @select="setStep(null)"
          >{{
            start?.auto
              ? t("rum.analytics.funnel.fromAutomatic", { step: start.auto })
              : t("rum.analytics.funnel.fromAutomaticNone")
          }}</ODropdownItem
        >
        <ODropdownItem
          v-for="(name, i) in stepNames"
          :key="i"
          :icon-left="attribute.s === i + 1 ? 'check' : undefined"
          :data-test="`rum-analytics-funnel-breakdown-from-${i + 1}`"
          @select="setStep(i + 1)"
          >{{
            t("rum.analytics.funnel.fromStepItem", { step: i + 1, name: raw(name) })
          }}</ODropdownItem
        >
      </ODropdown>
    </template>
    <template #action>
      <OPopover
        :open="open"
        side="right"
        align="start"
        content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
        :aria-label="t('rum.analytics.funnel.railBreakdown')"
        @update:open="setOpen"
      >
        <template #trigger>
          <span>
            <OButton
              ref="add"
              variant="ghost"
              size="icon-sm"
              icon-left="add"
              :active="open"
              :disabled="!!def.breakdown"
              :aria-label="t('rum.analytics.funnel.breakdownAdd')"
              data-test="rum-analytics-funnel-add-breakdown-btn"
            />
            <OTooltip
              :content="
                def.breakdown
                  ? t('rum.analytics.funnel.breakdownOneAtATime')
                  : t('rum.analytics.funnel.breakdownAdd')
              "
            />
          </span>
        </template>
        <SessionFieldPicker
          v-if="open"
          :fields="[]"
          :values="idleValues"
          :groups="groups"
          :note="note"
          @pick="pick"
          @cancel="setOpen(false)"
        />
      </OPopover>
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import SessionFieldPicker from "@/components/rum/productAnalytics/funnelParts/SessionFieldPicker.vue";
import type {
  FilterValuesState,
  PickerField,
  PickerGroup,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import type { FieldSampleState } from "@/composables/rum/useFunnelFieldSample";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { fieldsOnStep, type FieldSample, type SeenField } from "@/utils/rum/funnelFields";
import { formatPct, isFilterColumn, type BreakdownStart } from "@/utils/rum/productAnalyticsModel";
import {
  isAttributeBreakdown,
  type BreakdownDim,
  type FunnelDef,
} from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelBreakdownControl" });

const props = defineProps<{
  def: FunnelDef;
  /** The built-in breakdowns this app's data has, with their names. */
  dims: readonly { dim: BreakdownDim; label: I18nText }[];
  /** Every field Filter all steps offers; attribute columns among them can break a funnel down. */
  fields: readonly string[];
  sample: FieldSample | null;
  sampleState: FieldSampleState;
  start: BreakdownStart | null;
  stepNames: readonly string[];
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "load-fields": [];
}>();
const { t } = useI18nTyped();

const open = ref(false);
const chip = ref<{ $el: HTMLElement } | null>(null);
const add = ref<{ $el: HTMLElement } | null>(null);
// Set while the picker was opened from a step's menu: it lists that step's fields and pins the pick to it.
const limitStep = ref<number | null>(null);
const idleValues: FilterValuesState = { field: null, status: "idle", rows: [] };
const DIM_ID = "dim-";
const FIELD_ID = "field-";

const attribute = computed(() =>
  isAttributeBreakdown(props.def.breakdown) ? props.def.breakdown : null,
);

const valueLabel = computed<I18nText>(() => {
  const b = props.def.breakdown;
  if (!b) return raw("");
  if (isAttributeBreakdown(b)) return raw(b.f);
  return props.dims.find((d) => d.dim === b)?.label ?? raw(b);
});

const fromLabel = computed<I18nText>(() => {
  const s = props.start;
  if (s?.anyStep)
    return t("rum.analytics.funnel.fromAnyStep", {
      pct: raw(formatPct(s.reached > 0 ? s.covered / s.reached : 0)),
    });
  const step = s?.step ?? attribute.value?.s;
  return step
    ? t("rum.analytics.funnel.fromStep", { step })
    : t("rum.analytics.funnel.fromAutomaticNone");
});

const seenHint = (f: SeenField): I18nText => {
  const step = f.steps[0];
  if (f.many) return t("rum.analytics.funnel.pickerManyValues", { step });
  const values = raw(f.top.join(", "));
  return f.more
    ? t("rum.analytics.funnel.pickerStepHintMore", { step, values, more: f.more })
    : t("rum.analytics.funnel.pickerStepHint", { step, values });
};

const isUser = (f: string) => f.startsWith("usr_");

const stepHint = (f: SeenField): I18nText => {
  if (f.many) return t("rum.analytics.funnel.stepFieldMany");
  const values = raw(f.top.join(", "));
  return f.more ? t("rum.analytics.funnel.stepFieldValues", { values, more: f.more }) : values;
};

const groups = computed<PickerGroup[]>(() => {
  const k = limitStep.value;
  if (k !== null)
    return [
      {
        id: "step",
        label: t("rum.analytics.funnel.pickerOnStep", { step: k }),
        fields: fieldsOnStep(props.sample, k).map((f) => ({
          id: `${FIELD_ID}${f.field}`,
          name: f.field,
          hint: stepHint(f),
        })),
      },
    ];
  const seen = props.sample?.fields ?? [];
  const onSteps = new Set(seen.map((f) => f.field));
  const fieldRow = (field: string, extra: Partial<PickerField> = {}): PickerField => ({
    id: `${FIELD_ID}${field}`,
    name: field,
    ...extra,
  });
  return [
    {
      id: "steps",
      label: t("rum.analytics.funnel.pickerOnSteps"),
      fields: seen.map((f) => fieldRow(f.field, { hint: seenHint(f) })),
    },
    {
      id: "key",
      label: t("rum.analytics.funnel.pickerKeyFields"),
      fields: props.dims.map((d) => ({ id: `${DIM_ID}${d.dim}`, name: d.label })),
    },
    {
      id: "user",
      label: t("rum.analytics.funnel.pickerUser"),
      fields: props.fields
        .filter(isUser)
        .map((f) => fieldRow(f, { reason: t("rum.analytics.funnel.pickerUserReason") })),
    },
    {
      id: "all",
      label: t("rum.analytics.funnel.pickerAllFields"),
      fields: props.fields
        .filter((f) => isFilterColumn(f) && !isUser(f) && !onSteps.has(f))
        .map((f) => fieldRow(f)),
    },
  ];
});

const note = computed<I18nText | null>(() => {
  if (props.sampleState === "loading") return t("rum.analytics.funnel.pickerSampling");
  if (props.sampleState === "error") return t("rum.analytics.funnel.pickerSampleFailed");
  if (limitStep.value !== null && !groups.value[0].fields.length)
    return t("rum.analytics.funnel.propertyNoFields");
  return null;
});

const setOpen = (v: boolean) => {
  open.value = v;
  if (v) emit("load-fields");
  else limitStep.value = null;
};

const openForStep = (step: number) => {
  limitStep.value = step;
  setOpen(true);
};

const focus = () => (chip.value ?? add.value)?.$el.focus();

// The picker's trigger turns disabled and the chip unmounts, which would drop keyboard focus to the page.
const refocus = () => void nextTick(focus);

const pick = (id: string) => {
  const k = limitStep.value;
  setOpen(false);
  if (id.startsWith(DIM_ID)) {
    emit("update:def", { ...props.def, breakdown: id.slice(DIM_ID.length) as BreakdownDim });
    refocus();
    return;
  }
  const f = id.slice(FIELD_ID.length);
  emit("update:def", { ...props.def, breakdown: k === null ? { f } : { f, s: k } });
  refocus();
};

const remove = () => {
  setOpen(false);
  emit("update:def", { ...props.def, breakdown: null });
  refocus();
};

const setStep = (s: number | null) => {
  const a = attribute.value;
  if (!a) return;
  emit("update:def", { ...props.def, breakdown: s === null ? { f: a.f } : { f: a.f, s } });
};

defineExpose({ openForStep, focus });
</script>
