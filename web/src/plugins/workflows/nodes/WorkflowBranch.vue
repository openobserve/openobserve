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
  Branch node body — the N-way generalisation of the Condition node. Each case is
  an optional label plus the SAME ConditionBuilder the Condition node uses, and
  the trailing "Everything else" row stands for `else_handle`.

  Cases are evaluated TOP-DOWN and the FIRST MATCH WINS, so row order is semantic:
  the move up/down controls are a routing edit, not cosmetics. Making the else a
  visible, non-deletable row is what makes that legible — every record leaves by
  exactly one handle, and the last one is always "everything else".

  Dummy-node model (C1): every builder is `optional`, so an unfinished rule never
  blocks — submit() still returns the case (its handle, and therefore its edges,
  must survive) and the node is flagged `meta.incomplete` instead. submit() returns
  { cases, else_handle } exactly as the backend BranchParams expects.
-->
<template>
  <div data-test="workflow-branch-body" class="flex w-full flex-col">
    <WorkflowConfigHeader>
      <span
        class="text-text-secondary hover:text-text-body inline-flex cursor-help items-center"
        data-test="workflow-branch-guidelines-info"
      >
        <OIcon name="info" size="sm" />
        <OTooltip side="right" align="start" :side-offset="8" max-width="22rem">
          <template #content>
            <div class="flex flex-col gap-1.5 p-1 text-left">
              <div class="text-xs font-semibold">{{ t("workflow.node.branchNoteTitle") }}</div>
              <div v-for="(tip, i) in tips" :key="i" class="text-xs leading-snug">{{ tip }}</div>
            </div>
          </template>
        </OTooltip>
      </span>
    </WorkflowConfigHeader>

    <div class="flex w-full flex-col gap-3 pt-2">
      <div
        v-for="(row, index) in cases"
        :key="row.handle"
        :data-test="`workflow-branch-case-${row.handle}`"
        class="border-border-default rounded-surface flex w-full flex-col gap-2 border p-3"
      >
        <div class="flex items-center gap-2">
          <OBadge variant="warning-soft" size="sm" :data-test="`workflow-branch-order-${index}`">
            {{ index + 1 }}
          </OBadge>
          <OInput
            :model-value="row.label"
            size="sm"
            :placeholder="t('workflow.node.branchCaseLabelPlaceholder')"
            :aria-label="raw(t('workflow.node.branchCaseLabel'))"
            :data-test="`workflow-branch-label-${row.handle}`"
            class="grow"
            @update:model-value="(v: string | number) => (row.label = String(v ?? ''))"
          />
          <OButton
            variant="ghost"
            size="icon-xs"
            :disabled="index === 0"
            :aria-label="raw(t('workflow.node.branchMoveUp'))"
            :data-test="`workflow-branch-move-up-${row.handle}`"
            @click="moveCase(index, -1)"
          >
            <OIcon name="arrow-upward" size="xs" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon-xs"
            :disabled="index === cases.length - 1"
            :aria-label="raw(t('workflow.node.branchMoveDown'))"
            :data-test="`workflow-branch-move-down-${row.handle}`"
            @click="moveCase(index, 1)"
          >
            <OIcon name="arrow-downward" size="xs" />
          </OButton>
          <OButton
            v-if="cases.length > 1"
            variant="ghost-destructive"
            size="icon-xs"
            :aria-label="raw(t('workflow.node.branchRemoveCase'))"
            :data-test="`workflow-branch-remove-case-${row.handle}`"
            @click="removeCase(index)"
          >
            <OIcon name="delete" size="xs" />
          </OButton>
        </div>

        <ConditionBuilder
          :ref="(el: any) => setBuilderRef(row.handle, el)"
          :fields="fields"
          :initial-conditions="row.initialConditions"
          normalize-column-names
          optional
        />
      </div>

      <OButton variant="dashed" size="sm" data-test="workflow-branch-add-case" @click="addCase">
        <OIcon name="add" size="xs" />
        {{ t("workflow.node.branchAddCase") }}
      </OButton>

      <!-- Permanent and non-deletable: the else arm is what guarantees every record
           leaves by exactly one handle, so it is a row, not a hidden fallback. -->
      <div
        data-test="workflow-branch-else"
        class="border-border-default bg-surface-subtle rounded-surface flex w-full items-center gap-2 border border-dashed p-3"
      >
        <OBadge variant="default-soft" size="sm">{{ cases.length + 1 }}</OBadge>
        <span class="text-text-body text-sm font-bold">
          {{ t("workflow.node.branchElseTitle") }}
        </span>
        <span class="text-text-secondary text-xs">{{ t("workflow.node.branchElseHint") }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import {
  workflowObj,
  currentTriggerKind,
  setNodeIncomplete,
} from "@/plugins/workflows/useWorkflowCanvas";
import { triggerDef } from "@/plugins/workflows/triggers";

// The else arm's handle is fixed: `branchHandleRank` sorts it last on the canvas,
// and a case can never claim it (case handles are always `case-N`).
const ELSE_HANDLE = "else";

interface CaseRow {
  handle: string;
  label: string;
  initialConditions: any;
}

const { t } = useI18nTyped();

const tips: I18nText[] = [
  t("workflow.node.branchNoteFirstMatch"),
  t("workflow.node.branchNoteUnwired"),
];

// Field options come from the CURRENT trigger's kind, exactly as WorkflowCondition
// does; with no trigger we offer nothing rather than a wrong set.
const kind = currentTriggerKind();
const fields = kind ? triggerDef(kind).conditionFields : [];

const saved = workflowObj.currentSelectedNodeData?.data?.cases;

// STABLE handles: a case keeps the handle it was created with for the node's whole
// life. Re-indexing on delete would silently re-point every edge already wired to
// `case-1` at a different arm, so the next handle is taken from the high-water mark.
const nextIndex = ref(0);
const claimHandle = () => `case-${nextIndex.value++}`;

const toRow = (c: any): CaseRow => ({
  handle: typeof c?.handle === "string" && c.handle ? c.handle : claimHandle(),
  label: typeof c?.label === "string" ? c.label : "",
  initialConditions: c?.conditions?.conditions ?? null,
});

const hydrate = (): CaseRow[] => {
  if (!Array.isArray(saved) || !saved.length) return [];
  // Seed the high-water mark past every saved handle so a new case can't collide.
  saved.forEach((c: any) => {
    const m = /^case-(\d+)$/.exec(String(c?.handle ?? ""));
    if (m) nextIndex.value = Math.max(nextIndex.value, Number(m[1]) + 1);
  });
  return saved.map(toRow);
};

// A case-less Branch is rejected by the backend validator, so the panel always
// opens on at least one row.
const hydrated = hydrate();
const cases = ref<CaseRow[]>(
  hydrated.length ? hydrated : [{ handle: claimHandle(), label: "", initialConditions: null }],
);

// Builders are keyed by HANDLE, not index: reordering moves rows around, and an
// index-keyed ref array would hand a case its neighbour's rule on submit.
const builderRefs = ref<Record<string, any>>({});
const setBuilderRef = (handle: string, el: any) => {
  if (el) builderRefs.value[handle] = el;
  else delete builderRefs.value[handle];
};

const addCase = () => {
  cases.value.push({ handle: claimHandle(), label: "", initialConditions: null });
};

const removeCase = (index: number) => {
  if (cases.value.length <= 1) return;
  const [removed] = cases.value.splice(index, 1);
  delete builderRefs.value[removed.handle];
};

const moveCase = (index: number, delta: number) => {
  const target = index + delta;
  if (target < 0 || target >= cases.value.length) return;
  const [row] = cases.value.splice(index, 1);
  cases.value.splice(target, 0, row);
};

// Emits BranchParams: cases in evaluation order (first match wins) plus the fixed
// else handle. A case whose builder is missing or returned null is KEPT — dropping
// it would orphan every edge already wired to its handle — it just carries whatever
// rule it had. `complete` is builder-only and never reaches persisted node data.
const submit = async () => {
  const out: any[] = [];
  let anyComplete = false;
  for (const row of cases.value) {
    const payload = await builderRefs.value[row.handle]?.submit();
    const label = row.label.trim();
    const entry: any = { handle: row.handle };
    if (label) entry.label = label;
    if (payload) {
      const { complete, ...conditions } = payload;
      if (complete) anyComplete = true;
      entry.conditions = conditions;
    } else {
      entry.conditions = row.initialConditions
        ? { version: 2, conditions: row.initialConditions }
        : null;
    }
    out.push(entry);
  }
  setNodeIncomplete(workflowObj.currentSelectedNodeData, !anyComplete);
  return { cases: out, else_handle: ELSE_HANDLE };
};

defineExpose({ submit });
</script>
