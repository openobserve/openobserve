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
  Alert Trigger node body (drawer content only — chrome lives in
  WorkflowNodeDrawer). There's nothing to configure: the trigger kind is chosen
  at workflow creation and alert association is handled from the alert side. So
  this is a read-only *Outputs* reference of the payload the trigger emits when a
  linked alert fires, so users know which fields they can use downstream.

  Payload shape (matches the alert template vars the backend substitutes in
  service/alerts/alert.rs `process_dest_template`):
    { "meta": { ...fixed alert fields... }, "data": [ { ...matched row... } ] }

  submit() just carries the trigger_kind through (persisted in node.meta by
  WorkflowEditor); there are no editable fields.
-->
<template>
  <div data-test="workflow-trigger-body" class="w-full flex flex-col">
    <p class="text-xs text-text-secondary leading-normal mb-3">
      {{ t("workflow.node.triggerPayloadIntro") }}
    </p>

    <!-- Read-only Monaco instead of a hand-rolled schema tree: syntax
         highlighting, folding (what the old expand/collapse buttons were
         reimplementing) and copy/paste for free. Renders the SAME text the Test
         dialog seeds (buildTestSampleText), so the reference and the test input
         cannot drift.
         Monaco needs a DEFINITE height — it measures its container and collapses
         to nothing if that is auto/0. The wrapper supplies it (the drawer body is
         not always full-height), and the editor fills the wrapper. -->
    <div
      data-test="workflow-trigger-structure"
      class="w-full h-110 rounded-default border border-border-default overflow-hidden"
    >
      <QueryEditor
        editor-id="workflow-trigger-payload"
        language="json"
        :read-only="true"
        :show-auto-complete="false"
        :show-line-numbers="false"
        :sticky-scroll="false"
        :query="payloadText"
        class="w-full h-full!"
      />
    </div>

    <!-- Kept from the old tree: without it the sample's job/level/log columns
         read as guaranteed, when they actually come from the alert's query. -->
    <p class="text-xs text-text-secondary leading-normal mt-2 italic">
      {{ t("workflow.node.triggerDataExampleNote") }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSampleText } from "@/plugins/workflows/testSample";

// Async like every other QueryEditor consumer — Monaco is already on this route
// (Function node, Test dialog, Step Result drawer), so this adds no new chunk.
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const { t } = useI18n();

const savedData = workflowObj.currentSelectedNodeData?.data || {};
const triggerKind = savedData.trigger_kind || "alert_fired";

const payloadText = buildTestSampleText();

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>
