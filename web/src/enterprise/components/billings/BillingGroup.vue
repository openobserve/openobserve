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
    class="q-px-lg q-pt-md tw:h-full tw:flex tw:flex-col tw:overflow-hidden"
    data-test="organization-group-page"
  >
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-10">
      <q-spinner-dots color="primary" size="40px" />
    </div>

    <template v-else>
      <!-- SUPER / PAYER ORG VIEW -->
      <div
        v-if="role === 'super'"
        class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0"
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
              <q-icon name="arrow_forward" size="16px" class="tw:ml-1" />
            </template>
          </OButton>
        </div>

        <!-- Child orgs table (children only) -->
        <div class="tw:flex-1 tw:min-h-0">
          <q-table
            ref="qTable"
            :rows="filteredSuperRows"
            :columns="superColumns"
            row-key="key"
            flat
            dense
            :pagination="pagination"
            class="org-group-table o2-quasar-table o2-row-md o2-quasar-table-header-sticky tw:h-full"
            data-test="org-group-members-table"
          >
            <template #no-data>
              <div class="full-width tw:py-4 tw:text-center o2-page-subtitle">
                {{ t("billing.billingGroup.noMembers") }}
              </div>
            </template>
            <template #body-cell-index="props">
              <q-td :props="props">{{ props.rowIndex + 1 }}</q-td>
            </template>
            <template #body-cell-status="props">
              <q-td :props="props">
                <q-badge
                  :color="statusColor(props.row.status)"
                  :label="statusLabel(props.row.status)"
                />
              </q-td>
            </template>
            <template #bottom="scope">
              <div
                class="tw:flex tw:items-center tw:justify-end tw:w-full tw:h-[48px]"
              >
                <QTablePagination
                  :scope="scope"
                  :resultTotal="resultTotal"
                  :perPageOptions="perPageOptions"
                  position="bottom"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </template>
          </q-table>
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
              <q-icon name="verified" size="14px" />
              {{ t("billing.billingGroup.statusActive") }}
            </div>
            <div class="og-hero__headline">
              {{ t("billing.billingGroup.childHeadline") }}
              <span class="og-hero__brand">
                {{ payerName }}
                <q-tooltip
                  anchor="bottom middle"
                  self="top middle"
                  class="tw:text-sm"
                >
                  <div v-if="membership?.payer_org_name">
                    {{ membership.payer_org_name }}
                  </div>
                  <div class="tw:text-xs tw:opacity-70">
                    {{ membership?.payer_org_id }}
                  </div>
                </q-tooltip>
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
                <q-icon name="arrow_forward" size="16px" class="tw:ml-1" />
              </template>
            </OButton>
          </div>

          <!-- Right: membership facts -->
          <div class="og-hero__right" data-test="org-group-child-details">
            <div class="og-feature">
              <div class="og-feature__icon">
                <q-icon name="person_add" size="20px" />
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
                <q-icon name="how_to_reg" size="20px" />
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
                <q-icon name="schedule" size="20px" />
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
        <div class="o2-page-subtitle tw:mb-3 tw:shrink-0">
          {{ t("billing.billingGroup.invitesPanelHint") }}
        </div>
        <div class="tw:flex-1 tw:min-h-0">
          <q-table
            ref="qTable"
            :rows="receivedInvites"
            :columns="inviteColumns"
            row-key="token"
            flat
            dense
            :pagination="pagination"
            class="org-group-table o2-quasar-table o2-row-md o2-quasar-table-header-sticky tw:h-full"
            data-test="org-group-invites-table"
          >
            <template #body-cell-index="props">
              <q-td :props="props">{{ props.rowIndex + 1 }}</q-td>
            </template>
            <template #body-cell-actions="props">
              <q-td :props="props" class="tw:text-right tw:pr-3">
                <OButton
                  variant="primary"
                  size="xs"
                  class="q-mr-sm"
                  :disabled="actioningToken === props.row.token"
                  :data-test="`org-group-accept-invite-${props.row.inviter_org_id}`"
                  @click="acceptInvite(props.row.token)"
                >
                  {{ t("billing.billingGroup.accept") }}
                </OButton>
                <OButton
                  variant="outline"
                  size="xs"
                  :disabled="actioningToken === props.row.token"
                  :data-test="`org-group-reject-invite-${props.row.inviter_org_id}`"
                  @click="rejectInvite(props.row.token)"
                >
                  {{ t("billing.billingGroup.reject") }}
                </OButton>
              </q-td>
            </template>
            <template #bottom="scope">
              <div
                class="tw:flex tw:items-center tw:justify-end tw:w-full tw:h-[48px]"
              >
                <QTablePagination
                  :scope="scope"
                  :resultTotal="receivedInvites.length"
                  :perPageOptions="perPageOptions"
                  position="bottom"
                  @update:changeRecordPerPage="changePagination"
                />
              </div>
            </template>
          </q-table>
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
              <q-icon name="group_add" size="28px" class="og-empty__icon" />
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
                <q-icon name="receipt_long" size="13px" />
                {{ t("billing.billingGroup.chipConsolidatedBill") }}
              </span>
              <span class="og-empty__chip">
                <q-icon name="groups" size="13px" />
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
    <q-dialog
      v-model="showInviteDialog"
      position="right"
      full-height
      maximized
    >
      <q-card
        class="o2-side-dialog column full-height"
        data-test="org-group-invite-dialog"
      >
        <q-card-section class="q-py-md tw:w-full">
          <div class="row items-center no-wrap q-py-sm">
            <div class="col">
              <div class="tw:text-[18px] tw:font-semibold">
                {{ t("billing.billingGroup.inviteTitle") }}
              </div>
            </div>
            <div class="col-auto">
              <q-icon
                data-test="org-group-invite-close-btn"
                name="cancel"
                class="cursor-pointer"
                size="20px"
                @click="showInviteDialog = false"
              />
            </div>
          </div>

          <q-separator />

          <q-input
            v-model.trim="inviteOrgId"
            class="showLabelOnTop tw:mt-4"
            dense
            borderless
            bg-color="input-bg"
            color="input-border"
            stack-label
            hide-bottom-space
            autofocus
            :label="t('billing.billingGroup.inviteOrgIdLabel')"
            :placeholder="t('billing.billingGroup.inviteOrgIdPlaceholder')"
            data-test="org-group-invite-input"
            @keyup.enter="sendInvite"
          />
          <div class="flex justify-start tw:mt-6 tw:gap-2">
            <OButton
              variant="outline"
              size="sm-action"
              data-test="org-group-invite-cancel-btn"
              @click="showInviteDialog = false"
            >
              {{ t("billing.billingGroup.cancel") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm-action"
              :disabled="!inviteOrgId || sending"
              data-test="org-group-send-invite-btn"
              @click="sendInvite"
            >
              {{ t("billing.billingGroup.sendInvite") }}
            </OButton>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
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
import { useQuasar } from "quasar";
import type { QTableProps } from "quasar";
import BillingService from "@/services/billings";
import OButton from "@/lib/core/Button/OButton.vue";
import AppTabs from "@/components/common/AppTabs.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
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
  components: { OButton, AppTabs, QTablePagination },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const $q = useQuasar();

    const loading = ref(true);
    const membership = ref<BillingGroupMember | null>(null);
    const members = ref<BillingGroupMember[]>([]);
    const invites = ref<BillingGroupInvite[]>([]);
    const inviteOrgId = ref("");
    const sending = ref(false);
    const actioningToken = ref("");
    const showInviteDialog = ref(false);
    const superFilter = ref("all");
    const qTable = ref<any>(null);
    const pagination = ref({ rowsPerPage: 10 });
    const perPageOptions = [
      { label: "10", value: 10 },
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
    ];

    const currentOrg = computed(
      () => store.state.selectedOrganization.identifier
    );
    const changePagination = (val: { label: string; value: number }) => {
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
    };

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
      invites.value.filter(
        (i) => i.invitee_org_id === currentOrg.value && i.status === "Pending"
      )
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

    // Child view headline: show the payer org name (truncated to 10 chars),
    // falling back to the identifier when no name is returned.
    const payerName = computed(() => {
      const name = membership.value?.payer_org_name || "";
      if (!name) return membership.value?.payer_org_id || "";
      return name.length > 100 ? `${name.substring(0, 100)}...` : name;
    });


    // Super-org view: stats + unified child-org table
    const activeCount = computed(() => members.value.length);
    const pendingCount = computed(() => pendingSentInvites.value.length);
    const totalCount = computed(
      () => activeCount.value + pendingCount.value
    );

    interface SuperRow {
      key: string;
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
    const resultTotal = computed(() => filteredSuperRows.value.length);

    const superFilterTabs = computed(() => [
      { label: t("billing.billingGroup.filterAll"), value: "all" },
      { label: t("billing.billingGroup.statusActive"), value: "Active" },
      { label: t("billing.billingGroup.statusPending"), value: "Pending" },
    ]);

    const statusColor = (status: string) =>
      status === "Active" ? "positive" : "warning";

    const statusLabel = (status: string) =>
      status === "Active"
        ? t("billing.billingGroup.statusActive")
        : t("billing.billingGroup.statusPending");

    const inviteColumns = computed<QTableProps["columns"]>(() => [
      {
        name: "index",
        field: "index",
        label: "#",
        align: "left",
        style: "width: 56px",
        headerStyle: "width: 56px",
      },
      {
        name: "org_name",
        field: (row: BillingGroupInvite) => row.inviter_org_name || "-",
        label: t("billing.billingGroup.orgColumn"),
        align: "left",
      },
      {
        name: "org_id",
        field: "inviter_org_id",
        label: t("billing.billingGroup.orgIdColumn"),
        align: "left",
      },
      {
        name: "inviter_id",
        field: "inviter_id",
        label: t("billing.billingGroup.invitedBy"),
        align: "left",
      },
      {
        name: "date",
        field: (row: BillingGroupInvite) => formatDate(row.created_at),
        label: t("billing.billingGroup.dateColumn"),
        align: "left",
      },
      {
        name: "actions",
        field: "actions",
        label: t("billing.billingGroup.actionsColumn"),
        align: "center",
      },
    ]);

    const superColumns = computed<QTableProps["columns"]>(() => [
      {
        name: "index",
        field: "index",
        label: "#",
        align: "left",
        style: "width: 56px",
        headerStyle: "width: 56px",
      },
      {
        name: "org_id",
        field: "org_id",
        label: t("billing.billingGroup.childOrgIdColumn"),
        align: "left",
      },
      {
        name: "org_name",
        field: (row: SuperRow) => row.org_name || "-",
        label: t("billing.billingGroup.childOrgNameColumn"),
        align: "left",
      },
      {
        name: "status",
        field: "status",
        label: t("billing.status"),
        align: "left",
      },
      {
        name: "invited_by",
        field: "invited_by",
        label: t("billing.billingGroup.invitedBy"),
        align: "left",
      },
      {
        name: "accepted_by",
        field: "accepted_by",
        label: t("billing.billingGroup.acceptedBy"),
        align: "left",
      },
      {
        name: "date",
        field: (row: SuperRow) => formatDate(row.date),
        label: t("billing.billingGroup.dateColumn"),
        align: "left",
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
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "negative",
          message: t("billing.billingGroup.inviteSameOrg"),
          timeout: 5000,
        });
        return;
      }
      sending.value = true;
      try {
        await BillingService.send_billing_group_invite(currentOrg.value, target);
        $q.notify({
          type: "positive",
          message: t("billing.billingGroup.inviteSent"),
          timeout: 5000,
        });
        inviteOrgId.value = "";
        showInviteDialog.value = false;
        await loadAll();
      } catch (e: any) {
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "positive",
          message: t("billing.billingGroup.inviteAccepted"),
          timeout: 5000,
        });
        await loadAll();
      } catch (e: any) {
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "positive",
          message: t("billing.billingGroup.inviteRejected"),
          timeout: 5000,
        });
        await loadAll();
      } catch (e: any) {
        $q.notify({
          type: "negative",
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
      statusColor,
      statusLabel,
      qTable,
      pagination,
      perPageOptions,
      resultTotal,
      changePagination,
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
    border: 1px dashed color-mix(in srgb, var(--q-primary) 30%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;
  }
  &__icon-inner {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--q-primary) 10%, transparent);
    border: 1.5px solid color-mix(in srgb, var(--q-primary) 24%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  &__icon {
    color: var(--q-primary);
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
.org-group-table {
  display: flex;
  flex-direction: column;

  :deep(.q-table__middle) {
    flex: 1 1 0;
    overflow: auto;
  }
  :deep(.q-table__bottom) {
    position: sticky;
    bottom: 0;
    background: inherit;
    min-height: 48px;
    padding: 0 8px;
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
    flex: 2;
    min-width: 280px;
    max-width: 640px;
  }
  &__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: var(--q-primary);
    background: color-mix(in srgb, var(--q-primary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--q-primary) 25%, transparent);
    padding: 4px 10px;
    border-radius: 20px;
    margin-bottom: 20px;
  }
  &__headline {
    font-size: 2.4rem;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: -0.6px;
    margin-bottom: 16px;
  }
  &__brand {
    color: var(--q-primary);
    word-break: break-word;
    cursor: pointer;
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
    background: color-mix(in srgb, var(--q-primary) 10%, transparent);
    color: var(--q-primary);
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
