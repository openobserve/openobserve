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
  <div class="h-full" data-test="traces-sql-error-state">
    <QueryErrorState
      size="hero"
      :error-code="code"
      :error-msg="errorMsg"
      :error-detail="errorDetail"
      :ai-enabled="aiEnabled"
      :resource-name="streamName"
      :query="query"
      :title="copy?.title"
      :description="copy?.description"
      @ask-ai="emit('ask-ai')"
    >
      <template #actions>
        <!-- Always rendered: an empty slot falls back to the generic Fix query card. -->
        <div class="contents">
          <EmptyStateActionCard
            v-if="fix?.kind === 'suggestion'"
            icon="edit"
            :label="t('traces.sqlMode.errors.didYouMean', { field: fix.suggestion })"
            :sublabel="t('traces.sqlMode.errors.didYouMeanDesc', { field: fix.field })"
            class="max-w-full! flex-none! basis-auto!"
            data-test="traces-sql-fix-suggestion-card"
            @click="emit('run-sql', replaceSqlIdentifier(query, fix.field, fix.suggestion))"
          />
          <EmptyStateActionCard
            v-else-if="fix?.kind === 'lastHour'"
            icon="schedule"
            :label="t('traces.sqlMode.errors.useLastHour')"
            :sublabel="t('traces.sqlMode.errors.useLastHourDesc')"
            class="max-w-full! flex-none! basis-auto!"
            data-test="traces-sql-fix-last-hour-card"
            @click="emit('use-last-hour')"
          />
          <EmptyStateActionCard
            v-else-if="fix?.kind === 'strMatch'"
            icon="search"
            :label="t('traces.sqlMode.matchAllEmpty.searchOneField')"
            :sublabel="t('traces.sqlMode.matchAllEmpty.searchOneFieldDesc', { call: fix.call })"
            class="max-w-full! flex-none! basis-auto!"
            data-test="traces-sql-fix-str-match-card"
            @click="emit('run-sql', fix.sql)"
          />
          <EmptyStateActionCard
            v-else-if="code === 20003"
            icon="settings"
            :label="t('queryError.configureResource')"
            :sublabel="t('queryError.configureResourceDesc')"
            data-test="query-error-configure-resource-card"
            @click="emit('configure-resource')"
          />
        </div>
      </template>
    </QueryErrorState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { replaceSqlIdentifier } from "@/utils/traces/tracesSql";
import { sqlErrorCode, tracesSqlErrorFix } from "@/utils/traces/tracesSqlErrors";

const props = defineProps<{
  errorCode: number | string;
  /** The server's message as sent, which names the field or stream. */
  errorMsg: string;
  errorDetail?: string;
  aiEnabled: boolean;
  streamName?: string;
  query: string;
  suggestions: string[];
  fields: string[];
  rangeUs: number;
}>();

const emit = defineEmits<{
  "ask-ai": [];
  "run-sql": [sql: string];
  "use-last-hour": [];
  "configure-resource": [];
}>();

const { t } = useI18nTyped();

const errorText = computed(() => `${props.errorMsg} ${props.errorDetail ?? ""}`);
const code = computed(() => sqlErrorCode(props.errorCode, errorText.value));
const fix = computed(() =>
  tracesSqlErrorFix({
    code: props.errorCode,
    text: errorText.value,
    suggestions: props.suggestions,
    fields: props.fields,
    rangeUs: props.rangeUs,
    query: props.query,
  }),
);

const copy = computed<{ title: I18nText; description: I18nText } | null>(() => {
  const current = fix.value;
  if (current?.kind === "suggestion") {
    return {
      title: t("traces.sqlMode.errors.fieldNotFoundTitle", { field: current.field }),
      description: t("traces.sqlMode.errors.fieldNotFoundDesc"),
    };
  }
  if (current?.kind === "lastHour") {
    return {
      title: t("traces.sqlMode.errors.outOfMemoryTitle"),
      description: t("traces.sqlMode.errors.outOfMemoryDesc"),
    };
  }
  if (current?.kind === "strMatch") {
    return {
      title: t("traces.sqlMode.errors.noFullTextTitle"),
      description: t("traces.sqlMode.errors.noFullTextDesc"),
    };
  }
  if (current?.kind === "missingStream") {
    return {
      title: t("traces.sqlMode.errors.missingStreamTitle"),
      description: t("traces.sqlMode.errors.missingStreamDesc", {
        stream: props.streamName || "default",
      }),
    };
  }
  return null;
});
</script>
