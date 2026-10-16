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
  <div class="flex h-full min-h-0 flex-col" data-test="settings-org-domain-mappings">
    <div class="px-page-edge shrink-0 py-3">
      <div
        class="rounded-default bg-surface-overlay border-border-default flex items-center gap-4 border p-4"
        data-test="settings-org-domain-mappings-enforce"
      >
        <div
          class="rounded-default bg-surface-subtle border-border-default text-text-secondary flex h-9 w-9 shrink-0 items-center justify-center border"
        >
          <OIcon name="layers" size="sm" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-text-heading text-sm font-semibold">
            {{ t("settings.orgDomainMapping.enforceTitle") }}
          </span>
          <span class="text-text-secondary max-w-2xl text-sm">
            {{ t("settings.orgDomainMapping.enforceDesc") }}
          </span>
        </div>
        <OSwitch
          :model-value="enforceValue"
          :disabled="savingEnforce"
          label-position="left"
          data-test="settings-org-domain-mappings-enforce-switch"
          @update:model-value="setEnforce(!!$event)"
        >
          <template #label>
            <span class="sr-only">{{ t("settings.orgDomainMapping.enforceTitle") }}</span>
            <span class="text-text-secondary font-normal">
              {{
                enforceValue
                  ? t("components.badge.booleanState.on")
                  : t("components.badge.booleanState.off")
              }}
            </span>
          </template>
        </OSwitch>
      </div>
    </div>

    <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <OTable
        :frame="false"
        data-test="settings-org-domain-mappings-table"
        :data="visibleRows"
        :columns="columns"
        row-key="id"
        pagination="client"
        sorting="client"
        :show-global-filter="false"
        :loading="domains.isPending.value"
      >
        <template #toolbar>
          <OSearchInput
            v-model="filterQuery"
            class="min-w-0 flex-1 max-md:min-w-40"
            :placeholder="t('settings.orgDomainMapping.searchMappings')"
            data-test="settings-org-domain-mappings-search"
          />
        </template>
        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="domains.dataUpdatedAt.value || null"
            :loading="domains.isFetching.value || members.isFetching.value"
            data-test="settings-org-domain-mappings-refresh-btn"
            @click="refresh"
          />
        </template>
        <template #empty>
          <OEmptyState
            v-if="!domains.isPending.value"
            size="hero"
            preset="no-domain-mappings"
            :filtered="filterQuery !== ''"
            :description="
              verifiedDomains.length === 0
                ? t('settings.orgDomainMapping.noVerifiedDomains')
                : undefined
            "
            :actions="verifiedDomains.length === 0 ? GO_TO_LINKED_ACTIONS : undefined"
            @action="onEmptyAction"
          />
        </template>

        <template #cell-domain="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <OTruncatedText>{{ atSign }}{{ row.mapping.domain }}</OTruncatedText>
            <OBadge
              v-if="!row.verified"
              variant="warning-outline"
              size="sm"
              class="shrink-0"
              :data-test="`settings-org-domain-mappings-unverified-${row.mapping.domain}`"
            >
              {{ t("settings.orgDomainMapping.domainNotVerified") }}
            </OBadge>
          </div>
        </template>
        <template #cell-org="{ row }">
          {{ orgLabel(row.mapping.org_id) }}
        </template>
        <template #cell-base_role="{ row }">
          <OTag type="userRole" :value="badgeRole(row.mapping.base_role)" />
        </template>
        <template #cell-role_claim_name="{ row }">
          <OCodeCell v-if="row.mapping.role_claim_name" :value="row.mapping.role_claim_name" />
          <span v-else class="text-text-muted">{{ dash }}</span>
        </template>
        <template #cell-create_missing_roles="{ row }">
          <span v-if="row.mapping.role_claim_name && row.mapping.create_missing_roles">
            {{ t("common.yes") }}
          </span>
          <span v-else class="text-text-muted">{{ dash }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex items-center justify-center gap-1">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              class="max-md:hidden"
              :title="t('common.edit')"
              :data-test="`settings-org-domain-mappings-edit-${row.id}`"
              @click.stop="openEdit(row)"
            />
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              class="max-md:hidden"
              :title="t('common.delete')"
              :data-test="`settings-org-domain-mappings-delete-${row.id}`"
              @click.stop="remove(row)"
            />
            <ODropdown side="bottom" align="end">
              <template #trigger>
                <OButton
                  icon-left="more-vert"
                  variant="ghost"
                  size="icon-xs-sq"
                  class="md:hidden"
                  :data-test="`settings-org-domain-mappings-more-${row.id}`"
                  @click.stop
                />
              </template>
              <ODropdownItem
                icon-left="edit"
                class="md:hidden"
                :data-test="`settings-org-domain-mappings-edit-${row.id}-menu`"
                @select="openEdit(row)"
              >
                <span>{{ t("common.edit") }}</span>
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete"
                variant="destructive"
                class="md:hidden"
                :data-test="`settings-org-domain-mappings-delete-${row.id}-menu`"
                @select="remove(row)"
              >
                <span>{{ t("common.delete") }}</span>
              </ODropdownItem>
            </ODropdown>
          </div>
        </template>
      </OTable>
    </div>

    <OrgDomainMappingDialog
      v-model:open="dialogOpen"
      :mode="editingIndex === null ? 'add' : 'edit'"
      :mapping="dialogMapping"
      :domain-options="domainOptions"
      :org-options="orgOptions"
      :default-org-id="orgId"
      :taken-keys="takenKeys"
      :submit="submitMapping"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OCodeCell from "@/lib/core/Table/cells/OCodeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import type { OrgDomainMapping } from "@/services/organizations";
import {
  billingGroupMembersQuery,
  orgDomainsQuery,
  updateOrgSettingsMutation,
} from "@/services/organizations.queries";
import OrgDomainMappingDialog from "./OrgDomainMappingDialog.vue";

interface MappingRow {
  id: string;
  index: number;
  mapping: OrgDomainMapping;
  verified: boolean;
}

const props = defineProps<{
  orgId: string;
  mappings: OrgDomainMapping[];
  enforceAllowedOrgsOnly: boolean;
}>();

const emit = defineEmits<{
  (_e: "go-to-linked"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

const atSign = raw("@");
const dash = raw("—");

const GO_TO_LINKED_ACTIONS: EmptyStateAction[] = [
  {
    id: "go-to-linked",
    icon: "link",
    titleKey: "settings.orgDomainMapping.goToLinked",
    descriptionKey: "settings.orgDomainMapping.goToLinkedDesc",
  },
];

const domains = useQuery(() => orgDomainsQuery(props.orgId));
const members = useQuery(() => billingGroupMembersQuery(props.orgId));
const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));

const verifiedDomains = computed(() =>
  (domains.data.value ?? []).filter((d) => d.verification_state === 1).map((d) => d.domain),
);

const domainOptions = computed<SelectOption[]>(() =>
  verifiedDomains.value.map((domain) => ({ label: raw(domain), value: domain })),
);

const orgOptions = computed<SelectOption[]>(() => {
  const current = store.state.selectedOrganization;
  const options: SelectOption[] = [
    { label: raw(current?.label || props.orgId), value: props.orgId },
  ];
  for (const member of members.data.value ?? []) {
    if (member.member_org_id === props.orgId) continue;
    options.push({
      label: raw(member.member_org_name || member.member_org_id),
      value: member.member_org_id,
    });
  }
  return options;
});

const orgLabel = (orgId: string) =>
  orgOptions.value.find((o) => o.value === orgId)?.label ?? raw(orgId);

// The badge registry keys the User role as `user`; `allowed_user` is its OpenFGA relation name.
const badgeRole = (role: string) => (role === "allowed_user" ? "user" : role);

const mappingKey = (m: Pick<OrgDomainMapping, "domain" | "org_id">) =>
  `${m.domain.toLowerCase()}|${m.org_id}`;

const rows = computed<MappingRow[]>(() => {
  const verified = new Set(verifiedDomains.value);
  return props.mappings.map((mapping, index) => ({
    id: mappingKey(mapping),
    index,
    mapping,
    verified: verified.has(mapping.domain.toLowerCase()),
  }));
});

const filterQuery = ref("");
const visibleRows = computed(() => {
  const query = filterQuery.value.trim().toLowerCase();
  if (!query) return rows.value;
  return rows.value.filter(
    (row) =>
      row.mapping.domain.toLowerCase().includes(query) ||
      String(orgLabel(row.mapping.org_id)).toLowerCase().includes(query),
  );
});

const columns: OTableColumnDef<MappingRow>[] = [
  {
    id: "domain",
    header: t("settings.orgDomainMapping.domain"),
    accessorFn: (row) => row.mapping.domain,
    sortable: true,
    size: 300,
    meta: { isName: true, flex: true },
  },
  {
    id: "org",
    header: t("settings.orgDomainMapping.organization"),
    accessorFn: (row) => orgLabel(row.mapping.org_id),
    sortable: true,
    size: 220,
  },
  {
    id: "base_role",
    header: t("settings.orgDomainMapping.baseRole"),
    accessorFn: (row) => row.mapping.base_role,
    sortable: true,
    size: 140,
  },
  {
    id: "role_claim_name",
    header: t("settings.orgDomainMapping.roleClaimName"),
    accessorFn: (row) => row.mapping.role_claim_name ?? "",
    size: 180,
  },
  {
    id: "create_missing_roles",
    header: t("settings.orgDomainMapping.createsRoles"),
    accessorFn: (row) => row.mapping.create_missing_roles,
    size: 150,
    meta: { headerTooltip: t("settings.orgDomainMapping.createMissingRoles") },
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    meta: { align: "center", actionCount: 2 },
  },
];

const errorMessage = (err: any) => raw(err?.response?.data?.message || err?.message);

function refresh() {
  domains.refetch();
  members.refetch();
}

const dialogOpen = ref(false);
const dialogMapping = ref<OrgDomainMapping | null>(null);
const editingIndex = ref<number | null>(null);

const takenKeys = computed(() =>
  props.mappings
    .filter((_, index) => index !== editingIndex.value)
    .map((mapping) => mappingKey(mapping)),
);

function openAdd() {
  editingIndex.value = null;
  dialogMapping.value = null;
  dialogOpen.value = true;
}

function openEdit(row: MappingRow) {
  editingIndex.value = row.index;
  dialogMapping.value = { ...row.mapping };
  dialogOpen.value = true;
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") filterQuery.value = "";
  else if (id === "go-to-linked") emit("go-to-linked");
  else openAdd();
}

async function saveMappings(next: OrgDomainMapping[], successMessage: I18nText): Promise<boolean> {
  try {
    await updateSettings.mutateAsync({ domain_org_mappings: next });
  } catch (err) {
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
    });
    return false;
  }
  toast({ variant: "success", message: successMessage });
  return true;
}

function submitMapping(mapping: OrgDomainMapping): Promise<boolean> {
  const index = editingIndex.value;
  const next =
    index === null
      ? [...props.mappings, mapping]
      : props.mappings.map((m, i) => (i === index ? mapping : m));
  return saveMappings(next, t("settings.orgDomainMapping.saved"));
}

async function remove(row: MappingRow) {
  const ok = await confirm({
    title: t("settings.orgDomainMapping.deleteTitle"),
    message: t("settings.orgDomainMapping.deleteMappingBody", {
      domain: row.mapping.domain,
      org: orgLabel(row.mapping.org_id),
    }),
    confirmLabel: t("common.delete"),
  });
  if (!ok) return;
  await saveMappings(
    props.mappings.filter((_, i) => i !== row.index),
    t("settings.orgDomainMapping.deleted"),
  );
}

const savingEnforce = ref(false);
const pendingEnforce = ref<boolean | null>(null);
const enforceValue = computed(() => pendingEnforce.value ?? props.enforceAllowedOrgsOnly);

async function setEnforce(value: boolean) {
  // Hold the new value while asking, so a declined confirm changes the prop back
  // and the switch (which keeps its own state) flips back with it.
  pendingEnforce.value = value;
  if (value) {
    const ok = await confirm({
      title: t("settings.orgDomainMapping.enforceConfirmTitle"),
      message: t("settings.orgDomainMapping.enforceConfirmBody"),
      confirmLabel: t("settings.orgDomainMapping.enforceConfirmAction"),
    });
    if (!ok) {
      pendingEnforce.value = null;
      return;
    }
  }
  savingEnforce.value = true;
  try {
    await updateSettings.mutateAsync({ enforce_allowed_orgs_only: value });
    toast({ variant: "success", message: t("settings.orgDomainMapping.enforceSaved") });
  } catch (err) {
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
    });
  } finally {
    pendingEnforce.value = null;
    savingEnforce.value = false;
  }
}

defineExpose({ openAdd });
</script>
