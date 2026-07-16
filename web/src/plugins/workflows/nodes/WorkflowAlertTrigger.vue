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
  { key: "_timestamp", value: "1784027838234393", kind: "number" },
  { key: "job", value: '"test"', kind: "string" },
  { key: "level", value: '"info"', kind: "string" },
  { key: "log", value: '"test message for openobserve"', kind: "string" },
];

// The field key without the `meta.` prefix (shown in the tree).
const metaKey = (v: TriggerOutputVar) => v.ref.replace(/^meta\./, "");

const displayType = (v: TriggerOutputVar) =>
  v.enumValues
    ? v.enumValues.map((e) => `"${e}"`).join(" | ")
    : v.type;

// No editable fields — carry the trigger kind through (persisted in meta).
const submit = () => ({ trigger_kind: triggerKind });

defineExpose({ submit });
</script>

<!--
  Scoped block: styles the dynamically-rendered schema tree (syntax-highlighted
  tokens + :hover / expand states) that Tailwind utilities can't reach on
  generated spans. Colours reuse the existing base palette primitives
  (--color-blue/cyan/teal/amber-*) — the primitives are fixed, so the .dark rules
  pick a lighter shade for the dark surface. No --o2-* / hex literals.
-->
<style scoped>
.schema-tree {
  font-size: 0.75rem;
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
  padding-top: 0.125rem;
  padding-bottom: 0.125rem;
}

/* Interactive rows (expand toggles + hoverable leaves). */
.schema-row {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  border-radius: 0.25rem;
  font: inherit;
}
button.schema-row {
  cursor: pointer;
}
.schema-leaf {
  cursor: default;
}
.schema-row:hover {
  background: var(--color-surface-subtle-hover);
}

.schema-chevron {
  flex-shrink: 0;
  margin-right: 0.25rem;
  color: var(--color-text-secondary);
  transition: transform 0.15s ease;
}
.schema-chevron--open {
  transform: rotate(90deg);
}

.schema-key {
  color: var(--color-blue-600);
  font-weight: 600;
}
.schema-type {
  color: var(--color-cyan-700);
}
.schema-enum {
  color: var(--color-amber-700);
}
.schema-punct,
.schema-muted {
  color: var(--color-text-secondary);
}

/* Dark surface — lighter shades of the same families read better. */
.dark .schema-key {
  color: var(--color-blue-400);
}
.dark .schema-type {
  color: var(--color-teal-400);
}
.dark .schema-enum {
  color: var(--color-amber-400);
}
</style>
