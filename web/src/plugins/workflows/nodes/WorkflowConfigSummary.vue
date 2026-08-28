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
  READ-ONLY config readout for the NDV, shown in place of the editable node form when
  the panel is inspecting a run (canvasReadOnly — the Runs history). A form reads as
  "what do I edit here?"; this is a display of WHAT THE NODE IS SET TO, per type:
    - Condition   → the rule as a readable expression (buildConditionPreview).
    - Function    → name + before/after-flatten badge, then the code read-only.
    - Destination → the destination name.
    - Trigger     → the trigger kind (its payload shows in the Input/Output panes).
  Reads the current node's data reactively; the host keys it by node id so it swaps
  on prev/next navigation.
-->
<template>
  <div data-test="workflow-config-summary" class="flex min-h-0 w-full flex-1 flex-col gap-2">
    <WorkflowConfigHeader />

    <!-- CONDITION — the filter rule as an expression, not a builder. Same code-block
         frame the alert history drawer uses for its condition readout. -->
    <template v-if="type === 'condition'">
      <div
        v-if="conditionText"
        data-test="workflow-config-summary-condition"
        class="border-border-default bg-surface-panel rounded-default flex flex-col overflow-hidden border"
      >
        <div
          class="border-border-default bg-surface-subtle flex shrink-0 items-center justify-between border-b px-2.5 py-1.5"
        >
          <span class="text-text-secondary text-2xs font-medium">{{
            t("alerts.alertDetails.conditions")
          }}</span>
          <OButton
            variant="ghost-muted"
            size="icon-xs-sq"
            data-test="workflow-config-summary-condition-copy"
            @click="copyConditions"
          >
            <OIcon name="content-copy" size="sm" />
            <OTooltip :content="t('common.copy')" />
          </OButton>
        </div>
        <pre
          class="text-compact m-0 overflow-x-auto p-[0.625rem_0.875rem] font-mono leading-relaxed whitespace-pre-wrap"
          >{{ conditionText }}</pre>
      </div>
      <p v-else class="text-text-secondary text-sm italic">{{ t("workflow.results.noConfig") }}</p>
    </template>

    <!-- FUNCTION — name + flatten mode, then the code read-only. -->
    <template v-else-if="type === 'function'">
      <template v-if="functionName">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-text-secondary text-sm">{{ t("workflow.results.functionLabel") }}</span>
          <span class="text-text-body text-sm font-bold">{{ functionName }}</span>
          <OBadge variant="default-soft" size="sm">{{ flattenLabel }}</OBadge>
        </div>
        <div
          v-if="functionCode"
          data-test="workflow-config-summary-function"
          class="border-border-default bg-code-bg rounded-default flex min-h-0 flex-1 flex-col overflow-hidden border"
        >
          <CodeQueryEditor
            editor-id="workflow-config-summary-fn"
            language="javascript"
            :query="functionCode"
            :read-only="true"
            :show-auto-complete="false"
            class="min-h-0 flex-1"
          />
        </div>
      </template>
      <p v-else class="text-text-secondary text-sm italic">{{ t("workflow.results.noConfig") }}</p>
    </template>

    <!-- DESTINATION — the resolved request, not just the name. A bare name cannot
         explain a failed delivery; the URL and method are what a 404 is about. -->
    <template v-else-if="type === 'destination'">
      <div
        v-if="destinationName"
        data-test="workflow-config-summary-destination"
        class="border-border-default rounded-default flex flex-col gap-3 border px-3 py-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-text-secondary text-sm">{{
            t("workflow.results.destinationLabel")
          }}</span>
          <span class="text-text-body text-sm font-medium">{{ destinationName }}</span>
          <OBadge
            v-if="destinationUnsupported"
            variant="warning-soft"
            size="sm"
            data-test="workflow-config-summary-destination-unsupported"
            >{{ t("workflow.results.destinationUnsupported") }}</OBadge
          >
        </div>

        <!-- The request line. Wraps rather than truncates — a clipped URL is the one
             thing that makes this panel useless again. -->
        <div v-if="destinationUrl" class="flex flex-wrap items-baseline gap-2">
          <OBadge variant="default-soft" size="sm">{{ destinationMethod }}</OBadge>
          <span
            data-test="workflow-config-summary-destination-url"
            class="text-text-body font-mono text-sm break-all"
            >{{ destinationUrl }}</span
          >
        </div>

        <dl v-if="destinationRows.length" class="flex flex-col gap-1">
          <div v-for="row in destinationRows" :key="row.key" class="flex gap-2 text-sm">
            <dt class="text-text-secondary w-32 shrink-0">{{ row.label }}</dt>
            <dd class="text-text-body break-words">{{ row.value }}</dd>
          </div>
        </dl>

        <p
          v-if="destinationMissing"
          data-test="workflow-config-summary-destination-missing"
          class="text-text-warning text-sm"
        >
          {{ t("workflow.results.destinationMissing") }}
        </p>
      </div>
      <p v-else class="text-text-secondary text-sm italic">{{ t("workflow.results.noConfig") }}</p>
    </template>

    <!-- TRIGGER / OTHER — the trigger kind (payload is in the I/O panes). -->
    <template v-else>
      <div class="text-text-body text-sm" data-test="workflow-config-summary-trigger">
        {{ triggerKindTitle }}
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import WorkflowConfigHeader from "./WorkflowConfigHeader.vue";
import { buildConditionPreview } from "@/utils/conditionPreview";
import functionsService from "@/services/jstransform";
import { isCustomDestination } from "@/utils/destinationType";
import { useWorkflowDestinations } from "@/plugins/workflows/useWorkflowDestinations";
import type { Destination } from "@/ts/interfaces/alert";
import { workflowObj, triggerDef } from "@/plugins/workflows/useWorkflowCanvas";
import { DEFAULT_TRIGGER_KIND } from "@/plugins/workflows/triggers";

const { t } = useI18nTyped();
const store = useStore();

const data = computed<any>(() => workflowObj.currentSelectedNodeData?.data || {});
const type = computed<string>(() => data.value.node_type || "");

// Condition → the rule expression; "" when empty (placeholder) → noConfig.
const conditionText = computed(() => buildConditionPreview(data.value.conditions));

const copyConditions = () => copyToClipboard(conditionText.value, t);

// Function → name + flatten mode. `after_flatten` = run AFTER flattening (RAF), else
// BEFORE (RBF) — the same shorthand the function editor uses.
const functionName = computed(() => data.value.name || "");
const functionFlatten = computed(() => !!data.value.after_flatten);
const flattenLabel = computed<I18nText>(() => raw(functionFlatten.value ? "RAF" : "RBF"));

// Destination → the target name (the Pipeline Destination's name). The node stores
// only that name, so the record is fetched to show what the request actually is.
const destinationName = computed(() => data.value.destination_id || "");

const { destinationsByName, destinationsLoaded, ensureWorkflowDestinations } =
  useWorkflowDestinations();

watch(
  [type, destinationName],
  ([t2, name]) => {
    if (t2 === "destination" && name)
      ensureWorkflowDestinations(store.state.selectedOrganization.identifier);
  },
  { immediate: true },
);

const destinationRecord = computed<Destination | null>(
  () => destinationsByName.value[destinationName.value] || null,
);

// Only claim the destination is gone once the lookup actually succeeded — a failed
// list call means we don't know, and saying "no longer exists" there is a lie.
const destinationMissing = computed(
  () => !!destinationName.value && destinationsLoaded.value && !destinationRecord.value,
);

const destinationUrl = computed<I18nText>(() => raw(destinationRecord.value?.url) || raw(""));
const destinationMethod = computed<I18nText>(() =>
  raw((destinationRecord.value?.method || "POST").toUpperCase()),
);
// Only flagged once the record is actually loaded — an in-flight fetch is not "unsupported".
const destinationUnsupported = computed(
  () => !!destinationRecord.value && !isCustomDestination(destinationRecord.value),
);

// Header VALUES are withheld — this panel gets screenshotted and pasted into
// tickets, and an Authorization token should not travel with it.
const destinationHeaderNames = computed(() => Object.keys(destinationRecord.value?.headers || {}));

const destinationRows = computed<{ key: string; label: I18nText; value: I18nText }[]>(() => {
  const d = destinationRecord.value;
  if (!d) return [];
  const rows: { key: string; label: I18nText; value: I18nText }[] = [];

  if (destinationHeaderNames.value.length) {
    rows.push({
      key: "headers",
      label: t("workflow.results.headersLabel"),
      value: raw(destinationHeaderNames.value.join(", ")),
    });
  }
  const template = typeof d.template === "string" ? d.template : d.template?.name;
  if (template) {
    rows.push({
      key: "template",
      label: t("workflow.results.templateLabel"),
      value: raw(template),
    });
  }
  if (d.output_format) {
    rows.push({
      key: "output_format",
      label: t("workflow.results.outputFormatLabel"),
      value: raw(String(d.output_format).toUpperCase()),
    });
  }
  // Shown only when verification is OFF — the exception is the information; "on" is
  // the norm and would just be noise.
  if (d.skip_tls_verify) {
    rows.push({
      key: "tls",
      label: t("workflow.results.tlsVerifyLabel"),
      value: t("workflow.results.tlsDisabled"),
    });
  }
  return rows;
});

// Trigger → its display title (e.g. "Alert Fired").
const triggerKindTitle = computed<I18nText>(() =>
  t(triggerDef(data.value.trigger_kind || DEFAULT_TRIGGER_KIND).nodeTitleKey),
);

// A function node stores only its NAME — fetch definitions once to show the code
// read-only. On failure the name + flatten badge still render (code just omitted).
const functionDefs = ref<Record<string, string>>({});
const loadFunctionDefs = async () => {
  try {
    const res = await functionsService.list(
      1,
      100000,
      "name",
      false,
      "",
      store.state.selectedOrganization.identifier,
    );
    const list = res.data?.list || [];
    const map: Record<string, string> = {};
    for (const f of list) map[f.name] = f.function;
    functionDefs.value = map;
  } catch {
    /* code omitted — name + flatten still show */
  }
};
watch(
  type,
  (v) => {
    if (v === "function") loadFunctionDefs();
  },
  { immediate: true },
);
const functionCode = computed(() => functionDefs.value[functionName.value] || "");
</script>
