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
  <div class="flex flex-col gap-4" data-test="settings-org-domain-restrictions">
    <OFormSection
      :title="t('settings.orgDomainMapping.blocklistSection')"
      data-test="settings-org-domain-restrictions-blocklists"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          :disabled="addableDomains.length === 0"
          :title="
            addableDomains.length === 0
              ? t('settings.orgDomainMapping.noDomainForBlocklist')
              : undefined
          "
          data-test="settings-org-domain-restrictions-add-btn"
          @click="openAdd"
        >
          {{ t("settings.orgDomainMapping.blockUsers") }}
        </OButton>
      </template>

      <div class="py-1">
        <OTable
          data-test="settings-org-domain-restrictions-table"
          :data="blocklists"
          :columns="columns"
          row-key="name"
          show-index
          pagination="none"
          sorting="client"
          :fill-height="false"
          :show-global-filter="false"
        >
          <template #empty>
            <OEmptyState
              preset="no-blocked-users"
              :actions="addableDomains.length === 0 ? [] : undefined"
              @action="openAdd"
            />
          </template>
          <template #cell-emails="{ row }">
            <span
              class="relative inline-flex"
              :data-test="`settings-org-domain-restrictions-emails-${row.name}`"
            >
              {{
                t(
                  "settings.orgDomainMapping.blockedCount",
                  { count: row.blockedEmails.length },
                  row.blockedEmails.length,
                )
              }}
              <OTooltip :max-width="'25rem'" :content="raw(row.blockedEmails.join(', '))" />
            </span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center justify-center gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                class="max-md:hidden"
                :title="t('common.edit')"
                :data-test="`settings-org-domain-restrictions-edit-${row.name}`"
                @click.stop="openEdit(row)"
              />
              <OButton
                variant="ghost-destructive"
                size="icon-sm"
                icon-left="delete"
                class="max-md:hidden"
                :title="t('settings.orgDomainMapping.unblockAll')"
                :data-test="`settings-org-domain-restrictions-remove-${row.name}`"
                @click.stop="removeBlocklist(row)"
              />
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    icon-left="more-vert"
                    variant="ghost"
                    size="icon-xs-sq"
                    class="md:hidden"
                    :data-test="`settings-org-domain-restrictions-more-${row.name}`"
                    @click.stop
                  />
                </template>
                <ODropdownItem
                  icon-left="edit"
                  class="md:hidden"
                  :data-test="`settings-org-domain-restrictions-edit-${row.name}-menu`"
                  @select="openEdit(row)"
                >
                  <span>{{ t("common.edit") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="delete"
                  variant="destructive"
                  class="md:hidden"
                  :data-test="`settings-org-domain-restrictions-remove-${row.name}-menu`"
                  @select="removeBlocklist(row)"
                >
                  <span>{{ t("settings.orgDomainMapping.unblockAll") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
        </OTable>
      </div>
    </OFormSection>

    <OrgDomainBlocklistDialog
      v-model:open="dialogOpen"
      :blocklist="editing"
      :domain-options="dialogDomainOptions"
      :submit="submitBlocklist"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { orgDomainsQuery, updateOrgSettingsMutation } from "@/services/organizations.queries";
import {
  configToBlocklists,
  setDomainBlocklist,
  type DomainBlocklist,
  type DomainManagementConfig,
} from "./orgDomainRestrictions";
import OrgDomainBlocklistDialog from "./OrgDomainBlocklistDialog.vue";
import { createSaveQueue } from "./saveQueue";

const props = defineProps<{
  orgId: string;
  config?: Partial<DomainManagementConfig>;
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));
const domains = useQuery(() => orgDomainsQuery(props.orgId));

const blocklists = computed(() => configToBlocklists(props.config));

const columns: OTableColumnDef<DomainBlocklist>[] = [
  {
    id: "name",
    header: t("settings.orgDomainMapping.domain"),
    accessorKey: "name",
    sortable: true,
    size: 280,
    meta: { isName: true, flex: true },
  },
  {
    id: "emails",
    header: t("settings.orgDomainMapping.blockedEmails"),
    accessorFn: (row) => row.blockedEmails.length,
    sortable: true,
    size: 200,
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    meta: { align: "center", actionCount: 2 },
  },
];

// The backend checks blocks only for users of domains this org owns, so new blocklists pick from its verified domains.
const verifiedDomains = computed(() =>
  (domains.data.value ?? []).filter((d) => d.verification_state === 1).map((d) => d.domain),
);
const addableDomains = computed(() =>
  [...new Set(verifiedDomains.value)].filter((d) => !blocklists.value.some((b) => b.name === d)),
);

const queueSave = createSaveQueue();

const dialogOpen = ref(false);
const editing = ref<DomainBlocklist | null>(null);
const dialogDomainOptions = computed<SelectOption[]>(() => {
  const names = editing.value ? [editing.value.name] : addableDomains.value;
  return names.map((name) => ({ label: raw(name), value: name }));
});

function openAdd() {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(blocklist: DomainBlocklist) {
  editing.value = blocklist;
  dialogOpen.value = true;
}

async function saveBlocklist(
  domain: string,
  emails: string[],
  successMessage: I18nText,
): Promise<boolean> {
  return queueSave(() => writeBlocklist(domain, emails, successMessage));
}

async function writeBlocklist(
  domain: string,
  emails: string[],
  successMessage: I18nText,
): Promise<boolean> {
  try {
    await updateSettings.mutateAsync({
      domain_management_config: setDomainBlocklist(props.config, domain, emails),
    });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message || err?.message) ||
        t("settings.orgDomainMapping.saveFailed"),
    });
    return false;
  }
  toast({ variant: "success", message: successMessage });
  return true;
}

function submitBlocklist(blocklist: DomainBlocklist): Promise<boolean> {
  return saveBlocklist(
    blocklist.name,
    blocklist.blockedEmails,
    t("settings.orgDomainMapping.blocklistSaved"),
  );
}

async function removeBlocklist(blocklist: DomainBlocklist) {
  const ok = await confirm({
    title: t("settings.orgDomainMapping.unblockAllTitle"),
    message: t("settings.orgDomainMapping.unblockAllBody", { domain: blocklist.name }),
    confirmLabel: t("settings.orgDomainMapping.unblockAll"),
  });
  if (!ok) return;
  await saveBlocklist(blocklist.name, [], t("settings.orgDomainMapping.blocklistDeleted"));
}
</script>
