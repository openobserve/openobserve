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

<!--
  Shared condition/filter builder for the flow canvases (Pipelines + Workflows).
  Wraps the alerts FilterGroup in the V2 condition format, auto-converts saved
  V0/V1 rules, and hands the result back via the awaited `submit()`.

  Form wiring (the migrated house style, OWNER pattern): this component OWNS the
  <OForm> and its zod schema, so the "at least one complete condition" rule is
  enforced by makeConditionSchema — the same schema the pipeline drawer used —
  instead of an imperative toast. FilterGroup is a composite with no OForm*
  equivalent, so its model is bridged INTO the form's `conditions` field via a
  direct setFieldValue from FilterGroup's own change handlers, and the resulting
  form-level error is surfaced under it by hand.

  Hosts (pipeline Condition drawer / workflow Condition node) just render this
  and call the exposed async `submit()` from their Save: it validates and returns
  { version, conditions } — or null, having rendered the error inline.

  What each module supplies:
   - `fields`             — the column options for FilterGroup. Pipelines fetch
     the input stream schema; workflows pass the fired-alert payload fields.
   - `initialConditions`  — the saved rule to load (edit mode).
   - `normalizeOperators` — pipelines normalize backend lowercase operators.
   - `#guidelines` slot   — the yellow note box (wording differs per module).

  A condition is a filter (single output): matching records continue, the rest
  are dropped.
-->
<template>
  <div data-test="condition-builder" class="w-full">
    <OForm :form="form">
      <div class="flow-filter-group-wrapper max-w-full overflow-x-visible!" @submit.stop.prevent>
        <FilterGroup
          v-if="conditionGroup && conditionGroup.conditions"
          :key="filterGroupKey"
          :stream-fields="fields"
          :group="conditionGroup"
          :depth="0"
          name-prefix="conditions"
          condition-input-width="w-[8.125rem]"
          :allow-custom-columns="allowCustomColumns"
          :indent-rem="0.625"
          :module="module"
          @add-condition="(g) => updateGroup(g)"
          @add-group="(g) => updateGroup(g)"
          @remove-group="(id) => removeGroup(id)"
          @input:update="onInputUpdate"
        />
        <div v-else class="p-3 text-text-muted">{{ t("flow.condition.loading") }}</div>
      </div>

      <!-- The saved condition could not be parsed, so the builder reset to an
           empty group. Warn BEFORE the user saves over it. -->
      <div
        v-if="loadError"
        class="text-xs text-input-error-text mt-1"
        data-test="condition-builder-load-error"
      >
        {{ t("flow.condition.loadError") }}
      </div>

      <!-- Schema error for the bridged FilterGroup model (no OForm* field
           renders it, so surface the form-level `conditions` error here). -->
      <div
        v-if="conditionsError"
        class="text-xs text-input-error-text mt-1"
        data-test="add-condition-error"
      >
        {{ conditionsError }}
      </div>

      <slot name="guidelines" />
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import FilterGroup from "@/components/alerts/FilterGroup.vue";
import { cloneDeep } from "lodash-es";
import { getUUID } from "@/utils/zincutils";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import {
  makeConditionSchema,
  type ConditionForm,
} from "@/components/pipeline/NodeForm/Condition.schema";
import {
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  updateGroup as updateGroupUtil,
  removeConditionGroup as removeConditionGroupUtil,
  ensureIds,
} from "@/utils/alerts/alertDataTransforms";

const props = withDefaults(
  defineProps<{
    fields?: any[];
    initialConditions?: any;
    module?: string;
    allowCustomColumns?: boolean;
    normalizeOperators?: boolean;
  }>(),
  {
    fields: () => [],
    initialConditions: null,
    module: "pipelines",
    allowCustomColumns: true,
    normalizeOperators: false,
  },
);

const { t } = useI18n();
const filterGroupKey = ref(0);

// Backend returns operators in lowercase (e.g. "contains", "not_contains").
// Normalize to the canonical casing FilterCondition expects (pipeline only).
const OPERATOR_NORMALIZE_MAP: Record<string, string> = {
  contains: "Contains",
  notcontains: "NotContains",
  not_contains: "NotContains",
};
const normalizeConditionOperators = (group: any): any => {
  if (!group || group.filterType !== "group" || !Array.isArray(group.conditions)) return group;
  group.conditions = group.conditions.map((item: any) => {
    if (item.filterType === "group") return normalizeConditionOperators(item);
    if (item.filterType === "condition" && item.operator) {
      const normalized = OPERATOR_NORMALIZE_MAP[item.operator.toLowerCase()];
      if (normalized) item.operator = normalized;
    }
    return item;
  });
  return group;
};

const emptyGroup = () => ({
  filterType: "group",
  logicalOperator: "AND",
  groupId: getUUID(),
  conditions: [
    {
      filterType: "condition",
      column: "",
      operator: "=",
      value: "",
      values: [],
      logicalOperator: "AND",
      id: getUUID(),
    },
  ],
});

// A saved condition that fails to parse falls back to an EMPTY group. That is
// silently destructive — the user sees a blank builder and, on save, overwrites
// whatever was stored. Surface it so the reset is a visible, informed choice.
const loadError = ref(false);

// Load a saved rule into V2, auto-converting V0/V1; else start empty.
const initGroup = () => {
  const saved = props.initialConditions;
  if (saved) {
    try {
      const clone = JSON.parse(JSON.stringify(saved));
      const version = detectConditionsVersion(clone);
      let group: any;
      if (version === 0) group = ensureIds(convertV0ToV2(clone));
      else if (version === 1)
        group = ensureIds(clone.and || clone.or ? convertV1BEToV2(clone) : convertV1ToV2(clone));
      else group = ensureIds(clone);
      return props.normalizeOperators ? normalizeConditionOperators(group) : group;
    } catch (e) {
      console.error("Error loading condition:", e);
      loadError.value = true;
    }
  }
  return emptyGroup();
};

// Initial tree — seeds the form; after creation the FORM owns it.
const initialGroup = initGroup();

// ── OForm wiring (OWNER pattern) ─────────────────────────────────────────────
// This component owns <OForm>. FilterGroup renders in FORM MODE (name-prefix=
// "conditions"): FilterCondition name-binds each leaf's column/operator/value
// straight into the form, and structural changes (add/remove/toggle) are written
// back with setFieldValue below. SINGLE source of truth (form.useStore) — no
// mirror ref, no value-sync bridge. The schema's superRefine ("at least one
// complete condition") gates submit.
const validated = ref<ConditionForm | null>(null);

const form = useOForm<ConditionForm>({
  defaultValues: { conditions: initialGroup },
  schema: makeConditionSchema(t),
  onSubmit: (values) => {
    validated.value = values;
  },
});

// Reactive READ-VIEW of the form-owned tree, exposed as a WRITABLE computed:
// reads drive FilterGroup's `:group`, writes go through the form. Still one
// source of truth — no copy.
const conditionGroupStore = form.useStore((s: any) => s.values.conditions ?? initialGroup);
const conditionGroup = computed({
  get: () => conditionGroupStore.value,
  set: (v: any) => form.setFieldValue("conditions", v),
});

// Reactive view of the SAME form (no mirror) — rendered under the FilterGroup.
const conditionsErrors = form.useStore((s: any) => s.fieldMeta?.conditions?.errors ?? []);
const conditionsError = computed(() =>
  conditionsErrors.value.length ? String(firstFieldError(conditionsErrors.value)) : "",
);

// FilterGroup edits flow through the shared alert utilities, which expect a
// context shaped like { formData: { query_condition: { conditions } } }.
// The transform utils MUTATE their context in place and the form store is
// readonly, so run them on a CLONE of the form's current tree, then write the
// result back with setFieldValue.
const updateGroup = (updatedGroup: any) => {
  const cloned = cloneDeep((form.state.values as any).conditions);
  const ctx = { formData: { query_condition: { conditions: cloned } } };
  updateGroupUtil(updatedGroup, ctx as any);
  form.setFieldValue("conditions", ctx.formData.query_condition.conditions);
};
const removeGroup = (groupId: string) => {
  const cloned = cloneDeep((form.state.values as any).conditions);
  const ctx = { formData: { query_condition: { conditions: cloned } } };
  removeConditionGroupUtil(groupId, cloned, ctx as any);
  form.setFieldValue("conditions", ctx.formData.query_condition.conditions);
};

const onInputUpdate = (_name?: string, _field?: any) => {
  // Leaf values are name-bound in form mode (FilterCondition writes them
  // straight into the form), so there is no bridge to run here. Kept for the
  // template's @input:update wiring.
};

// Host bridge: validate through the schema and return { version, conditions },
// or null when invalid (the error renders inline under the FilterGroup).
// Detach from the readonly form read-view before handing the tree to the host.
const submit = async () => {
  validated.value = null;
  await form.handleSubmit();
  if (!validated.value) return null;
  return {
    version: 2,
    conditions: cloneDeep((form.state.values as any).conditions),
  };
};

defineExpose({ submit, conditionGroup, form });
</script>

<style scoped>
/* keep(lib-override:FilterGroup): these fit FilterGroup into the narrow flow
   drawer by reaching its INTERNALS, which utilities cannot address — hence
   :deep(). Scoped (not global): `.flow-filter-group-wrapper` is this
   component's own element, so nothing needs to escape.

   NOTE `.filter-group-box` was `.el-border` until the design-token migration
   renamed it; the old selector silently stopped matching, which is why this is
   pinned by name here.

   The former `[style*="margin-left"]` rule is gone — it patched FilterGroup's
   computed inline indent from outside and would have hit any other inline
   margin-left. The child takes an `indent-rem` prop instead (see above). */

/* Force the FilterGroup box to span the full drawer width (defaults to w-fit). */
.flow-filter-group-wrapper > :deep(.filter-group-box) {
  width: 100% !important;
}
.flow-filter-group-wrapper :deep(.group-container) {
  white-space: normal !important;
  overflow-x: visible !important;
  max-width: 100%;
  pointer-events: auto;
}
.flow-filter-group-wrapper :deep(.conditions-input) {
  min-width: 7.5rem !important;
  max-width: 12.5rem;
}
.flow-filter-group-wrapper :deep(.group-border) {
  max-width: calc(100% - 1.25rem);
}
</style>
