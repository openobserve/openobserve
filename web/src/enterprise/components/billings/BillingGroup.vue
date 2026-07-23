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
  <div class="flex h-full flex-col overflow-hidden px-6 pt-4" data-test="organization-group-page">
    <div v-if="loading" class="flex justify-center py-10">
      <OSpinner size="md" />
    </div>

    <template v-else>
      <!-- SUPER / PAYER ORG VIEW -->
      <div
        v-if="role === 'super'"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        data-test="org-group-super-view"
      >
        <!-- Stat cards -->
        <div class="mb-5 flex shrink-0 gap-4" data-test="org-group-stats">
          <div class="feature-card flex-1">
            <div class="text-sm leading-5 font-semibold whitespace-nowrap opacity-85">
              {{ t("billing.billingGroup.statTotal") }}
            </div>
            <div class="mt-1.5 text-2xl leading-[1.2] font-semibold">{{ totalCount }}</div>
          </div>
          <div class="feature-card flex-1">
            <div class="text-sm leading-5 font-semibold whitespace-nowrap opacity-85">
              {{ t("billing.billingGroup.statActive") }}
            </div>
            <div class="text-status-positive mt-1.5 text-2xl leading-[1.2] font-semibold">
              {{ activeCount }}
            </div>
          </div>
          <div class="feature-card flex-1">
            <div class="text-sm leading-5 font-semibold whitespace-nowrap opacity-85">
              {{ t("billing.billingGroup.statPending") }}
            </div>
            <div class="text-status-warning-text mt-1.5 text-2xl leading-[1.2] font-semibold">
              {{ pendingCount }}
            </div>
          </div>
        </div>

        <!-- Status filter + view usage -->
        <div class="mb-3 flex shrink-0 items-center justify-between gap-2">
          <AppTabs
            :tabs="superFilterTabs"
            :activeTab="superFilter"
            @update:activeTab="(v: string) => (superFilter = v)"
          />
          <OButton
            variant="outline"
            size="sm-action"
            data-test="org-group-view-usage-btn"
            @click="goToUsage"
          >
            {{ t("billing.billingGroup.viewUsage") }}
            <template #icon-right>
              <OIcon name="arrow-forward" size="sm" class="ml-1" />
            </template>
          </OButton>
        </div>

        <!-- Child orgs table (children only) -->
        <div class="min-h-0 flex-1">
          <OTable
            :data="filteredSuperRows"
            :columns="superColumns"
            row-key="key"
            pagination="client"
            :page-size="10"
            :page-size-options="[10, 20, 50, 100]"
            :default-columns="false"
            :fill-height="true"
            data-test="org-group-members-table"
          >
            <template #empty>
              <div class="py-4 text-center">
                {{ t("billing.billingGroup.noMembers") }}
              </div>
            </template>
            <template #cell-status="{ row }">
              <OTag type="billingGroupMemberStatus" :value="row.status" />
            </template>
            <template #cell-invited_by="{ row }">
              <OUserCell :value="row.invited_by" />
            </template>
            <template #cell-accepted_by="{ row }">
              <OUserCell :value="row.accepted_by" />
            </template>
          </OTable>
        </div>
      </div>

      <!-- CHILD ORG VIEW -->
      <div
        v-else-if="role === 'child'"
        class="flex min-h-0 flex-1 flex-col justify-center overflow-auto"
        data-test="org-group-child-view"
      >
        <div class="flex flex-wrap items-center justify-between gap-14 px-10 py-12">
          <!-- Left: headline + CTA -->
          <div class="max-w-120 min-w-70 flex-1">
            <div
              class="text-primary-600 mb-5 inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-primary-600)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)] px-2.5 py-1 text-xs font-semibold tracking-[0.4px]"
            >
              <OIcon name="verified" size="xs" />
              {{ t("billing.billingGroup.statusActive") }}
            </div>
            <div class="mb-4 text-4xl leading-[1.2] font-bold tracking-[-0.6px]">
              {{ t("billing.billingGroup.childHeadline") }}
              <span
                class="text-tabs-active-text inline-block max-w-full cursor-pointer overflow-hidden align-bottom text-ellipsis whitespace-nowrap"
              >
                {{ payerName }}
                <OTooltip side="bottom">
                  <template #content>
                    <div v-if="membership?.payer_org_name" class="break-all">
                      {{ membership.payer_org_name }}
                    </div>
                    <div class="text-xs break-all opacity-70">
                      {{ membership?.payer_org_id }}
                    </div>
                  </template>
                </OTooltip>
              </span>
            </div>
            <div class="mb-8 max-w-105 text-base leading-[1.7] opacity-70">
              {{ t("billing.billingGroup.childHeroSub") }}
            </div>
            <OButton
              variant="primary"
              class="h-11 px-6 font-semibold"
              data-test="org-group-child-view-usage-btn"
              @click="goToUsage"
            >
              {{ t("billing.billingGroup.viewUsage") }}
              <template #icon-right>
                <OIcon name="arrow-forward" size="sm" class="ml-1" />
              </template>
            </OButton>
          </div>

          <!-- Right: membership facts -->
          <div class="flex w-85 shrink-0 flex-col gap-3.5" data-test="org-group-child-details">
            <div
              class="og-feature rounded-default bg-surface-base border-card-glass-border flex items-start gap-4 border px-5 py-4.5 transition-all duration-200 hover:-translate-y-px hover:shadow-lg"
            >
              <div
                class="rounded-default text-primary-600 flex h-10 w-10 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)]"
              >
                <OIcon name="person-add" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-1 text-xs font-semibold opacity-60">
                  {{ t("billing.billingGroup.invitedBy") }}
                </div>
                <div class="truncate text-base font-semibold">
                  {{ membership?.created_by }}
                </div>
              </div>
            </div>
            <div
              class="og-feature rounded-default bg-surface-base border-card-glass-border flex items-start gap-4 border px-5 py-4.5 transition-all duration-200 hover:-translate-y-px hover:shadow-lg"
            >
              <div
                class="rounded-default text-primary-600 flex h-10 w-10 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)]"
              >
                <OIcon name="how-to-reg" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-1 text-xs font-semibold opacity-60">
                  {{ t("billing.billingGroup.acceptedBy") }}
                </div>
                <div class="truncate text-base font-semibold">
                  {{ membership?.accepted_by || t("billing.billingGroup.addedOnCreation") }}
                </div>
              </div>
            </div>
            <div
              class="og-feature rounded-default bg-surface-base border-card-glass-border flex items-start gap-4 border px-5 py-4.5 transition-all duration-200 hover:-translate-y-px hover:shadow-lg"
            >
              <div
                class="rounded-default text-primary-600 flex h-10 w-10 shrink-0 items-center justify-center bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)]"
              >
                <OIcon name="schedule" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-1 text-xs font-semibold opacity-60">
                  {{ t("billing.billingGroup.memberSince") }}
                </div>
                <div class="text-base font-semibold">
                  {{ formatDate(membership?.created_at) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- STANDALONE ORG VIEW — has pending invites: invites table -->
      <div
        v-else-if="receivedInvites.length > 0"
        class="flex min-h-0 flex-1 flex-col"
        data-test="org-group-standalone-invites-view"
      >
        <p class="mb-3 shrink-0">
          {{ t("billing.billingGroup.invitesPanelHint") }}
        </p>
        <div class="min-h-0 flex-1">
          <OTable
            :data="receivedInvites"
            :columns="inviteColumns"
            row-key="token"
            pagination="client"
            :page-size="10"
            :page-size-options="[10, 20, 50, 100]"
            :default-columns="false"
            class="h-full"
            data-test="org-group-invites-table"
          >
            <template #cell-inviter_id="{ row }">
              <OUserCell :value="row.inviter_id" />
            </template>
            <template #cell-actions="{ row }">
              <div class="flex justify-end gap-2 pr-3">
                <OButton
                  variant="primary"
                  size="sm"
                  :disabled="actioningToken === row.token"
                  :data-test="`org-group-accept-invite-${row.inviter_org_id}`"
                  @click="acceptInvite(row.token)"
                >
                  {{ t("billing.billingGroup.accept") }}
                </OButton>
                <OButton
                  variant="outline"
                  size="sm"
                  :disabled="actioningToken === row.token"
                  :data-test="`org-group-reject-invite-${row.inviter_org_id}`"
                  @click="rejectInvite(row.token)"
                >
                  {{ t("billing.billingGroup.reject") }}
                </OButton>
              </div>
            </template>
          </OTable>
        </div>
      </div>

      <!-- STANDALONE ORG VIEW — no invites: polished empty state -->
      <div
        v-else
        class="flex min-h-0 flex-1 flex-col overflow-auto"
        data-test="org-group-standalone-view"
      >
        <div
          class="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center"
          data-test="org-group-standalone-invite"
        >
          <div
            class="mb-7 flex h-25 w-25 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--color-primary-600)_30%,transparent)]"
          >
            <div
              class="flex h-17 w-17 items-center justify-center rounded-full border-[1.5px] border-solid border-[color-mix(in_srgb,var(--color-primary-600)_24%,transparent)] bg-[color-mix(in_srgb,var(--color-primary-600)_10%,transparent)]"
            >
              <OIcon name="group-add" size="lg" class="text-primary-600 opacity-85" />
            </div>
          </div>

          <div class="mb-2.5 text-xl font-bold tracking-[-0.2px]">
            {{
              allowedForBillingGroup
                ? t("billing.billingGroup.emptyTitle")
                : t("billing.billingGroup.notEnabledTitle")
            }}
          </div>
          <div class="mb-6 max-w-105 text-sm leading-[1.65] opacity-65">
            {{
              allowedForBillingGroup
                ? t("billing.billingGroup.inviteTabPrompt")
                : t("billing.billingGroup.notEnabledDesc")
            }}
          </div>

          <template v-if="allowedForBillingGroup">
            <div class="mb-8 flex flex-wrap items-center justify-center gap-2">
              <span
                class="border-card-glass-border inline-flex items-center gap-1.25 rounded-full border bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-3 py-1 text-xs font-medium opacity-85"
              >
                <OIcon name="receipt-long" size="xs" />
                {{ t("billing.billingGroup.chipConsolidatedBill") }}
              </span>
              <span
                class="border-card-glass-border inline-flex items-center gap-1.25 rounded-full border bg-[color-mix(in_srgb,currentColor_6%,transparent)] px-3 py-1 text-xs font-medium opacity-85"
              >
                <OIcon name="groups" size="xs" />
                {{ t("billing.billingGroup.chipLinkOrgs") }}
              </span>
            </div>

            <OButton
              variant="primary"
              class="h-10 px-6 font-semibold"
              data-test="org-group-standalone-invite-btn-empty"
              @click="showInviteDialog = true"
            >
              {{ t("billing.billingGroup.inviteOrgButton") }}
            </OButton>
          </template>
        </div>
      </div>
    </template>

    <!-- Invite side panel -->
    <ODrawer
      :open="showInviteDialog"
      :title="t('billing.billingGroup.inviteTitle')"
      :primary-button-label="t('billing.billingGroup.sendInvite')"
      :secondary-button-label="t('billing.billingGroup.cancel')"
      form-id="billing-group-invite-form"
      data-test="org-group-invite-dialog"
      @update:open="showInviteDialog = $event"
      @click:secondary="showInviteDialog = false"
    >
      <OForm
        id="billing-group-invite-form"
        :schema="billingGroupInviteSchema"
        :default-values="billingGroupInviteDefaults()"
        @submit="sendInvite"
      >
        <div class="p-4">
          <OFormInput
            name="inviteOrgId"
            class="showLabelOnTop mt-4"
            :label="t('billing.billingGroup.inviteOrgIdLabel')"
            :placeholder="t('billing.billingGroup.inviteOrgIdPlaceholder')"
            data-test="org-group-invite-input"
            required
            autofocus
          />
        </div>
      </OForm>
    </ODrawer>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, inject, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import BillingService from "@/services/billings";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import {
  makeBillingGroupInviteSchema,
  billingGroupInviteDefaults,
  type BillingGroupInviteForm,
} from "./BillingGroup.schema";

interface BillingGroupMember {
  id: number;
  payer_org_id: string;
  payer_org_name?: string;
  member_org_id: string;
  member_org_name?: string;
  created_at: number;
  created_by: string;
  accepted_by: string | null;
}

interface BillingGroupInvite {
  id: number;
  inviter_org_id: string;
  inviter_org_name?: string;
  invitee_org_id: string;
  invitee_org_name?: string;
  inviter_id: string;
  created_at: number;
  expires_at: number;
  status: string;
  token: string;
}

export default defineComponent({
  name: "BillingGroup",
  components: {
    OTag,
    OButton,
    OIcon,
    OForm,
    OFormInput,
    OSpinner,
    OTable,
    OUserCell,
    ODrawer,
    OTooltip,
    AppTabs,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const loading = ref(true);
    const membership = ref<BillingGroupMember | null>(null);
    const members = ref<BillingGroupMember[]>([]);
    const invites = ref<BillingGroupInvite[]>([]);
    const actioningToken = ref("");
    const showInviteDialog = ref(false);
    const superFilter = ref("all");

    const currentOrg = computed(() => store.state.selectedOrganization.identifier);

    // inviteOrgId is OForm-owned; the schema gates required + same-org.
    const billingGroupInviteSchema = makeBillingGroupInviteSchema(t, () => currentOrg.value);

    const goToUsage = () => {
      router.push({
        name: "usage",
        query: { org_identifier: currentOrg.value },
      });
    };

    const role = computed(() => {
      if (membership.value) return "child";
      // An org that has members OR has sent any invites is acting as a payer,
      // so it gets the management view.
      const hasSentInvites = invites.value.some((i) => i.inviter_org_id === currentOrg.value);
      if (members.value.length > 0 || hasSentInvites) return "super";
      return "standalone";
    });

    // Only orgs listed in billing_group_allowed_orgs (comma-separated, from
    // config) can act as a payer org and send invites.
    const allowedForBillingGroup = computed(() => {
      const allowed = (store.state.zoConfig?.billing_group_allowed_orgs || "")
        .split(",")
        .map((o: string) => o.trim())
        .filter(Boolean);
      return allowed.includes(currentOrg.value);
    });

    // Header-hosted "Invite Organization" button (rendered by Billing.vue)
    // communicates via this injected reactive object: we expose canInvite and
    // react to the click trigger to open the invite side panel.
    const headerInvite = inject<{
      trigger: number;
      canInvite: boolean;
    }>("orgGroupInvite", undefined as any);
    watch(
      () => headerInvite?.trigger,
      () => {
        showInviteDialog.value = true;
      },
    );

    const pendingSentInvites = computed(() =>
      invites.value.filter((i) => i.inviter_org_id === currentOrg.value && i.status === "Pending"),
    );
    const receivedInvites = computed(() =>
      invites.value
        .filter((i) => i.invitee_org_id === currentOrg.value && i.status === "Pending")
        .map((i, idx) => ({ ...i, index: idx + 1 })),
    );

    // Keep the header "Invite Organization" button in sync with this org's role
    // and whether the org is allowed to run a billing group.
    watch(
      [role, allowedForBillingGroup],
      ([r, allowed]) => {
        if (!headerInvite) return;
        headerInvite.canInvite = (r === "super" || r === "standalone") && allowed;
      },
      { immediate: true },
    );

    const formatDate = (epoch?: number) => {
      if (!epoch) return "-";
      return timestampToTimezoneDate(epoch, store.state.timezone || "UTC", "yyyy-MM-dd HH:mm");
    };

    const payerName = computed(() => {
      const name = membership.value?.payer_org_name || "";
      return name || membership.value?.payer_org_id || "";
    });

    // Super-org view: stats + unified child-org table
    const activeCount = computed(() => members.value.length);
    const pendingCount = computed(() => pendingSentInvites.value.length);
    const totalCount = computed(() => activeCount.value + pendingCount.value);

    interface SuperRow {
      key: string;
      index: number;
      org_id: string;
      org_name: string;
      status: "Active" | "Pending";
      invited_by: string;
      accepted_by: string;
      date: number;
    }

    const superRows = computed<SuperRow[]>(() => {
      const rows: SuperRow[] = [];
      members.value.forEach((m) =>
        rows.push({
          key: `m-${m.member_org_id}`,
          index: rows.length + 1,
          org_id: m.member_org_id,
          org_name: m.member_org_name || "",
          status: "Active",
          invited_by: m.created_by,
          accepted_by: m.accepted_by || t("billing.billingGroup.addedOnCreation"),
          date: m.created_at,
        }),
      );
      pendingSentInvites.value.forEach((i) =>
        rows.push({
          key: `p-${i.token}`,
          index: rows.length + 1,
          org_id: i.invitee_org_id,
          org_name: i.invitee_org_name || "",
          status: "Pending",
          invited_by: i.inviter_id,
          accepted_by: "-",
          date: i.created_at,
        }),
      );
      return rows;
    });

    const filteredSuperRows = computed(() =>
      superFilter.value === "all"
        ? superRows.value
        : superRows.value.filter((r) => r.status === superFilter.value),
    );

    const superFilterTabs = computed(() => [
      { label: t("billing.billingGroup.filterAll"), value: "all" },
      { label: t("billing.billingGroup.statusActive"), value: "Active" },
      { label: t("billing.billingGroup.statusPending"), value: "Pending" },
    ]);

    const inviteColumns = computed<OTableColumnDef[]>(() => [
      {
        id: "index",
        header: "#",
        accessorKey: "index",
        size: 56,
        meta: { align: "left" },
      },
      {
        id: "org_name",
        header: t("billing.billingGroup.orgColumn"),
        accessorFn: (row: BillingGroupInvite) => row.inviter_org_name || "-",
        size: COL.name,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "org_id",
        header: t("billing.billingGroup.orgIdColumn"),
        accessorKey: "inviter_org_id",
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "inviter_id",
        header: t("billing.billingGroup.invitedBy"),
        accessorKey: "inviter_id",
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "date",
        header: t("billing.billingGroup.dateColumn"),
        accessorFn: (row: BillingGroupInvite) => formatDate(row.created_at),
        size: COL.date,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("billing.billingGroup.actionsColumn"),
        accessorKey: "token",
        isAction: true,
        meta: { align: "center" },
      },
    ]);

    const superColumns = computed<OTableColumnDef[]>(() => [
      {
        id: "index",
        header: "#",
        accessorKey: "index",
        size: 56,
        meta: { align: "left" },
      },
      {
        id: "org_id",
        header: t("billing.billingGroup.childOrgIdColumn"),
        accessorKey: "org_id",
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "org_name",
        header: t("billing.billingGroup.childOrgNameColumn"),
        accessorFn: (row: SuperRow) => row.org_name || "-",
        size: COL.name,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "status",
        header: t("billing.status"),
        accessorKey: "status",
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "invited_by",
        header: t("billing.billingGroup.invitedBy"),
        accessorKey: "invited_by",
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "accepted_by",
        header: t("billing.billingGroup.acceptedBy"),
        accessorKey: "accepted_by",
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "date",
        header: t("billing.billingGroup.dateColumn"),
        accessorFn: (row: SuperRow) => formatDate(row.date),
        size: COL.date,
        meta: { align: "left" },
      },
    ]);

    const loadAll = async () => {
      loading.value = true;
      const org = currentOrg.value;
      try {
        const [membershipRes, membersRes, invitesRes] = await Promise.all([
          BillingService.get_billing_group_membership(org),
          BillingService.list_billing_group_members(org),
          BillingService.list_billing_group_invites(org),
        ]);
        membership.value = membershipRes.data?.membership ?? null;
        members.value = membersRes.data ?? [];
        invites.value = invitesRes.data ?? [];
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e.message,
          timeout: 5000,
        });
      } finally {
        loading.value = false;
      }
    };

    // @submit handler — the schema already gated the empty + same-org cases, so
    // there is no imperative guard here. Loading is form-driven (the ODrawer
    // footer Save auto-spins while OForm awaits this) and double-submit is
    // guarded by the form. The drawer body unmounts on close, so the next open
    // re-seeds a blank field via `:default-values` (no manual clear).
    const sendInvite = async (value: BillingGroupInviteForm) => {
      const target = value.inviteOrgId.trim();
      try {
        await BillingService.send_billing_group_invite(currentOrg.value, target);
        toast({
          variant: "success",
          message: t("billing.billingGroup.inviteSent"),
          timeout: 5000,
        });
        showInviteDialog.value = false;
        await loadAll();
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e.message,
          timeout: 5000,
        });
      }
    };

    const acceptInvite = async (token: string) => {
      if (actioningToken.value) return;
      actioningToken.value = token;
      try {
        await BillingService.accept_billing_group_invite(currentOrg.value, token);
        toast({
          variant: "success",
          message: t("billing.billingGroup.inviteAccepted"),
          timeout: 5000,
        });
        await loadAll();
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e.message,
          timeout: 5000,
        });
      } finally {
        actioningToken.value = "";
      }
    };

    const rejectInvite = async (token: string) => {
      if (actioningToken.value) return;
      actioningToken.value = token;
      try {
        await BillingService.reject_billing_group_invite(currentOrg.value, token);
        toast({
          variant: "success",
          message: t("billing.billingGroup.inviteRejected"),
          timeout: 5000,
        });
        await loadAll();
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e.message,
          timeout: 5000,
        });
      } finally {
        actioningToken.value = "";
      }
    };

    onMounted(loadAll);

    return {
      t,
      loading,
      role,
      membership,
      members,
      // Returned from setup() so the Options-API template resolves `:schema`.
      billingGroupInviteSchema,
      billingGroupInviteDefaults,
      actioningToken,
      showInviteDialog,
      superFilter,
      superFilterTabs,
      filteredSuperRows,
      superColumns,
      activeCount,
      pendingCount,
      totalCount,
      goToUsage,
      receivedInvites,
      inviteColumns,
      allowedForBillingGroup,
      formatDate,
      payerName,
      sendInvite,
      acceptInvite,
      rejectInvite,
    };
  },
});
</script>
