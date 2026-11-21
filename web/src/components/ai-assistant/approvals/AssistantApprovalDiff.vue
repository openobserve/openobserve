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
  <dl
    class="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1"
    :data-test="dataTest"
  >
    <template v-for="(row, index) in rows" :key="index">
      <dt class="text-text-secondary text-xs">{{ row.field }}</dt>
      <dd
        class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-mono text-xs wrap-anywhere"
      >
        <template v-if="row.before !== null">
          <span
            v-if="row.beforeUnknown"
            class="text-text-secondary font-sans"
            data-test="assistant-approval-diff-before-unknown"
            >{{ row.before }}</span
          >
          <s v-else class="text-text-secondary" data-test="assistant-approval-diff-before">{{
            shown(index, row.before)
          }}</s>
          <OIcon
            :name="assistantGlyph.goTo"
            size="xs"
            class="text-text-secondary"
            aria-hidden="true"
          />
          <span
            class="text-status-success-text font-medium"
            data-test="assistant-approval-diff-after"
            >{{ shown(index, row.value) }}</span
          >
        </template>
        <span v-else class="text-text-body" data-test="assistant-approval-diff-after">{{
          shown(index, row.value)
        }}</span>
        <OButton
          v-if="long(row)"
          variant="ghost-primary"
          size="xs"
          class="-ms-2 font-sans"
          :aria-expanded="open.has(index) ? 'true' : 'false'"
          data-test="assistant-approval-diff-expand"
          @click="toggle(index)"
        >
          {{ t(open.has(index) ? "assistant.approval.showLess" : "assistant.approval.showMore") }}
        </OButton>
      </dd>
    </template>
  </dl>
</template>

<script setup lang="ts">
import { reactive } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";

import type { ApprovalDiffRow } from "./approvals.types";

// Past this many characters a value is cut short, so one long field never buries the decision.
const VALUE_MAX = 120;

defineProps<{ rows: ApprovalDiffRow[]; dataTest: string }>();

const { t } = useI18nTyped();
const open = reactive(new Set<number>());

function long(row: ApprovalDiffRow): boolean {
  return [row.value, row.before].some((text) => text !== null && String(text).length > VALUE_MAX);
}

function shown(index: number, text: ApprovalDiffRow["value"]): string {
  const words = String(text);
  if (open.has(index) || words.length <= VALUE_MAX) return words;
  return `${words.slice(0, VALUE_MAX).trimEnd()}…`;
}

function toggle(index: number): void {
  if (open.has(index)) open.delete(index);
  else open.add(index);
}
</script>
