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

<template>
  <div class="flex flex-col gap-3 p-1" data-test="trace-issues-panel">
    <section
      v-for="issue in issues"
      :key="`${issue.rule}-${issue.agent ?? ''}-${issue.tool}`"
      class="rounded-default border-border-default flex flex-col gap-2 border p-3"
      :data-test="`trace-issue-${issue.rule}-${issue.tool}`"
    >
      <div class="flex items-center gap-2">
        <OBadge
          :variant="issue.rule === 'repeated_tool_calls' ? 'error-soft' : 'warning-soft'"
          size="sm"
        >
          {{ t(`traceIssues.severity.${issue.rule}`) }}
        </OBadge>
        <span class="text-compact text-text-heading font-semibold">{{
          t(`traceIssues.rules.${issue.rule}`)
        }}</span>
        <span v-if="issue.agent" class="text-2xs text-text-secondary">{{ issue.agent }}</span>
      </div>
      <span class="text-compact text-text-body">{{ sentence(issue) }}</span>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-2xs text-text-secondary font-semibold">{{
          t("traceIssues.evidence")
        }}</span>
        <template v-for="(id, n) in shown(issue)" :key="id ?? `gap-${n}`">
          <span v-if="id === null" class="text-2xs text-text-secondary">{{ `…` }}</span>
          <button
            v-else
            type="button"
            class="text-2xs text-text-link hover:underline"
            :data-test="`trace-issue-evidence-${id}`"
            @click="emit('select-span', id)"
          >
            {{ t("traceIssues.call", { n: issue.evidence.indexOf(id) + 1 }) }}
          </button>
        </template>
      </div>
      <span class="text-2xs text-text-secondary">{{ t("traceIssues.ruleSource") }}</span>
    </section>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { TraceIssue } from "./traceIssues";

defineProps<{ issues: TraceIssue[] }>();
const emit = defineEmits<{ (e: "select-span", spanId: string): void }>();

const { t } = useI18nTyped();

const sentence = (i: TraceIssue) =>
  i.rule === "repeated_tool_calls"
    ? t("traceIssues.repeated", {
        tool: i.tool,
        calls: i.calls,
        threshold: i.threshold,
        errors: i.errors,
      })
    : t("traceIssues.failing", { tool: i.tool, errors: i.errors, threshold: i.threshold });

// The first three calls and the last, with a gap marker between.
const shown = (i: TraceIssue): Array<string | null> =>
  i.evidence.length <= 5
    ? i.evidence
    : [...i.evidence.slice(0, 3), null, i.evidence[i.evidence.length - 1]];
</script>
