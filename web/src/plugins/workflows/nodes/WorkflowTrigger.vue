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
  - Incident Event (kinds with `commonMetaKeys`) → a split view: a stable common
    block + an event_type picker revealing each event's extra fields.

  submit() just carries the trigger_kind through (persisted in node.meta by
  WorkflowEditor); there are no editable fields.
-->
<template>
  <div data-test="workflow-trigger-body" class="flex w-full flex-col">
    <p class="text-text-secondary mb-3 text-xs leading-normal">
      {{ t(introKey) }}
    </p>

    <!-- SPLIT VIEW (kinds with commonMetaKeys, e.g. incidents): a stable "common
         fields" block on top, then a picker that reveals what each event_type
         ADDS on top of it. Preview-only — the trigger node has no config. -->
    <template v-if="isSplit">
      <OSelect
        v-model="selectedVariant"
        :label="t(variantLabelKey)"
        :options="variantOptions"
        class="mb-3"
        data-test="workflow-trigger-sample-variant"
      />

      <div class="text-text-body mb-1 text-xs font-semibold">
        {{ t("workflow.node.incidentCommonTitle") }}
      </div>
      <div
        data-test="workflow-trigger-common-structure"
        class="rounded-default border-border-default h-96 w-full overflow-hidden border"
      >
        <QueryEditor
          :key="selectedVariant + '-common'"
          editor-id="workflow-trigger-common"
          language="json"
          :read-only="true"
          :show-auto-complete="false"
          :show-line-numbers="false"
          :sticky-scroll="false"
          :query="commonText"
          class="h-full! w-full"
        />
      </div>

      <div class="text-text-body mt-4 mb-1 text-xs font-semibold">
        {{ t("workflow.node.incidentSpecificTitle") }}
      </div>
      <div
        v-if="hasSpecific"
        data-test="workflow-trigger-specific-structure"
        class="rounded-default border-border-default h-40 w-full overflow-hidden border"
      >
        <QueryEditor
          :key="selectedVariant + '-specific'"
          editor-id="workflow-trigger-specific"
          language="json"
          :read-only="true"
          :show-auto-complete="false"
          :show-line-numbers="false"
          :sticky-scroll="false"
          :query="specificText"
          class="h-full! w-full"
        />
      </div>
      <p
        v-else
        data-test="workflow-trigger-no-extras"
        class="text-text-secondary text-xs leading-normal"
      >
        {{ t("workflow.node.incidentNoExtraFields") }}
      </p>
    </template>

    <!-- SINGLE VIEW (alert): one read-only payload reference. Renders the SAME
         text the Test dialog seeds, so reference and test input cannot drift. -->
    <template v-else>
      <div
        data-test="workflow-trigger-structure"
        class="rounded-default border-border-default h-110 w-full overflow-hidden border"
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
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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
const variantOptions = variants.map((v) => ({ label: v.key, value: v.key }));
const selectedVariant = ref(variants[0]?.key ?? "");

// Kinds that declare `commonMetaKeys` render the SPLIT view (a stable common
// block + a per-event "what it adds" block); the rest render one combined
// payload. Both derive from the same variant sample, so they can't drift.
const commonKeys = def.commonMetaKeys ?? [];
const isSplit = !!(commonKeys.length && variants.length);

// The `meta` block of the selected variant's sample (`[{ meta, data }]`).
const selectedMeta = computed<Record<string, unknown>>(() => {
  const variant = variants.find((v) => v.key === selectedVariant.value) ?? variants[0];
  const sample = variant?.build() as [{ meta?: Record<string, unknown> }] | undefined;
  return sample?.[0]?.meta ?? {};
});

// Common block, in the registry's key order, wrapped back in the real envelope.
const commonText = computed(() => {
  const meta = selectedMeta.value;
  const common: Record<string, unknown> = {};
  for (const k of commonKeys) if (k in meta) common[k] = meta[k];
  return JSON.stringify([{ meta: common, data: [] }], null, 2);
});

// Only the fields THIS event adds on top of the common block.
const specificFields = computed<Record<string, unknown>>(() => {
  const meta = selectedMeta.value;
  const commonSet = new Set(commonKeys);
  const extras: Record<string, unknown> = {};
  for (const k of Object.keys(meta)) if (!commonSet.has(k)) extras[k] = meta[k];
  return extras;
});
// Render the extras INSIDE the real `meta` object, with a "..." placeholder
// standing in for the common fields (shown above) — so the exact merged shape
// is clear (these nest into the same `meta`, after the common ones) without
// repeating the common block. Kept valid JSON so the editor never flags it.
const specificText = computed(() =>
  JSON.stringify({ meta: { "...": "common fields above", ...specificFields.value } }, null, 2),
);
const hasSpecific = computed(() => Object.keys(specificFields.value).length > 0);

// Combined single-payload text for non-split kinds (Alert Fired).
const payloadText = computed(() => buildTriggerSampleText(triggerKind));

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>
