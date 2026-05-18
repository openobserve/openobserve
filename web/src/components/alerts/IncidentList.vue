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
  <div data-test="incident-list" class="flex q-mt-xs">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] tw:pb-[0.625rem]">
      <!-- Header with title and search -->
      <div class="card-container tw:mb-[0.625rem]">
        <div class="tw:flex tw:justify-between tw:items-center tw:w-full tw:py-3 tw:px-4 tw:h-[68px]">
          <div class="q-table__title tw:font-[600]" data-test="incidents-list-title">
            {{ t("alerts.incidents.title") }}
          </div>

          <div class="tw:flex tw:items-center tw:gap-2">
            <OButton
              variant="outline"
              size="sm"
              :loading="loading"
              @click="refreshIncidents"
              data-test="incident-refresh-btn"
            >Refresh</OButton>
            <OInput
              v-model="searchQuery"
              :placeholder="t('alerts.incidents.search')"
              data-test="incident-search-input"
              clearable
              class="o2-search-input"
            >
              <template #prepend>
                <OIcon class="o2-search-input-icon" name="search" size="sm" />
              </template>
            </OInput>
          </div>
        </div>
      </div>
      <!-- Incidents table -->
      <div class="tw:w-full tw:h-full tw:pb-[0.625rem]">
      <div class="card-container tw:h-[calc(100vh-128px)]">
        <OTable
          ref="qTableRef"
          :data="visibleIncidents"
          :columns="columns"
          :loading="loading"
          row-key="id"
          pagination="client"
          :page-size="pageSize"
          :page-size-options="[20, 50, 100, 250, 500]"
          sorting="client"
          filter-mode="client"
          :default-columns="false"
          :show-global-filter="false"
          class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
          :class="{
            'tw:h-[calc(100vh-128px)]': !loading && visibleIncidents.length > 0,
          }"
          data-test="incident-list-table"
          @row-click="viewIncident"
        >
        <template #cell-status="{ row }">
          <span
            class="status-badge"
            :class="getStatusColorClass(row.status)"
          >
            {{ getStatusLabel(row.status) }}
          </span>
        </template>
        <template #cell-severity="{ row }">
          <span
            class="severity-badge"
            :class="getSeverityColorClass(row.severity)"
          >
            {{ row.severity }}
          </span>
        </template>
        <template #cell-title="{ row }">
          <div class="tw:flex tw:items-center tw:gap-1">
            <span class="tw:font-medium">
              {{ row.title || formatDimensions(row.group_values) }}
            </span>
          </div>
        </template>
        <template #cell-dimensions="{ row }">
          <div class="tw:flex tw:flex-wrap tw:gap-1">
            <span
              v-for="[key, value] in getSortedDimensions(row.group_values).slice(0, 2)"
              :key="key"
              class="dimension-badge"
              :class="getDimensionColorClass(key)"
            >
              <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
              <OTooltip :delay="300" :content="key + '=' + value" />
            </span>
            <span
              v-if="getSortedDimensions(row.group_values).length > 2"
              class="dimension-badge badge-more"
            >
              +{{ getSortedDimensions(row.group_values).length - 2 }} more
              <OTooltip :delay="300" :max-width="'28rem'">
                <template #content>
                  <div class="tw:space-y-1">
                    <div
                      v-for="[key, value] in getSortedDimensions(row.group_values).slice(2)"
                      :key="key"
                    >
                      <span class="tw:font-medium">{{ key }}</span>=<span>{{ value }}</span>
                    </div>
                  </div>
                </template>
              </OTooltip>
            </span>
          </div>
        </template>
        <template #cell-actions="{ row }">
          <div class="action-buttons">
            <OButton
              v-if="row.status === 'open'"
              variant="ghost-warning"
              size="icon-circle-sm"
              @click.stop="acknowledgeIncident(row)"
              data-test="incident-ack-btn"
            ><OIcon name="visibility" size="sm" /><OTooltip :content="t('alerts.incidents.acknowledge')" /></OButton>
            <OButton
              v-if="row.status !== 'resolved'"
              variant="ghost-primary"
              size="icon-circle-sm"
              @click.stop="resolveIncident(row)"
              data-test="incident-resolve-btn"
            ><OIcon name="task-alt" size="sm" /><OTooltip :content="t('alerts.incidents.resolve')" /></OButton>
            <OButton
              v-if="row.status === 'resolved'"
              variant="ghost-warning"
              size="icon-circle-sm"
              @click.stop="reopenIncident(row)"
              data-test="incident-reopen-btn"
            ><OIcon name="restart-alt" size="sm" /><OTooltip :content="t('alerts.incidents.reopen')" /></OButton>
          </div>
        </template>

        <!-- Empty state -->
        <template #empty>
          <div v-if="!loading" class="tw:flex tw:items-center tw:justify-center tw:w-full tw:h-full">
            <no-data />
          </div>
        </template>

        <!-- Bottom -->
        <template #bottom>
          <div class="bottom-btn tw:h-[48px]">
            <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[100px] tw:mr-md">
              {{ visibleIncidents.length }} {{ visibleIncidents.length === 1 ? 'Incident' : 'Incidents' }}
            </div>
          </div>
        </template>
        </OTable>
      </div>
    </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { date } from "quasar";
import incidentsService, { Incident } from "@/services/incidents";
import NoData from "../shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "IncidentList",
  components: {
    NoData,
    OButton,
    OSpinner,
    OInput,
    OTooltip,
    OIcon,
    OTable,
},
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const qTableRef: any = ref(null);
    const loading = ref(false);
    const allIncidents = ref<Incident[]>([]);
    const searchQuery = ref("");
    const isRestoringState = ref(false);
    const pageSize = ref(20);

    const columns: OTableColumnDef[] = [
      {
        id: "#",
        header: "#",
        accessorKey: "#",
        size: 67,
        meta: { align: "center" },
      },
      {
        id: "title",
        header: t("alerts.incidents.title_field"),
        accessorKey: "title",
        meta: { align: "left" },
      },
      {
        id: "severity",
        header: t("alerts.incidents.severity"),
        accessorKey: "severity",
        size: 100,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("alerts.incidents.status"),
        accessorKey: "status",
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "dimensions",
        header: "Dimensions",
        accessorKey: "group_values",
        size: 400,
        meta: { align: "left" },
      },
      {
        id: "alert_count",
        header: t("alerts.incidents.alertCount"),
        accessorKey: "alert_count",
        size: 80,
        meta: { align: "center" },
      },
      {
        id: "last_alert_at",
        header: t("alerts.incidents.lastAlertAt"),
        accessorKey: "last_alert_at",
        sortable: true,
        size: 180,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alerts.incidents.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center" },
      },
    ];

    // Frontend search filter function
    const applyFrontendSearch = (incidentsList: Incident[], query: string) => {
      if (!query || query.trim() === "") {
        return incidentsList;
      }
      const searchLower = query.toLowerCase().trim();
      return incidentsList.filter((incident) => {
        const title = incident.title || formatDimensions(incident.group_values);
        if (title.toLowerCase().includes(searchLower)) return true;
        const statusLabel = getStatusLabel(incident.status).toLowerCase();
        if (statusLabel.includes(searchLower) || incident.status.toLowerCase().includes(searchLower)) return true;
        if (incident.severity.toLowerCase().includes(searchLower)) return true;
        if (incident.group_values) {
          const dimensionsStr = Object.entries(incident.group_values)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")
            .toLowerCase();
          if (dimensionsStr.includes(searchLower)) return true;
        }
        return false;
      });
    };

    const visibleIncidents = computed(() => {
      const filtered = applyFrontendSearch(allIncidents.value, searchQuery.value);
      return filtered.map((incident, i) => ({ ...incident, "#": i + 1 }));
    });

    const loadIncidents = async () => {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const limit = 1000;
        const offset = 0;
        const keyword = undefined;

        const response = await incidentsService.list(
          org,
          undefined,
          limit,
          offset,
          keyword
        );

        allIncidents.value = response.data.incidents;
        store.dispatch('incidents/setCachedData', response.data.incidents);
      } catch (error: any) {
        toast({
          variant: "error",
          message: t("alerts.incidents.errorLoading"),
        });
        console.error("Failed to load incidents:", error);
      } finally {
        loading.value = false;
      }
    };

    const viewIncident = (incident: Incident) => {
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: { page: 1, rowsPerPage: 20 },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });

      router.push({
        name: "incidentDetail",
        params: { id: incident.id },
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    };

    const updateStatus = async (incident: Incident, newStatus: "open" | "acknowledged" | "resolved") => {
      try {
        const org = store.state.selectedOrganization.identifier;
        await incidentsService.updateStatus(org, incident.id, newStatus);
        toast({
          variant: "success",
          message: t("alerts.incidents.statusUpdated"),
        });
        loadIncidents();
        store.dispatch('incidents/setShouldRefresh', true);
      } catch (error: any) {
        toast({
          variant: "error",
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
        case "open": return "status-open";
        case "acknowledged": return "status-acknowledged";
        case "resolved": return "status-resolved";
        default: return "status-default";
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case "open": return t("alerts.incidents.statusOpen");
        case "acknowledged": return t("alerts.incidents.statusAcknowledged");
        case "resolved": return t("alerts.incidents.statusResolved");
        default: return status;
      }
    };

    const getSeverityColorClass = (severity: string) => {
      switch (severity) {
        case "P1": return "severity-p1";
        case "P2": return "severity-p2";
        case "P3": return "severity-p3";
        case "P4": return "severity-p4";
        default: return "severity-default";
      }
    };

    const formatTimestamp = (timestamp: number) => {
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
      if (!dimensions || Object.keys(dimensions).length === 0) return [];
      return Object.keys(dimensions)
        .sort()
        .map(key => [key, dimensions[key]] as [string, string]);
    };

    const getDimensionColorClass = (key: string) => {
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
      if (colorMap[key]) return colorMap[key];
      const lowerKey = key.toLowerCase();
      for (const [pattern, className] of Object.entries(colorMap)) {
        if (lowerKey.includes(pattern)) return className;
      }
      const classes = ['badge-gray', 'badge-amber', 'badge-violet', 'badge-rose'];
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash;
      }
      return classes[Math.abs(hash) % classes.length];
    };

    const restoreStateFromStore = (): boolean => {
      const savedState = store.state.incidents.incidents;
      const cachedData = store.state.incidents.cachedData;
      const isInitialized = store.state.incidents.isInitialized;
      const currentOrg = store.state.selectedOrganization.identifier;

      if (isInitialized && savedState && savedState.organizationIdentifier &&
          savedState.organizationIdentifier !== currentOrg) {
        store.dispatch('incidents/resetIncidents');
        searchQuery.value = "";
        allIncidents.value = [];
        return false;
      }
      else if (isInitialized && savedState &&
               savedState.organizationIdentifier === currentOrg) {
        isRestoringState.value = true;
        if (cachedData && cachedData.length > 0) {
          allIncidents.value = cachedData;
        }
        if (savedState.searchQuery !== undefined) {
          searchQuery.value = savedState.searchQuery;
        }
        return true;
      }
      return false;
    };

    onMounted(async () => {
      const hasRestoredState = restoreStateFromStore();
      const shouldRefresh = store.state.incidents?.shouldRefresh || false;

      if (allIncidents.value.length === 0 || shouldRefresh) {
        await loadIncidents();
        if (shouldRefresh) {
          store.dispatch('incidents/setShouldRefresh', false);
        }
      }

      if (!store.state.incidents.isInitialized) {
        store.dispatch('incidents/setIsInitialized', true);
      }

      if (hasRestoredState) {
        store.dispatch('incidents/setIncidents', {
          searchQuery: searchQuery.value,
          pagination: { page: 1, rowsPerPage: 20 },
          organizationIdentifier: store.state.selectedOrganization.identifier
        });
      }

      await nextTick();
      isRestoringState.value = false;
    });

    watch(() => searchQuery.value, () => {
      if (isRestoringState.value) return;
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        pagination: { page: 1, rowsPerPage: 20 },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });
    });

    const refreshIncidents = async () => {
      await loadIncidents();
      toast({
        variant: "success",
        message: "Incidents refreshed",
        timeout: 1500,
      });
    };

    return {
      t,
      loading,
      allIncidents,
      visibleIncidents,
      searchQuery,
      columns,
      pageSize,
      loadIncidents,
      refreshIncidents,
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
      qTableRef,
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

/* Status badge styling */
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

/* Severity badge styling */
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

/* Dark mode adjustments for status and severity badges */
body.body--dark {
  .status-open { border: 1px solid #fca5a5; }
  .status-acknowledged { border: 1px solid #fbbf24; }
  .status-resolved { border: 1px solid #6ee7b7; }
  .status-default { border: 1px solid #d1d5db; }
  .severity-p1 { border: 1px solid #fca5a5; }
  .severity-p2 { border: 1px solid #fdba74; }
  .severity-p3 { border: 1px solid #fcd34d; }
  .severity-p4 { border: 1px solid #d1d5db; }
  .severity-default { border: 1px solid #d1d5db; }
}

/* Dimension badge base styling */
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

.badge-more {
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 500;
}

body.body--dark .badge-more {
  background: #4b5563;
  color: #d1d5db;
}

/* Color scheme matching schema.scss type badges */
.badge-blue { border: 1px solid #1d4ed8; }
.badge-green { border: 1px solid #065f46; }
.badge-yellow { border: 1px solid #92400e; }
.badge-pink { border: 1px solid #9f1239; }
.badge-purple { border: 1px solid #7c3aed; }
.badge-orange { border: 1px solid #c2410c; }
.badge-cyan { border: 1px solid #0e7490; }
.badge-indigo { border: 1px solid #4f46e5; }
.badge-teal { border: 1px solid #0f766e; }
.badge-red { border: 1px solid #dc2626; }
.badge-gray { border: 1px solid #4b5563; }
.badge-amber { border: 1px solid #d97706; }
.badge-violet { border: 1px solid #7c3aed; }
.badge-rose { border: 1px solid #e11d48; }

/* Dark mode adjustments */
body.body--dark {
  .badge-blue { border: 1px solid #93c5fd; }
  .badge-green { border: 1px solid #6ee7b7; }
  .badge-yellow { border: 1px solid #fcd34d; }
  .badge-pink { border: 1px solid #f9a8d4; }
  .badge-purple { border: 1px solid #c4b5fd; }
  .badge-orange { border: 1px solid #fdba74; }
  .badge-cyan { border: 1px solid #67e8f9; }
  .badge-indigo { border: 1px solid #a5b4fc; }
  .badge-teal { border: 1px solid #5eead4; }
  .badge-red { border: 1px solid #fca5a5; }
  .badge-gray { border: 1px solid #d1d5db; }
  .badge-amber { border: 1px solid #fbbf24; }
  .badge-violet { border: 1px solid #c4b5fd; }
  .badge-rose { border: 1px solid #fda4af; }
}

/* Action buttons styling */
.action-buttons {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}
</style>
