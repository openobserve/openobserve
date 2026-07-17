<!-- Copyright 2026 OpenObserve Inc. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

const performanceOpen = ref(false);

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
      value: String(props.span.db_namespace ?? props.span.db_name ?? ""),
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
  <div class="flex flex-col h-full overflow-auto gap-3">
    <OCard data-test="traces-db-span-details-metadata-grid">
      <OCardSection class="py-0! px-0!">
        <div class="flex flex-wrap gap-2">
          <span
            v-for="row in metadataRows"
            :key="row.key"
            :data-test="`traces-db-span-details-tag-${row.key}`"
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm"
            style="
              background: var(--color-surface-base);
              border: 1px solid var(--color-border-default);
              color: var(--color-text-heading);
            "
          >
            <span style="color: var(--color-text-secondary)"
              >{{ row.label }}:</span
            >
            <span class="break-all">{{ row.value }}</span>
          </span>
        </div>
      </OCardSection>
    </OCard>

    <OCard
      class="flex-1 flex flex-col"
      data-test="traces-db-span-details-query-editor"
    >
      <OCardSection
        class="flex-1 flex flex-col p-0 min-h-[18.75rem] p-[0.375rem]!"
      >
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
          class="p-4 text-sm"
          style="color: var(--color-text-secondary)"
        >
          No query text recorded for this span.
        </div>
      </OCardSection>
    </OCard>

    <OCollapsible
      v-if="hasPerformanceData"
      v-model="performanceOpen"
      label="Performance"
      data-test="traces-db-span-details-performance"
    >
      <div class="py-2 px-3">
          <div class="grid grid-cols-2 gap-x-4 gap-y-1">
            <template v-if="span.db_response_returned_rows">
              <div class="text-xs" style="color: var(--color-text-secondary)">
                Rows Returned
              </div>
              <div class="text-xs">{{ span.db_response_returned_rows }}</div>
            </template>
            <template v-if="span.db_operation_batch_size">
              <div class="text-xs" style="color: var(--color-text-secondary)">
                Batch Size
              </div>
              <div class="text-xs">{{ span.db_operation_batch_size }}</div>
            </template>
            <template v-if="span.db_query_summary">
              <div class="text-xs" style="color: var(--color-text-secondary)">
                Query Summary
              </div>
              <div class="text-xs">{{ span.db_query_summary }}</div>
            </template>
            <template v-if="span.db_response_status_code">
              <div class="text-xs" style="color: var(--color-text-secondary)">
                Response Status
              </div>
              <div
                class="text-xs"
                style="color: var(--color-status-error-text)"
              >
                {{ span.db_response_status_code }}
              </div>
            </template>
          </div>
      </div>
    </OCollapsible>
  </div>
</template>
