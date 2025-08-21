<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="tw-m-4 tw-border">
    <div
      class="tw-flex tw-flex-row tw-justify-between tw-items-center tw-px-4 tw-py-3"
      :class="
        store.state.theme == 'dark'
          ? 'o2-table-header-dark'
          : 'o2-table-header-light'
      "
    >
      <div class="q-table__title full-width" data-test="invitation-title-text">
        {{ t("invitation.pendingInvitations") }}
      </div>
    </div>
    <!-- <div class="tw-text-sm tw-text-grey-500 tw-px-4">
      Info: If you decline all invitations and are not part of any organization,
      you will be logged out.
    </div> -->
    <q-table
      ref="qTable"
      :rows="invitations"
      :columns="columns"
      row-key="id"
      :pagination="pagination"
      class="o2-quasar-table"
      :class="
        store.state.theme == 'dark'
          ? 'o2-quasar-table-dark'
          : 'o2-quasar-table-light'
      "
    >
      <template #no-data>
        <NoData></NoData>
      </template>
      <template v-slot:header="props">
        <q-tr :props="props">
          <q-th
            v-for="col in props.cols"
            :class="col.classes"
            :key="col.name"
            :props="props"
          >
            <span>{{ col.label }}</span>
          </q-th>
        </q-tr>
      </template>
      <template #body-cell-actions="props">
        <q-td :props="props" side>
          <q-btn
            color="positive"
            :label="t('invitation.accept')"
            class="q-mr-sm"
            padding="sm lg"
            unelevated
            size="sm"
            no-caps
            @click="acceptInvitation(props.row)"
            :data-test="`accept-invitation-${props.row.token}`"
          />
          <q-btn
            color="negative"
            :label="t('invitation.reject')"
            padding="sm lg"
            unelevated
            size="sm"
            no-caps
            @click="rejectInvitation(props.row)"
            :data-test="`reject-invitation-${props.row.token}`"
          />
        </q-td>
      </template>
    </q-table>

    <q-dialog v-model="confirmAccept">
      <q-card style="width: 300px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("invitation.confirmAcceptHead") }}</div>
          <div class="para">
            {{
              t("invitation.confirmAcceptMsg", {
                org: selectedInvitation?.organization_name,
              })
            }}
          </div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            {{ t("invitation.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="positive"
            @click="confirmAcceptInvitation"
          >
            {{ t("invitation.accept") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="confirmReject">
      <q-card style="width: 300px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("invitation.confirmRejectHead") }}</div>
          <div class="para">
            {{
              t("invitation.confirmRejectMsg", {
                org: selectedInvitation?.organization_name,
              })
            }}
          </div>
        </q-card-section>

        <q-card-actions class="confirmActions">
          <q-btn v-close-popup="true" unelevated no-caps class="q-mr-sm">
            {{ t("invitation.cancel") }}
          </q-btn>
          <q-btn
            v-close-popup="true"
            unelevated
            no-caps
            class="no-border"
            color="negative"
            @click="confirmRejectInvitation"
          >
            {{ t("invitation.reject") }}
          </q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar, type QTableProps } from "quasar";
import { useI18n } from "vue-i18n";
import NoData from "@/components/shared/grid/NoData.vue";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";

export default defineComponent({
  name: "InvitationList",
  components: {
    NoData,
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
    const qTable: any = ref(null);
    const invitations = ref([]);
    const confirmAccept = ref(false);
    const confirmReject = ref(false);
    const selectedInvitation = ref(null);

    const columns: any = ref<QTableProps["columns"]>([
      {
        name: "org_name",
        field: "org_name",
        label: t("invitation.organizationName"),
        align: "left",
        sortable: true,
      },
      {
        name: "role",
        field: "role",
        label: t("invitation.role"),
        align: "left",
        sortable: true,
      },
      {
        name: "inviter_id",
        field: "inviter_id",
        label: t("invitation.invitedBy"),
        align: "left",
        sortable: true,
      },
      {
        name: "expiry",
        field: "expiry",
        label: t("invitation.expiry"),
        align: "left",
        sortable: true,
      },
      {
        name: "actions",
        field: "actions",
        label: t("invitation.actions"),
        align: "left",
        classes: "actions-column",
      },
    ]);

    const pagination: any = ref({
      rowsPerPage: 25,
    });

    onMounted(() => {
      fetchPendingInvitations();
    });

    const fetchPendingInvitations = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Loading pending invitations...",
      });
      // {"data":[{"org_id":"31b5oGxybSzf61gTGhHhEtsP0K5","token":"7364275578188333056","role":"admin","status":"pending","expires_at":1756384919464570}]}

      try {
        const response = await usersService.getPendingInvites();
        invitations.value = response.data.data.map((invitation: any) => ({
          ...invitation,
          expiry: formatExpiry(invitation.expires_at),
        }));
        dismiss();
      } catch {
        dismiss();
        $q.notify({
          color: "negative",
          message: "Failed to load pending invitations",
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
      } catch {
        dismiss();
        $q.notify({
          color: "negative",
          message: "Failed to accept invitation",
        });
      }
    };

    const confirmRejectInvitation = async () => {
      if (!selectedInvitation.value) return;

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
      } catch {
        dismiss();
        $q.notify({
          color: "negative",
          message: "Failed to reject invitation",
        });
      }
    };

    return {
      t,
      qTable,
      store,
      invitations,
      columns,
      pagination,
      confirmAccept,
      confirmReject,
      selectedInvitation,
      acceptInvitation,
      rejectInvitation,
      confirmAcceptInvitation,
      confirmRejectInvitation,
      fetchPendingInvitations,
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
</style>
