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
  <div class="incident-list tw-w-full tw-h-full">
    <q-table
      :rows="incidents"
      :columns="columns"
      row-key="incident_id"
      :pagination="pagination"
      :loading="loading"
      class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
      style="height: 100%"
      @row-click="showIncidentDetails"
    >
      <template #body-cell-status="props">
        <q-td :props="props">
          <q-badge
            :color="getStatusColor(props.row.status)"
            :label="getStatusLabel(props.row.status)"
            class="tw-px-2 tw-py-1"
          />
        </q-td>
      </template>

      <template #body-cell-created_at="props">
        <q-td :props="props">
          {{ formatTimestamp(props.row.created_at) }}
        </q-td>
      </template>

      <template #body-cell-updated_at="props">
        <q-td :props="props">
          {{ formatTimestamp(props.row.updated_at) }}
        </q-td>
      </template>

      <template #body-cell-canonical_dimensions="props">
        <q-td :props="props">
          <div class="tw-flex tw-flex-wrap tw-gap-1">
            <q-chip
              v-for="(value, key) in props.row.canonical_dimensions"
              :key="key"
              dense
              size="sm"
              class="tw-text-xs"
            >
              {{ key }}: {{ value }}
            </q-chip>
          </div>
        </q-td>
      </template>

      <template #body-cell-primary_correlation_type="props">
        <q-td :props="props">
          <q-badge
            :color="getCorrelationTypeColor(props.row.primary_correlation_type)"
            :label="getCorrelationTypeLabel(props.row.primary_correlation_type)"
            class="tw-px-2 tw-py-1"
          />
        </q-td>
      </template>

      <template #body-cell-alert_count="props">
        <q-td :props="props">
          <div class="tw-flex tw-items-center tw-gap-2">
            <span class="tw-font-semibold">{{ props.row.alert_count }}</span>
            <span
              v-if="props.row.temporal_only_count > 0"
              class="tw-text-xs tw-text-gray-500"
            >
              ({{ props.row.temporal_only_count }} temporal)
            </span>
          </div>
        </q-td>
      </template>

      <template #no-data>
        <div class="tw-text-center tw-py-8 tw-text-gray-500">
          No incidents found
        </div>
      </template>
    </q-table>

    <!-- Incident Details Drawer -->
    <IncidentDetailsDrawer
      v-if="selectedIncident"
      v-model="showDetailsDrawer"
      :incident-id="selectedIncident.incident_id"
      @updated="refreshIncidents"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import alertsService from "@/services/alerts";
import { formatDistanceToNow } from "date-fns";
import IncidentDetailsDrawer from "./IncidentDetailsDrawer.vue";

const store = useStore();
const $q = useQuasar();

const incidents = ref<any[]>([]);
const loading = ref(false);
const showDetailsDrawer = ref(false);
const selectedIncident = ref<any>(null);

const pagination = ref({
  rowsPerPage: 50,
});

const columns = [
  {
    name: "status",
    label: "Status",
    field: "status",
    align: "left",
    sortable: true,
    style: "width: 120px",
  },
  {
    name: "created_at",
    label: "Created",
    field: "created_at",
    align: "left",
    sortable: true,
    style: "width: 150px",
  },
  {
    name: "alert_count",
    label: "Alerts",
    field: "alert_count",
    align: "left",
    sortable: true,
    style: "width: 120px",
  },
  {
    name: "canonical_dimensions",
    label: "Dimensions",
    field: "canonical_dimensions",
    align: "left",
    style: "min-width: 200px",
  },
  {
    name: "primary_correlation_type",
    label: "Correlation",
    field: "primary_correlation_type",
    align: "left",
    sortable: true,
    style: "width: 150px",
  },
  {
    name: "updated_at",
    label: "Updated",
    field: "updated_at",
    align: "left",
    sortable: true,
    style: "width: 150px",
  },
];

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
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
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const getCorrelationTypeColor = (type: string) => {
  switch (type) {
    case "semantic_fields":
      return "primary";
    case "mixed":
      return "info";
    case "temporal_only":
      return "secondary";
    default:
      return "grey";
  }
};

const getCorrelationTypeLabel = (type: string) => {
  if (!type) return "Unknown";
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "--";
  // Convert microseconds to milliseconds
  const date = new Date(timestamp / 1000);
  return formatDistanceToNow(date, { addSuffix: true });
};

const loadIncidents = async () => {
  loading.value = true;
  try {
    const response = await alertsService.listIncidents(
      store.state.selectedOrganization.identifier,
    );
    incidents.value = response.data.incidents || [];
  } catch (error: any) {
    $q.notify({
      type: "negative",
      message:
        "Failed to load incidents: " + (error?.message || "Unknown error"),
      timeout: 3000,
    });
  } finally {
    loading.value = false;
  }
};

const refreshIncidents = () => {
  loadIncidents();
};

const showIncidentDetails = (evt: any, row: any) => {
  selectedIncident.value = row;
  showDetailsDrawer.value = true;
};

onMounted(() => {
  loadIncidents();
});

defineExpose({
  refreshIncidents,
});
</script>

<style scoped lang="scss">
.incident-list {
  :deep(.q-table__card) {
    box-shadow: none;
  }

  :deep(.q-table tbody td) {
    cursor: pointer;
  }

  :deep(.q-table tbody tr:hover) {
    background-color: rgba(0, 0, 0, 0.03);
  }
}

.dark {
  .incident-list {
    :deep(.q-table tbody tr:hover) {
      background-color: rgba(255, 255, 255, 0.05);
    }
  }
}
</style>
