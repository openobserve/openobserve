<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { computed } from "vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";

const props = defineProps<{
  span: Record<string, any>;
}>();

const dbSystem = computed(() => props.span.db_system ?? "");

const queryText = computed(
  () => props.span.db_query_text ?? props.span.db_statement ?? "",
);

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

const tableDisplay = computed(
  () => props.span.db_collection_name ?? props.span.db_sql_table ?? "",
);

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
      label: "DB System",
      value: String(dbSystem.value || ""),
      key: "db-system",
    },
    {
      label: "Operation",
      value: String(props.span.db_operation_name ?? ""),
      key: "operation",
    },
    {
      label: "Database",
      value: String(props.span.db_namespace ?? props.span.db_name),
      key: "namespace",
    },
    {
      label: "Table / Collection",
      value: String(tableDisplay.value || ""),
      key: "table",
    },
    { label: "Host", value: hostDisplay.value, key: "host" },
    { label: "User", value: String(props.span.db_user ?? ""), key: "user" },
    {
      label: "Stored Procedure",
      value: String(props.span.db_stored_procedure_name ?? ""),
      key: "stored-proc",
    },
  ].filter((row) => !!row.value),
);
</script>

<template>
  <div class="tw:flex tw:flex-col tw:h-full tw:overflow-auto tw:gap-3">
    <q-card flat data-test="traces-db-span-details-metadata-grid">
      <q-card-section class="tw:py-0! tw:px-0!">
        <div class="tw:flex tw:flex-wrap tw:gap-2">
          <span
            v-for="row in metadataRows"
            :key="row.key"
            :data-test="`traces-db-span-details-tag-${row.key}`"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-1 tw:text-[0.85rem]"
            style="
              background: var(--o2-card-background);
              border: 1px solid var(--o2-border);
              color: var(--o2-text-primary);
            "
          >
            <span style="color: var(--o2-text-secondary)"
              >{{ row.label }}:</span
            >
            <span class="tw:break-all">{{ row.value }}</span>
          </span>
        </div>
      </q-card-section>
    </q-card>

    <q-card
      flat
      bordered
      class="tw:flex-1 tw:flex tw:flex-col"
      data-test="traces-db-span-details-query-editor"
    >
      <q-card-section
        class="tw:flex-1 tw:flex tw:flex-col tw:p-0 tw:min-h-[18.75rem] tw:p-[0.375rem]!"
      >
        <CodeQueryEditor
          v-if="queryText"
          :query="queryText"
          :language="editorLanguage"
          :readOnly="true"
          :showAutoComplete="false"
          :showAiIcon="false"
          editorId="db-span-query-editor"
          class="tw:flex-1"
        />
        <div
          v-else
          data-test="traces-db-span-details-no-query"
          class="tw:p-4 tw:text-sm"
          style="color: var(--o2-text-secondary)"
        >
          No query text recorded for this span.
        </div>
      </q-card-section>
    </q-card>

    <q-expansion-item
      v-if="hasPerformanceData"
      label="Performance"
      dense
      data-test="traces-db-span-details-performance"
    >
      <q-card flat>
        <q-card-section class="tw:py-2 tw:px-3">
          <div class="tw:grid tw:grid-cols-2 tw:gap-x-4 tw:gap-y-1">
            <template v-if="span.db_response_returned_rows">
              <div class="tw:text-xs" style="color: var(--o2-text-secondary)">
                Rows Returned
              </div>
              <div class="tw:text-xs">{{ span.db_response_returned_rows }}</div>
            </template>
            <template v-if="span.db_operation_batch_size">
              <div class="tw:text-xs" style="color: var(--o2-text-secondary)">
                Batch Size
              </div>
              <div class="tw:text-xs">{{ span.db_operation_batch_size }}</div>
            </template>
            <template v-if="span.db_query_summary">
              <div class="tw:text-xs" style="color: var(--o2-text-secondary)">
                Query Summary
              </div>
              <div class="tw:text-xs">{{ span.db_query_summary }}</div>
            </template>
            <template v-if="span.db_response_status_code">
              <div class="tw:text-xs" style="color: var(--o2-text-secondary)">
                Response Status
              </div>
              <div
                class="tw:text-xs"
                style="color: var(--o2-status-error-text)"
              >
                {{ span.db_response_status_code }}
              </div>
            </template>
          </div>
        </q-card-section>
      </q-card>
    </q-expansion-item>
  </div>
</template>
