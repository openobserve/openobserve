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
      :title="t('settings.orgDomainMapping.domainRulesSection')"
      data-test="settings-org-domain-restrictions-rules"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          :disabled="addableDomains.length === 0"
          :title="
            addableDomains.length === 0 ? t('settings.orgDomainMapping.noDomainForRule') : undefined
          "
          data-test="settings-org-domain-restrictions-add-rule-btn"
          @click="openAdd"
        >
          {{ t("settings.orgDomainMapping.addRule") }}
        </OButton>
      </template>

      <div class="py-1">
        <OTable
          data-test="settings-org-domain-restrictions-table"
          :data="cards"
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
              preset="no-access-rules"
              :actions="addableDomains.length === 0 ? [] : undefined"
              @action="openAdd"
            />
          </template>
          <template #cell-policy="{ row }">
            <OBadge
              :variant="RULE_BADGES[row.policy].variant"
              size="sm"
              :data-test="`settings-org-domain-restrictions-rule-${row.name}`"
            >
              {{ t(RULE_BADGES[row.policy].labelKey) }}
            </OBadge>
          </template>
          <template #cell-emails="{ row }">
            <span
              v-if="emailSummary(row)"
              class="relative inline-flex"
              :data-test="`settings-org-domain-restrictions-emails-${row.name}`"
            >
              {{ emailSummary(row) }}
              <OTooltip :max-width="'25rem'" :content="emailList(row)" />
            </span>
            <span v-else class="text-text-secondary">{{ dash }}</span>
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
                :title="t('common.delete')"
                :data-test="`settings-org-domain-restrictions-remove-${row.name}`"
                @click.stop="removeRule(row)"
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
                  @select="removeRule(row)"
                >
                  <span>{{ t("common.delete") }}</span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </template>
        </OTable>
      </div>
    </OFormSection>

    <OrgDomainRuleDialog
      v-model:open="ruleDialogOpen"
      :rule="editingRule"
      :domain-options="ruleDomainOptions"
      :submit="submitRule"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
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
  cardsToConfig,
  configToCards,
  type DomainManagementConfig,
  type RestrictionCard,
  type RestrictionPolicy,
} from "./orgDomainRestrictions";
import OrgDomainRuleDialog from "./OrgDomainRuleDialog.vue";

const props = defineProps<{
  orgId: string;
  config?: Partial<DomainManagementConfig>;
}>();

const { t } = useI18nTyped();
const { confirm } = useConfirmDialog();

const dash = raw("—");

const RULE_BADGES: Record<RestrictionPolicy, { variant: BadgeVariant; labelKey: I18nKey }> = {
  allow_all: {
    variant: "success-outline",
    labelKey: "settings.orgDomainMapping.rulePolicy.allow_all",
  },
  allow_specific: {
    variant: "default-outline",
    labelKey: "settings.orgDomainMapping.rulePolicy.allow_specific",
  },
  block_specific: {
    variant: "warning-outline",
    labelKey: "settings.orgDomainMapping.rulePolicy.block_specific",
  },
  block_all: {
    variant: "error-outline",
    labelKey: "settings.orgDomainMapping.rulePolicy.block_all",
  },
};

const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));
const domains = useQuery(() => orgDomainsQuery(props.orgId));

const cards = computed(() => configToCards(props.config));

const columns: OTableColumnDef<RestrictionCard>[] = [
  {
    id: "name",
    header: t("settings.orgDomainMapping.domain"),
    accessorKey: "name",
    sortable: true,
    size: 280,
    meta: { isName: true, flex: true },
  },
  {
    id: "policy",
    header: t("settings.orgDomainMapping.ruleColumn"),
    accessorKey: "policy",
    sortable: true,
    size: 180,
  },
  {
    id: "emails",
    header: t("settings.orgDomainMapping.emailsColumn"),
    accessorFn: (row) => row.allowedEmails.length + row.blockedEmails.length,
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

// Rules only apply to domains this org owns, so new rules pick from its verified domains.
const verifiedDomains = computed(() =>
  (domains.data.value ?? []).filter((d) => d.verification_state === 1).map((d) => d.domain),
);
const addableDomains = computed(() =>
  [...new Set(verifiedDomains.value)].filter((d) => !cards.value.some((c) => c.name === d)),
);

const ruleDialogOpen = ref(false);
const editingRule = ref<RestrictionCard | null>(null);
const ruleDomainOptions = computed<SelectOption[]>(() => {
  const names = editingRule.value ? [editingRule.value.name] : addableDomains.value;
  return names.map((name) => ({ label: raw(name), value: name }));
});

function openAdd() {
  editingRule.value = null;
  ruleDialogOpen.value = true;
}

function openEdit(rule: RestrictionCard) {
  editingRule.value = rule;
  ruleDialogOpen.value = true;
}

async function saveRules(next: RestrictionCard[], successMessage: I18nText): Promise<boolean> {
  try {
    await updateSettings.mutateAsync({ domain_management_config: cardsToConfig(next) });
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

function submitRule(rule: RestrictionCard): Promise<boolean> {
  const exists = cards.value.some((c) => c.name === rule.name);
  const next = exists
    ? cards.value.map((c) => (c.name === rule.name ? rule : c))
    : [...cards.value, rule];
  return saveRules(next, t("settings.orgDomainMapping.ruleSaved"));
}

async function removeRule(rule: RestrictionCard) {
  const ok = await confirm({
    title: t("settings.orgDomainMapping.deleteRuleTitle"),
    message: t("settings.orgDomainMapping.deleteRuleBody", { domain: rule.name }),
    confirmLabel: t("common.delete"),
  });
  if (!ok) return;
  await saveRules(
    cards.value.filter((c) => c.name !== rule.name),
    t("settings.orgDomainMapping.ruleDeleted"),
  );
}

const emailSummary = (rule: RestrictionCard): I18nText | null => {
  const parts: I18nText[] = [];
  const allowed = rule.allowedEmails.length;
  const blocked = rule.blockedEmails.length;
  if (allowed) parts.push(t("settings.orgDomainMapping.allowedCount", { count: allowed }, allowed));
  if (blocked) parts.push(t("settings.orgDomainMapping.blockedCount", { count: blocked }, blocked));
  return parts.length ? raw(parts.join(" · ")) : null;
};

const emailList = (rule: RestrictionCard) =>
  raw([...rule.allowedEmails, ...rule.blockedEmails].join(", "));
</script>
