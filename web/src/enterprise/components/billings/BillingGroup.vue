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
    class="tw:px-6 tw:pt-4 tw:h-full tw:flex tw:flex-col tw:overflow-hidden"
    data-test="organization-group-page"
  >
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-10">
      <OSpinner size="md" />
    </div>

    <template v-else>
      <!-- SUPER / PAYER ORG VIEW -->
      <div
        v-if="role === 'super'"
        class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden"
        data-test="org-group-super-view"
      >
        <!-- Stat cards -->
        <div
          class="tw:flex tw:gap-4 tw:mb-5 tw:shrink-0"
          data-test="org-group-stats"
        >
          <div class="feature-card tw:flex-1">
            <div class="stat-card-title">
              {{ t("billing.billingGroup.statTotal") }}
            </div>
            <div class="stat-card-value">{{ totalCount }}</div>
          </div>
          <div class="feature-card tw:flex-1">
            <div class="stat-card-title">
              {{ t("billing.billingGroup.statActive") }}
            </div>
            <div class="stat-card-value tw:text-green-600">{{ activeCount }}</div>
          </div>
          <div class="feature-card tw:flex-1">
            <div class="stat-card-title">
              {{ t("billing.billingGroup.statPending") }}
            </div>
            <div class="stat-card-value tw:text-amber-500">
              {{ pendingCount }}
            </div>
          </div>
        </div>

        <!-- Status filter + view usage -->
        <div
          class="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:mb-3 tw:shrink-0"
        >
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
              <OIcon name="arrow-forward" size="sm" class="tw:ml-1" />
            </template>
          </OButton>
        </div>

        <!-- Child orgs table (children only) -->
        <div class="tw:flex-1 tw:min-h-0">
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
              <div class="tw:py-4 tw:text-center">
                {{ t("billing.billingGroup.noMembers") }}
              </div>
            </template>
            <template #cell-status="{ row }">
              <OBadge :variant="statusVariant(row.status)">
                {{ statusLabel(row.status) }}
              </OBadge>
            </template>
          </OTable>
        </div>
      </div>

      <!-- CHILD ORG VIEW -->
      <div
        v-else-if="role === 'child'"
        class="tw:flex-1 tw:min-h-0 tw:overflow-auto tw:flex tw:flex-col tw:justify-center"
        data-test="org-group-child-view"
      >
        <div class="og-hero">
          <!-- Left: headline + CTA -->
          <div class="og-hero__left">
            <div class="og-hero__eyebrow">
              <OIcon name="verified" size="xs" />
              {{ t("billing.billingGroup.statusActive") }}
            </div>
            <div class="og-hero__headline">
              {{ t("billing.billingGroup.childHeadline") }}
              <span class="og-hero__brand">
                {{ payerName }}
                <OTooltip side="bottom">
                  <template #content>
                    <div v-if="membership?.payer_org_name" class="tw:break-all">
                      {{ membership.payer_org_name }}
                    </div>
                    <div class="tw:text-xs tw:opacity-70 tw:break-all">
                      {{ membership?.payer_org_id }}
                    </div>
                  </template>
                </OTooltip>
              </span>
            </div>
            <div class="og-hero__sub">
              {{ t("billing.billingGroup.childHeroSub") }}
            </div>
            <OButton
              variant="primary"
              class="og-hero__cta"
              data-test="org-group-child-view-usage-btn"
              @click="goToUsage"
            >
              {{ t("billing.billingGroup.viewUsage") }}
              <template #icon-right>
                <OIcon name="arrow-forward" size="sm" class="tw:ml-1" />
              </template>
            </OButton>
          </div>

          <!-- Right: membership facts -->
          <div class="og-hero__right" data-test="org-group-child-details">
            <div class="og-feature">
              <div class="og-feature__icon">
                <OIcon name="person-add" />
              </div>
              <div class="og-feature__content">
                <div class="og-feature__title">
                  {{ t("billing.billingGroup.invitedBy") }}
                </div>
                <div class="og-feature__desc tw:truncate">
                  {{ membership?.created_by }}
                </div>
              </div>
            </div>
            <div class="og-feature">
              <div class="og-feature__icon">
                <OIcon name="how-to-reg" />
              </div>
              <div class="og-feature__content">
                <div class="og-feature__title">
                  {{ t("billing.billingGroup.acceptedBy") }}
                </div>
                <div class="og-feature__desc tw:truncate">
                  {{
                    membership?.accepted_by ||
                    t("billing.billingGroup.addedOnCreation")
                  }}
                </div>
              </div>
            </div>
            <div class="og-feature">
              <div class="og-feature__icon">
                <OIcon name="schedule" />
              </div>
              <div class="og-feature__content">
                <div class="og-feature__title">
                  {{ t("billing.billingGroup.memberSince") }}
                </div>
                <div class="og-feature__desc">
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
        class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0"
        data-test="org-group-standalone-invites-view"
      >
        <p class="tw:mb-3 tw:shrink-0">
          {{ t("billing.billingGroup.invitesPanelHint") }}
        </p>
        <div class="tw:flex-1 tw:min-h-0">
          <OTable
            :data="receivedInvites"
            :columns="inviteColumns"
            row-key="token"
            pagination="client"
            :page-size="10"
            :page-size-options="[10, 20, 50, 100]"
            :default-columns="false"
            class="tw:h-full"
            data-test="org-group-invites-table"
          >
            <template #cell-actions="{ row }">
              <div class="tw:flex tw:justify-end tw:pr-3 tw:gap-2">
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
        class="tw:flex-1 tw:min-h-0 tw:overflow-auto tw:flex tw:flex-col"
        data-test="org-group-standalone-view"
      >
        <div
          class="og-empty"
          data-test="org-group-standalone-invite"
        >
          <div class="og-empty__icon-outer">
            <div class="og-empty__icon-inner">
              <OIcon name="group-add" size="lg" class="og-empty__icon" />
            </div>
          </div>

          <div class="og-empty__title">
            {{
              allowedForBillingGroup
                ? t("billing.billingGroup.emptyTitle")
                : t("billing.billingGroup.notEnabledTitle")
            }}
          </div>
          <div class="og-empty__desc">
            {{
              allowedForBillingGroup
                ? t("billing.billingGroup.inviteTabPrompt")
                : t("billing.billingGroup.notEnabledDesc")
            }}
          </div>

          <template v-if="allowedForBillingGroup">
            <div class="og-empty__chips">
              <span class="og-empty__chip">
                <OIcon name="receipt-long" size="xs" />
                {{ t("billing.billingGroup.chipConsolidatedBill") }}
              </span>
              <span class="og-empty__chip">
                <OIcon name="groups" size="xs" />
                {{ t("billing.billingGroup.chipLinkOrgs") }}
              </span>
            </div>

            <OButton
              variant="primary"
              class="og-empty__btn"
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
      :primary-button-disabled="!inviteOrgId || sending"
      data-test="org-group-invite-dialog"
      @update:open="showInviteDialog = $event"
      @click:primary="sendInvite"
      @click:secondary="showInviteDialog = false"
    >
      <div class="tw:p-4">
        <OInput
          v-model="inviteOrgId"
          class="showLabelOnTop tw:mt-4"
          :label="t('billing.billingGroup.inviteOrgIdLabel')"
          :placeholder="t('billing.billingGroup.inviteOrgIdPlaceholder')"
          data-test="org-group-invite-input"
          autofocus
          @keyup.enter="sendInvite"
        />
      </div>
    </ODrawer>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  onMounted,
  inject,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import BillingService from "@/services/billings";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { timestampToTimezoneDate } from "@/utils/zincutils";

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
  components: { OBadge, OButton, OIcon, OInput, OSpinner, OTable, ODrawer, OTooltip, AppTabs },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const loading = ref(true);
    const membership = ref<BillingGroupMember | null>(null);
    const members = ref<BillingGroupMember[]>([]);
    const invites = ref<BillingGroupInvite[]>([]);
    const inviteOrgId = ref("");
    const sending = ref(false);
    const actioningToken = ref("");
    const showInviteDialog = ref(false);
    const superFilter = ref("all");

    const currentOrg = computed(
      () => store.state.selectedOrganization.identifier
    );

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
      const hasSentInvites = invites.value.some(
        (i) => i.inviter_org_id === currentOrg.value
      );
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
      }
    );

    const pendingSentInvites = computed(() =>
      invites.value.filter(
        (i) => i.inviter_org_id === currentOrg.value && i.status === "Pending"
      )
    );
    const receivedInvites = computed(() =>
      invites.value
        .filter((i) => i.invitee_org_id === currentOrg.value && i.status === "Pending")
        .map((i, idx) => ({ ...i, index: idx + 1 }))
    );

    // Keep the header "Invite Organization" button in sync with this org's role
    // and whether the org is allowed to run a billing group.
    watch(
      [role, allowedForBillingGroup],
      ([r, allowed]) => {
        if (!headerInvite) return;
        headerInvite.canInvite =
          (r === "super" || r === "standalone") && allowed;
      },
      { immediate: true }
    );

    const formatDate = (epoch?: number) => {
      if (!epoch) return "-";
      return timestampToTimezoneDate(
        epoch,
        store.state.timezone || "UTC",
        "yyyy-MM-dd HH:mm"
      );
    };

    const payerName = computed(() => {
      const name = membership.value?.payer_org_name || "";
      return name || membership.value?.payer_org_id || "";
    });


    // Super-org view: stats + unified child-org table
    const activeCount = computed(() => members.value.length);
    const pendingCount = computed(() => pendingSentInvites.value.length);
    const totalCount = computed(
      () => activeCount.value + pendingCount.value
    );

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
          accepted_by:
            m.accepted_by || t("billing.billingGroup.addedOnCreation"),
          date: m.created_at,
        })
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
        })
      );
      return rows;
    });

    const filteredSuperRows = computed(() =>
      superFilter.value === "all"
        ? superRows.value
        : superRows.value.filter((r) => r.status === superFilter.value)
    );

    const superFilterTabs = computed(() => [
      { label: t("billing.billingGroup.filterAll"), value: "all" },
      { label: t("billing.billingGroup.statusActive"), value: "Active" },
      { label: t("billing.billingGroup.statusPending"), value: "Pending" },
    ]);

    const statusVariant = (status: string): "success" | "warning" =>
      status === "Active" ? "success" : "warning";

    const statusLabel = (status: string) =>
      status === "Active"
        ? t("billing.billingGroup.statusActive")
        : t("billing.billingGroup.statusPending");

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

    const sendInvite = async () => {
      const target = inviteOrgId.value.trim();
      if (!target || sending.value) return;
      if (target === currentOrg.value) {
        toast({
          variant: "error",
          message: t("billing.billingGroup.inviteSameOrg"),
          timeout: 5000,
        });
        return;
      }
      sending.value = true;
      try {
        await BillingService.send_billing_group_invite(currentOrg.value, target);
        toast({
          variant: "success",
          message: t("billing.billingGroup.inviteSent"),
          timeout: 5000,
        });
        inviteOrgId.value = "";
        showInviteDialog.value = false;
        await loadAll();
      } catch (e: any) {
        toast({
          variant: "error",
          message: e?.response?.data?.message || e.message,
          timeout: 5000,
        });
      } finally {
        sending.value = false;
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
      inviteOrgId,
      sending,
      actioningToken,
      showInviteDialog,
      superFilter,
      superFilterTabs,
      filteredSuperRows,
      superColumns,
      activeCount,
      pendingCount,
      totalCount,
      statusVariant,
      statusLabel,
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

<style scoped lang="scss">
.og-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 100%;
  padding: 48px 24px;

  &__icon-outer {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 1px dashed color-mix(in srgb, var(--color-primary-600) 30%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;
  }
  &__icon-inner {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-primary-600) 10%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--color-primary-600) 24%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  &__icon {
    color: var(--color-primary-600);
    opacity: 0.85;
  }
  &__title {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: -0.2px;
    margin-bottom: 10px;
  }
  &__desc {
    font-size: 0.88rem;
    line-height: 1.65;
    opacity: 0.65;
    max-width: 420px;
    margin-bottom: 24px;
  }
  &__chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    margin-bottom: 32px;
  }
  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-weight: 500;
    opacity: 0.85;
    background: color-mix(in srgb, currentColor 6%, transparent);
    border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.1));
    border-radius: 20px;
    padding: 4px 12px;
  }
  &__btn {
    height: 40px;
    padding: 0 24px;
    font-weight: 600;
  }
}
.stat-card-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  opacity: 0.85;
  white-space: nowrap;
}
.stat-card-value {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 6px;
}
.og-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 56px;
  padding: 48px 40px;
  flex-wrap: wrap;

  &__left {
    flex: 1;
    min-width: 280px;
    max-width: 480px;
  }
  &__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: var(--color-primary-600);
    background: color-mix(in srgb, var(--color-primary-600) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary-600) 25%, transparent);
    padding: 4px 10px;
    border-radius: 20px;
    margin-bottom: 20px;
  }
  &__headline {
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.6px;
    margin-bottom: 16px;
  }
  &__brand {
    color: var(--color-tabs-active-text);
    cursor: pointer;
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
  &__sub {
    font-size: 0.95rem;
    line-height: 1.7;
    opacity: 0.7;
    margin-bottom: 32px;
    max-width: 420px;
  }
  &__right {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
}
.og-hero__cta {
  height: 44px;
  padding: 0 24px;
  font-weight: 600;
}
.og-feature {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 16px;
  background: var(--tile-bg);
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
  transition: box-shadow 0.2s ease, transform 0.2s ease;

  &:hover {
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
    transform: translateY(-1px);
  }
  &__icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-primary-600) 10%, transparent);
    color: var(--color-primary-600);
  }
  &__content {
    flex: 1;
    min-width: 0;
  }
  &__title {
    font-size: 0.78rem;
    font-weight: 600;
    opacity: 0.6;
    margin-bottom: 4px;
  }
  &__desc {
    font-size: 0.95rem;
    font-weight: 600;
  }
}
</style>
