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

          <div class="tw:flex tw:items-center tw:gap-2">
            <q-btn
              flat
              round
              :loading="loading"
              @click="refreshIncidents"
              data-test="incident-refresh-btn"
              class="o2-secondary-button"
            >
             Refresh
            </q-btn>
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
                <span
                  class="status-badge"
                  :class="getStatusColorClass(props.row.status)"
                >
                  {{ getStatusLabel(props.row.status) }}
                </span>
              </template>
              <template v-else-if="col.name === 'severity'">
                <span
                  class="severity-badge"
                  :class="getSeverityColorClass(props.row.severity)"
                >
                  {{ props.row.severity }}
                </span>
              </template>
              <template v-else-if="col.name === 'title'">
                <div class="tw:flex tw:items-center tw:gap-1">
                  <span class="tw:font-medium">
                    {{ props.row.title || formatDimensions(props.row.stable_dimensions) }}
                  </span>
                </div>
              </template>
              <template v-else-if="col.name === 'dimensions'">
                <div class="tw:flex tw:flex-wrap tw:gap-1">
                  <!-- Show first 2 dimensions -->
                  <span
                    v-for="[key, value] in getSortedDimensions(props.row.stable_dimensions).slice(0, 2)"
                    :key="key"
                    class="dimension-badge"
                    :class="getDimensionColorClass(key)"
                  >
                    <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
                    <q-tooltip :delay="300" class="tw:text-xs">
                      {{ key }}={{ value }}
                    </q-tooltip>
                  </span>
                  <!-- Show +X more badge if there are more than 2 dimensions -->
                  <span
                    v-if="getSortedDimensions(props.row.stable_dimensions).length > 2"
                    class="dimension-badge badge-more"
                  >
                    +{{ getSortedDimensions(props.row.stable_dimensions).length - 2 }} more
                    <q-tooltip :delay="300" class="tw:text-xs tw:max-w-md">
                      <div class="tw:space-y-1">
                        <div
                          v-for="[key, value] in getSortedDimensions(props.row.stable_dimensions).slice(2)"
                          :key="key"
                        >
                          <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
                        </div>
                      </div>
                    </q-tooltip>
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
                <div class="action-buttons">
                  <q-btn
                    v-if="props.row.status === 'open'"
                    flat
                    dense
                    size="sm"
                    icon="visibility"
                    class="action-btn acknowledge-btn"
                    @click.stop="acknowledgeIncident(props.row)"
                    data-test="incident-ack-btn"
                  >
                    <q-tooltip>{{ t("alerts.incidents.acknowledge") }}</q-tooltip>
                  </q-btn>
                  <q-btn
                    v-if="props.row.status !== 'resolved'"
                    flat
                    dense
                    size="sm"
                    icon="task_alt"
                    class="action-btn resolve-btn"
                    @click.stop="resolveIncident(props.row)"
                    data-test="incident-resolve-btn"
                  >
                    <q-tooltip>{{ t("alerts.incidents.resolve") }}</q-tooltip>
                  </q-btn>
                  <q-btn
                    v-if="props.row.status === 'resolved'"
                    flat
                    dense
                    size="sm"
                    icon="restart_alt"
                    class="action-btn reopen-btn"
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
import { defineComponent, ref, computed, onMounted, watch, nextTick } from "vue";
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
    const isRestoringState = ref(false); // Simple flag to prevent watch from firing during restoration

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
        name: "title",
        label: t("alerts.incidents.title_field"),
        field: "title",
        align: "left" as const,
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
        name: "status",
        label: t("alerts.incidents.status"),
        field: "status",
        align: "left" as const,
        style: "width: 120px",
        sortable: false,
      },

      {
        name: "dimensions",
        label: "Dimensions",
        field: "stable_dimensions",
        align: "left" as const,
        style: "width: 400px;",
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

        // Cache data in store for when navigating back
        store.dispatch('incidents/setCachedData', response.data.incidents);

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

      // Save to store after pagination update (only search query, page, and rowsPerPage)
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: {
          page: pagination.value.page,
          rowsPerPage: pagination.value.rowsPerPage
        },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });
    };

    const viewIncident = (incident: Incident) => {
      // Ensure state is saved before navigation (only search query, page, and rowsPerPage)
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: {
          page: pagination.value.page,
          rowsPerPage: pagination.value.rowsPerPage
        },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });

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
        // Reload the incidents list to show updated status
        loadIncidents();
        // Also mark data as stale in store for when navigating back from other pages
        store.dispatch('incidents/setShouldRefresh', true);
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


    const getStatusColorClass = (status: string) => {
      switch (status) {
        case "open":
          return "status-open";
        case "acknowledged":
          return "status-acknowledged";
        case "resolved":
          return "status-resolved";
        default:
          return "status-default";
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

    const getSeverityColorClass = (severity: string) => {
      switch (severity) {
        case "P1":
          return "severity-p1";
        case "P2":
          return "severity-p2";
        case "P3":
          return "severity-p3";
        case "P4":
          return "severity-p4";
        default:
          return "severity-default";
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

    const getSortedDimensions = (dimensions: Record<string, string>) => {
      if (!dimensions || Object.keys(dimensions).length === 0) {
        return [];
      }

      // Sort keys alphabetically for consistency
      return Object.keys(dimensions)
        .sort()
        .map(key => [key, dimensions[key]] as [string, string]);
    };

    const getDimensionColorClass = (key: string) => {
      // Color palette using CSS classes matching schema.scss style
      const colorMap: Record<string, string> = {
        'k8s-deployment': 'badge-blue',
        'k8s-namespace': 'badge-orange',
        'deployment': 'badge-blue',
        'namespace': 'badge-orange',
        'env': 'badge-green',
        'environment': 'badge-green',
        'host': 'badge-purple',
        'hostname': 'badge-purple',
        'service': 'badge-cyan',
        'service_name': 'badge-cyan',
        'region': 'badge-pink',
        'zone': 'badge-pink',
        'cluster': 'badge-indigo',
        'pod': 'badge-teal',
        'container': 'badge-red',
        'app': 'badge-yellow',
        'application': 'badge-yellow',
      };

      // Check for exact match first
      if (colorMap[key]) {
        return colorMap[key];
      }

      // Check for partial matches
      const lowerKey = key.toLowerCase();
      for (const [pattern, className] of Object.entries(colorMap)) {
        if (lowerKey.includes(pattern)) {
          return className;
        }
      }

      // Hash-based fallback for consistency
      const classes = ['badge-gray', 'badge-amber', 'badge-violet', 'badge-rose'];
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash;
      }
      return classes[Math.abs(hash) % classes.length];
    };

    /**
     * Restores state from Vuex store or resets if organization changed
     * @returns {boolean} True if state was restored, false if reset
     */
    const restoreStateFromStore = (): boolean => {
      const savedState = store.state.incidents.incidents;
      const cachedData = store.state.incidents.cachedData;
      const isInitialized = store.state.incidents.isInitialized;
      const currentOrg = store.state.selectedOrganization.identifier;

      // Check if organization has changed - if so, reset the store
      if (isInitialized && savedState && savedState.organizationIdentifier &&
          savedState.organizationIdentifier !== currentOrg) {
        // Organization changed - reset store to clear old org's state
        store.dispatch('incidents/resetIncidents');

        // Reset local state to defaults
        searchQuery.value = "";
        allIncidents.value = [];
        pagination.value = {
          sortBy: "last_alert_at",
          descending: true,
          page: 1,
          rowsPerPage: 20,
          rowsNumber: 0,
        };
        return false;
      }
      // Restore state if available and same organization
      else if (isInitialized && savedState &&
               savedState.organizationIdentifier === currentOrg) {

        // Prevent watch from interfering during restoration
        isRestoringState.value = true;

        // Restore cached data
        if (cachedData && cachedData.length > 0) {
          allIncidents.value = cachedData;
        }

        // Restore pagination
        if (savedState.pagination) {
          pagination.value.page = savedState.pagination.page || 1;
          pagination.value.rowsPerPage = savedState.pagination.rowsPerPage || 20;
        }

        // Restore search query
        if (savedState.searchQuery !== undefined) {
          searchQuery.value = savedState.searchQuery;
        }

        // Note: isRestoringState reset at end of onMounted after all async ops complete

        return true;
      }

      return false;
    };

    /**
     * Validates pagination after data load and auto-corrects if current page is out of bounds
     * This handles edge cases like:
     * - User had page=3 with 150 records, comes back to find only 10 records left
     * - Search results have fewer items than expected
     * - All data was deleted (totalRecords = 0)
     * - Invalid rowsPerPage values (e.g., 0, negative, corrupt store data)
     * - pageBeforeSearch out of bounds when clearing search
     * @returns {boolean} True if pagination was corrected, false if valid
     */
    const validateAndCorrectPagination = (): boolean => {
      const totalRecords = pagination.value.rowsNumber;
      let currentPage = pagination.value.page;
      let rowsPerPage = pagination.value.rowsPerPage;
      let wasCorrected = false;

      // Safety: Validate rowsPerPage (must be positive, default to 20)
      if (!rowsPerPage || rowsPerPage <= 0) {
        pagination.value.rowsPerPage = 20;
        rowsPerPage = 20;
        wasCorrected = true;
      }

      // Safety: Validate currentPage (must be positive, default to 1)
      if (!currentPage || currentPage < 1) {
        pagination.value.page = 1;
        currentPage = 1;
        wasCorrected = true;
      }

      // Calculate max valid page (at least 1)
      const maxPage = Math.max(1, Math.ceil(totalRecords / rowsPerPage));

      // Check if current page is out of bounds
      if (currentPage > maxPage) {
        pagination.value.page = maxPage;
        wasCorrected = true;
      }

      // Re-apply pagination if any correction was made
      if (wasCorrected) {
        const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);
        const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
        const endIndex = startIndex + pagination.value.rowsPerPage;
        incidents.value = filteredIncidents.slice(startIndex, endIndex);
      }

      return wasCorrected;
    };

    onMounted(async () => {
      // Restore state from store (or reset if org changed)
      const hasRestoredState = restoreStateFromStore();

      // Check if data should be refreshed (e.g., after incident updates)
      const shouldRefresh = store.state.incidents?.shouldRefresh || false;

      // Load incidents if:
      // 1. We don't have cached data, OR
      // 2. shouldRefresh flag is set (indicates changes were made)
      if (allIncidents.value.length === 0 || shouldRefresh) {
        // Load incidents with restored or default state
        await loadIncidents();
        // Clear the shouldRefresh flag after loading
        if (shouldRefresh) {
          store.dispatch('incidents/setShouldRefresh', false);
        }
      } else {
        // We have cached data and no refresh needed, just reapply filters and pagination
        const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);
        const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
        const endIndex = startIndex + pagination.value.rowsPerPage;
        incidents.value = filteredIncidents.slice(startIndex, endIndex);
        pagination.value.rowsNumber = filteredIncidents.length;
      }

      // Validate pagination after loading data (edge case: restored page is out of bounds)
      const wasCorrected = validateAndCorrectPagination();

      // Mark as initialized after first load
      if (!store.state.incidents.isInitialized) {
        store.dispatch('incidents/setIsInitialized', true);
      }

      // Save the state to store (either restored or corrected)
      if (hasRestoredState || wasCorrected) {
        store.dispatch('incidents/setIncidents', {
          searchQuery: searchQuery.value,
          pagination: {
            page: pagination.value.page,
            rowsPerPage: pagination.value.rowsPerPage
          },
          organizationIdentifier: store.state.selectedOrganization.identifier
        });
      }

      // Wait for next tick to ensure watches fire with isRestoringState=true
      await nextTick();

      // Clear restoration flag after all operations complete
      isRestoringState.value = false;
    });

    // Watch for search query changes and apply FE filter
    watch(() => searchQuery.value, (newValue, oldValue) => {
      // Skip page manipulation during state restoration
      if (!isRestoringState.value) {
        // If starting a search (going from empty to something)
        if (!oldValue && newValue) {
          store.dispatch('incidents/setPageBeforeSearch', pagination.value.page);
          pagination.value.page = 1;
        }
        // If clearing the search (going from something to empty)
        else if (oldValue && !newValue) {
          const pageBeforeSearch = store.state.incidents.pageBeforeSearch;
          pagination.value.page = pageBeforeSearch || 1;
        }
        // If changing search query (both old and new have values)
        else if (oldValue && newValue) {
          pagination.value.page = 1;
        }
      }

      // Apply FE search filter without API call
      const filteredIncidents = applyFrontendSearch(allIncidents.value, searchQuery.value);
      const startIndex = (pagination.value.page - 1) * pagination.value.rowsPerPage;
      const endIndex = startIndex + pagination.value.rowsPerPage;
      incidents.value = filteredIncidents.slice(startIndex, endIndex);
      pagination.value.rowsNumber = filteredIncidents.length;

      // Validate pagination after applying search (handles edge case: pageBeforeSearch is out of bounds)
      validateAndCorrectPagination();

      // Save to store (only search query, page, and rowsPerPage - not sort settings)
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: {
          page: pagination.value.page,
          rowsPerPage: pagination.value.rowsPerPage
        },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });
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

      // Save to store (only search query, page, and rowsPerPage)
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: {
          page: pagination.value.page,
          rowsPerPage: pagination.value.rowsPerPage
        },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });
    };

    const refreshIncidents = async () => {
      // Force reload from API
      await loadIncidents();
      $q.notify({
        type: "positive",
        message: "Incidents refreshed",
        timeout: 1500,
      });
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
      refreshIncidents,
      onRequest,
      viewIncident,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      getStatusColorClass,
      getStatusLabel,
      getSeverityColorClass,
      formatTimestamp,
      formatDimensions,
      getSortedDimensions,
      getDimensionColorClass,
      toggleStatusFilter,
      toggleSeverityFilter,
      clearStatusFilter,
      clearSeverityFilter,
      changePagination,
      perPageOptions,
      qTableRef,
      validateAndCorrectPagination, // Expose for testing
      store,
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

/* Status badge styling - matching schema.scss */
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.status-open {
  border: 1px solid #dc2626;
}

.status-acknowledged {
  border: 1px solid #d97706;
}

.status-resolved {
  border: 1px solid #065f46;
}

.status-default {
  border: 1px solid #6b7280;
}

/* Severity badge styling - matching schema.scss */
.severity-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}

.severity-p1 {
  border: 1px solid #991b1b;
}

.severity-p2 {
  border: 1px solid #c2410c;
}

.severity-p3 {
  border: 1px solid #92400e;
}

.severity-p4 {
  border: 1px solid #6b7280;
}

.severity-default {
  border: 1px solid #6b7280;
}

/* Dark mode adjustments for status and severity badges - border only */
body.body--dark {
  .status-open {
    border: 1px solid #fca5a5;
  }

  .status-acknowledged {
    border: 1px solid #fbbf24;
  }

  .status-resolved {
    border: 1px solid #6ee7b7;
  }

  .status-default {
    border: 1px solid #d1d5db;
  }

  .severity-p1 {
    border: 1px solid #fca5a5;
  }

  .severity-p2 {
    border: 1px solid #fdba74;
  }

  .severity-p3 {
    border: 1px solid #fcd34d;
  }

  .severity-p4 {
    border: 1px solid #d1d5db;
  }

  .severity-default {
    border: 1px solid #d1d5db;
  }
}

/* Dimension badge base styling - matching schema.scss */
.dimension-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin: 2px;
  max-width: 180px;
  overflow: hidden;

  span {
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* "+X more" badge styling - with background */
.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  cursor: help;
  font-weight: 500;
}

body.body--dark .badge-more {
  background: #4b5563;
  color: #d1d5db;
}

/* Color scheme matching schema.scss type badges - border only */
.badge-blue {
  border: 1px solid #1d4ed8;
}

.badge-green {
  border: 1px solid #065f46;
}

.badge-yellow {
  border: 1px solid #92400e;
}

.badge-pink {
  border: 1px solid #9f1239;
}

.badge-purple {
  border: 1px solid #7c3aed;
}

.badge-orange {
  border: 1px solid #c2410c;
}

.badge-cyan {
  border: 1px solid #0e7490;
}

.badge-indigo {
  border: 1px solid #4f46e5;
}

.badge-teal {
  border: 1px solid #0f766e;
}

.badge-red {
  border: 1px solid #dc2626;
}

.badge-gray {
  border: 1px solid #4b5563;
}

.badge-amber {
  border: 1px solid #d97706;
}

.badge-violet {
  border: 1px solid #7c3aed;
}

.badge-rose {
  border: 1px solid #e11d48;
}

/* Dark mode adjustments - border only with lighter colors */
body.body--dark {
  .badge-blue {
    border: 1px solid #93c5fd;
  }

  .badge-green {
    border: 1px solid #6ee7b7;
  }

  .badge-yellow {
    border: 1px solid #fcd34d;
  }

  .badge-pink {
    border: 1px solid #f9a8d4;
  }

  .badge-purple {
    border: 1px solid #c4b5fd;
  }

  .badge-orange {
    border: 1px solid #fdba74;
  }

  .badge-cyan {
    border: 1px solid #67e8f9;
  }

  .badge-indigo {
    border: 1px solid #a5b4fc;
  }

  .badge-teal {
    border: 1px solid #5eead4;
  }

  .badge-red {
    border: 1px solid #fca5a5;
  }

  .badge-gray {
    border: 1px solid #d1d5db;
  }

  .badge-amber {
    border: 1px solid #fbbf24;
  }

  .badge-violet {
    border: 1px solid #c4b5fd;
  }

  .badge-rose {
    border: 1px solid #fda4af;
  }
}

/* Action buttons styling */
.action-buttons {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.action-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  transition: all 0.2s ease;
  border-radius: 6px;
}

.action-btn:hover {
  transform: translateY(-1px);
}

/* Acknowledge button - eye/visibility icon */
.acknowledge-btn {
  color: #d97706;
}

.acknowledge-btn:hover {
  background: #fef3c7;
  color: #92400e;
}

/* Resolve button - checkmark icon */
.resolve-btn {
  color: #059669;
}

.resolve-btn:hover {
  background: #d1fae5;
  color: #065f46;
}

/* Reopen button - refresh icon */
.reopen-btn {
  color: #ea580c;
}

.reopen-btn:hover {
  background: #fed7aa;
  color: #c2410c;
}

/* Dark mode adjustments for action buttons */
body.body--dark {
  .acknowledge-btn {
    color: #fbbf24;
  }

  .acknowledge-btn:hover {
    background: #78350f;
    color: #fde68a;
  }

  .resolve-btn {
    color: #34d399;
  }

  .resolve-btn:hover {
    background: #065f46;
    color: #6ee7b7;
  }

  .reopen-btn {
    color: #fb923c;
  }

  .reopen-btn:hover {
    background: #7c2d12;
    color: #fdba74;
  }
}
</style>
