<!-- Copyright 2025 OpenObserve Inc.

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
  <div data-test="incident-list" class="q-pa-none flex flex-col tw-h-full">
    <!-- Incidents table -->
    <div class="tw-flex-1 tw-overflow-auto">
      <q-table
        v-model:pagination="pagination"
        :rows="filteredIncidents"
        :columns="columns"
        :loading="loading"
        row-key="id"
        flat
        bordered
        :rows-per-page-options="[10, 25, 50, 100]"
        class="incident-table"
        data-test="incident-list-table"
        @request="onRequest"
      >
        <!-- Custom header for Status column with filter -->
        <template v-slot:header-cell-status="props">
          <q-th :props="props" class="cursor-pointer">
            <div class="tw-flex tw-items-center tw-gap-1">
              <span>{{ props.col.label }}</span>
              <q-btn
                flat
                dense
                round
                size="xs"
                icon="filter_list"
                :color="statusFilter.length > 0 ? 'primary' : 'grey-7'"
              >
                <q-menu>
                  <q-list style="min-width: 150px">
                    <q-item
                      v-for="option in statusOptions"
                      :key="option"
                      clickable
                      v-close-popup
                      @click="toggleStatusFilter(option)"
                    >
                      <q-item-section side>
                        <q-checkbox
                          :model-value="statusFilter.includes(option)"
                          @update:model-value="toggleStatusFilter(option)"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-badge
                          :color="getStatusColor(option)"
                          :label="getStatusLabel(option)"
                        />
                      </q-item-section>
                    </q-item>
                    <q-separator v-if="statusFilter.length > 0" />
                    <q-item
                      v-if="statusFilter.length > 0"
                      clickable
                      v-close-popup
                      @click="clearStatusFilter"
                    >
                      <q-item-section class="text-primary">
                        Clear Filter
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </div>
          </q-th>
        </template>

        <!-- Custom header for Severity column with filter -->
        <template v-slot:header-cell-severity="props">
          <q-th :props="props" class="cursor-pointer">
            <div class="tw-flex tw-items-center tw-gap-1">
              <span>{{ props.col.label }}</span>
              <q-btn
                flat
                dense
                round
                size="xs"
                icon="filter_list"
                :color="severityFilter.length > 0 ? 'primary' : 'grey-7'"
              >
                <q-menu>
                  <q-list style="min-width: 150px">
                    <q-item
                      v-for="option in severityOptions"
                      :key="option"
                      clickable
                      v-close-popup
                      @click="toggleSeverityFilter(option)"
                    >
                      <q-item-section side>
                        <q-checkbox
                          :model-value="severityFilter.includes(option)"
                          @update:model-value="toggleSeverityFilter(option)"
                        />
                      </q-item-section>
                      <q-item-section>
                        <q-badge
                          :color="getSeverityColor(option)"
                          :label="option"
                        />
                      </q-item-section>
                    </q-item>
                    <q-separator v-if="severityFilter.length > 0" />
                    <q-item
                      v-if="severityFilter.length > 0"
                      clickable
                      v-close-popup
                      @click="clearSeverityFilter"
                    >
                      <q-item-section class="text-primary">
                        Clear Filter
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </div>
          </q-th>
        </template>
        <!-- Status column -->
        <template v-slot:body-cell-status="props">
          <q-td :props="props">
            <q-badge
              :color="getStatusColor(props.row.status)"
              :label="getStatusLabel(props.row.status)"
            />
          </q-td>
        </template>

        <!-- Severity column -->
        <template v-slot:body-cell-severity="props">
          <q-td :props="props">
            <q-badge
              :color="getSeverityColor(props.row.severity)"
              :label="props.row.severity"
            />
          </q-td>
        </template>

        <!-- Title column -->
        <template v-slot:body-cell-title="props">
          <q-td :props="props">
            <div class="tw-flex tw-items-center tw-gap-1">
              <span class="tw-font-medium">
                {{ props.row.title || formatDimensions(props.row.stable_dimensions) }}
              </span>
              <O2AIContextAddBtn
                @sendToAiChat="openSREChat(props.row)"
                :size="'6px'"
                :imageHeight="'16px'"
                :imageWidth="'16px'"
              />
            </div>
          </q-td>
        </template>

        <!-- Alert count column -->
        <template v-slot:body-cell-alert_count="props">
          <q-td :props="props">
            <q-badge color="grey-7" :label="props.row.alert_count" />
          </q-td>
        </template>

        <!-- Last alert column -->
        <template v-slot:body-cell-last_alert_at="props">
          <q-td :props="props">
            {{ formatTimestamp(props.row.last_alert_at) }}
          </q-td>
        </template>

        <!-- Actions column -->
        <template v-slot:body-cell-actions="props">
          <q-td :props="props">
            <q-btn
              flat
              dense
              round
              icon="visibility"
              @click="viewIncident(props.row)"
              data-test="incident-view-btn"
            >
              <q-tooltip>{{ t("alerts.incidents.viewDetails") }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="props.row.status === 'open'"
              flat
              dense
              round
              icon="check_circle_outline"
              color="warning"
              @click="acknowledgeIncident(props.row)"
              data-test="incident-ack-btn"
            >
              <q-tooltip>{{ t("alerts.incidents.acknowledge") }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="props.row.status !== 'resolved'"
              flat
              dense
              round
              icon="done_all"
              color="positive"
              @click="resolveIncident(props.row)"
              data-test="incident-resolve-btn"
            >
              <q-tooltip>{{ t("alerts.incidents.resolve") }}</q-tooltip>
            </q-btn>
            <q-btn
              v-if="props.row.status === 'resolved'"
              flat
              dense
              round
              icon="replay"
              color="negative"
              @click="reopenIncident(props.row)"
              data-test="incident-reopen-btn"
            >
              <q-tooltip>{{ t("alerts.incidents.reopen") }}</q-tooltip>
            </q-btn>
          </q-td>
        </template>

        <!-- Empty state -->
        <template v-slot:no-data>
          <div class="tw-text-center tw-py-8 tw-text-gray-500">
            {{ t("alerts.incidents.noIncidents") }}
          </div>
        </template>

        <!-- Bottom pagination -->
        <template v-slot:bottom="scope">
          <div class="bottom-btn tw-h-[48px]">
            <div class="o2-table-footer-title tw-flex tw-items-center tw-w-[100px] tw-mr-md">
              {{ pagination.rowsNumber }} {{ pagination.rowsNumber === 1 ? 'Incident' : 'Incidents' }}
            </div>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="pagination.rowsNumber"
              :perPageOptions="[10, 25, 50, 100]"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
      </q-table>
    </div>

    <!-- Incident detail drawer -->
    <IncidentDetailDrawer
      v-model="showDetailDrawer"
      :incident="selectedIncident"
      @status-updated="onStatusUpdated"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { date } from "quasar";
import incidentsService, { Incident } from "@/services/incidents";
import IncidentDetailDrawer from "./IncidentDetailDrawer.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";

export default defineComponent({
  name: "IncidentList",
  components: {
    IncidentDetailDrawer,
    QTablePagination,
    O2AIContextAddBtn,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();

    const loading = ref(false);
    const incidents = ref<Incident[]>([]);
    const showDetailDrawer = ref(false);
    const selectedIncident = ref<Incident | null>(null);

    // Filter state for status and severity columns
    const statusFilter = ref<string[]>([]);
    const severityFilter = ref<string[]>([]);

    const pagination = ref({
      sortBy: "last_alert_at",
      descending: true,
      page: 1,
      rowsPerPage: 25,
      rowsNumber: 0,
    });

    // Available filter options
    const statusOptions = ["open", "acknowledged", "resolved"];
    const severityOptions = ["P1", "P2", "P3", "P4"];

    // Filtered incidents based on active filters
    const filteredIncidents = computed(() => {
      let filtered = incidents.value;

      // Apply status filter
      if (statusFilter.value.length > 0) {
        filtered = filtered.filter((incident) =>
          statusFilter.value.includes(incident.status)
        );
      }

      // Apply severity filter
      if (severityFilter.value.length > 0) {
        filtered = filtered.filter((incident) =>
          severityFilter.value.includes(incident.severity)
        );
      }

      return filtered;
    });

    const columns = computed(() => [
      {
        name: "status",
        label: t("alerts.incidents.status"),
        field: "status",
        align: "left" as const,
        style: "width: 120px",
        sortable: true,
      },
      {
        name: "severity",
        label: t("alerts.incidents.severity"),
        field: "severity",
        align: "left" as const,
        style: "width: 100px",
        sortable: true,
      },
      {
        name: "title",
        label: t("alerts.incidents.title_field"),
        field: "title",
        align: "left" as const,
      },
      {
        name: "alert_count",
        label: t("alerts.incidents.alertCount"),
        field: "alert_count",
        align: "center" as const,
        style: "width: 80px",
      },
      {
        name: "last_alert_at",
        label: t("alerts.incidents.lastAlertAt"),
        field: "last_alert_at",
        align: "left" as const,
        style: "width: 180px",
        sortable: true,
      },
      {
        name: "actions",
        label: t("alerts.incidents.actions"),
        field: "actions",
        align: "center" as const,
        style: "width: 150px",
      },
    ]);

    const loadIncidents = async () => {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const limit = pagination.value.rowsPerPage;
        const offset = (pagination.value.page - 1) * limit;

        const response = await incidentsService.list(
          org,
          undefined,  // No status filter passed to API (filtering done client-side)
          limit,
          offset
        );

        incidents.value = response.data.incidents;
        pagination.value.rowsNumber = response.data.total;
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: t("alerts.incidents.errorLoading"),
        });
        console.error("Failed to load incidents:", error);
      } finally {
        loading.value = false;
      }
    };

    const onRequest = (props: any) => {
      pagination.value.page = props.pagination.page;
      pagination.value.rowsPerPage = props.pagination.rowsPerPage;
      loadIncidents();
    };

    const viewIncident = (incident: Incident) => {
      selectedIncident.value = incident;
      showDetailDrawer.value = true;
    };

    const updateStatus = async (incident: Incident, newStatus: "open" | "acknowledged" | "resolved") => {
      try {
        const org = store.state.selectedOrganization.identifier;
        await incidentsService.updateStatus(org, incident.id, newStatus);
        $q.notify({
          type: "positive",
          message: t("alerts.incidents.statusUpdated"),
        });
        loadIncidents();
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: t("alerts.incidents.statusUpdateFailed"),
        });
        console.error("Failed to update incident status:", error);
      }
    };

    const acknowledgeIncident = (incident: Incident) => {
      updateStatus(incident, "acknowledged");
    };

    const resolveIncident = (incident: Incident) => {
      updateStatus(incident, "resolved");
    };

    const reopenIncident = (incident: Incident) => {
      updateStatus(incident, "open");
    };

    const onStatusUpdated = () => {
      loadIncidents();
    };

    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "negative";
        case "acknowledged":
          return "warning";
        case "resolved":
          return "positive";
        default:
          return "grey";
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case "open":
          return t("alerts.incidents.statusOpen");
        case "acknowledged":
          return t("alerts.incidents.statusAcknowledged");
        case "resolved":
          return t("alerts.incidents.statusResolved");
        default:
          return status;
      }
    };

    const getSeverityColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "red-10";
        case "P2":
          return "orange-8";
        case "P3":
          return "amber-8";
        case "P4":
          return "grey-7";
        default:
          return "grey";
      }
    };

    const formatTimestamp = (timestamp: number) => {
      // Backend sends microseconds
      return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
    };

    const formatDimensions = (dimensions: Record<string, string>) => {
      if (!dimensions || Object.keys(dimensions).length === 0) {
        return "Unknown";
      }
      return Object.entries(dimensions)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
    };

    onMounted(() => {
      loadIncidents();
    });

    // Filter toggle functions
    const toggleStatusFilter = (status: string) => {
      const index = statusFilter.value.indexOf(status);
      if (index === -1) {
        statusFilter.value.push(status);
      } else {
        statusFilter.value.splice(index, 1);
      }
    };

    const toggleSeverityFilter = (severity: string) => {
      const index = severityFilter.value.indexOf(severity);
      if (index === -1) {
        severityFilter.value.push(severity);
      } else {
        severityFilter.value.splice(index, 1);
      }
    };

    const clearStatusFilter = () => {
      statusFilter.value = [];
    };

    const clearSeverityFilter = () => {
      severityFilter.value = [];
    };

    const changePagination = (val: { label: string; value: number }) => {
      pagination.value.rowsPerPage = val.value;
      pagination.value.page = 1;
      loadIncidents();
    };

    const openSREChat = (incident: any) => {
      store.state.sreChatContext = {
        type: 'incident',
        data: incident,
      };
      store.dispatch("setIsSREChatOpen", true);
    };

    return {
      t,
      loading,
      incidents,
      filteredIncidents,
      statusFilter,
      severityFilter,
      statusOptions,
      severityOptions,
      pagination,
      columns,
      showDetailDrawer,
      selectedIncident,
      loadIncidents,
      onRequest,
      viewIncident,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      onStatusUpdated,
      getStatusColor,
      getStatusLabel,
      getSeverityColor,
      formatTimestamp,
      formatDimensions,
      toggleStatusFilter,
      toggleSeverityFilter,
      clearStatusFilter,
      clearSeverityFilter,
      changePagination,
      openSREChat,
    };
  },
});
</script>

<style scoped>
.incident-table {
  height: 100%;
}
</style>
