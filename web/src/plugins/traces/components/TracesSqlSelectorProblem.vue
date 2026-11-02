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
  <div class="h-full" data-test="traces-sql-selector-problem">
    <QueryErrorState
      size="hero"
      :error-code="0"
      error-msg=""
      :ai-enabled="aiEnabled"
      :title="
        problem === 'quotedMarker'
          ? t('traces.sqlMode.selector.quotedMarkerTitle')
          : t('traces.sqlMode.selector.title')
      "
      :description="t(`traces.sqlMode.selector.${problem}`)"
      @ask-ai="emit('ask-ai')"
    >
      <template #actions>
        <div class="flex w-full flex-col items-center gap-3">
          <div
            v-if="suggestion"
            class="flex w-full max-w-2xl flex-col gap-1.5 text-start"
            data-test="traces-sql-suggested-change"
          >
            <span class="text-text-secondary text-xs font-medium">
              {{ t("traces.sqlMode.selector.suggestedChange") }}
            </span>
            <OCode block wrap>
              <span
                class="text-status-error block"
                data-test="traces-sql-suggested-change-before"
                >{{ `− ${suggestion.before}` }}</span
              ><span
                class="text-status-success block"
                data-test="traces-sql-suggested-change-after"
                >{{ `+ ${suggestion.after}` }}</span
              >
            </OCode>
          </div>
          <div class="flex flex-wrap items-stretch justify-center gap-3">
            <EmptyStateActionCard
              v-if="suggestion"
              icon="play-arrow"
              :label="t('traces.sqlMode.selector.addTraceIdAndRun')"
              :sublabel="t('traces.sqlMode.selector.addTraceIdAndRunDesc')"
              data-test="traces-sql-add-trace-id-run-card"
              @click="emit('add-trace-id')"
            />
            <EmptyStateActionCard
              icon="list"
              :label="t('traces.sqlMode.openInSpans')"
              :sublabel="t('traces.sqlMode.openInSpansDesc')"
              data-test="traces-sql-open-in-spans-card"
              @click="emit('open-spans')"
            />
          </div>
        </div>
      </template>
    </QueryErrorState>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import type { TraceSelectorProblem } from "@/utils/traces/tracesSql";

defineProps<{
  problem: TraceSelectorProblem;
  /** The SELECT line before and after trace_id; null when adding it would change the groups. */
  suggestion: { before: string; after: string } | null;
  aiEnabled?: boolean;
}>();

const emit = defineEmits<{
  "add-trace-id": [];
  "open-spans": [];
  "ask-ai": [];
}>();

const { t } = useI18nTyped();
</script>
