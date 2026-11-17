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
  <OBanner variant="info" icon="info" dense inline-actions data-test="traces-sql-kept-line">
    <span data-test="traces-sql-kept-line-text">{{ message }}</span>
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        :disabled="!!whereProblem"
        :focusable-unavailable="!!whereProblem"
        data-test="traces-sql-kept-line-use-where-btn"
        @click="emit('use-where')"
      >
        <!-- First child, so it anchors to the whole button: a disabled one must say why on hover. -->
        <OTooltip v-if="whereProblem" :content="whereProblemText" />
        {{ t("traces.sqlMode.keptLine.useWhere") }}
        <template v-if="whereProblem" #unavailable-reason>{{ whereProblemText }}</template>
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        data-test="traces-sql-kept-line-back-to-sql-btn"
        @click="emit('back-to-sql')"
      >
        {{ t("traces.sqlMode.keptLine.backToSql") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import useTraces from "@/composables/useTraces";
import { analyzeTracesSql, tracesFilterFromSql } from "@/utils/traces/tracesSql";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  /** The SQL text the Spans view keeps. */
  sql: string;
  /** The filter the Traces view runs. */
  filter: string;
  /** The WHERE Use WHERE from SQL last wrote into the filter. */
  filterFromSql: string | null;
  /** The stream the picker has selected. */
  stream: string;
}>();

const emit = defineEmits<{
  (e: "use-where"): void;
  (e: "back-to-sql"): void;
}>();

const { t } = useI18nTyped();
const { tracesParser } = useTraces();

const info = computed(() => analyzeTracesSql(props.sql, tracesParser.value));
const sqlWhere = computed(() => tracesFilterFromSql(props.sql, tracesParser.value));
const whereProblem = computed(() => sqlWhere.value.problem);
const whereProblemText = computed(() =>
  whereProblem.value === "unreadable"
    ? t("traces.sqlMode.keptLine.unreadable")
    : t("traces.sqlMode.keptLine.noWhere"),
);

const message = computed(() => {
  const parts: string[] = [];
  // The SQL may have been edited since Use WHERE, so its own WHERE must still match.
  const fromSql = props.filterFromSql !== null && props.filter === props.filterFromSql;
  if (fromSql && !sqlWhere.value.problem && sqlWhere.value.filter === props.filter) {
    parts.push(t("traces.sqlMode.keptLine.fromSql"));
    if (info.value.groupBy) parts.push(t("traces.sqlMode.keptLine.groupingNotApplied"));
  } else if (!props.filter.trim()) {
    parts.push(t("traces.sqlMode.keptLine.noFilter"));
  } else {
    parts.push(t("traces.sqlMode.keptLine.otherFilter"));
  }
  const sqlStream = info.value.stream;
  if (sqlStream && sqlStream !== props.stream) {
    parts.push(t("traces.sqlMode.keptLine.otherStream", { stream: sqlStream }));
  }
  return parts.join(" ");
});
</script>
