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
    data-test="settings-org-linked-domains"
  >
    <OTable
      v-model:expanded-ids="expandedIds"
      :frame="false"
      data-test="settings-org-linked-domains-table"
      :data="visibleRows"
      :columns="columns"
      row-key="id"
      pagination="client"
      sorting="client"
      expansion="single"
      :get-row-expansion-enabled="isExpandable"
      :expand-on-row-click="isExpandable"
      :show-global-filter="false"
      :loading="loading"
      :error="loadError"
    >
      <template #toolbar>
        <OSearchInput
          v-model="filterQuery"
          class="min-w-0 flex-1 max-md:min-w-40"
          :placeholder="t('settings.orgDomainMapping.searchDomains')"
          data-test="settings-org-linked-domains-search"
        />
      </template>
      <template #toolbar-trailing>
        <ORefreshButton
          layout="inline"
          variant="outline"
          :last-run-at="domains.dataUpdatedAt.value || null"
          :loading="domains.isFetching.value || requests.isFetching.value"
          data-test="settings-org-linked-domains-refresh-btn"
          @click="refresh"
        />
      </template>
      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          preset="no-linked-domains"
          :filtered="filterQuery !== ''"
          @action="onEmptyAction"
        />
      </template>
      <template #error="{ message }">
        <OEmptyState preset="load-error" :description="raw(message)" @action="refresh" />
      </template>

      <template #cell-state="{ row }">
        <OBadge
          :variant="STATE_BADGES[row.state].variant"
          size="sm"
          :data-test="`settings-org-linked-domains-state-${row.domain}`"
        >
          {{ t(STATE_BADGES[row.state].labelKey) }}
        </OBadge>
      </template>
      <template #cell-method="{ row }">
        {{ t(METHOD_KEYS[row.method]) }}
      </template>
      <template #cell-updated="{ row }">
        <OTimeCell :value="row.updated" unit="us" />
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center justify-center gap-1">
          <OButton
            v-if="canVerify(row)"
            variant="ghost"
            size="icon-sm"
            icon-left="refresh"
            class="max-md:hidden"
            :loading="verifyingDomain === row.domain"
            :title="t('settings.orgDomainMapping.verifyNow')"
            :data-test="`settings-org-linked-domains-verify-${row.domain}`"
            @click.stop="verify(row.domain)"
          />
          <OButton
            v-if="row.link"
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            class="max-md:hidden"
            :title="t('settings.orgDomainMapping.removeDomain')"
            :data-test="`settings-org-linked-domains-remove-${row.domain}`"
            @click.stop="remove(row)"
          />
          <ODropdown v-if="canVerify(row) || row.link" side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-vert"
                variant="ghost"
                size="icon-xs-sq"
                class="md:hidden"
                :data-test="`settings-org-linked-domains-more-${row.domain}`"
                @click.stop
              />
            </template>
            <ODropdownItem
              v-if="canVerify(row)"
              icon-left="refresh"
              class="md:hidden"
              :data-test="`settings-org-linked-domains-verify-${row.domain}-menu`"
              @select="verify(row.domain)"
            >
              <span>{{ t("settings.orgDomainMapping.verifyNow") }}</span>
            </ODropdownItem>
            <ODropdownItem
              v-if="row.link"
              icon-left="delete"
              variant="destructive"
              class="md:hidden"
              :data-test="`settings-org-linked-domains-remove-${row.domain}-menu`"
              @select="remove(row)"
            >
              <span>{{ t("settings.orgDomainMapping.removeDomain") }}</span>
            </ODropdownItem>
          </ODropdown>
        </div>
      </template>

      <template #expansion="{ row }">
        <div class="px-page-edge py-3">
          <OrgDomainVerification v-if="row.link && row.method === 'dns'" :domain="row.link" />
          <div
            v-else-if="row.request"
            class="flex flex-col gap-1 text-sm"
            :data-test="`settings-org-linked-domains-reason-${row.domain}`"
          >
            <span class="text-text-label text-xs font-medium">
              {{ t("settings.orgDomainMapping.rejectionReason") }}
            </span>
            <span class="text-text-body">{{ row.request.reason || dash }}</span>
          </div>
        </div>
      </template>
    </OTable>

    <OrgLinkDomainDialog
      v-model:open="linkDialogOpen"
      :initial-method="linkDialogMethod"
      :submit="submitLink"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import type {
  OrgDomainMapping,
  OrgDomainOwnership,
  OrgDomainRequest,
} from "@/services/organizations";
import {
  linkOrgDomainMutation,
  orgDomainRequestsQuery,
  orgDomainsQuery,
  raiseOrgDomainRequestMutation,
  unlinkOrgDomainMutation,
  updateOrgSettingsMutation,
  verifyOrgDomainMutation,
} from "@/services/organizations.queries";
import OrgDomainVerification from "./OrgDomainVerification.vue";
import OrgLinkDomainDialog from "./OrgLinkDomainDialog.vue";
import type { LinkMethod } from "./OrgDomainMapping.schema";

type RowState = "verified" | "pending" | "failed" | "requested" | "rejected";
type RowMethod = "dns" | "approved" | "request";

interface LinkedDomainRow {
  id: string;
  domain: string;
  state: RowState;
  method: RowMethod;
  updated: number | null;
  link: OrgDomainOwnership | null;
  request: OrgDomainRequest | null;
}

const props = defineProps<{ orgId: string; mappings: OrgDomainMapping[] }>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const dash = raw("—");

const STATE_BADGES: Record<RowState, { variant: BadgeVariant; labelKey: I18nKey }> = {
  verified: { variant: "success-outline", labelKey: "settings.orgDomainMapping.state.verified" },
  pending: { variant: "default-outline", labelKey: "settings.orgDomainMapping.state.pending" },
  failed: { variant: "error-outline", labelKey: "settings.orgDomainMapping.state.failed" },
  requested: { variant: "warning-outline", labelKey: "settings.orgDomainMapping.state.requested" },
  rejected: { variant: "error-outline", labelKey: "settings.orgDomainMapping.state.rejected" },
};

const METHOD_KEYS: Record<RowMethod, I18nKey> = {
  dns: "settings.orgDomainMapping.method.dns",
  approved: "settings.orgDomainMapping.method.approved",
  request: "settings.orgDomainMapping.method.request",
};

const LINK_STATES: Record<number, RowState> = { 0: "pending", 1: "verified", 2: "failed" };

const domains = useQuery(() => orgDomainsQuery(props.orgId));
const requests = useQuery(() => orgDomainRequestsQuery(props.orgId));
const linkDomain = useMutation(() => linkOrgDomainMutation(props.orgId));
const raiseRequest = useMutation(() => raiseOrgDomainRequestMutation(props.orgId));
const unlinkDomain = useMutation(() => unlinkOrgDomainMutation(props.orgId));
const verifyDomain = useMutation(() => verifyOrgDomainMutation(props.orgId));
const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));

const loading = computed(() => domains.isPending.value || requests.isPending.value);
const loadError = computed(() => {
  const err: any = domains.error.value ?? requests.error.value;
  if (!err) return null;
  return err?.response?.data?.message || err?.message || t("settings.orgDomainMapping.loadFailed");
});

// An approved request becomes a link, so only open and rejected requests are listed beside the links.
const rows = computed<LinkedDomainRow[]>(() => {
  const result: LinkedDomainRow[] = (domains.data.value ?? []).map((link) => ({
    id: `link-${link.id}`,
    domain: link.domain,
    state: LINK_STATES[link.verification_state] ?? "pending",
    method: link.meta_mapped ? "approved" : "dns",
    updated: link.last_checked_at ?? link.updated_at,
    link,
    request: null,
  }));
  for (const request of requests.data.value ?? []) {
    if (request.org_id !== props.orgId || request.status === 1) continue;
    result.push({
      id: `request-${request.id}`,
      domain: request.domain,
      state: request.status === 2 ? "rejected" : "requested",
      method: "request",
      updated: request.updated_at,
      link: null,
      request,
    });
  }
  return result;
});

const filterQuery = ref("");
const visibleRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  return query ? rows.value.filter((row) => row.domain.includes(query)) : rows.value;
});

const columns: OTableColumnDef<LinkedDomainRow>[] = [
  {
    id: "domain",
    header: t("settings.orgDomainMapping.domain"),
    accessorKey: "domain",
    sortable: true,
    size: 320,
    meta: { isName: true, flex: true },
  },
  {
    id: "state",
    header: t("settings.orgDomainMapping.status"),
    accessorKey: "state",
    sortable: true,
    size: 160,
  },
  {
    id: "method",
    header: t("settings.orgDomainMapping.linkedVia"),
    accessorKey: "method",
    size: 200,
  },
  {
    id: "updated",
    header: t("settings.orgDomainMapping.lastChecked"),
    accessorKey: "updated",
    sortable: true,
    size: COL.updatedAt,
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    meta: { align: "center", actionCount: 2 },
  },
];

const isExpandable = (row: LinkedDomainRow) =>
  row.method === "dns" || (row.state === "rejected" && !!row.request?.reason);

const canVerify = (row: LinkedDomainRow) => row.method === "dns" && row.state !== "verified";

const expandedIds = ref<string[]>([]);
// Set after a DNS link so its record opens once the new row arrives.
const expandOnArrival = ref<string | null>(null);

watch(rows, (next) => {
  if (!expandOnArrival.value) return;
  const row = next.find((r) => r.link && r.domain === expandOnArrival.value);
  if (!row) return;
  expandedIds.value = [row.id];
  expandOnArrival.value = null;
});

const errorMessage = (err: any) => raw(err?.response?.data?.message || err?.message);

function refresh() {
  domains.refetch();
  requests.refetch();
}

const linkDialogOpen = ref(false);
const linkDialogMethod = ref<LinkMethod>("dns");

function openLink(method: LinkMethod = "dns") {
  linkDialogMethod.value = method;
  linkDialogOpen.value = true;
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") filterQuery.value = "";
  else openLink(id === "request" ? "request" : "dns");
}

async function submitLink(domain: string, method: LinkMethod): Promise<boolean> {
  if (method === "request") {
    try {
      await raiseRequest.mutateAsync(domain);
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.requestFailed"),
      });
      return false;
    }
    toast({ variant: "success", message: t("settings.orgDomainMapping.requestSent") });
    return true;
  }

  // The backend inserts a second row with a new token rather than rejecting a repeat link.
  if ((domains.data.value ?? []).some((link) => link.domain.toLowerCase() === domain)) {
    toast({ variant: "error", message: t("settings.orgDomainMapping.alreadyLinked") });
    return false;
  }

  try {
    await linkDomain.mutateAsync(domain);
  } catch (err) {
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.linkFailed"),
    });
    return false;
  }
  expandOnArrival.value = domain;
  toast({ variant: "success", message: t("settings.orgDomainMapping.linked") });
  return true;
}

const verifyingDomain = ref<string | null>(null);

async function verify(domain: string) {
  verifyingDomain.value = domain;
  try {
    const res = await verifyDomain.mutateAsync(domain);
    if (res?.data?.verification_state === 1) {
      toast({ variant: "success", message: t("settings.orgDomainMapping.verified") });
    } else {
      toast({ variant: "warning", message: t("settings.orgDomainMapping.notVerifiedYet") });
    }
  } catch (err) {
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.verifyFailed"),
    });
    // A failed check still records its failure reason server-side, and error paths skip invalidation.
    await domains.refetch();
  } finally {
    verifyingDomain.value = null;
  }
}

async function remove(row: LinkedDomainRow) {
  const remaining = props.mappings.filter((m) => m.domain.toLowerCase() !== row.domain);
  const mappedCount = props.mappings.length - remaining.length;
  const ok = await confirm({
    title: t("settings.orgDomainMapping.removeTitle"),
    message:
      mappedCount > 0
        ? t(
            "settings.orgDomainMapping.removeWithMappingsBody",
            { domain: row.domain, count: mappedCount },
            mappedCount,
          )
        : t("settings.orgDomainMapping.removeBody", { domain: row.domain }),
    confirmLabel: t("settings.orgDomainMapping.removeDomain"),
  });
  if (!ok) return;

  // The settings endpoint rejects every mapping save while one points at an unlinked domain, so mappings go first.
  if (mappedCount > 0) {
    try {
      await updateSettings.mutateAsync({ domain_org_mappings: remaining });
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
      });
      return;
    }
  }
  try {
    await unlinkDomain.mutateAsync(row.domain);
  } catch (err) {
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.unlinkFailed"),
    });
    return;
  }
  toast({ variant: "success", message: t("settings.orgDomainMapping.removed") });
}

defineExpose({ openLink });
</script>
