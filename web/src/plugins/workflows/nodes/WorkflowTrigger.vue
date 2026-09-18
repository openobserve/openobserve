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
  Trigger node body (drawer content only — chrome lives in WorkflowNodeDrawer),
  for EVERY trigger kind. There's nothing to configure: the kind is chosen at
  workflow creation. So this is a read-only *Outputs* reference of the payload
  the trigger emits, so users know which fields they can use downstream.

  Everything is resolved from the trigger registry (triggers.ts) by kind:
  - Alert Fired → a single { meta, data[] } sample.
  - Incident Event (kinds with `commonMetaKeys`) → an event_type picker above the
    selected event's full { meta, data[] } payload (common + specific merged).

  submit() just carries the trigger_kind through (persisted in node.meta by
  WorkflowEditor); there are no editable fields.
-->
<template>
  <div data-test="workflow-trigger-body" class="flex min-h-0 w-full flex-1 flex-col">
    <!-- Config pane header (shared) — the trigger has no editable config, so this
         pane is a read-only payload reference under the same header. -->
    <WorkflowConfigHeader class="mb-2" />
    <p class="text-text-secondary mb-3 text-xs leading-normal">
      {{ t(introKey) }}
    </p>

    <!-- VARIANT VIEW (kinds with commonMetaKeys, e.g. incidents): an event_type
         picker above the selected event's FULL payload — common and event-specific
         fields merged in one `meta`. Preview-only — the trigger node has no config. -->
    <template v-if="isSplit">
      <OSelect
        v-model="selectedVariant"
        :label="t(variantLabelKey)"
        :options="variantOptions"
        class="mb-3"
        data-test="workflow-trigger-sample-variant"
      />

      <div
        data-test="workflow-trigger-structure"
        class="rounded-default border-border-default min-h-0 w-full flex-1 overflow-hidden border"
      >
        <QueryEditor
          :key="selectedVariant"
          editor-id="workflow-trigger-payload"
          language="json"
          :read-only="true"
          :show-auto-complete="false"
          :show-line-numbers="false"
          :sticky-scroll="false"
          :query="mergedPayloadText"
          class="h-full! w-full"
        />
      </div>
    </template>

    <!-- SINGLE VIEW (alert): one read-only payload reference. Renders the SAME
         text the Test dialog seeds, so reference and test input cannot drift. -->
    <template v-else>
      <div
        data-test="workflow-trigger-structure"
        class="rounded-default border-border-default min-h-0 w-full flex-1 overflow-hidden border"
      >
        <QueryEditor
          editor-id="workflow-trigger-payload"
          language="json"
          :read-only="true"
          :show-auto-complete="false"
          :show-line-numbers="false"
          :sticky-scroll="false"
          :query="payloadText"
          class="h-full! w-full"
        />
      </div>
      <p v-if="noteKey" class="text-text-secondary mt-2 text-xs leading-normal">
        {{ t(noteKey) }}
      </p>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import {
  triggerDef,
  buildTriggerSampleText,
  DEFAULT_TRIGGER_KIND,
} from "@/plugins/workflows/triggers";

// Async like every other QueryEditor consumer — Monaco is already on this route
// (Function node, Test dialog, Step Result drawer), so this adds no new chunk.
const QueryEditor = defineAsyncComponent(() => import("@/components/CodeQueryEditor.vue"));

const { t } = useI18nTyped();

const savedData = workflowObj.currentSelectedNodeData?.data || {};
const triggerKind = savedData.trigger_kind || DEFAULT_TRIGGER_KIND;

// Everything the read-only reference shows comes from the trigger registry, so a
// new trigger kind needs no change here: its intro copy, per-kind caveat note,
// and sample payload(s) all resolve from the kind.
const def = triggerDef(triggerKind);
const introKey = def.introKey;
const noteKey = def.payloadNoteKey;

// Sample-variant picker (e.g. incident lifecycle event_types). Preview-only —
// the trigger node has no editable config, so nothing here is persisted.
const variants = def.sampleVariants ?? [];
const variantLabelKey = def.sampleVariantLabelKey ?? "";
const variantOptions = variants.map((v) => ({
  label: v.labelKey ? t(v.labelKey) : raw(v.key),
  value: v.key,
}));
const selectedVariant = ref(variants[0]?.key ?? "");

// Kinds with variant samples (e.g. incidents) render a picker + the selected
// event's FULL payload (common + event-specific merged into one `meta`); the rest
// render one static payload. Both derive from the same sample, so they can't drift.
const isSplit = !!(def.commonMetaKeys?.length && variants.length);

// The selected variant's complete sample — common and event-specific fields in a
// single `meta` block, so users see the exact shape they receive.
const mergedPayloadText = computed(() => {
  const variant = variants.find((v) => v.key === selectedVariant.value) ?? variants[0];
  return JSON.stringify(variant?.build() ?? [], null, 2);
});

// Combined single-payload text for non-split kinds (Alert Fired).
const payloadText = computed(() => buildTriggerSampleText(triggerKind));

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>
