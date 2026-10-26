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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { MAX_VIEW_CONDS } from "@/utils/rum/productAnalyticsModel";
import type { StepFilters, StepRef, ViewCond } from "@/utils/rum/productAnalyticsQueries";
import { MAX_STEP_MS, toMs } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import {
  condOf,
  condProblem,
  draftOf,
  withConds,
  type ViewCondDraft,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";

defineOptions({ name: "StepConditionEditor" });

const props = defineProps<{ step: StepRef; index: number; compact?: boolean }>();
const emit = defineEmits<{ update: [StepRef] }>();
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

const setFilters = (patch: { minMs?: number; frustrated?: boolean; errored?: boolean }) => {
  const s = props.step;
  const merged = { ...s.f, ...patch };
  const f: StepFilters = {
    ...(merged.minMs !== undefined ? { minMs: merged.minMs } : {}),
    ...(merged.frustrated ? { frustrated: true as const } : {}),
    ...(merged.errored ? { errored: true as const } : {}),
    ...(merged.vc?.length ? { vc: merged.vc } : {}),
  };
  emit(
    "update",
    Object.keys(f).length ? { kind: s.kind, key: s.key, f } : { kind: s.kind, key: s.key },
  );
};
</script>
