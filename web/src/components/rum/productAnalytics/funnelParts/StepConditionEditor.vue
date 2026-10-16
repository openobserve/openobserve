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
    class="flex flex-col gap-3"
    :data-test="`rum-analytics-funnel-step-${index}-filters-popover`"
  >
    <span v-if="!compact" class="text-text-heading text-sm font-semibold">{{
      t("rum.analytics.funnel.stepFilters")
    }}</span>
    <template v-if="step.kind === 'p'">
      <OInput
        type="number"
        size="sm"
        :min="0"
        :max="MAX_STEP_MS / 1000"
        :label="t('rum.analytics.funnel.filterMinTime')"
        :model-value="step.f?.minMs !== undefined ? step.f.minMs / 1000 : ''"
        :data-test="`rum-analytics-funnel-step-${index}-filter-min`"
        @update:model-value="(v) => setFilters({ minMs: toMs(v) })"
      />
      <OCheckbox
        :model-value="!!step.f?.frustrated"
        :label="t('rum.analytics.funnel.filterFrustrated')"
        :data-test="`rum-analytics-funnel-step-${index}-filter-frustrated`"
        @update:model-value="(v) => setFilters({ frustrated: v === true })"
      />
      <OCheckbox
        :model-value="!!step.f?.errored"
        :label="t('rum.analytics.funnel.filterErrored')"
        :data-test="`rum-analytics-funnel-step-${index}-filter-errored`"
        @update:model-value="(v) => setFilters({ errored: v === true })"
      />
      <div class="flex flex-col gap-2" :data-test="`rum-analytics-funnel-step-${index}-only-when`">
        <span class="text-text-heading text-xs font-semibold">{{
          t("rum.analytics.funnel.onlyWhen")
        }}</span>
        <div
          v-for="(d, i) in drafts"
          :key="i"
          class="flex items-start gap-1.5"
          :class="compact ? 'flex-wrap' : ''"
          :data-test="`rum-analytics-funnel-step-${index}-cond-${i}`"
        >
          <OSelect
            :model-value="d.t"
            :options="condTypes"
            size="sm"
            class="w-32 shrink-0"
            :data-test="`rum-analytics-funnel-step-${index}-cond-${i}-type`"
            @update:model-value="(v) => setDraft(i, { t: v === 'ref' ? 'ref' : 'param' })"
          />
          <OInput
            v-if="d.t === 'param'"
            size="sm"
            class="w-28 shrink-0"
            :model-value="d.key"
            :placeholder="t('rum.analytics.funnel.condParam')"
            :data-test="`rum-analytics-funnel-step-${index}-cond-${i}-key`"
            @update:model-value="(v) => setDraft(i, { key: String(v ?? '') })"
          />
          <OInput
            size="sm"
            class="min-w-0 flex-1"
            :class="compact ? 'order-last basis-full' : ''"
            :model-value="d.values"
            :placeholder="
              d.t === 'param'
                ? t('rum.analytics.funnel.condValues')
                : t('rum.analytics.funnel.condHosts')
            "
            :error="!!problems[i]"
            :error-message="problems[i] ?? undefined"
            :data-test="`rum-analytics-funnel-step-${index}-cond-${i}-values`"
            @update:model-value="(v) => setDraft(i, { values: String(v ?? '') })"
          />
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="close"
            :aria-label="t('rum.analytics.funnel.removeCond')"
            :data-test="`rum-analytics-funnel-step-${index}-cond-${i}-remove`"
            @click="removeRow(i)"
            ><OTooltip :content="t('rum.analytics.funnel.removeCond')"
          /></OButton>
        </div>
        <span>
          <OButton
            variant="ghost-primary"
            size="xs"
            icon-left="add"
            :disabled="drafts.length >= MAX_VIEW_CONDS"
            :data-test="`rum-analytics-funnel-step-${index}-cond-add`"
            @click="addRow"
            >{{ t("rum.analytics.funnel.addCond") }}</OButton
          >
        </span>
        <span class="text-text-secondary text-xs">{{
          t("rum.analytics.funnel.condSessionHint")
        }}</span>
      </div>
    </template>
    <div class="flex flex-col gap-2" :data-test="`rum-analytics-funnel-step-${index}-property`">
      <span class="text-text-heading text-xs font-semibold">{{
        t("rum.analytics.funnel.propertyTitle")
      }}</span>
      <div
        v-for="(d, i) in propRows"
        :key="i"
        class="flex flex-col gap-1.5"
        :data-test="`rum-analytics-funnel-step-${index}-prop-${i}`"
      >
        <div class="flex items-center gap-1.5">
          <span class="min-w-0 flex-1">
            <OSelect
              :model-value="d.field || null"
              :options="fieldOptions(d.field)"
              :placeholder="t('rum.analytics.funnel.propertyField')"
              searchable
              size="sm"
              :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-field`"
              @update:model-value="(v) => setProp(i, { field: String(v ?? ''), values: [] })"
            />
          </span>
          <span class="w-28 shrink-0">
            <OSelect
              :model-value="d.cond"
              :options="propConds"
              size="sm"
              :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-op`"
              @update:model-value="(v) => setProp(i, { cond: condId(v) })"
            />
          </span>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="close"
            :aria-label="t('rum.analytics.funnel.propertyRemove')"
            :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-remove`"
            @click="removeProp(i)"
            ><OTooltip :content="t('rum.analytics.funnel.propertyRemove')"
          /></OButton>
        </div>
        <div v-if="d.field" class="flex flex-wrap items-center gap-1.5">
          <OTag
            v-for="v in d.values"
            :key="v"
            :label="valueLabel(d.field, v)"
            variant="primary-outline"
            size="sm"
            removable
            :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-value-${v}`"
            @remove="setProp(i, { values: d.values.filter((x) => x !== v) })"
          />
          <OSelect
            :model-value="null"
            :options="valueOptions(d)"
            :placeholder="t('rum.analytics.funnel.propertyAddValue')"
            :loading="values.field === d.field && values.status === 'loading'"
            searchable
            creatable
            size="sm"
            width="sm"
            :disabled="d.values.length >= MAX_FILTER_VALUES"
            :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-add-value`"
            @open="emit('filter-values', d.field)"
            @update:model-value="(v) => addValue(i, v)"
            @create="(v) => addValue(i, v)"
          />
        </div>
        <span
          v-if="propProblem(d)"
          class="text-error text-xs"
          :data-test="`rum-analytics-funnel-step-${index}-prop-${i}-invalid`"
          >{{ t("rum.analytics.funnel.propertyInvalid") }}</span
        >
      </div>
      <span
        v-if="fieldsNote"
        class="text-text-secondary text-xs"
        :data-test="`rum-analytics-funnel-step-${index}-prop-fields-note`"
        >{{ fieldsNote }}</span
      >
      <span>
        <OButton
          variant="ghost-primary"
          size="xs"
          icon-left="add"
          :disabled="propRows.length >= MAX_STEP_PROP_CONDS || !fields.length"
          :data-test="`rum-analytics-funnel-step-${index}-prop-add`"
          @click="addProp"
          >{{ t("rum.analytics.funnel.propertyAdd") }}</OButton
        >
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import {
  MAX_FILTER_VALUES,
  MAX_STEP_PROP_CONDS,
  MAX_VIEW_CONDS,
} from "@/utils/rum/productAnalyticsModel";
import type {
  FunnelFilter,
  StepFilters,
  StepRef,
  ViewCond,
} from "@/utils/rum/productAnalyticsQueries";
import type { FieldSampleState } from "@/composables/rum/useFunnelFieldSample";
import { MAX_STEP_MS, toMs } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import {
  condOf,
  condProblem,
  draftOf,
  PROP_CONDITIONS,
  propDraftOf,
  propOf,
  withConds,
  withProps,
  type FilterConditionId,
  type FilterValuesState,
  type PropDraft,
  type ViewCondDraft,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";

defineOptions({ name: "StepConditionEditor" });

const props = withDefaults(
  defineProps<{
    step: StepRef;
    index: number;
    compact?: boolean;
    /** Fields the sample saw on this step's events, the only ones its Property rows offer. */
    fields?: readonly string[];
    fieldsState?: FieldSampleState;
    values?: FilterValuesState;
  }>(),
  {
    fields: () => [],
    fieldsState: "idle",
    values: () => ({ field: null, status: "idle", rows: [] }),
  },
);
const emit = defineEmits<{
  update: [StepRef];
  "filter-values": [string];
  "load-fields": [];
}>();
const { t } = useI18nTyped();

const condTypes = computed(() => [
  { label: t("rum.analytics.funnel.condTypeParam"), value: "param" },
  { label: t("rum.analytics.funnel.condTypeRef"), value: "ref" },
]);

const saved = () => props.step.f?.vc ?? [];
// Incomplete rows stay local, so only conditions a link can carry ever reach the funnel.
const drafts = ref<ViewCondDraft[]>(saved().map(draftOf));
const applied = (rows: ViewCondDraft[]): ViewCond[] =>
  rows.map(condOf).filter((c): c is ViewCond => c !== null);

const problems = computed<(I18nText | null)[]>(() =>
  drafts.value.map((d) => {
    const p = condProblem(d);
    if (p === "credential") return t("rum.analytics.funnel.condCredential", { name: d.key.trim() });
    return p ? t("rum.analytics.funnel.condInvalid") : null;
  }),
);

watch(
  () => JSON.stringify(saved()),
  (vc) => {
    if (vc !== JSON.stringify(applied(drafts.value))) drafts.value = saved().map(draftOf);
  },
);

const emitConds = () => {
  const conds = applied(drafts.value);
  if (JSON.stringify(conds) !== JSON.stringify(saved()))
    emit("update", withConds(props.step, conds));
};

const setDraft = (i: number, patch: Partial<ViewCondDraft>) => {
  drafts.value = drafts.value.map((d, j) => (j === i ? { ...d, ...patch } : d));
  emitConds();
};

const addRow = () => {
  if (drafts.value.length < MAX_VIEW_CONDS)
    drafts.value = [...drafts.value, { t: "param", key: "", values: "" }];
};

const removeRow = (i: number) => {
  drafts.value = drafts.value.filter((_, j) => j !== i);
  emitConds();
};

const savedProps = () => props.step.f?.pc ?? [];
// A row without a field or a value stays local, so only rules a link can carry reach the funnel.
const blankProp = (): PropDraft => ({ field: "", cond: "in", values: [] });
const propRows = ref<PropDraft[]>(
  savedProps().length ? savedProps().map(propDraftOf) : [blankProp()],
);
const appliedProps = (rows: PropDraft[]): FunnelFilter[] =>
  rows.map(propOf).filter((r): r is FunnelFilter => r !== null);

const propConds = computed(() =>
  PROP_CONDITIONS.map((c) => ({
    label: t(
      `rum.analytics.funnel.propConditions.${c.id as "in" | "notIn" | "contains" | "regex"}`,
    ),
    value: c.id,
  })),
);

const condId = (v: unknown): FilterConditionId =>
  PROP_CONDITIONS.find((c) => c.id === v)?.id ?? "in";

// A field from a link that the sample missed stays offered, so the row never loses its own field.
const fieldOptions = (current: string) =>
  [...new Set([...props.fields, ...(current ? [current] : [])])].map((f) => ({
    label: raw(f),
    value: f,
  }));

const countOf = (field: string, value: string): number | null => {
  const v = props.values;
  if (v.field !== field || v.status !== "ok") return null;
  return v.rows.find((r) => r.value === value)?.sessions ?? null;
};

const valueLabel = (field: string, value: string): I18nText => {
  const n = countOf(field, value);
  return n === null
    ? raw(value)
    : t("rum.analytics.funnel.propertyValueCount", {
        value: raw(value),
        count: raw(addCommasToNumber(n)),
      });
};

const valueOptions = (d: PropDraft) =>
  props.values.field === d.field && props.values.status === "ok"
    ? props.values.rows
        .filter((r) => !d.values.includes(r.value))
        .map((r) => ({ label: valueLabel(d.field, r.value), value: r.value }))
    : [];

const propProblem = (d: PropDraft): boolean => !!d.field && !!d.values.length && !propOf(d);

const fieldsNote = computed<I18nText | null>(() => {
  if (props.fieldsState === "loading") return t("rum.analytics.funnel.propertyFieldsLoading");
  if (props.fieldsState === "error") return t("rum.analytics.funnel.propertyFieldsFailed");
  if (props.fieldsState === "ok" && !props.fields.length)
    return t("rum.analytics.funnel.propertyNoFields");
  return null;
});

watch(
  () => JSON.stringify(savedProps()),
  (pc) => {
    if (pc !== JSON.stringify(appliedProps(propRows.value)))
      propRows.value = savedProps().map(propDraftOf);
  },
);

const emitProps = () => {
  const rules = appliedProps(propRows.value);
  if (JSON.stringify(rules) !== JSON.stringify(savedProps()))
    emit("update", withProps(props.step, rules));
};

const setProp = (i: number, patch: Partial<PropDraft>) => {
  propRows.value = propRows.value.map((d, j) => (j === i ? { ...d, ...patch } : d));
  emitProps();
};

const addValue = (i: number, v: unknown) => {
  const value = String(v ?? "").trim();
  const d = propRows.value[i];
  if (!d || !value || d.values.includes(value) || d.values.length >= MAX_FILTER_VALUES) return;
  setProp(i, { values: [...d.values, value] });
};

const addProp = () => {
  if (propRows.value.length < MAX_STEP_PROP_CONDS)
    propRows.value = [...propRows.value, blankProp()];
};

const removeProp = (i: number) => {
  propRows.value = propRows.value.filter((_, j) => j !== i);
  emitProps();
};

onMounted(() => emit("load-fields"));

const setFilters = (patch: { minMs?: number; frustrated?: boolean; errored?: boolean }) => {
  const s = props.step;
  const merged = { ...s.f, ...patch };
  const f: StepFilters = {
    ...(merged.minMs !== undefined ? { minMs: merged.minMs } : {}),
    ...(merged.frustrated ? { frustrated: true as const } : {}),
    ...(merged.errored ? { errored: true as const } : {}),
    ...(merged.vc?.length ? { vc: merged.vc } : {}),
    ...(merged.pc?.length ? { pc: merged.pc } : {}),
  };
  emit(
    "update",
    Object.keys(f).length ? { kind: s.kind, key: s.key, f } : { kind: s.kind, key: s.key },
  );
};
</script>
