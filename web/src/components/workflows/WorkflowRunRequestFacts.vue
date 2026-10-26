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
  <section
    data-test="workflow-run-request"
    class="border-border-default rounded-default flex shrink-0 flex-col gap-3 border p-3"
  >
    <div class="text-text-body text-sm font-semibold">{{ t("workflow.http.request") }}</div>
    <ODescriptionList :columns="2" dense>
      <ODescriptionItem :label="t('workflow.http.requestReceived')" stacked>
        <OTimeCell
          :value="receivedAt"
          unit="us"
          mode="absolute"
          :format="RUN_TIME_LONG"
          :timezone="store.state.timezone"
          :empty-label="dash"
        />
      </ODescriptionItem>
      <ODescriptionItem :label="t('workflow.http.requestToken')" stacked>
        <span v-if="facts.credential_prefix" class="font-mono">{{ facts.credential_prefix }}</span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('workflow.http.requestCallerIp')" stacked>
        <span v-if="facts.caller_ip" class="font-mono">{{ facts.caller_ip }}</span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('workflow.http.requestIdempotencyKey')" stacked>
        <span v-if="facts.idempotency_key" class="font-mono">{{ facts.idempotency_key }}</span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('workflow.http.requestContentType')" stacked>
        <span v-if="facts.content_type" class="font-mono">{{ facts.content_type }}</span>
      </ODescriptionItem>
      <ODescriptionItem :label="t('workflow.http.requestBodySize')" stacked>
        {{ bodySize }}
      </ODescriptionItem>
    </ODescriptionList>
    <OCollapsible
      :label="t('workflow.http.headers')"
      :caption="t('workflow.http.headersKept', { count: headerRows.length }, headerRows.length)"
      default-open
      data-test="workflow-run-headers"
    >
      <OTable
        :data="headerRows"
        :columns="headerColumns"
        row-key="name"
        pagination="none"
        :show-global-filter="false"
        :show-header="false"
        :frame="false"
        dense
      />
    </OCollapsible>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { HttpRequestFacts } from "@/services/workflows";
import { RUN_TIME_LONG, bodySizeParts } from "@/plugins/workflows/runStatus";

const props = defineProps<{
  facts: HttpRequestFacts;
  receivedAt: number;
  headers: Record<string, string>;
}>();

const { t } = useI18nTyped();
const store = useStore();
const dash = raw("—");

const bodySize = computed(() => {
  const { key, size } = bodySizeParts(props.facts.body_bytes);
  return t(key, { size });
});

const headerRows = computed(() =>
  Object.entries(props.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
);

const headerColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("workflow.http.headerName"),
    accessorKey: "name",
    size: 180,
    meta: { align: "left", cellClass: "font-mono" },
  },
  {
    id: "value",
    header: t("workflow.http.headerValue"),
    accessorKey: "value",
    meta: { align: "left", flex: true, cellClass: "font-mono" },
  },
]);
</script>
