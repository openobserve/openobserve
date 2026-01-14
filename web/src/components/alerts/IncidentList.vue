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
  <div data-test="incident-list" class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
    <!-- Incidents table -->
    <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
      <div class="card-container tw:h-[calc(100vh-120px)]">
        <q-table
          ref="qTableRef"
          v-model:pagination="pagination"
          :rows="loading ? [] : incidents"
          :columns="columns"
          :loading="loading"
          row-key="id"
          :rows-per-page-options="perPageOptions.map((opt: any) => opt.value)"
          style="width: 100%"
          :style="!loading && incidents.length > 0
            ? 'width: 100%; height: calc(100vh - 127px)'
            : 'width: 100%'"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          data-test="incident-list-table"
          @request="onRequest"
        >
        <!-- Custom body template for clickable rows -->
        <template v-slot:body="props">
          <q-tr
            :props="props"
            style="cursor: pointer"
            @click="viewIncident(props.row)"
            data-test="incident-row"
          >
            <q-td
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
            >
              <template v-if="col.name === 'index'">
                {{ (pagination.page - 1) * pagination.rowsPerPage + props.pageIndex + 1 }}
              </template>
              <template v-else-if="col.name === 'status'">
                <q-badge
                  :color="getStatusColor(props.row.status)"
                  :label="getStatusLabel(props.row.status)"
                />
              </template>
              <template v-else-if="col.name === 'severity'">
                <q-badge
                  :color="getSeverityColor(props.row.severity)"
                  :label="props.row.severity"
                />
              </template>
              <template v-else-if="col.name === 'title'">
                <div class="tw:flex tw:items-center tw:gap-1">
                  <span class="tw:font-medium">
                    {{ props.row.title || formatDimensions(props.row.stable_dimensions) }}
                  </span>
                </div>
              </template>
              <template v-else-if="col.name === 'alert_count'">
                {{ props.row.alert_count }}
              </template>
              <template v-else-if="col.name === 'last_alert_at'">
                {{ formatTimestamp(props.row.last_alert_at) }}
              </template>
              <template v-else-if="col.name === 'actions'">
                <div class="tw:flex tw:justify-end">
                  <q-btn
                    v-if="props.row.status === 'open'"
                    flat
                    dense
                    round
                    icon="check_circle_outline"
                    color="warning"
                    @click.stop="acknowledgeIncident(props.row)"
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
                    @click.stop="resolveIncident(props.row)"
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
                    @click.stop="reopenIncident(props.row)"
                    data-test="incident-reopen-btn"
                  >
                    <q-tooltip>{{ t("alerts.incidents.reopen") }}</q-tooltip>
                  </q-btn>
                </div>
              </template>
            </q-td>
          </q-tr>
        </template>

        <template v-slot:header="props">
          <q-tr :props="props">
            <!-- Rendering the of the columns -->
            <!-- here we can add the classes class so that the head will be sticky -->
            <q-th
              v-for="col in props.cols"
              :key="col.name"
              :props="props"
              :class="col.classes"
              :style="col.style"
            >
              {{ col.label }}
            </q-th>
          </q-tr>
        </template>

        <!-- Loading state -->
        <template #loading>
          <div class="tw:flex tw:items-center tw:justify-center tw:py-20">
            <q-spinner-hourglass color="primary" size="3rem" />
          </div>
        </template>

        <!-- Empty state -->
        <template #no-data>
          <div v-if="!loading" class="tw:flex tw:items-center tw:justify-center tw:w-full tw:h-full">
            <no-data />
          </div>
        </template>

        <!-- Bottom pagination -->
        <template v-slot:bottom="scope">
          <div class="bottom-btn tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md">
              {{ pagination.rowsNumber }} {{ pagination.rowsNumber === 1 ? 'Incident' : 'Incidents' }}
            </div>
            <QTablePagination
              :scope="scope"
              :position="'bottom'"
              :resultTotal="pagination.rowsNumber"
              :perPageOptions="perPageOptions"
              @update:changeRecordPerPage="changePagination"
            />
          </div>
        </template>
        </q-table>
      </div>
    </div>

    <!-- Incident detail drawer -->
    <q-dialog
      v-model="showDetailDrawer"
      position="right"
      full-height
      :maximized="true"
    >
      <IncidentDetailDrawer
        @close="closeDrawer"
        @status-updated="onStatusUpdated"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { date } from "quasar";
import incidentsService, { Incident } from "@/services/incidents";
import IncidentDetailDrawer from "./IncidentDetailDrawer.vue";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import NoData from "../shared/grid/NoData.vue";

export default defineComponent({
  name: "IncidentList",
  components: {
    IncidentDetailDrawer,
    QTablePagination,
    O2AIContextAddBtn,
    NoData,
  },
  props: {
    searchQuery: {
      type: String,
      default: "",
    },
  },
  setup(props) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();

    const qTableRef: any = ref(null);
    const loading = ref(false);
    const incidents = ref<Incident[]>([]);
    const allIncidents = ref<Incident[]>([]); // Store all incidents for FE filtering
    const showDetailDrawer = ref(false);
    const selectedIncident = ref<Incident | null>(null); // Keep for reference but not passed to drawer

    // Filter state for status and severity columns
    const statusFilter = ref<string[]>([]);
    const severityFilter = ref<string[]>([]);

    const pagination = ref({
      sortBy: "last_alert_at",
      descending: true,
      page: 1,
      rowsPerPage: 20,
      rowsNumber: 0,
    });

    // Available filter options
    const statusOptions = ["open", "acknowledged", "resolved"];
    const severityOptions = ["P1", "P2", "P3", "P4"];

    // Pagination options
    const perPageOptions: any = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];

    // Computed property for filtered incidents (used by tests and for consistency)
    const filteredIncidents = computed(() => {
      let filtered = allIncidents.value;

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
        name: "index",
        label: "#",
        field: "index",
        align: "center" as const,
        style: "width: 67px;",
        sortable: false,
      },
      {
        name: "status",
        label: t("alerts.incidents.status"),
        field: "status",
        align: "left" as const,
        style: "width: 120px",
        sortable: false,
      },
      {
        name: "severity",
        label: t("alerts.incidents.severity"),
        field: "severity",
        align: "left" as const,
        style: "width: 100px",
        sortable: false,
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
        style: "width: 100px",
        classes:'actions-column'
      },
    ]);

    // Frontend search filter function
    const applyFrontendSearch = (incidentsList: Incident[], searchQuery: string) => {
      if (!searchQuery || searchQuery.trim() === "") {
        return incidentsList;
      }

      const query = searchQuery.toLowerCase().trim();

      return incidentsList.filter((incident) => {
        // Search in title
        const title = incident.title || formatDimensions(incident.stable_dimensions);
        if (title.toLowerCase().includes(query)) {
          return true;
        }

        // Search in status
        const statusLabel = getStatusLabel(incident.status).toLowerCase();
        if (statusLabel.includes(query) || incident.status.toLowerCase().includes(query)) {
          return true;
        }

        // Search in severity
        if (incident.severity.toLowerCase().includes(query)) {
          return true;
        }

        // Search in stable dimensions (key-value pairs)
        if (incident.stable_dimensions) {
          const dimensionsStr = Object.entries(incident.stable_dimensions)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
            .toLowerCase();
          if (dimensionsStr.includes(query)) {
            return true;
          }
        }

        return false;
      });
    };

    const loadIncidents = async () => {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        // Load all incidents for now (can be paginated when BE supports it)
        const limit = 1000; // Large limit for FE filtering
        const offset = 0;
        // Keep keyword parameter for future BE implementation
        const keyword = undefined; // props.searchQuery?.trim() || undefined;

        const response = await incidentsService.list(
          org,
          undefined,  // Status filter to be added when API supports it
          limit,
          offset,
          keyword
        );

        // Store all incidents
        allIncidents.value = response.data.incidents;

        // Apply frontend search filter
        const filteredIncidents = applyFrontendSearch(allIncidents.value, props.searchQuery);

        // Apply pagination on filtered results
        const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
        const endIndex = startIndex + pagination.value.rowsPerPage;
        incidents.value = filteredIncidents.slice(startIndex, endIndex);
        pagination.value.rowsNumber = filteredIncidents.length;
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

    const onRequest = async (props: any) => {
      pagination.value.page = props.pagination.page;
      pagination.value.rowsPerPage = props.pagination.rowsPerPage;
      pagination.value.sortBy = props.pagination.sortBy;
      pagination.value.descending = props.pagination.descending;

      // For FE filtering, just reapply filters and pagination without API call
      const filteredIncidents = applyFrontendSearch(allIncidents.value, props.searchQuery);
      const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
      const endIndex = startIndex + pagination.value.rowsPerPage;
      incidents.value = filteredIncidents.slice(startIndex, endIndex);
      pagination.value.rowsNumber = filteredIncidents.length;
    };

    const viewIncident = (incident: Incident) => {
      selectedIncident.value = incident;

      // Add incident ID to URL and open drawer after navigation completes
      router.push({
        query: {
          ...router.currentRoute.value.query,
          incident_id: incident.id,
        },
      }).then(() => {
        // Open drawer after URL is updated
        showDetailDrawer.value = true;
      });
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

    const closeDrawer = () => {
      // Close drawer immediately for better UX
      showDetailDrawer.value = false;
      selectedIncident.value = null;

      // Remove incident_id from URL
      const query = { ...router.currentRoute.value.query };
      delete query.incident_id;
      router.replace({ query }); // Use replace instead of push to not add history entry
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

    onMounted(async () => {
      await loadIncidents();

      // Check if there's an incident_id in the URL and open the drawer
      const incidentIdFromUrl = router.currentRoute.value.query.incident_id as string;
      if (incidentIdFromUrl) {
        // Just open the drawer - the IncidentDetailDrawer will read the ID from URL
        showDetailDrawer.value = true;
      }
    });

    // Watch for search query changes and apply FE filter
    watch(() => props.searchQuery, () => {
      // Reset to page 1 when search query changes
      pagination.value.page = 1;

      // Apply FE search filter without API call
      const filteredIncidents = applyFrontendSearch(allIncidents.value, props.searchQuery);
      const startIndex = 0; // Always start from first page
      const endIndex = pagination.value.rowsPerPage;
      incidents.value = filteredIncidents.slice(startIndex, endIndex);
      pagination.value.rowsNumber = filteredIncidents.length;
    });

    // Watch for drawer closing (handles ESC key, clicking outside, etc.)
    watch(showDetailDrawer, (isOpen) => {
      if (!isOpen && router.currentRoute.value.query.incident_id) {
        // Drawer was closed but incident_id is still in URL - clean it up
        const query = { ...router.currentRoute.value.query };
        delete query.incident_id;
        router.replace({ query });
        selectedIncident.value = null;
      }
    });

    // Filter toggle functions
    const toggleStatusFilter = (status: string) => {
      const index = statusFilter.value.indexOf(status);
      if (index === -1) {
        statusFilter.value.push(status);
      } else {
        statusFilter.value.splice(index, 1);
      }
      // Note: With backend pagination, filters would need to be sent to API
      // For now, filters are visual only and don't affect data
    };

    const toggleSeverityFilter = (severity: string) => {
      const index = severityFilter.value.indexOf(severity);
      if (index === -1) {
        severityFilter.value.push(severity);
      } else {
        severityFilter.value.splice(index, 1);
      }
      // Note: With backend pagination, filters would need to be sent to API
      // For now, filters are visual only and don't affect data
    };

    const clearStatusFilter = () => {
      statusFilter.value = [];
      // Note: With backend pagination, would trigger API reload
    };

    const clearSeverityFilter = () => {
      severityFilter.value = [];
      // Note: With backend pagination, would trigger API reload
    };

    const changePagination = (val: { label: string; value: number }) => {
      pagination.value.rowsPerPage = val.value;
      pagination.value.page = 1;
      qTableRef.value?.requestServerInteraction({
        pagination: pagination.value
      });
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
      allIncidents,
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
      closeDrawer,
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
      perPageOptions,
      qTableRef,
    };
  },
});
</script>

<style lang="scss" scoped>
.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}
</style>
