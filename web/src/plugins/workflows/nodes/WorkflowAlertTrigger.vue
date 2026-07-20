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
      class="text-xs leading-[1.9] border border-border-default bg-surface-subtle rounded-lg p-3 overflow-x-auto"
      data-test="workflow-trigger-structure"
    >
      <div class="whitespace-pre"><span class="text-text-secondary">{</span></div>

      <!-- meta: expandable object -->
      <!-- Kept as a native <button>: this is a disclosure toggle, not an
           action/CTA. OButton would need every one of its variant styles
           unset to sit inline in the tree, and nesting button semantics is
           worse for a11y than the reset below. -->
      <button
        type="button"
        class="whitespace-pre flex items-center w-full text-left rounded-sm hover:bg-surface-subtle-hover cursor-pointer border-0 bg-transparent font-[inherit] pl-3"
        :aria-expanded="metaOpen"
        data-test="workflow-trigger-meta-toggle"
        @click="metaOpen = !metaOpen"
      >
        <OIcon
          name="chevron-right"
          size="xs"
          class="shrink-0 mr-1 text-text-secondary transition-transform duration-150"
          :class="metaOpen ? 'rotate-90' : ''"
        />
        <span class="text-blue-600 dark:text-blue-400 font-semibold">meta</span><span class="text-text-secondary">: </span>
        <template v-if="metaOpen"><span class="text-text-secondary">{</span></template>
        <template v-else>
          <span class="text-text-secondary">{…}</span>
          <span class="text-text-secondary ml-1">{{ t("workflow.node.triggerMetaKeys", { count: metaVars.length }) }}</span>
        </template>
      </button>

      <template v-if="metaOpen">
        <div
          v-for="v in metaVars"
          :key="v.ref"
          class="whitespace-pre flex items-center w-full text-left rounded-sm hover:bg-surface-subtle-hover cursor-default pl-8"
          :title="t(v.descKey)"
          :data-test="`workflow-trigger-field-${metaKey(v)}`"
        >
          <span class="text-blue-600 dark:text-blue-400 font-semibold">{{ metaKey(v) }}</span><span class="text-text-secondary">: </span><span
            :data-kind="v.enumValues ? 'enum' : 'type'"
            :class="v.enumValues ? 'text-amber-700 dark:text-amber-400' : 'text-(--color-cyan-700) dark:text-(--color-teal-400)'"
            >{{ displayType(v) }}</span
          >
        </div>
        <div class="whitespace-pre pl-3"><span class="text-text-secondary">}</span></div>
      </template>

      <!-- data: expandable array of dynamic objects -->
      <button
        type="button"
        class="whitespace-pre flex items-center w-full text-left rounded-sm hover:bg-surface-subtle-hover cursor-pointer border-0 bg-transparent font-[inherit] pl-3"
        :aria-expanded="dataOpen"
        data-test="workflow-trigger-data-toggle"
        @click="dataOpen = !dataOpen"
      >
        <OIcon
          name="chevron-right"
          size="xs"
          class="shrink-0 mr-1 text-text-secondary transition-transform duration-150"
          :class="dataOpen ? 'rotate-90' : ''"
        />
        <span class="text-blue-600 dark:text-blue-400 font-semibold">data</span><span class="text-text-secondary">: </span
        ><span class="text-(--color-cyan-700) dark:text-(--color-teal-400)">Array&lt;object&gt;</span>
      </button>
      <template v-if="dataOpen">
        <div class="whitespace-pre pl-8"><span class="text-text-secondary">[</span></div>
        <div class="whitespace-pre pl-12"><span class="text-text-secondary">{</span></div>
        <div
          v-for="ex in dataExample"
          :key="ex.key"
          class="whitespace-pre pl-16"
        >
          <span class="text-blue-600 dark:text-blue-400 font-semibold">{{ ex.key }}</span><span class="text-text-secondary">: </span><span
            :data-kind="ex.kind === 'string' ? 'enum' : 'type'"
            :class="ex.kind === 'string' ? 'text-amber-700 dark:text-amber-400' : 'text-(--color-cyan-700) dark:text-(--color-teal-400)'"
            >{{ ex.value }}</span
          ><span class="text-text-secondary">,</span>
        </div>
        <div class="whitespace-pre pl-16"><span class="text-text-secondary">…</span></div>
        <div class="whitespace-pre pl-12"><span class="text-text-secondary">}</span></div>
        <div class="whitespace-pre pl-8"><span class="text-text-secondary">]</span></div>
        <div
          data-test="workflow-trigger-note"
          class="whitespace-normal leading-normal py-0.5 text-text-secondary pl-8 italic"
        >
          {{ t("workflow.node.triggerDataExampleNote") }}
        </div>
      </template>

      <div class="whitespace-pre"><span class="text-text-secondary">}</span></div>
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
