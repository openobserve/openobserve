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
  Condition node body — a thin wrapper over the shared ConditionBuilder (same
  FilterGroup body the pipeline condition form uses). A workflow has no upstream
  stream node, so the fields are the CURRENT trigger's payload fields (resolved
  from the trigger registry by kind — alert vs incident); the guidelines below
  carry the workflow filter wording.

  A Condition is a filter (single output): matching records continue, the rest
  are dropped. Dummy-node model (C1): the builder is `optional`, so an empty or
  incomplete rule doesn't block — the panel-close commit saves it as a placeholder
  (flagged `meta.incomplete`, Publish blocked) instead. submit() returns
  { version, conditions } and sets the node's incomplete flag from the builder's
  `complete` result.
-->
<template>
  <div data-test="workflow-condition-body" class="flex w-full flex-col">
    <!-- Config pane header (shared) — title + the guidelines info icon RIGHT AFTER
         it. Always visible; hovering the icon shows the tips (tooltip is the app-wide
         info pattern), reachable whether or not the first-run box below is dismissed. -->
    <WorkflowConfigHeader>
      <span
        class="text-text-secondary hover:text-text-body inline-flex cursor-help items-center"
        data-test="workflow-condition-guidelines-info"
      >
        <OIcon name="info" size="sm" />
        <OTooltip side="right" align="start" :side-offset="8" max-width="22rem">
          <template #content>
            <div class="flex flex-col gap-1.5 p-1 text-left">
              <div class="text-xs font-semibold">{{ t("workflow.node.conditionNoteTitle") }}</div>
              <div v-for="(tip, i) in tips" :key="i" class="text-xs leading-snug">
                {{ tip.note }}
                <span
                  v-if="tip.example"
                  class="rounded-default bg-code-bg text-code-text px-1 py-px font-mono"
                  >{{ tip.example }}</span
                >
              </div>
            </div>
          </template>
        </OTooltip>
      </span>
    </WorkflowConfigHeader>

    <ConditionBuilder
      ref="builder"
      :fields="fields"
      :initial-conditions="savedConditions"
      normalize-column-names
      optional
    >
      <template #guidelines>
        <!-- First-run hint; dismissed once, it stays gone (localStorage) and the
             recall icon above takes over. -->
        <div
          v-if="!guidelinesDismissed"
          class="bg-banner-warning-bg border-banner-warning-border text-banner-warning-text rounded-default mt-4 flex w-full flex-col gap-2 border p-3"
          data-test="workflow-condition-note"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-bold">{{ t("workflow.node.conditionNoteTitle") }}</div>
            <OButton
              variant="ghost"
              size="icon-xs"
              data-test="workflow-condition-note-dismiss"
              :aria-label="t('common.close')"
              @click="dismissGuidelines"
            >
              <OIcon name="close" size="xs" />
            </OButton>
          </div>
          <div class="flex flex-col gap-1 text-sm">
            <div v-for="(tip, i) in tips" :key="i" class="flex items-start gap-2">
              <OIcon name="info" size="sm" class="text-status-warning-text mt-0.5 shrink-0" />
              <span>
                {{ tip.note }}
                <span
                  v-if="tip.example"
                  class="rounded-default bg-code-bg text-code-text px-1 py-px font-mono"
                  >{{ tip.example }}</span
                >
              </span>
            </div>
          </div>
        </div>
      </template>
    </ConditionBuilder>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ConditionBuilder from "@/components/flow/forms/ConditionBuilder.vue";
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import {
  workflowObj,
  currentTriggerKind,
  setNodeIncomplete,
} from "@/plugins/workflows/useWorkflowCanvas";
import { triggerDef } from "@/plugins/workflows/triggers";

const { t } = useI18nTyped();

// The guidelines, as data — rendered in BOTH the inline first-run box and the
// recall tooltip, so the copy lives in one place. The null/empty value hints
// are gone (dedicated is_null/is_empty operators replaced them); `example`
// stays for future tips that carry a verbatim code sample.
const tips: Array<{ note: I18nText; example?: I18nText }> = [
  { note: t("workflow.node.conditionNoteCustom") },
];

// The inline guidelines box is a first-run hint: shown until the user dismisses
// it, then remembered so it never nags again. The recall icon (+ tooltip) is the
// way back to the tips afterward.
const GUIDELINES_SEEN_KEY = "workflows:conditionGuidelinesSeen";
const guidelinesDismissed = ref(localStorage.getItem(GUIDELINES_SEEN_KEY) === "true");
const dismissGuidelines = () => {
  guidelinesDismissed.value = true;
  localStorage.setItem(GUIDELINES_SEEN_KEY, "true");
};
// The pickable fields are the CURRENT trigger's payload fields, so an incident
// workflow branches on incident fields and an alert workflow on alert fields.
// With no trigger (it was deleted), we offer nothing rather than a wrong set —
// the user can still type any column via allow-custom-columns.
const kind = currentTriggerKind();
const fields = kind ? triggerDef(kind).conditionFields : [];
const savedConditions = workflowObj.currentSelectedNodeData?.data?.conditions ?? null;

const builder = ref<any>(null);
// The builder is `optional`, so submit() never blocks on an incomplete rule — it
// returns { version, conditions, complete }. Flag the node incomplete when the rule
// isn't complete (drives the "Set up later" badge + blocks Publish), then strip the
// `complete` flag before it's persisted into node data. Custom columns are
// normalized to the flattened form (dots → underscores) by ConditionBuilder.
const submit = async () => {
  const payload = await builder.value?.submit();
  if (!payload) return null;
  const { complete, ...data } = payload;
  setNodeIncomplete(workflowObj.currentSelectedNodeData, !complete);
  return data;
};

defineExpose({ submit });
</script>
