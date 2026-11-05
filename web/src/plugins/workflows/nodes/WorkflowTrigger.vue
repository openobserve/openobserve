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

    <div
      v-if="showHttpLink"
      data-test="workflow-trigger-http-link"
      class="border-border-default rounded-default mb-3 flex items-center gap-2 border px-3 py-1.5 text-xs"
    >
      <OIcon name="webhook" size="xs" class="text-text-secondary shrink-0" />
      <span class="text-text-secondary min-w-0 flex-1">
        {{
          httpEditorState.endpointOn
            ? t("workflow.http.triggerLinkOn")
            : t("workflow.http.triggerLinkOff")
        }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="workflow-trigger-http-link-action"
        @click="emit('open-http-endpoint')"
      >
        {{
          httpEditorState.endpointOn
            ? t("workflow.http.triggerLinkOnAction")
            : t("workflow.http.triggerLinkOffAction")
        }}
      </OButton>
    </div>

    <!-- Kinds with commonMetaKeys (incidents) pick an event_type; with the endpoint on, every kind also offers the HTTP request. -->
    <OSelect
      v-if="showPicker"
      v-model="selectedVariant"
      :label="pickerLabel"
      :options="pickerOptions"
      class="mb-3"
      data-test="workflow-trigger-sample-variant"
    />

    <!-- Renders the SAME text the Test dialog seeds, so reference and test input cannot drift. -->
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
        :query="shownPayloadText"
        class="h-full! w-full"
      />
    </div>
    <p
      v-if="noteKey && !isSplit && !showsHttp"
      class="text-text-secondary mt-2 text-xs leading-normal"
    >
      {{ t(noteKey) }}
    </p>
  </div>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { workflowHooksEnabled } from "@/plugins/workflows/httpEndpoint";
import { httpEditorState, httpPreviewSample } from "@/plugins/workflows/httpEndpointUi";
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
const store = useStore();
const emit = defineEmits<{ (e: "open-http-endpoint"): void }>();

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
// Sentinels outside every kind's variant keys, so they never collide with an event_type.
const KIND_VARIANT = "__kind__";
const HTTP_VARIANT = "__http__";

const hooksOn = computed(() => workflowHooksEnabled(store.state.zoConfig));
const showHttpLink = computed(() => hooksOn.value && !workflowObj.readOnly);
const offersHttp = computed(() => hooksOn.value && httpEditorState.endpointOn);

const selectedVariant = ref(
  offersHttp.value && httpEditorState.payloadFrom === "http"
    ? HTTP_VARIANT
    : (variants[0]?.key ?? KIND_VARIANT),
);
const showsHttp = computed(() => selectedVariant.value === HTTP_VARIANT);
watch(selectedVariant, (v) => {
  httpEditorState.payloadFrom = v === HTTP_VARIANT ? "http" : "trigger";
});
// The endpoint turning off takes the HTTP choice with it.
watch(offersHttp, (on) => {
  if (!on && showsHttp.value) selectedVariant.value = variants[0]?.key ?? KIND_VARIANT;
});

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

const showPicker = computed(() => isSplit || offersHttp.value);
const pickerLabel = computed(() =>
  offersHttp.value ? t("workflow.http.payloadFrom") : t(variantLabelKey),
);
const pickerOptions = computed(() => {
  const kindOptions = isSplit ? variantOptions : [{ label: t(def.labelKey), value: KIND_VARIANT }];
  if (!offersHttp.value) return kindOptions;
  return [...kindOptions, { label: t("workflow.http.payloadHttp"), value: HTTP_VARIANT }];
});
const shownPayloadText = computed(() => {
  if (showsHttp.value) return JSON.stringify(httpPreviewSample(), null, 2);
  return isSplit ? mergedPayloadText.value : payloadText.value;
});

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>
