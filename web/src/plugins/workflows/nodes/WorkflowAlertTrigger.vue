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

  Rendered as a Datadog-style collapsible JSON schema tree: keys with their type
  inline, `*` marks always-present fields, nested `meta` / `data` are
  expand/collapse. `meta` is a fixed schema; `data[]` columns are dynamic (from
  the alert's query). Hovering a field shows its description (native title).
  Types are annotations, not dummy values.

  submit() just carries the trigger_kind through (persisted in node.meta by
  WorkflowEditor); there are no editable fields.
-->
<template>
  <div data-test="workflow-trigger-body" class="w-full flex flex-col">
    <p class="text-[13px] text-text-secondary leading-normal mb-3">
      {{ t("workflow.node.triggerPayloadIntro") }}
    </p>

    <div
      class="schema-tree border border-border-default bg-surface-subtle rounded-lg p-3 overflow-x-auto"
      data-test="workflow-trigger-structure"
    >
      <div class="schema-line"><span class="schema-punct">{</span></div>

      <!-- meta: expandable object -->
      <button
        type="button"
        class="schema-line schema-row pl-3"
        data-test="workflow-trigger-meta-toggle"
        @click="metaOpen = !metaOpen"
      >
        <OIcon
          name="chevron-right"
          size="xs"
          class="schema-chevron"
          :class="{ 'schema-chevron--open': metaOpen }"
        />
        <span class="schema-key">meta</span><span class="schema-punct">: </span>
        <template v-if="metaOpen"><span class="schema-punct">{</span></template>
        <template v-else>
          <span class="schema-punct">{…}</span>
          <span class="schema-muted ml-1">{{ metaVars.length }} keys</span>
        </template>
      </button>

      <template v-if="metaOpen">
        <div
          v-for="v in metaVars"
          :key="v.ref"
          class="schema-line schema-row schema-leaf pl-8"
          :title="t(v.descKey)"
          :data-test="`workflow-trigger-field-${metaKey(v)}`"
        >
          <span class="schema-key">{{ metaKey(v) }}</span><span class="schema-punct">: </span><span
            :class="v.enumValues ? 'schema-enum' : 'schema-type'"
            >{{ displayType(v) }}</span
          >
        </div>
        <div class="schema-line pl-3"><span class="schema-punct">}</span></div>
      </template>

      <!-- data: expandable array of dynamic objects -->
      <button
        type="button"
        class="schema-line schema-row pl-3"
        data-test="workflow-trigger-data-toggle"
        @click="dataOpen = !dataOpen"
      >
        <OIcon
          name="chevron-right"
          size="xs"
          class="schema-chevron"
          :class="{ 'schema-chevron--open': dataOpen }"
        />
        <span class="schema-key">data</span><span class="schema-punct">: </span
        ><span class="schema-type">Array&lt;object&gt;</span>
      </button>
      <template v-if="dataOpen">
        <div class="schema-line pl-8"><span class="schema-punct">[</span></div>
        <div class="schema-line pl-12"><span class="schema-punct">{</span></div>
        <div
          v-for="ex in dataExample"
          :key="ex.key"
          class="schema-line pl-16"
        >
          <span class="schema-key">{{ ex.key }}</span><span class="schema-punct">: </span><span
            :class="ex.kind === 'string' ? 'schema-enum' : 'schema-type'"
            >{{ ex.value }}</span
          ><span class="schema-punct">,</span>
        </div>
        <div class="schema-line pl-16"><span class="schema-muted">…</span></div>
        <div class="schema-line pl-12"><span class="schema-punct">}</span></div>
        <div class="schema-line pl-8"><span class="schema-punct">]</span></div>
        <div class="schema-note schema-leaf pl-8 schema-muted italic">
          {{ t("workflow.node.triggerDataExampleNote") }}
        </div>
      </template>

      <div class="schema-line"><span class="schema-punct">}</span></div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import {
  TRIGGER_META_VARS,
  type TriggerOutputVar,
} from "@/plugins/workflows/alertFields";

const { t } = useI18n();

const savedData = workflowObj.currentSelectedNodeData?.data || {};
const triggerKind = savedData.trigger_kind || "alert_fired";

const metaVars = TRIGGER_META_VARS;

const metaOpen = ref(true);
const dataOpen = ref(true);

// Example row for the dynamic `data` array. `_timestamp` is always present on a
// record; the rest are illustrative — the real columns come from the alert's
// query (called out in triggerDataExampleNote).
const dataExample: { key: string; value: string; kind: "string" | "number" }[] = [
  { key: "_timestamp", value: "1719400000000000", kind: "number" },
  { key: "host", value: '"api-01"', kind: "string" },
  { key: "status_code", value: "500", kind: "number" },
];

// The field key without the `meta.` prefix (shown in the tree).
const metaKey = (v: TriggerOutputVar) => v.ref.replace(/^meta\./, "");

// The inline type — an enum renders as `"a" | "b"` (Datadog style).
const displayType = (v: TriggerOutputVar) =>
  v.enumValues
    ? v.enumValues.map((e) => `"${e}"`).join(" | ")
    : v.type;

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>

<style scoped>
.schema-tree {
  font-size: 12px;
  line-height: 1.9;
  /* background comes from the themed `bg-surface-subtle` class */
}

.schema-line {
  white-space: pre;
}

/* Descriptive note lines wrap instead of forcing horizontal scroll. */
.schema-note {
  white-space: normal;
  line-height: 1.5;
  padding-top: 2px;
  padding-bottom: 2px;
}

/* Interactive rows (expand toggles + hoverable leaves). */
.schema-row {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  border-radius: 4px;
  font: inherit;
}
button.schema-row {
  cursor: pointer;
}
.schema-leaf {
  cursor: default;
}
.schema-row:hover {
  background: var(--o2-color-surface-hover, rgba(79, 107, 237, 0.08));
}

.schema-chevron {
  flex-shrink: 0;
  margin-right: 4px;
  color: var(--o2-color-text-secondary, #8a94a6);
  transition: transform 0.15s ease;
}
.schema-chevron--open {
  transform: rotate(90deg);
}

/* Tokens (Datadog-like syntax colours) — light theme. */
.schema-key {
  color: #2b6cb0;
  font-weight: 600;
}
.schema-type {
  color: #0b7285;
}
.schema-enum {
  color: #b7791f;
}
.schema-punct,
.schema-muted {
  color: var(--o2-text-secondary, #8a94a6);
}

/* Dark theme — lighter token colours so they read on the dark surface. */
.dark .schema-key {
  color: #60a5fa;
}
.dark .schema-type {
  color: #2dd4bf;
}
.dark .schema-enum {
  color: #fbbf24;
}
</style>
