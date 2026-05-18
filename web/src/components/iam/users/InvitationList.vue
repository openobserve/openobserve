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
  <div class="tw:w-full tw:h-full ">
    <div class="card-container tw:mb-[0.625rem]">
      <div class="flex justify-between full-width tw:py-3 tw:px-4 items-center tw:h-[68px]">
        <div class="q-table__title tw:font-[600]" data-test="invitation-title-text">
          {{ t("invitation.pendingInvitations") }}
        </div>
        <div class="tw:h-[36px]" />
      </div>
    </div>

    <div class="tw:w-full tw:h-full">
      <div class="card-container" style="height: calc(100vh - var(--navbar-height) - 92px)">
        <OTable
          :data="invitations"
          :columns="columns"
          row-key="token"
          pagination="client"
          :page-size="25"
          sorting="client"
          :default-columns="false"
          :show-global-filter="false"
        >
          <template #empty>
            <NoData />
          </template>
          <template #cell-actions="{ row }">
            <div class="tw:flex tw:items-center tw:gap-2">
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
            <span class="tw:text-xs tw:text-text-primary tw:font-medium">
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
  </div>
</template>

<script lang="ts">

import { defineComponent, ref, onMounted } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import NoData from "@/components/shared/grid/NoData.vue";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";

export default defineComponent({
  name: "InvitationList",
  components: {
    NoData,
    OButton,
    ODialog,
    OTable,
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
    const $q = useQuasar();
    const invitations = ref([]);
    const confirmAccept = ref(false);
    const confirmReject = ref(false);
    const selectedInvitation = ref(null);

    const columns: OTableColumnDef[] = [
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 48,
        minSize: 40,
        maxSize: 64,
        meta: { align: "center", compactPadding: true },
      },
      {
        id: "org_name",
        header: t("invitation.organizationName"),
        accessorKey: "org_name",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "role",
        header: t("invitation.role"),
        accessorKey: "role",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "inviter_id",
        header: t("invitation.invitedBy"),
        accessorKey: "inviter_id",
        sortable: true,
        meta: { align: "left" },
      },
      {
        id: "expiry",
        header: t("invitation.expiry"),
        accessorKey: "expiry",
        sortable: true,
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
        meta: { align: "center" },
      },
    ];
    const resultTotal = ref<number>(0);

    onMounted(() => {
      fetchPendingInvitations();
    });

    const fetchPendingInvitations = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Loading pending invitations...",
      });

      try {
        const response = await usersService.getPendingInvites();

        let counter = 1;
        invitations.value = response.data.data.map((invitation: any) => ({
          "#": counter <= 9 ? `0${counter++}` : counter++,
          ...invitation,
          expiry: formatExpiry(invitation.expires_at),
        }));
        resultTotal.value = response.data.data.length;
        dismiss();
      } catch (error) {
        dismiss();
        $q.notify({
          color: "negative",
          message:
            error.response?.data?.message ||
            "Failed to load pending invitations",
          timeout: 4000,
        });
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
      if (!selectedInvitation.value) return;
      confirmAccept.value = false;

      const dismiss = $q.notify({
        spinner: true,
        message: "Accepting invitation...",
      });

      try {
        await organizationsService.process_subscription(
          selectedInvitation.value.token,
          "confirm",
          selectedInvitation.value.org_id,
        );

        // Refresh the organizations list in the store
        const orgResponse = await organizationsService.list(0, 1000000, "name", false, "");
        store.dispatch("setOrganizations", orgResponse.data.data);

        dismiss();
        $q.notify({
          color: "positive",
          message: "Invitation accepted successfully!",
        });

        // Set the selected organization and redirect
        const orgData = {
          identifier: selectedInvitation.value.org_id,
          name: selectedInvitation.value.org_name,
        };

        store.dispatch("setSelectedOrganization", orgData);
        emit("invitations-processed", {
          accepted: true,
          organization: orgData,
        });
      } catch (error) {
        dismiss();
        $q.notify({
          color: "negative",
          message:
            error.response?.data?.message || "Failed to accept invitation",
          timeout: 4000,
        });
      }
    };

    const confirmRejectInvitation = async () => {
      if (!selectedInvitation.value) return;
      confirmReject.value = false;

      const dismiss = $q.notify({
        spinner: true,
        message: "Rejecting invitation...",
      });

      try {
        await organizationsService.decline_subscription(
          selectedInvitation.value.token,
        );
        dismiss();
        $q.notify({
          color: "positive",
          message: "Invitation rejected successfully!",
        });

        // Remove from list
        invitations.value = invitations.value.filter(
          (inv: any) => inv.token !== selectedInvitation.value.token,
        );

        // If no more invitations, emit to parent
        if (invitations.value.length === 0) {
          emit("invitations-processed", { accepted: false, hasMore: false });
        }
      } catch (error) {
        dismiss();
        $q.notify({
          color: "negative",
          message:
            error.response?.data?.message || "Failed to reject invitation",
          timeout: 4000,
        });
      }
    };

    return {
      t,
      store,
      invitations,
      columns,
      resultTotal,
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

<style lang="scss" scoped>
.confirmBody {
  padding: 11px 1.375rem 0;
  font-size: 0.875rem;
  text-align: center;
  font-weight: 700;

  .head {
    line-height: 2.125rem;
    margin-bottom: 0.5rem;
    color: $dark-page;
  }

  .para {
    color: $light-text;
  }
}

.confirmActions {
  justify-content: center;
  padding: 1.25rem 1.375rem 1.625rem;
  display: flex;

  .q-btn {
    font-size: 0.75rem;
    font-weight: 700;
  }
}

.no-hover {
  &:hover {
    color: black !important;
  }
}
</style>
