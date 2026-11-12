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
  <div
    class="rounded-surface relative h-full w-full border-2 border-dashed transition-colors"
    :class="
      data.selected
        ? 'border-accent bg-surface-tint-accent/40'
        : data.dropTarget
          ? 'border-accent'
          : 'border-border-strong'
    "
    :data-test="`fleet-editor-group-${id}`"
  >
    <div class="absolute start-3 top-2.5 flex items-center gap-1.5">
      <span
        class="rounded-default bg-surface-panel border-border-default text-text-heading inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs"
      >
        <OIcon
          :name="SIGNAL_ICON[data.signal] ?? 'timeline'"
          size="xs"
          class="text-text-secondary"
        />
        {{ data.label }}
      </span>
      <OTag
        v-for="(issue, i) in data.issues"
        :key="i"
        :variant="issue.severity === 'error' ? 'error-soft' : 'warning-soft'"
        size="xs"
        icon="warning"
        :label="issue.text"
      />
    </div>
    <div
      v-if="data.empty"
      class="text-text-secondary absolute inset-0 grid place-items-center text-xs"
    >
      {{ t("fleet.editor.emptyPipeline") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export interface GroupIssue {
  severity: "warning" | "error";
  text: I18nText;
}

export interface EditorGroupData {
  label: I18nText;
  signal: string;
  selected: boolean;
  dropTarget: boolean;
  empty: boolean;
  issues: GroupIssue[];
}

defineProps<{ id: string; data: EditorGroupData }>();

const { t } = useI18nTyped();

const SIGNAL_ICON: Record<string, IconName> = {
  metrics: "bar-chart",
  logs: "article",
  traces: "account-tree",
};
</script>
