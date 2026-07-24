<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

const { t } = useI18n();

const performanceOpen = ref(false);

const props = defineProps<{
  span: Record<string, any>;
}>();

const dbSystem = computed(() => props.span.db_system ?? "");

const queryText = computed(() => props.span.db_query_text ?? props.span.db_statement ?? "");

const editorLanguage = computed(() => {
  switch (dbSystem.value) {
    case "redis":
      return "plaintext";
    case "mongodb":
      return "javascript";
    case "elasticsearch":
      return "json";
    default:
      return "sql";
  }
});

const hostDisplay = computed(() => {
  const addr = props.span.server_address;
  const port = props.span.server_port;
  if (addr && port) return `${addr}:${port}`;
  if (addr) return String(addr);
  const peerAddr = props.span.network_peer_address;
  const peerPort = props.span.network_peer_port;
  if (peerAddr && peerPort) return `${peerAddr}:${peerPort}`;
  if (peerAddr) return String(peerAddr);
  return "";
});

const tableDisplay = computed(() => props.span.db_collection_name ?? props.span.db_sql_table ?? "");

const hasPerformanceData = computed(
  () =>
    !!(
      props.span.db_response_returned_rows ||
      props.span.db_operation_batch_size ||
      props.span.db_response_status_code ||
      props.span.db_query_summary
    ),
);

const metadataRows = computed(() =>
  [
    {
      label: t("traces.dbSpanDetails.dbSystem"),
      value: String(dbSystem.value || ""),
      key: "db-system",
    },
    {
      label: t("traces.dbSpanDetails.operation"),
      value: String(props.span.db_operation_name ?? ""),
      key: "operation",
    },
    {
      label: t("traces.dbSpanDetails.database"),
      value: String(props.span.db_namespace ?? props.span.db_name ?? ""),
      key: "namespace",
    },
    {
      label: t("traces.dbSpanDetails.tableCollection"),
      value: String(tableDisplay.value || ""),
      key: "table",
    },
    { label: t("traces.dbSpanDetails.host"), value: hostDisplay.value, key: "host" },
    { label: t("traces.dbSpanDetails.user"), value: String(props.span.db_user ?? ""), key: "user" },
    {
      label: t("traces.dbSpanDetails.storedProcedure"),
      value: String(props.span.db_stored_procedure_name ?? ""),
      key: "stored-proc",
    },
  ].filter((row) => !!row.value),
);
</script>

<template>
  <div class="flex h-full flex-col gap-3 overflow-auto">
    <OCard data-test="traces-db-span-details-metadata-grid">
      <OCardSection class="px-0! py-0!">
        <div class="flex flex-wrap gap-2">
          <span
            v-for="row in metadataRows"
            :key="row.key"
            :data-test="`traces-db-span-details-tag-${row.key}`"
            class="rounded-default inline-flex items-center gap-1 px-2 py-1 text-sm"
            style="
              background: var(--color-surface-base);
              border: 1px solid var(--color-border-default);
              color: var(--color-text-heading);
            "
          >
            <span class="text-text-secondary">{{ row.label }}:</span>
            <span class="break-all">{{ row.value }}</span>
          </span>
        </div>
      </OCardSection>
    </OCard>

    <OCard class="flex flex-1 flex-col" data-test="traces-db-span-details-query-editor">
      <OCardSection class="flex min-h-[18.75rem] flex-1 flex-col p-0 p-1.5!">
        <CodeQueryEditor
          v-if="queryText"
          :query="queryText"
          :language="editorLanguage"
          :readOnly="true"
          :showAutoComplete="false"
          :showAiIcon="false"
          editorId="db-span-query-editor"
          class="flex-1"
        />
        <div
          v-else
          data-test="traces-db-span-details-no-query"
          class="text-text-secondary p-4 text-sm"
        >
          {{ t("traces.dbSpanDetails.noQueryText") }}
        </div>
      </OCardSection>
    </OCard>

    <OCollapsible
      v-if="hasPerformanceData"
      v-model="performanceOpen"
      :label="t('traces.dbSpanDetails.performance')"
      data-test="traces-db-span-details-performance"
    >
      <div class="px-3 py-2">
        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
          <template v-if="span.db_response_returned_rows">
            <div class="text-text-secondary text-xs">
              {{ t("traces.dbSpanDetails.rowsReturned") }}
            </div>
            <div class="text-xs">{{ span.db_response_returned_rows }}</div>
          </template>
          <template v-if="span.db_operation_batch_size">
            <div class="text-text-secondary text-xs">
              {{ t("traces.dbSpanDetails.batchSize") }}
            </div>
            <div class="text-xs">{{ span.db_operation_batch_size }}</div>
          </template>
          <template v-if="span.db_query_summary">
            <div class="text-text-secondary text-xs">
              {{ t("traces.dbSpanDetails.querySummary") }}
            </div>
            <div class="text-xs">{{ span.db_query_summary }}</div>
          </template>
          <template v-if="span.db_response_status_code">
            <div class="text-text-secondary text-xs">
              {{ t("traces.dbSpanDetails.responseStatus") }}
            </div>
            <div class="text-status-error-text text-xs">
              {{ span.db_response_status_code }}
            </div>
          </template>
        </div>
      </div>
    </OCollapsible>
  </div>
</template>
