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
  <OPageLayout :title="t('secrets.title')" icon="lock" tabs-below bleed>
    <template v-if="!fgaOff && isAdmin" #actions-overflow>
      <OButton
        variant="outline"
        size="sm"
        icon-left="group"
        data-test="secrets-page-create-grants-btn"
        @click="createGrantsOpen = true"
      >
        {{ t("secrets.createGrants.title") }}
      </OButton>
    </template>
    <template #actions>
      <ODropdown v-if="tab === 'backends' && isAdmin" side="bottom" align="end">
        <template #trigger>
          <OButton variant="primary" size="sm" data-test="secrets-page-connect-backend-btn">
            {{ t("secrets.backends.connectBackend") }}
          </OButton>
        </template>
        <ODropdownItem
          v-for="kind in BACKEND_KINDS"
          :key="kind"
          :data-test="`secrets-page-connect-${kind}`"
          @select="connectKind = kind"
          >{{ backendProviderLabel(kind) }}</ODropdownItem
        >
      </ODropdown>
      <OButton
        v-else-if="tab !== 'backends' && canCreate"
        variant="primary"
        size="sm"
        data-test="secrets-page-new-btn"
        @click="openCreate(activeKind)"
      >
        {{ activeKind === "secret" ? t("secrets.newSecret") : t("secrets.newVariable") }}
      </OButton>
    </template>
    <template #header-tabs>
      <OTabs v-model="tab" align="left" data-test="secrets-page-tabs">
        <OTab name="secret" data-test="secrets-page-tab-secret">
          <span>{{ t("secrets.tabSecrets") }}</span>
          <OBadge size="xs" variant="default-soft" :count="secretRows.length" />
        </OTab>
        <OTab name="variable" data-test="secrets-page-tab-variable">
          <span>{{ t("secrets.tabVariables") }}</span>
          <OBadge size="xs" variant="default-soft" :count="variableRows.length" />
        </OTab>
        <OTab name="backends" data-test="secrets-page-tab-backends">
          <span>{{ t("secrets.backends.title") }}</span>
        </OTab>
      </OTabs>
    </template>

    <SecretBackendsTab
      v-if="tab === 'backends'"
      @connect="(kind: BackendKind) => (connectKind = kind)"
      @open="openBackend"
    />
    <div v-else class="flex h-full min-h-0 flex-col">
      <div
        v-if="notReady || fgaOff || prescanHits.length"
        class="px-page-edge flex shrink-0 flex-col gap-2 pt-3"
      >
        <OBanner
          v-if="notReady"
          variant="info"
          icon="sync"
          :content="notReadyContent"
          data-test="secrets-page-not-ready-banner"
        />
        <OBanner
          v-if="fgaOff"
          variant="info"
          icon="info"
          :content="t('secrets.fgaOffBanner')"
          data-test="secrets-page-fga-off-banner"
        />
        <OBanner
          v-if="prescanHits.length"
          variant="warning"
          icon="warning"
          inline-actions
          :content="t('secrets.prescanBanner', { count: prescanHits.length }, prescanHits.length)"
          data-test="secrets-page-prescan-banner"
        >
          <template #actions>
            <OButton
              variant="ghost-primary"
              size="sm"
              data-test="secrets-page-prescan-toggle"
              @click="showPrescan = !showPrescan"
            >
              {{ showPrescan ? t("secrets.hide") : t("secrets.view") }}
            </OButton>
          </template>
        </OBanner>
        <ul
          v-if="showPrescan && prescanHits.length"
          class="border-border-default bg-surface-base text-compact rounded-surface flex flex-col gap-1 border px-4 py-2"
          data-test="secrets-page-prescan-list"
        >
          <li v-for="hit in prescanHits" :key="`${hit.consumer_id}-${hit.field}`">
            {{
              t("secrets.prescanRow", {
                type: consumerTypeLabel(t, hit.consumer_type),
                id: hit.consumer_id,
                field: hit.field,
                token: hit.token,
              })
            }}
          </li>
        </ul>
      </div>

      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <OTable
          :key="activeKind"
          :frame="false"
          :forbidden="forbidden"
          :data="visibleRows"
          :columns="columns"
          :row-actions="rowActions"
          row-key="id"
          :loading="loading"
          pagination="client"
          :page-size="50"
          sorting="client"
          :default-columns="false"
          :persist-columns="true"
          :table-id="`settings-secrets-${activeKind}`"
          :show-global-filter="false"
          data-test="secrets-page-table"
        >
          <template #toolbar>
            <OSearchInput
              v-model="filterQuery"
              class="min-w-0 flex-1 max-md:min-w-40"
              :placeholder="t('secrets.searchPlaceholder')"
              data-test="secrets-page-search"
            />
            <OCheckbox
              v-model="showDeleted"
              :label="t('secrets.showDeleted')"
              data-test="secrets-page-show-deleted"
            />
          </template>
          <template #toolbar-trailing>
            <ORefreshButton
              layout="inline"
              variant="outline"
              :last-run-at="lastRunAt"
              :loading="fetching"
              data-test="secrets-page-refresh"
              @click="refresh"
            />
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              icon="lock"
              :filtered="!!filterQuery"
              :title="emptyTitle"
              :description="emptyDescription"
              :action-label="canCreate ? t('secrets.newSecret') : undefined"
              action-id="new-secret"
              :secondary-action-label="canCreate ? t('secrets.newVariable') : undefined"
              secondary-action-id="new-variable"
              data-test="secrets-page-empty"
              @action="onEmptyAction"
              @secondary-action="openCreate('variable')"
            />
          </template>

          <template #cell-name="{ row }">
            <div class="flex min-w-0 flex-col gap-0.5 py-1">
              <ONameLinkCell
                :to="() => openSecret(row)"
                class="text-start font-mono"
                :data-test="`secrets-page-row-${row.name}-name`"
                >{{ row.name }}</ONameLinkCell
              >
              <div class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs">
                <OTag
                  size="xs"
                  shape="rounded"
                  variant="default-soft"
                  :icon="row.source === 'local' ? '' : 'cloud'"
                  :label="
                    row.source === 'external'
                      ? t('secrets.sourceExternal')
                      : row.source === 'mixed'
                        ? t('secrets.sourceMixed')
                        : t('secrets.sourceLocal')
                  "
                />
                <OTruncatedText>{{ row.description }}</OTruncatedText>
              </div>
            </div>
          </template>

          <template #cell-updated="{ row }">
            <div class="flex min-w-0 flex-col py-1" data-test="secrets-page-row-updated">
              <OTruncatedText class="text-text-body text-sm">{{
                updatedWhen(row.updated_at)
              }}</OTruncatedText>
              <OTruncatedText class="text-text-secondary text-xs">{{
                row.updated_by
              }}</OTruncatedText>
            </div>
          </template>

          <template #cell-value="{ row }">
            <span class="font-mono">{{ row.value ?? "—" }}</span>
          </template>

          <template #cell-allowed="{ row }">
            <div class="flex flex-col items-start gap-1 py-1">
              <OTag
                v-for="(label, i) in allowedForLabels(t, row.allowed_types, row.selected_count)"
                :key="i"
                size="xs"
                shape="rounded"
                variant="default-soft"
                icon=""
                :label="label"
              />
            </div>
          </template>

          <template #cell-envs="{ row }">
            <div class="flex flex-wrap gap-1 py-1">
              <OTag
                v-for="chip in envChips(t, row.envs)"
                :key="chip.id"
                size="xs"
                shape="rounded"
                :variant="chip.variant"
                :icon="chip.icon ?? ''"
                :label="chip.label"
              />
            </div>
          </template>

          <template #cell-pin="{ row }">
            <div class="flex min-w-0 flex-col items-start gap-1 py-1">
              <span
                v-if="row.pin_mode === 'hosts' && row.allowed_hosts.length"
                class="text-compact max-w-full truncate font-mono"
                :title="row.allowed_hosts.join(', ')"
                :data-test="`secrets-page-row-${row.name}-hosts`"
                >{{ row.allowed_hosts.join(", ") }}</span
              >
              <OTag
                v-for="badge in rowBadges(row)"
                :key="badge.id"
                size="xs"
                shape="rounded"
                :variant="badge.variant"
                :icon="badge.icon ?? ''"
                :label="badge.label"
                :title="badge.title"
                :data-test="`secrets-page-row-${row.name}-badge-${badge.id}`"
              />
            </div>
          </template>
        </OTable>
      </div>
    </div>
    <SecretDrawer :secret-id="selectedId" :fga-off="fgaOff" @close="selectedId = null" />
    <SecretBackendDrawer :kind="connectKind" :backend="openedBackend" @close="closeBackend" />
    <SecretCreateGrantsDialog v-model:open="createGrantsOpen" />
    <SecretCreateDrawer
      :kind="createKind"
      :fga-on="!fgaOff"
      @close="createKind = null"
      @created="onCreated"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useOrgRole } from "@/composables/useOrgRole";
import { raw, useI18nTyped } from "@/types/i18n";
import { relativeTimeText } from "@/lib/core/Table/cells/relativeTime";
import { useOrgId } from "@/composables/query/useOrgId";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ONameLinkCell from "@/lib/core/Table/cells/ONameLinkCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { COL, type OTableColumnDef, type OTableRowAction } from "@/lib/core/Table/OTable.types";
import { forbiddenState } from "@/utils/featureGate";
import type { SecretKind, SecretListItem } from "@/services/secrets";
import {
  secretPrescanQuery,
  secretStoreStatusQuery,
  secretsListQuery,
} from "@/services/secrets.queries";
import SecretDrawer from "./SecretDrawer.vue";
import SecretBackendsTab from "./SecretBackendsTab.vue";
import SecretBackendDrawer from "./SecretBackendDrawer.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { BackendKind, SecretBackend } from "@/services/secretBackends";
import SecretCreateGrantsDialog from "./SecretCreateGrantsDialog.vue";
import SecretCreateDrawer from "./SecretCreateDrawer.vue";
import {
  allowedForLabels,
  consumerTypeLabel,
  envChips,
  pinBadges,
  privateLocationBadges,
  stateBadges,
  type SecretBadge,
} from "./secretBadges";

const { t } = useI18nTyped();
const orgId = useOrgId();

const activeKind = ref<SecretKind>("secret");
const tab = ref<SecretKind | "backends">("secret");
watch(tab, (v) => {
  if (v !== "backends") activeKind.value = v;
});

const BACKEND_KINDS: readonly BackendKind[] = ["aws_sm", "gcp_sm", "azure_kv"];
const backendProviderLabel = (kind: BackendKind) =>
  kind === "aws_sm"
    ? t("secrets.backends.providers.aws")
    : kind === "gcp_sm"
      ? t("secrets.backends.providers.gcp")
      : t("secrets.backends.providers.azure");
const connectKind = ref<BackendKind | null>(null);
const openedBackend = ref<SecretBackend | null>(null);
const openBackend = (b: SecretBackend) => {
  openedBackend.value = b;
  connectKind.value = b.kind;
};
const closeBackend = () => {
  connectKind.value = null;
  openedBackend.value = null;
};
const filterQuery = ref("");
const showDeleted = ref(false);
const showPrescan = ref(false);

const secretsQuery = useQuery(() =>
  Object.assign(secretsListQuery(orgId.value, "secret"), { enabled: !!orgId.value }),
);
const variablesQuery = useQuery(() =>
  Object.assign(secretsListQuery(orgId.value, "variable"), { enabled: !!orgId.value }),
);
const statusQuery = useQuery(() =>
  Object.assign(secretStoreStatusQuery(orgId.value), { enabled: !!orgId.value }),
);
const prescanQuery = useQuery(() =>
  Object.assign(secretPrescanQuery(orgId.value), { enabled: !!orgId.value }),
);

const activeQuery = computed(() => (activeKind.value === "secret" ? secretsQuery : variablesQuery));

// The server lists deleted rows only on request, so Show deleted adds that list.
const deletedQuery = useQuery(() =>
  Object.assign(secretsListQuery(orgId.value, activeKind.value, true), {
    enabled: !!orgId.value && showDeleted.value,
  }),
);
const withDeleted = (kind: SecretKind, rows: SecretListItem[] | undefined) => {
  const extra =
    showDeleted.value && kind === activeKind.value ? (deletedQuery.data.value ?? []) : [];
  return [...(rows ?? []), ...extra].filter((r) => r.state !== "purged");
};
const secretRows = computed(() => withDeleted("secret", secretsQuery.data.value));
const variableRows = computed(() => withDeleted("variable", variablesQuery.data.value));

const visibleRows = computed(() => {
  const rows = activeKind.value === "secret" ? secretRows.value : variableRows.value;
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
});

const loading = computed(() => activeQuery.value.isPending.value);
const fetching = computed(() => activeQuery.value.isFetching.value);
const lastRunAt = computed(() => activeQuery.value.dataUpdatedAt.value);
const forbidden = computed(() => {
  const e: any = activeQuery.value.error.value;
  return forbiddenState(e) || e?.status === 403 || e?.response?.status === 403;
});
const fgaOff = computed(() => statusQuery.data.value?.fga === "off");
const notReady = computed(() => statusQuery.data.value?.store_ready === false);
const notReadyContent = computed(() => {
  const status = statusQuery.data.value;
  if (status?.not_ready_reason === "super_cluster" || status?.mode === "super_cluster") {
    return t("secrets.superClusterBanner");
  }
  if (status?.not_ready_reason === "refs_disabled") {
    return t("secrets.refsOffBanner", { flag: raw("O2_SECRET_STORE_REFS_ENABLED") });
  }
  if (status?.not_ready_reason === "fga_mode_mismatch") {
    return t("secrets.fgaModeMismatchBanner", { permissionMode: raw("OpenFGA") });
  }
  return t("secrets.notReadyBanner");
});
const createGrantsOpen = ref(false);
const { isAdmin } = useOrgRole();
const prescanHits = computed(() => prescanQuery.data.value ?? []);
// Hidden until the status answers, so a caller without the grant never sees a create button flash.
const canCreate = computed(
  () => !!statusQuery.data.value && statusQuery.data.value.can_create !== false,
);
// An org admin sees every row; anyone else may have rows the list leaves out.
const emptyTitle = computed(() => {
  if (activeKind.value === "secret")
    return isAdmin.value ? t("secrets.emptyTitle") : t("secrets.emptyHiddenTitle");
  return isAdmin.value ? t("secrets.emptyVariablesTitle") : t("secrets.emptyHiddenVariablesTitle");
});
const emptyDescription = computed(() => {
  if (!canCreate.value) return t("secrets.emptyDescNoCreate");
  return fgaOff.value ? t("secrets.emptyDescFgaOff") : t("secrets.emptyDesc");
});

const rowBadges = (row: SecretListItem): SecretBadge[] => [
  ...stateBadges(t, row),
  ...pinBadges(t, row),
  ...privateLocationBadges(t, row),
];

const secretColumns = (): OTableColumnDef[] => [
  {
    id: "name",
    header: t("secrets.colName"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", flex: true },
  },
  { id: "allowed", header: t("secrets.colAllowedFor"), size: COL.type, hideable: true },
  { id: "envs", header: t("secrets.colValues"), size: 150, hideable: true },
  { id: "pin", header: t("secrets.colHostPin"), size: 200, hideable: true },
  {
    id: "usage_count",
    header: t("secrets.colInUse"),
    accessorKey: "usage_count",
    sortable: true,
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "updated",
    header: t("secrets.colUpdated"),
    accessorKey: "updated_at",
    sortable: true,
    size: COL.updatedAt,
    hideable: true,
    meta: { align: "left" },
  },
  { id: "actions", header: t("secrets.colActions"), isAction: true, pinned: "right" },
];

const variableColumns = (): OTableColumnDef[] => [
  {
    id: "name",
    header: t("secrets.colName"),
    accessorKey: "name",
    sortable: true,
    size: COL.name,
    meta: { align: "left" },
  },
  {
    id: "value",
    header: t("secrets.colValue"),
    accessorKey: "value",
    size: 200,
    meta: { align: "left", flex: true },
  },
  { id: "allowed", header: t("secrets.colAllowedFor"), size: COL.type, hideable: true },
  { id: "envs", header: t("secrets.colValues"), size: 150, hideable: true },
  {
    id: "usage_count",
    header: t("secrets.colInUse"),
    accessorKey: "usage_count",
    sortable: true,
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "updated",
    header: t("secrets.colUpdated"),
    accessorKey: "updated_at",
    sortable: true,
    size: COL.updatedAt,
    hideable: true,
    meta: { align: "left" },
  },
  { id: "actions", header: t("secrets.colActions"), isAction: true, pinned: "right" },
];

const columns = computed(() =>
  activeKind.value === "secret" ? secretColumns() : variableColumns(),
);

const rowActions: OTableRowAction[] = [
  {
    id: "open",
    label: t("common.edit"),
    icon: "edit",
    onSelect: (row) => openSecret(row as SecretListItem),
    dataTest: (row) => `secrets-page-row-${row.name}-open`,
  },
];

const selectedId = ref<string | null>(null);
const createKind = ref<SecretKind | null>(null);
const openSecret = (row: SecretListItem) => (selectedId.value = row.id);
const openCreate = (kind: SecretKind) => (createKind.value = kind);

const updatedWhen = (us: number) =>
  us > 0 ? raw(relativeTimeText(us / 1000, Date.now())) : raw("—");

const onCreated = (id: string) => {
  createKind.value = null;
  selectedId.value = id;
};

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") filterQuery.value = "";
  else openCreate("secret");
};

const refresh = async () => {
  await Promise.all([
    secretsQuery.refetch(),
    variablesQuery.refetch(),
    ...(showDeleted.value ? [deletedQuery.refetch()] : []),
    statusQuery.refetch(),
    prescanQuery.refetch(),
  ]);
};

watch(activeKind, () => (filterQuery.value = ""));

defineExpose({ activeKind, tab, refresh, selectedId, createKind, connectKind });
</script>
