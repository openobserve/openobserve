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

<!-- Backends tab (X1, X5): external stores this org reads secrets from; values never copied. -->
<template>
  <div class="bg-card-glass-bg h-full min-h-0 overflow-hidden" data-test="secret-backends-tab">
    <OTable
      :frame="false"
      :forbidden="forbidden"
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="backends.isPending.value"
      pagination="client"
      :page-size="50"
      sorting="client"
      :show-global-filter="false"
      data-test="secret-backends-table"
    >
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="backends.dataUpdatedAt.value"
          :loading="backends.isFetching.value"
          data-test="secret-backends-refresh"
          @click="backends.refetch()"
        />
      </template>

      <template #empty>
        <OEmptyState
          size="hero"
          icon="cloud"
          :title="t('secrets.backends.emptyTitle')"
          :description="t('secrets.backends.emptyDesc')"
          data-test="secret-backends-empty"
        >
          <template #actions>
            <EmptyStateActionCard
              v-for="p in PROVIDERS"
              :key="p.kind"
              icon="cloud"
              :label="p.label()"
              :sublabel="p.hint()"
              :data-test="`secret-backends-connect-${p.kind}`"
              @click="emit('connect', p.kind)"
            />
            <EmptyStateActionCard
              icon="cloud"
              :label="raw('HashiCorp Vault')"
              :sublabel="t('secrets.backends.laterRelease')"
              unavailable
              data-test="secret-backends-connect-vault"
            />
          </template>
        </OEmptyState>
      </template>

      <template #cell-name="{ row }">
        <ONameLinkCell
          :to="() => emit('open', row)"
          :data-test="`secret-backends-row-${row.name}-name`"
          >{{ row.name }}</ONameLinkCell
        >
      </template>

      <template #cell-kind="{ row }">
        <span class="text-text-body text-sm">{{ providerLabel(row.kind) }}</span>
      </template>

      <template #cell-auth="{ row }">
        <OTag
          size="xs"
          shape="rounded"
          :variant="row.auth_mode === 'static' ? 'warning-soft' : 'primary-soft'"
          icon=""
          :label="
            row.auth_mode === 'static'
              ? t('secrets.backends.staticBadge')
              : t('secrets.backends.signIn.identity')
          "
          :data-test="`secret-backends-row-${row.name}-auth`"
        />
      </template>

      <template #cell-status="{ row }">
        <div class="flex min-w-0 items-center gap-2 py-1">
          <OTag
            size="xs"
            shape="rounded"
            :variant="STATUS[backendStatus(row)].variant"
            icon=""
            :label="STATUS[backendStatus(row)].label()"
            :data-test="`secret-backends-row-${row.name}-status`"
          />
        </div>
      </template>

      <template #cell-secrets="{ row }">
        <span :class="row.secrets_count ? 'text-text-body' : 'text-text-muted'">{{
          row.secrets_count ?? 0
        }}</span>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import ONameLinkCell from "@/lib/core/Table/cells/ONameLinkCell.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { BackendKind, SecretBackend } from "@/services/secretBackends";
import { secretBackendsQuery } from "@/services/secretBackends.queries";
import { backendStatus, type BackendStatus } from "./SecretBackend.schema";

const emit = defineEmits<{ connect: [kind: BackendKind]; open: [backend: SecretBackend] }>();
const { t } = useI18nTyped();
const orgId = useOrgId();

const backends = useQuery(() =>
  Object.assign(secretBackendsQuery(orgId.value), { enabled: !!orgId.value }),
);
const rows = computed(() => backends.data.value ?? []);
const forbidden = computed(
  () =>
    (backends.error.value as { response?: { status?: number } } | null)?.response?.status === 403,
);

const PROVIDERS: { kind: BackendKind; label: () => I18nText; hint: () => I18nText }[] = [
  {
    kind: "aws_sm",
    label: () => t("secrets.backends.providers.aws"),
    hint: () => t("secrets.backends.providerHint"),
  },
  {
    kind: "gcp_sm",
    label: () => t("secrets.backends.providers.gcp"),
    hint: () => t("secrets.backends.providerHint"),
  },
  {
    kind: "azure_kv",
    label: () => t("secrets.backends.providers.azure"),
    hint: () => t("secrets.backends.providerHint"),
  },
];
const providerLabel = (kind: BackendKind) =>
  PROVIDERS.find((p) => p.kind === kind)?.label() ?? raw(kind);

const STATUS: Record<BackendStatus, { label: () => I18nText; variant: BadgeVariant }> = {
  ready: { label: () => t("secrets.backends.status.ready"), variant: "success-soft" },
  pending: { label: () => t("secrets.backends.status.pending"), variant: "warning-soft" },
};

const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: t("secrets.colName"),
    accessorKey: "name",
    sortable: true,
    size: 220,
    meta: { align: "left", flex: true },
  },
  { id: "kind", header: t("secrets.backends.colProvider"), size: 200 },
  { id: "auth", header: t("secrets.backends.colSignIn"), size: 180 },
  { id: "status", header: t("secrets.backends.colStatus"), size: 240 },
  {
    id: "secrets",
    header: t("secrets.backends.colSecrets"),
    accessorKey: "secrets_count",
    size: COL.count,
    meta: { align: "right" },
  },
];
</script>
