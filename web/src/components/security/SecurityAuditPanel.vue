<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import SecurityPanel from "@/components/security/SecurityPanel.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { securityAuditQuery } from "@/services/security.queries";
import type { SecurityAuditEvent } from "@/services/security";
import { auditAction } from "@/utils/security/audit";
import { forbiddenState } from "@/utils/featureGate";

const { t } = useI18nTyped();
const org = useOrgId();
const query = useQuery(() => ({ ...securityAuditQuery(org.value), enabled: !!org.value }));

const page = computed(() => query.data.value);
const events = computed(() => page.value?.events ?? []);
const rows = computed(() =>
  events.value.map((e: SecurityAuditEvent, i: number) => ({
    id: `${e.timestamp}:${i}`,
    timestamp: e.timestamp,
    user: e.user_email,
    category: e.category,
    action: auditAction(e.method, e.path, e.query),
    path: e.path,
    detail: e.body,
  })),
);
type Row = (typeof rows.value)[number];

const columns = computed<OTableColumnDef<Row>[]>(() => [
  { id: "timestamp", header: t("siem.audit.when"), accessorKey: "timestamp", size: 120 },
  { id: "user", header: t("siem.audit.who"), accessorKey: "user", size: 220 },
  { id: "category", header: t("siem.audit.area"), accessorKey: "category", size: 120 },
  { id: "action", header: t("siem.audit.action"), accessorKey: "action", size: 110 },
  { id: "path", header: t("siem.audit.target"), accessorKey: "path", meta: { isName: true } },
]);

const forbidden = computed(() => (query.error.value ? forbiddenState(query.error.value) : false));
</script>

<template>
  <SecurityPanel
    :title="t('siem.audit.title')"
    :hint="t('siem.audit.hint')"
    :count="events.length"
    icon="history"
    tone="neutral"
    class="h-96"
    data-test="security-audit-panel"
  >
    <template #actions>
      <ORefreshButton
        :loading="query.isFetching.value"
        data-test="security-audit-refresh"
        @click="query.refetch()"
      />
    </template>
    <OEmptyState
      v-if="page && !page.audit_enabled"
      size="inline"
      icon="history"
      :title="t('siem.audit.disabled')"
      :description="t('siem.audit.disabledHint')"
      data-test="security-audit-disabled"
    />
    <OTable
      v-else
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="query.isPending.value && !!org"
      :forbidden="forbidden"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      class="min-h-0 flex-1"
      data-test="security-audit-table"
    >
      <template #cell-timestamp="{ row }">
        <OTimeCell :value="row.timestamp" unit="us" />
      </template>
      <template #cell-category="{ row }">
        <OTag variant="default-soft" size="xs">{{ t(`siem.audit.category.${row.category}`) }}</OTag>
      </template>
      <template #cell-action="{ row }">
        {{ t(`siem.audit.verb.${row.action}`) }}
      </template>
      <template #cell-path="{ row }">
        <div class="flex min-w-0 flex-col">
          <OTruncatedText class="text-text-heading font-mono text-xs">{{
            raw(row.path)
          }}</OTruncatedText>
          <OTruncatedText v-if="row.detail" class="text-text-secondary text-2xs font-mono">{{
            raw(row.detail)
          }}</OTruncatedText>
        </div>
      </template>
      <template #empty>
        <OEmptyState
          size="inline"
          icon="task-alt"
          :title="t('siem.audit.empty')"
          :description="t('siem.audit.emptyHint')"
        />
      </template>
    </OTable>
  </SecurityPanel>
</template>
