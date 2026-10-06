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
  <div data-test="settings-org-domain-mappings">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xl font-semibold">{{ t("settings.orgDomainMapping.mappingsTitle") }}</div>
        <div class="text-text-secondary text-sm">
          {{ t("settings.orgDomainMapping.mappingsSubtitle") }}
        </div>
      </div>
      <OButton
        data-test="settings-org-domain-mappings-add-btn"
        variant="outline"
        size="sm-action"
        icon-left="add"
        class="shrink-0"
        @click="openAdd"
      >
        {{ t("settings.orgDomainMapping.addMapping") }}
      </OButton>
    </div>

    <div v-if="domains.isPending.value" class="flex justify-center py-6">
      <OSpinner />
    </div>
    <div
      v-else-if="rows.length === 0"
      data-test="settings-org-domain-mappings-empty"
      class="text-text-secondary border-border-default rounded-surface border py-6 text-center text-sm"
    >
      {{ t("settings.orgDomainMapping.empty") }}
    </div>
    <div v-else class="flex flex-col gap-2" data-test="settings-org-domain-mappings-list">
      <div
        v-for="row in rows"
        :key="row.domain"
        :data-test="`settings-org-domain-mappings-row-${row.domain}`"
        class="border-border-default rounded-surface flex flex-col gap-3 border p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
              <span class="text-text-heading truncate font-semibold">
                {{ atSign }}{{ row.domain }}
              </span>
              <OBadge
                v-if="row.link"
                :variant="stateBadge(row.link.verification_state).variant"
                size="sm"
                :data-test="`settings-org-domain-mappings-state-${row.domain}`"
              >
                {{ t(stateBadge(row.link.verification_state).labelKey) }}
              </OBadge>
              <OBadge v-else variant="warning-outline" size="sm">
                {{ t("settings.orgDomainMapping.notLinked") }}
              </OBadge>
            </div>
            <div v-if="row.mapping" class="flex min-w-0 flex-wrap items-center gap-1">
              <OIcon name="arrow-forward" size="xs" class="text-text-secondary shrink-0" />
              <span class="text-text-body truncate text-sm">{{
                orgLabel(row.mapping.org_id)
              }}</span>
              <OTag
                v-if="isBuiltInRole(row.mapping.role_name)"
                type="userRole"
                :value="row.mapping.role_name || 'user'"
              />
              <OTag v-else type="fieldTag">
                <span class="truncate text-xs">{{ row.mapping.role_name }}</span>
              </OTag>
            </div>
            <div v-else class="text-text-secondary text-xs">
              {{ t("settings.orgDomainMapping.notMapped") }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <OButton
              v-if="row.link && row.link.verification_state !== 1"
              variant="ghost"
              size="icon-sm"
              icon-left="refresh"
              :loading="verifyingDomain === row.domain"
              :data-test="`settings-org-domain-mappings-verify-${row.domain}`"
              @click="verify(row.domain)"
            >
              <OTooltip side="bottom" :content="t('settings.orgDomainMapping.verifyNow')" />
            </OButton>
            <OButton
              v-if="!row.mapping"
              variant="ghost"
              size="icon-sm"
              icon-left="link"
              :data-test="`settings-org-domain-mappings-map-${row.domain}`"
              @click="openMapLinked(row.domain)"
            >
              <OTooltip side="bottom" :content="t('settings.orgDomainMapping.addMapping')" />
            </OButton>
            <OButton
              v-else
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :data-test="`settings-org-domain-mappings-edit-${row.domain}`"
              @click="openEdit(row.mapping)"
            >
              <OTooltip side="bottom" :content="t('common.edit')" />
            </OButton>
            <OButton
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="delete"
              :data-test="`settings-org-domain-mappings-delete-${row.domain}`"
              @click="remove(row)"
            >
              <OTooltip side="bottom" :content="t('common.delete')" />
            </OButton>
          </div>
        </div>
        <OrgDomainVerification
          v-if="row.link && row.link.verification_state !== 1"
          :domain="row.link"
        />
      </div>
    </div>

    <OrgDomainMappingDialog
      v-model:open="dialogOpen"
      :mode="dialogMode"
      :mapping="dialogMapping"
      :org-options="orgOptions"
      :default-org-id="orgId"
      :taken-domains="takenDomains"
      :submit="submitMapping"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import type { OrgDomainOwnership } from "@/services/organizations";
import {
  billingGroupMembersQuery,
  linkOrgDomainMutation,
  orgDomainsQuery,
  unlinkOrgDomainMutation,
  updateOrgSettingsMutation,
  verifyOrgDomainMutation,
} from "@/services/organizations.queries";
import OrgDomainMappingDialog from "./OrgDomainMappingDialog.vue";
import OrgDomainVerification from "./OrgDomainVerification.vue";
import { BUILT_IN_ROLES, type OrgDomainMapping } from "./OrgDomainMapping.schema";

interface DomainRow {
  domain: string;
  mapping: OrgDomainMapping | null;
  link: OrgDomainOwnership | null;
}

const props = defineProps<{ orgId: string; mappings: OrgDomainMapping[] }>();

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

const atSign = raw("@");

const domains = useQuery(() => orgDomainsQuery(props.orgId));
const members = useQuery(() => billingGroupMembersQuery(props.orgId));
const updateSettings = useMutation(() => updateOrgSettingsMutation(props.orgId));
const linkDomain = useMutation(() => linkOrgDomainMutation(props.orgId));
const unlinkDomain = useMutation(() => unlinkOrgDomainMutation(props.orgId));
const verifyDomain = useMutation(() => verifyOrgDomainMutation(props.orgId));

const linksByDomain = computed(() => {
  const map = new Map<string, OrgDomainOwnership>();
  for (const link of domains.data.value ?? []) map.set(link.domain.toLowerCase(), link);
  return map;
});

// Linked domains without a mapping are listed too, so a link left behind by a failed save can be mapped or released.
const rows = computed<DomainRow[]>(() => {
  const mapped = new Set<string>();
  const result: DomainRow[] = props.mappings.map((mapping) => {
    const domain = mapping.domain.toLowerCase();
    mapped.add(domain);
    return { domain, mapping, link: linksByDomain.value.get(domain) ?? null };
  });
  for (const [domain, link] of linksByDomain.value) {
    if (!mapped.has(domain)) result.push({ domain, mapping: null, link });
  }
  return result;
});

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

const isBuiltInRole = (role?: string) =>
  !role || (BUILT_IN_ROLES as readonly string[]).includes(role);

const stateBadge = (state: number): { variant: BadgeVariant; labelKey: I18nKey } => {
  if (state === 1)
    return { variant: "success-outline", labelKey: "settings.orgDomainMapping.state.verified" };
  if (state === 2)
    return { variant: "error-outline", labelKey: "settings.orgDomainMapping.state.failed" };
  return { variant: "default-outline", labelKey: "settings.orgDomainMapping.state.pending" };
};

const errorMessage = (err: any) => raw(err?.response?.data?.message || err?.message);

const dialogOpen = ref(false);
const dialogMode = ref<"add" | "edit">("add");
const dialogMapping = ref<OrgDomainMapping | null>(null);
const editingDomain = ref<string | null>(null);

const takenDomains = computed(() =>
  props.mappings
    .map((m) => m.domain.toLowerCase())
    .filter((domain) => domain !== editingDomain.value),
);

function openAdd() {
  dialogMode.value = "add";
  dialogMapping.value = null;
  editingDomain.value = null;
  dialogOpen.value = true;
}

function openMapLinked(domain: string) {
  dialogMode.value = "add";
  dialogMapping.value = { domain, org_id: props.orgId, role_name: "user" };
  editingDomain.value = null;
  dialogOpen.value = true;
}

function openEdit(mapping: OrgDomainMapping) {
  dialogMode.value = "edit";
  dialogMapping.value = { ...mapping };
  editingDomain.value = mapping.domain.toLowerCase();
  dialogOpen.value = true;
}

const saveMappings = (next: OrgDomainMapping[]) =>
  updateSettings.mutateAsync({ domain_org_mappings: next });

async function submitMapping(mapping: OrgDomainMapping): Promise<boolean> {
  if (editingDomain.value) {
    const target = editingDomain.value;
    try {
      await saveMappings(
        props.mappings.map((m) => (m.domain.toLowerCase() === target ? mapping : m)),
      );
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
      });
      return false;
    }
    toast({ variant: "success", message: t("settings.orgDomainMapping.saved") });
    return true;
  }

  // The settings endpoint rejects a mapping whose domain is not linked to this org, so the link goes first.
  const needsLink = !linksByDomain.value.has(mapping.domain);
  if (needsLink) {
    try {
      await linkDomain.mutateAsync(mapping.domain);
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.linkFailed"),
      });
      return false;
    }
  }
  try {
    await saveMappings([...props.mappings, mapping]);
  } catch (err) {
    if (needsLink) await unlinkDomain.mutateAsync(mapping.domain).catch(() => undefined);
    toast({
      variant: "error",
      message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
    });
    return false;
  }
  toast({ variant: "success", message: t("settings.orgDomainMapping.saved") });
  return true;
}

async function remove(row: DomainRow) {
  const ok = await confirm({
    title: t("settings.orgDomainMapping.deleteTitle"),
    message: row.link
      ? t("settings.orgDomainMapping.deleteBody", { domain: row.domain })
      : t("settings.orgDomainMapping.deleteMappingBody", { domain: row.domain }),
    confirmLabel: t("common.delete"),
  });
  if (!ok) return;

  if (row.link) {
    try {
      await unlinkDomain.mutateAsync(row.domain);
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.unlinkFailed"),
      });
      return;
    }
  }
  if (row.mapping) {
    try {
      await saveMappings(props.mappings.filter((m) => m.domain.toLowerCase() !== row.domain));
    } catch (err) {
      toast({
        variant: "error",
        message: errorMessage(err) || t("settings.orgDomainMapping.saveFailed"),
      });
      return;
    }
  }
  toast({ variant: "success", message: t("settings.orgDomainMapping.deleted") });
}

const verifyingDomain = ref<string | null>(null);

async function verify(domain: string) {
  verifyingDomain.value = domain;
  try {
    await verifyDomain.mutateAsync(domain);
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
</script>
