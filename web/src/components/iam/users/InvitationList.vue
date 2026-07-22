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
  <OPageLayout
      :title="t('invitation.pendingInvitations')"
      :subtitle="t('iam.invitationList.subtitle')"
      icon="mail" bleed>
    <div class="w-full flex-1 min-h-0 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <OTable
          :data="invitations"
          :columns="columns"
          row-key="token"
          :loading="loading"
          v-model:global-filter="filterQuery"
          :show-global-filter="false"
          pagination="client"
          :page-size="20"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          show-index
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="iam-invitations-list"
        >
          <template #toolbar>
            <div class="flex items-center gap-2 w-full">
              <OSearchInput
                v-model="filterQuery"
                :placeholder="t('invitation.search')"
                data-test="invitation-list-search-input"
                class="flex-1"
              />
            </div>
          </template>
          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="invitation-list-refresh-btn"
              @click="fetchPendingInvitations"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="iamInvitationsRefresh" />
            </OButton>
          </template>
          <template #empty>
            <OEmptyState
              size="hero"
              preset="no-invitations"
              :filtered="!!filterQuery"
              :hide-action="!filterQuery"
              @action="(id) => id === 'clear-filters' && (filterQuery = '')"
            />
          </template>
          <template #cell-role="{ row }">
            <OTag v-if="row.role" type="userRole" :value="row.role" />
            <span v-else class="text-text-muted">—</span>
          </template>
          <template #cell-inviter_id="{ row }">
            <OUserCell :value="row.inviter_id" />
          </template>
          <template #cell-expiry="{ row }">
            <OTimeCell
              :value="row.expires_at"
              unit="us"
              :timezone="store.state.timezone"
              empty-label="—"
            />
          </template>
          <template #cell-actions="{ row }">
            <div class="flex items-center gap-2">
              <OButton
                variant="primary"
                size="sm"
                @click="acceptInvitation(row)"
                :data-test="`accept-invitation-${row.token}`"
              >
                {{ t('invitation.accept') }}
              </OButton>
              <OButton
                variant="secondary"
                size="sm"
                @click="rejectInvitation(row)"
                :data-test="`reject-invitation-${row.token}`"
              >
                {{ t('invitation.reject') }}
              </OButton>
            </div>
          </template>
          <template #bottom>
            <span class="text-xs font-normal">
              {{ resultTotal }} {{ t('invitation.pendingInvitations') }}
            </span>
          </template>
        </OTable>
      </div>
    </div>

    <ODialog data-test="invitation-list-accept-dialog"
      v-model:open="confirmAccept"
      size="xs"
      :title="t('invitation.confirmAcceptHead')"
      :secondary-button-label="t('invitation.cancel')"
      :primary-button-label="t('invitation.accept')"
      @click:secondary="confirmAccept = false"
      @click:primary="confirmAcceptInvitation"
    >
      <p>{{ t('invitation.confirmAcceptMsg', { org: selectedInvitation?.org_name }) }}</p>
    </ODialog>

    <ODialog data-test="invitation-list-reject-dialog"
      v-model:open="confirmReject"
      size="xs"
      :title="t('invitation.confirmRejectHead')"
      :secondary-button-label="t('invitation.cancel')"
      :primary-button-label="t('invitation.reject')"
      @click:secondary="confirmReject = false"
      @click:primary="confirmRejectInvitation"
    >
      <p>{{ t('invitation.confirmRejectMsg', { org: selectedInvitation?.org_name }) }}</p>
    </ODialog>
  </OPageLayout>
</template>

<script lang="ts">

import { defineComponent, ref, onMounted } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";

// Pending invitation row shape returned by GET /api/invites, enriched locally
// with the row index (`#`) and a formatted `expiry` label.
interface PendingInvitation {
  "#": string | number;
  token: string;
  org_id: string;
  org_name: string;
  role: string;
  inviter_id: string;
  expires_at: number;
  expiry: string;
}

export default defineComponent({
  name: "InvitationList",
  components: {
    OPageLayout,
    OEmptyState,
    OButton,
    OTooltip,
    OTag,
    OTimeCell,
    OUserCell,
    ODialog,
    OTable,
    OSearchInput,
  },
  props: {
    userEmail: {
      type: String,
      required: true,
    },
  },
  emits: ["invitations-processed"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const invitations = ref<PendingInvitation[]>([]);
    const filterQuery = ref("");
    const confirmAccept = ref(false);
    const confirmReject = ref(false);
    const selectedInvitation = ref<PendingInvitation | null>(null);

    const columns: OTableColumnDef[] = [
      {
        id: "org_name",
        header: t("invitation.organizationName"),
        accessorKey: "org_name",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "role",
        header: t("invitation.role"),
        accessorKey: "role",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.role,
        meta: { align: "left" },
      },
      {
        id: "inviter_id",
        header: t("invitation.invitedBy"),
        accessorKey: "inviter_id",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "expiry",
        header: t("invitation.expiry"),
        accessorKey: "expiry",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.duration,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("invitation.actions"),
        isAction: true,
        pinned: "right",
        size: 180,
        minSize: 140,
        maxSize: 220,
        meta: { align: "center", actionCount: 2, actionSize: "pill" },
      },
    ];
    const resultTotal = ref<number>(0);
    const loading = ref(false);

    onMounted(() => {
      fetchPendingInvitations();
    });

    const fetchPendingInvitations = async () => {
      const dismiss = toast({
        variant: "loading",
        message: t("iam.invitationList.loadingPending"),
              timeout: 0,
});

      loading.value = true;
      try {
        const response = await usersService.getPendingInvites();

        invitations.value = response.data.data.map((invitation: any) => ({
          ...invitation,
          expiry: formatExpiry(invitation.expires_at),
        }));
        resultTotal.value = response.data.data.length;
        dismiss();
      } catch (error) {
        const e = error as { response?: { data?: { message?: string } } };
        dismiss();
        toast({
          message:
            e.response?.data?.message ||
            t("iam.invitationList.failedLoadPending"),
          variant: "error",
        });
      } finally {
        loading.value = false;
      }
    };

    const formatExpiry = (expiryMicroseconds: number) => {
      // Convert microseconds to milliseconds for Date constructor
      try {
        const expiry = new Date(expiryMicroseconds / 1000);
        const now = new Date();
        const daysLeft = Math.ceil(
          (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysLeft < 0) {
          return t("invitation.expired");
        } else if (daysLeft === 0) {
          return t("invitation.expiresToday");
        } else {
          return t("invitation.daysLeft", { days: daysLeft });
        }
      } catch {
        return t("invitation.expired");
      }
    };

    const acceptInvitation = (invitation: any) => {
      selectedInvitation.value = invitation;
      confirmAccept.value = true;
    };

    const rejectInvitation = (invitation: any) => {
      selectedInvitation.value = invitation;
      confirmReject.value = true;
    };

    const confirmAcceptInvitation = async () => {
      const selected = selectedInvitation.value;
      if (!selected) return;
      confirmAccept.value = false;

      const dismiss = toast({
        variant: "loading",
        message: t("iam.invitationList.accepting"),
              timeout: 0,
});

      try {
        await organizationsService.process_subscription(
          selected.token,
          "confirm",
          selected.org_id,
        );

        // Refresh the organizations list in the store
        const orgResponse = await organizationsService.list(0, 1000000, "name", false, "");
        store.dispatch("setOrganizations", orgResponse.data.data);

        dismiss();
        toast({
          message: t("iam.invitationList.acceptedSuccess"),
          variant: "success",
        });

        // Set the selected organization and redirect
        const orgData = {
          identifier: selected.org_id,
          name: selected.org_name,
        };

        store.dispatch("setSelectedOrganization", orgData);
        emit("invitations-processed", {
          accepted: true,
          organization: orgData,
        });
      } catch (error) {
        const e = error as { response?: { data?: { message?: string } } };
        dismiss();
        toast({
          message:
            e.response?.data?.message || t("iam.invitationList.failedAccept"),
          variant: "error",
        });
      }
    };

    const confirmRejectInvitation = async () => {
      const selected = selectedInvitation.value;
      if (!selected) return;
      confirmReject.value = false;

      const dismiss = toast({
        variant: "loading",
        message: t("iam.invitationList.rejecting"),
              timeout: 0,
});

      try {
        await organizationsService.decline_subscription(
          selected.token,
        );
        dismiss();
        toast({
          message: t("iam.invitationList.rejectedSuccess"),
          variant: "success",
        });

        // Remove from list
        invitations.value = invitations.value.filter(
          (inv) => inv.token !== selected.token,
        );

        // If no more invitations, emit to parent
        if (invitations.value.length === 0) {
          emit("invitations-processed", { accepted: false, hasMore: false });
        }
      } catch (error) {
        const e = error as { response?: { data?: { message?: string } } };
        dismiss();
        toast({
          message:
            e.response?.data?.message || t("iam.invitationList.failedReject"),
          variant: "error",
        });
      }
    };

    useShortcuts([
      { id: "iamInvitationsRefresh", handler: () => { if (!isInputFocused()) fetchPendingInvitations(); } },
    ]);

    return {
      t,
      store,
      invitations,
      filterQuery,
      columns,
      resultTotal,
      loading,
      confirmAccept,
      confirmReject,
      selectedInvitation,
      acceptInvitation,
      rejectInvitation,
      confirmAcceptInvitation,
      confirmRejectInvitation,
      fetchPendingInvitations,
      formatExpiry,
    };
  },
});
</script>
