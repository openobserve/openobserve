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
  <div
    class="bg-card-glass-bg h-full min-h-0 overflow-hidden"
    data-test="settings-org-domain-requests"
  >
    <OTable
      :frame="false"
      data-test="settings-org-domain-requests-table"
      :data="visibleRows"
      :columns="columns"
      row-key="id"
      pagination="client"
      sorting="client"
      :show-global-filter="false"
      :loading="requests.isPending.value"
      :error="loadError"
      :column-visibility="{ answered_by: false }"
    >
      <template #toolbar>
        <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
          <OToggleGroup
            mobile-dropdown
            :model-value="statusFilter"
            data-test="settings-org-domain-requests-filter"
            @update:model-value="statusFilter = $event as StatusFilter"
          >
            <OToggleGroupItem
              value="pending"
              size="sm"
              data-test="settings-org-domain-requests-filter-pending"
            >
              {{ t("settings.orgDomainMapping.filterPending") }}
            </OToggleGroupItem>
            <OToggleGroupItem
              value="all"
              size="sm"
              data-test="settings-org-domain-requests-filter-all"
            >
              {{ t("settings.orgDomainMapping.filterAll") }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OSearchInput
            v-model="filterQuery"
            class="min-w-0 flex-1 max-md:min-w-40"
            :placeholder="t('settings.orgDomainMapping.searchRequests')"
            data-test="settings-org-domain-requests-search"
          />
        </div>
      </template>
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="requests.dataUpdatedAt.value || null"
          :loading="requests.isFetching.value"
          data-test="settings-org-domain-requests-refresh-btn"
          @click="refresh"
        />
      </template>
      <template #empty>
        <OEmptyState
          v-if="!requests.isPending.value"
          size="hero"
          preset="no-domain-requests"
          :filtered="filterQuery !== ''"
          @action="filterQuery = ''"
        />
      </template>
      <template #error="{ message }">
        <OEmptyState preset="load-error" :description="raw(message)" @action="requests.refetch()" />
      </template>

      <template #cell-requested_by="{ row }">
        <OUserCell :value="row.requested_by" />
      </template>
      <template #cell-created_at="{ row }">
        <OTimeCell :value="row.created_at" unit="us" />
      </template>
      <template #cell-status="{ row }">
        <OBadge :variant="STATUS_BADGES[row.status].variant" size="sm">
          {{ t(STATUS_BADGES[row.status].labelKey) }}
        </OBadge>
      </template>
      <template #cell-answered_by="{ row }">
        <OUserCell :value="row.answered_by ?? ''" />
      </template>
      <template #cell-reason="{ row }">
        <span v-if="row.reason">{{ row.reason }}</span>
        <span v-else class="text-text-muted">{{ dash }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div v-if="row.status === 0" class="flex items-center justify-center gap-1">
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="check-circle"
            class="max-md:hidden"
            :title="t('settings.orgDomainMapping.approve')"
            :data-test="`settings-org-domain-requests-approve-${row.id}`"
            @click.stop="openDecision(row, true)"
          />
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="cancel"
            class="max-md:hidden"
            :title="t('settings.orgDomainMapping.reject')"
            :data-test="`settings-org-domain-requests-reject-${row.id}`"
            @click.stop="openDecision(row, false)"
          />
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-vert"
                variant="ghost"
                size="icon-xs-sq"
                class="md:hidden"
                :data-test="`settings-org-domain-requests-more-${row.id}`"
                @click.stop
              />
            </template>
            <ODropdownItem
              icon-left="check-circle"
              class="md:hidden"
              :data-test="`settings-org-domain-requests-approve-${row.id}-menu`"
              @select="openDecision(row, true)"
            >
              <span>{{ t("settings.orgDomainMapping.approve") }}</span>
            </ODropdownItem>
            <ODropdownItem
              icon-left="cancel"
              variant="destructive"
              class="md:hidden"
              :data-test="`settings-org-domain-requests-reject-${row.id}-menu`"
              @select="openDecision(row, false)"
            >
              <span>{{ t("settings.orgDomainMapping.reject") }}</span>
            </ODropdownItem>
          </ODropdown>
        </div>
      </template>
    </OTable>

    <OrgDomainRequestDecisionDialog
      v-model:open="decisionOpen"
      :request="decisionRequest"
      :approve="decisionApprove"
      :org-name="decisionRequest ? orgLabel(decisionRequest.org_id) : ''"
      :submit="submitDecision"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { OrgDomainRequest } from "@/services/organizations";
import {
  adminOrgsQuery,
  decideOrgDomainRequestMutation,
  orgDomainRequestsQuery,
} from "@/services/organizations.queries";
import OrgDomainRequestDecisionDialog from "./OrgDomainRequestDecisionDialog.vue";

type StatusFilter = "pending" | "all";

const props = defineProps<{ orgId: string }>();

const { t } = useI18nTyped();

const dash = raw("—");

const STATUS_BADGES: Record<number, { variant: BadgeVariant; labelKey: I18nKey }> = {
  0: { variant: "warning-outline", labelKey: "settings.orgDomainMapping.state.requested" },
  1: { variant: "success-outline", labelKey: "settings.orgDomainMapping.state.approved" },
  2: { variant: "error-outline", labelKey: "settings.orgDomainMapping.state.rejected" },
};

const requests = useQuery(() => orgDomainRequestsQuery(props.orgId));
const orgs = useQuery(() => adminOrgsQuery(props.orgId));
const decide = useMutation(() => decideOrgDomainRequestMutation(props.orgId));

const loadError = computed(() => {
  const err: any = requests.error.value;
  if (!err) return null;
  return err?.response?.data?.message || err?.message || t("settings.orgDomainMapping.loadFailed");
});

const orgNames = computed(
  () => new Map((orgs.data.value ?? []).map((org) => [org.identifier, org.name])),
);
const orgLabel = (orgId: string) => raw(orgNames.value.get(orgId) || orgId);

function refresh() {
  requests.refetch();
  orgs.refetch();
}

const statusFilter = ref<StatusFilter>("pending");
const filterQuery = ref("");

const visibleRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  return (requests.data.value ?? []).filter((req) => {
    if (statusFilter.value === "pending" && req.status !== 0) return false;
    if (!query) return true;
    return [req.domain, req.org_id, orgLabel(req.org_id), req.requested_by].some((v) =>
      v.toLowerCase().includes(query),
    );
  });
});

const columns: OTableColumnDef<OrgDomainRequest>[] = [
  {
    id: "domain",
    header: t("settings.orgDomainMapping.domain"),
    accessorKey: "domain",
    sortable: true,
    size: 260,
    meta: { isName: true, flex: true },
  },
  {
    id: "org_id",
    header: t("settings.orgDomainMapping.organization"),
    accessorFn: (row) => orgLabel(row.org_id),
    sortable: true,
    size: 220,
  },
  {
    id: "requested_by",
    header: t("settings.orgDomainMapping.requestedBy"),
    accessorKey: "requested_by",
    sortable: true,
    size: COL.email,
  },
  {
    id: "created_at",
    header: t("settings.orgDomainMapping.requestedAt"),
    accessorKey: "created_at",
    sortable: true,
    size: COL.createdAt,
  },
  {
    id: "status",
    header: t("settings.orgDomainMapping.status"),
    accessorKey: "status",
    sortable: true,
    size: 140,
  },
  {
    id: "answered_by",
    header: t("settings.orgDomainMapping.answeredBy"),
    accessorKey: "answered_by",
    hideable: true,
    size: COL.email,
  },
  {
    id: "reason",
    header: t("settings.orgDomainMapping.reason"),
    accessorKey: "reason",
    hideable: true,
    size: 260,
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    meta: { align: "center", actionCount: 2 },
  },
];

const decisionOpen = ref(false);
const decisionRequest = ref<OrgDomainRequest | null>(null);
const decisionApprove = ref(true);

function openDecision(request: OrgDomainRequest, approve: boolean) {
  decisionRequest.value = request;
  decisionApprove.value = approve;
  decisionOpen.value = true;
}

async function submitDecision(reason: string): Promise<boolean> {
  const request = decisionRequest.value;
  if (!request) return false;
  const approve = decisionApprove.value;
  try {
    await decide.mutateAsync({ id: request.id, approve, reason });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message || err?.message) ||
        t("settings.orgDomainMapping.decisionFailed"),
    });
    return false;
  }
  toast({
    variant: "success",
    message: approve
      ? t("settings.orgDomainMapping.requestApproved", { domain: request.domain })
      : t("settings.orgDomainMapping.requestRejected", { domain: request.domain }),
  });
  return true;
}
</script>
