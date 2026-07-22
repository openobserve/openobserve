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
  <div data-test="incident-list" class="incident-list h-full">
    <OPageLayout
      bleed
      :title="t('alerts.incidents.title')"
      icon="notifications-active"
      :subtitle="t('alerts.incidents.subtitle')"
    >
      <OTable
        ref="qTableRef"
        :data="visibleIncidents"
        :columns="columns"
        :frame="false"
        :loading="loading"
        row-key="id"
        pagination="client"
        :page-size="pageSize"
        :page-size-options="[20, 50, 100, 250, 500]"
        sorting="client"
        filter-mode="client"
        :default-columns="false"
        show-index
        :show-global-filter="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="alerts-incident-list"
        data-test="incident-list-table"
        @row-click="viewIncident"
      >
        <template #toolbar>
          <div class="flex items-center justify-between gap-2 w-full">
            <OToggleGroup
              :model-value="statusFilter"
              @update:model-value="(v) => filterByStatus(v as string)"
              data-test="incident-status-filter-group"
            >
              <OToggleGroupItem value="all" size="sm" data-test="incident-status-filter-all">
                <template #icon-left><OIcon name="format-list-bulleted" size="sm" /></template>
                {{ t("alerts.incidents.allStatuses") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="open" size="sm" data-test="incident-status-filter-open">
                <template #icon-left><OIcon name="radio-button-unchecked" size="sm" /></template>
                {{ t("alerts.incidents.statusOpen") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="acknowledged" size="sm" data-test="incident-status-filter-acknowledged">
                <template #icon-left><OIcon name="visibility" size="sm" /></template>
                {{ t("alerts.incidents.statusAcknowledged") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="resolved" size="sm" data-test="incident-status-filter-resolved">
                <template #icon-left><OIcon name="task-alt" size="sm" /></template>
                {{ t("alerts.incidents.statusResolved") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <OSearchInput
              v-model="searchQuery"
              class="w-64"
              :placeholder="t('alerts.incidents.search')"
              data-test="incident-search-input"
              clearable
            />
          </div>
        </template>
        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="incident-list-refresh-btn"
            @click="refreshIncidents"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="alertIncidentsRefresh" />
          </OButton>
        </template>
        <template #cell-status="{ row }">
          <OTag
            type="incidentStatus"
            :value="row.status"
            :label="getStatusLabel(row.status)"
            size="sm"
            data-test="incident-status-badge"
          />
        </template>
        <template #cell-severity="{ row }">
          <OTag
            type="severity"
            :value="row.severity"
            size="sm"
            data-test="incident-severity-badge"
          />
        </template>
        <template #cell-title="{ row }">
          <div class="flex items-center gap-1">
            <span>
              {{ row.title || formatDimensions(row.group_values) }}
            </span>
          </div>
        </template>
        <template #cell-dimensions="{ row }">
          <div class="flex flex-nowrap items-center gap-1 min-w-0 overflow-hidden">
            <ODimensionChip
              v-for="[key, value] in getSortedDimensions(row.group_values).slice(0, 2)"
              :key="key"
              :dim-key="key"
              :value="value"
              :tooltip="true"
              class="min-w-0"
            />
            <OTag
              v-if="getSortedDimensions(row.group_values).length > 2"
              type="countChip"
              value="neutral"
              class="shrink-0"
            >
              +{{ getSortedDimensions(row.group_values).length - 2 }} more
              <OTooltip :delay="300" :max-width="'28rem'">
                <template #content>
                  <div class="space-y-1">
                    <div
                      v-for="[key, value] in getSortedDimensions(row.group_values).slice(2)"
                      :key="key"
                    >
                      <span>{{ key }}</span>=<span>{{ value }}</span>
                    </div>
                  </div>
                </template>
              </OTooltip>
            </OTag>
          </div>
        </template>
        <template #cell-last_alert_at="{ row }">
          <OTimeCell
            :value="row.last_alert_at"
            unit="us"
            mode="absolute"
            :timezone="store.state.timezone"
            empty-label="—"
          />
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end items-center">
            <OButton
              v-if="row.status === 'open'"
              variant="ghost-warning"
              size="icon-sm"
              @click.stop="acknowledgeIncident(row)"
              data-test="incident-ack-btn"
            ><OIcon name="visibility" size="sm" /><OTooltip :content="t('alerts.incidents.acknowledge')" /></OButton>
            <OButton
              v-if="row.status !== 'resolved'"
              variant="ghost-primary"
              size="icon-sm"
              @click.stop="resolveIncident(row)"
              data-test="incident-resolve-btn"
            ><OIcon name="task-alt" size="sm" /><OTooltip :content="t('alerts.incidents.resolve')" /></OButton>
            <OButton
              v-if="row.status === 'resolved'"
              variant="ghost-warning"
              size="icon-sm"
              @click.stop="reopenIncident(row)"
              data-test="incident-reopen-btn"
            ><OIcon name="restart-alt" size="sm" /><OTooltip :content="t('alerts.incidents.reopen')" /></OButton>
          </div>
        </template>

        <!-- Empty state -->
        <template #empty>
          <div v-if="!loading" class="flex items-center justify-center w-full h-full">
            <OEmptyState
              size="hero"
              preset="no-incidents"
              :filtered="!!searchQuery || statusFilter !== 'all'"
              :hide-action="!searchQuery && statusFilter === 'all'"
              @action="(id) => id === 'clear-filters' ? clearFilters() : null"
            />
          </div>
        </template>

        <!-- Bottom -->
        <template #bottom>
          <div class="flex w-full justify-between items-center h-12">
            <div class="text-xs font-normal flex items-center w-25 mr-md">
              {{ visibleIncidents.length }} {{ visibleIncidents.length === 1 ? 'Incident' : 'Incidents' }}
            </div>
          </div>
        </template>
        </OTable>
    </OPageLayout>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, useRoute } from "vue-router";
import { formatToReadable } from "@/utils/date";
import incidentsService, { Incident } from "@/services/incidents";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "IncidentList",
  components: {
    OPageLayout,
    OEmptyState,
    OButton,
    OSearchInput,
    OTooltip,
    OIcon,
    OTable,
    OTag,
    ODimensionChip,
    OTimeCell,
    OToggleGroup,
    OToggleGroupItem,
},
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();

    const qTableRef: any = ref(null);
    const loading = ref(false);
    const allIncidents = ref<Incident[]>([]);
    const searchQuery = ref("");
    const validStatuses = ["all", "open", "acknowledged", "resolved"];
    const statusFilter = ref(
      validStatuses.includes(route.query.status as string)
        ? (route.query.status as string)
        : "all"
    );
    const isRestoringState = ref(false);
    const pageSize = ref(20);

    const columns: OTableColumnDef[] = [
      {
        id: "title",
        header: t("alerts.incidents.title_field"),
        accessorKey: "title",
        resizable: true,
        hideable: true,
        size: COL.name,
        minSize: 160,
        meta: { align: "left", flex: true },
      },
      {
        id: "severity",
        header: t("alerts.incidents.severity"),
        accessorKey: "severity",
        resizable: true,
        hideable: true,
        size: 100,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("alerts.incidents.status"),
        accessorKey: "status",
        resizable: true,
        hideable: true,
        size: 120,
        meta: { align: "left" },
      },
      {
        id: "dimensions",
        header: "Dimensions",
        accessorKey: "group_values",
        resizable: true,
        hideable: true,
        size: 500,
        meta: { align: "left" },
      },
      {
        id: "alert_count",
        header: t("alerts.incidents.alertCount"),
        accessorKey: "alert_count",
        resizable: true,
        hideable: true,
        size: 80,
        meta: { align: "right" },
      },
      {
        id: "last_alert_at",
        header: t("alerts.incidents.lastAlertAt"),
        accessorKey: "last_alert_at",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.dateAbsolute,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("alerts.incidents.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
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
      let filtered = allIncidents.value;
      if (statusFilter.value !== "all") {
        filtered = filtered.filter((incident) => incident.status === statusFilter.value);
      }
      filtered = applyFrontendSearch(filtered, searchQuery.value);
      return filtered;
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
        statusFilter: statusFilter.value,
        pagination: { page: 1, rowsPerPage: 20 },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });

      router.push({
        name: "incidentDetail",
        params: { id: incident.id },
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    };

    const savePageState = () => {
      if (isRestoringState.value) return;
      store.dispatch('incidents/setIncidents', {
        searchQuery: searchQuery.value,
        statusFilter: statusFilter.value,
        pagination: { page: 1, rowsPerPage: 20 },
        organizationIdentifier: store.state.selectedOrganization.identifier
      });
    };

    const filterByStatus = (value: string) => {
      statusFilter.value = value;
      store.dispatch('incidents/setStatusFilter', value);
      savePageState();
    };

    const clearFilters = () => {
      searchQuery.value = "";
      filterByStatus("all");
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

    const formatTimestamp = (timestamp: number) => {
      return formatToReadable(timestamp);
    };

    const formatDimensions = (
      dimensions: Record<string, string> | undefined,
    ) => {
      if (!dimensions || Object.keys(dimensions).length === 0) {
        return "Unknown";
      }
      return Object.entries(dimensions)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
    };

    const getSortedDimensions = (
      dimensions: Record<string, string> | undefined,
    ) => {
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
        if (savedState.statusFilter !== undefined) {
          statusFilter.value = savedState.statusFilter;
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
          statusFilter: statusFilter.value,
          pagination: { page: 1, rowsPerPage: 20 },
          organizationIdentifier: store.state.selectedOrganization.identifier
        });
      }

      await nextTick();
      isRestoringState.value = false;
    });

    watch(() => searchQuery.value, savePageState);

    const refreshIncidents = async () => {
      await loadIncidents();
      toast({
        variant: "success",
        message: "Incidents refreshed",
        timeout: 1500,
      });
    };

    useShortcuts([
      { id: "alertIncidentsRefresh", handler: () => { if (!isInputFocused()) refreshIncidents(); } },
    ]);

    return {
      t,
      loading,
      allIncidents,
      visibleIncidents,
      searchQuery,
      statusFilter,
      filterByStatus,
      clearFilters,
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
