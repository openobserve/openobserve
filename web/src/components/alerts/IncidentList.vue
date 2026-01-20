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
  <div data-test="incident-list" class="flex q-mt-xs">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <!-- Header with title and search -->
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:justify-between tw:items-center tw:w-full tw:py-3 tw:px-4 tw:h-[68px]">
          <div class="q-table__title tw:font-[600]" data-test="incidents-list-title">
            {{ t("alerts.incidents.title") }}
          </div>

          <div class="tw:flex tw:items-center">
            <q-input
              v-model="searchQuery"
              dense
              borderless
              :placeholder="t('alerts.incidents.search')"
              data-test="incident-search-input"
              clearable
              class="o2-search-input"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
          </div>
        </div>
      </div>
      <!-- Incidents table -->
      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
      <div class="card-container tw:h-[calc(100vh-128px)]">
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
    </div>
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
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import NoData from "../shared/grid/NoData.vue";

export default defineComponent({
  name: "IncidentList",
  components: {
    QTablePagination,
    O2AIContextAddBtn,
    NoData,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();

    const qTableRef: any = ref(null);
    const loading = ref(false);
    const incidents = ref<Incident[]>([]);
    const allIncidents = ref<Incident[]>([]); // Store all incidents for FE filtering
    const searchQuery = ref("");

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
        const keyword = undefined; // searchQuery.value?.trim() || undefined;

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
        const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);

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
      const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);
      const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
      const endIndex = startIndex + pagination.value.rowsPerPage;
      incidents.value = filteredIncidents.slice(startIndex, endIndex);
      pagination.value.rowsNumber = filteredIncidents.length;
    };

    const viewIncident = (incident: Incident) => {
      // Navigate to incident detail page
      router.push({
        name: "incidentDetail",
        params: {
          id: incident.id,
        },
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
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
    });

    // Watch for search query changes and apply FE filter
    watch(() => searchQuery.value, () => {
      // Reset to page 1 when search query changes
      pagination.value.page = 1;

      // Apply FE search filter without API call
      const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);
      const startIndex = 0; // Always start from first page
      const endIndex = pagination.value.rowsPerPage;
      incidents.value = filteredIncidents.slice(startIndex, endIndex);
      pagination.value.rowsNumber = filteredIncidents.length;
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
      searchQuery,
      loadIncidents,
      onRequest,
      viewIncident,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
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

.o2-search-input {
  width: 250px;
}
</style>
