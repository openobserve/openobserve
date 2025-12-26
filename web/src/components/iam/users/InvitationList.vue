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
      <div class="card-container tw:h-[calc(100vh-128px)]">
        <q-table
          ref="qTable"
          :rows="invitations"
          :columns="columns"
          row-key="token"
          :pagination="pagination"
          style="width: 100%"
          :style="invitations.length > 0
              ? 'width: 100%; height: calc(100vh - 128px)'
              : 'width: 100%'"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
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
            :label="t('invitation.accept')"
            class="q-mr-sm o2-primary-button"
            no-caps
            dense
            @click="acceptInvitation(props.row)"
            :data-test="`accept-invitation-${props.row.token}`"
          />
          <q-btn
            :label="t('invitation.reject')"
            dense
            class="o2-secondary-button"
            no-caps
            @click="rejectInvitation(props.row)"
            :data-test="`reject-invitation-${props.row.token}`"
          />
        </q-td>
      </template>

      <template #bottom="scope">
      <div class="bottom-btn tw:h-[48px] tw:flex tw:w-full">
          <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[250px] tw:mr-md">
            {{ resultTotal }} {{ t('invitation.pendingInvitations') }}
          </div>
        <QTablePagination
          :scope="scope"
          :resultTotal="resultTotal"
          :perPageOptions="perPageOptions"
          position="bottom"
          @update:changeRecordPerPage="changePagination"
        />
        </div>
        <!-- :maxRecordToReturn="maxRecordToReturn" -->
        <!-- @update:maxRecordToReturn="changeMaxRecordToReturn" -->
      </template>
        </q-table>
      </div>
    </div>

    <q-dialog v-model="confirmAccept">
      <q-card style="width: 300px">
        <q-card-section class="confirmBody">
          <div class="head">{{ t("invitation.confirmAcceptHead") }}</div>
          <div class="para">
            {{
              t("invitation.confirmAcceptMsg", {
                org: selectedInvitation?.org_name,
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
                org: selectedInvitation?.org_name,
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
import QTablePagination from "@/components/shared/grid/Pagination.vue";

export default defineComponent({
  name: "InvitationList",
  components: {
    NoData,
    QTablePagination,
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
        name: "#",
        label: "#",
        field: "#",
        align: "left",
        style: "width: 67px;",
      },
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

    const perPageOptions = [
      { label: "25", value: 25 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const resultTotal = ref<number>(0);
    const selectedPerPage = ref<number>(25);

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value.setPagination(pagination.value);
    };

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
      qTable,
      store,
      invitations,
      columns,
      pagination,
      perPageOptions,
      resultTotal,
      selectedPerPage,
      changePagination,
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
