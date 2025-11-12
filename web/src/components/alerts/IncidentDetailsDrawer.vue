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
  <q-drawer
    v-model="drawerOpen"
    side="right"
    :width="800"
    behavior="mobile"
    elevated
    class="incident-details-drawer"
  >
    <div class="tw-h-full tw-flex tw-flex-col">
      <!-- Header -->
      <div
        class="tw-p-4 tw-border-b tw-flex tw-justify-between tw-items-center"
      >
        <div class="tw-flex tw-items-center tw-gap-3">
          <h6 class="tw-m-0 tw-text-lg tw-font-semibold">Incident Details</h6>
          <q-badge
            v-if="incident"
            :color="getStatusColor(incident.status)"
            :label="getStatusLabel(incident.status)"
            class="tw-px-3 tw-py-1"
          />
        </div>
        <q-btn
          flat
          round
          dense
          icon="close"
          @click="closeDrawer"
        />
      </div>

      <!-- Content -->
      <div
        v-if="loading"
        class="tw-flex tw-items-center tw-justify-center tw-flex-1"
      >
        <q-spinner size="lg" color="primary" />
      </div>

      <div
        v-else-if="incident"
        class="tw-flex-1 tw-overflow-y-auto tw-p-4"
      >
        <!-- Incident Info -->
        <q-card flat bordered class="tw-mb-4">
          <q-card-section>
            <div class="tw-text-sm tw-font-semibold tw-mb-3">
              Incident Information
            </div>

            <div class="tw-grid tw-grid-cols-2 tw-gap-4">
              <div>
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Incident ID
                </div>
                <div class="tw-font-mono tw-text-sm">
                  {{ incident.incident_id }}
                </div>
              </div>

              <div>
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">Created</div>
                <div class="tw-text-sm">
                  {{ formatTimestamp(incident.created_at) }}
                </div>
              </div>

              <div>
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Last Updated
                </div>
                <div class="tw-text-sm">
                  {{ formatTimestamp(incident.updated_at) }}
                </div>
              </div>

              <div v-if="incident.resolved_at">
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">Resolved</div>
                <div class="tw-text-sm">
                  {{ formatTimestamp(incident.resolved_at) }}
                </div>
              </div>

              <div>
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Total Alerts
                </div>
                <div class="tw-text-sm tw-font-semibold">
                  {{ incident.alert_count }}
                </div>
              </div>

              <div v-if="incident.temporal_only_count > 0">
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Temporal Only
                </div>
                <div class="tw-text-sm">{{ incident.temporal_only_count }}</div>
              </div>

              <div v-if="incident.primary_correlation_type">
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Correlation Type
                </div>
                <q-badge
                  :color="
                    getCorrelationTypeColor(incident.primary_correlation_type)
                  "
                  :label="
                    getCorrelationTypeLabel(incident.primary_correlation_type)
                  "
                  class="tw-px-2 tw-py-1"
                />
              </div>

              <div v-if="incident.correlation_confidence">
                <div class="tw-text-xs tw-text-gray-500 tw-mb-1">
                  Confidence
                </div>
                <q-badge
                  :color="getConfidenceColor(incident.correlation_confidence)"
                  :label="incident.correlation_confidence?.toUpperCase()"
                  class="tw-px-2 tw-py-1"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Canonical Dimensions -->
        <q-card flat bordered class="tw-mb-4">
          <q-card-section>
            <div class="tw-text-sm tw-font-semibold tw-mb-3">
              Canonical Dimensions
            </div>
            <div class="tw-flex tw-flex-wrap tw-gap-2">
              <q-chip
                v-for="(value, key) in incident.canonical_dimensions"
                :key="key"
                color="primary"
                text-color="white"
                size="md"
              >
                <strong>{{ key }}:</strong>&nbsp;{{ value }}
              </q-chip>
            </div>
          </q-card-section>
        </q-card>

        <!-- Status Actions -->
        <q-card flat bordered class="tw-mb-4">
          <q-card-section>
            <div class="tw-text-sm tw-font-semibold tw-mb-3">Update Status</div>
            <div class="tw-flex tw-gap-2">
              <q-btn
                :disable="incident.status === 'open'"
                :color="incident.status === 'open' ? 'grey' : 'negative'"
                label="Open"
                @click="updateStatus('open')"
                no-caps
              />
              <q-btn
                :disable="incident.status === 'acknowledged'"
                :color="incident.status === 'acknowledged' ? 'grey' : 'warning'"
                label="Acknowledge"
                @click="updateStatus('acknowledged')"
                no-caps
              />
              <q-btn
                :disable="incident.status === 'resolved'"
                :color="incident.status === 'resolved' ? 'grey' : 'positive'"
                label="Resolve"
                @click="updateStatus('resolved')"
                no-caps
              />
            </div>
          </q-card-section>
        </q-card>

        <!-- Correlated Alerts -->
        <q-card flat bordered>
          <q-card-section>
            <div class="tw-text-sm tw-font-semibold tw-mb-3">
              Correlated Alerts ({{ alerts.length }})
            </div>

            <q-list bordered separator>
              <q-item
                v-for="alert in alerts"
                :key="alert.alert_id"
                class="tw-py-2"
              >
                <q-item-section>
                  <q-item-label class="tw-font-semibold">
                    {{ alert.alert_name }}
                  </q-item-label>
                  <q-item-label caption>
                    Alert ID: {{ alert.alert_id }}
                  </q-item-label>
                  <q-item-label caption>
                    Triggered: {{ formatTimestamp(alert.triggered_at) }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge
                    :color="
                      alert.match_type === 'semantic_fields'
                        ? 'primary'
                        : 'secondary'
                    "
                    :label="getMatchTypeLabel(alert.match_type)"
                    class="tw-px-2 tw-py-1"
                  />
                </q-item-section>
              </q-item>

              <q-item v-if="alerts.length === 0">
                <q-item-section>
                  <q-item-label class="tw-text-center tw-text-gray-500">
                    No alerts found
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </div>

      <div
        v-else
        class="tw-flex-1 tw-flex tw-items-center tw-justify-center tw-text-gray-500"
      >
        Failed to load incident details
      </div>
    </div>
  </q-drawer>
</template>

<script lang="ts" setup>
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import alertsService from "@/services/alerts";
import { formatDistanceToNow } from "date-fns";

interface Props {
  modelValue: boolean;
  incidentId: string;
}

const props = defineProps<Props>();
const emit = defineEmits(["update:modelValue", "updated"]);

const store = useStore();
const $q = useQuasar();

const drawerOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const loading = ref(false);
const incident = ref<any>(null);
const alerts = ref<any[]>([]);

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

const getConfidenceColor = (confidence: string) => {
  switch (confidence?.toLowerCase()) {
    case "high":
      return "positive";
    case "medium":
      return "warning";
    case "low":
      return "negative";
    default:
      return "grey";
  }
};

const getMatchTypeLabel = (type: string) => {
  if (!type) return "Unknown";
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "--";
  const date = new Date(timestamp / 1000);
  return formatDistanceToNow(date, { addSuffix: true });
};

const loadIncidentDetails = async () => {
  loading.value = true;
  try {
    const response = await alertsService.getIncident(
      store.state.selectedOrganization.identifier,
      props.incidentId,
    );
    incident.value = response.data.incident;
    alerts.value = response.data.alerts || [];
  } catch (error: any) {
    $q.notify({
      type: "negative",
      message:
        "Failed to load incident details: " +
        (error?.message || "Unknown error"),
      timeout: 3000,
    });
  } finally {
    loading.value = false;
  }
};

const updateStatus = async (newStatus: string) => {
  try {
    await alertsService.updateIncidentStatus(
      store.state.selectedOrganization.identifier,
      props.incidentId,
      newStatus,
    );

    $q.notify({
      type: "positive",
      message: `Incident status updated to ${newStatus}`,
      timeout: 2000,
    });

    // Reload details
    await loadIncidentDetails();
    emit("updated");
  } catch (error: any) {
    $q.notify({
      type: "negative",
      message:
        "Failed to update incident status: " +
        (error?.message || "Unknown error"),
      timeout: 3000,
    });
  }
};

const closeDrawer = () => {
  drawerOpen.value = false;
};

watch(
  () => props.incidentId,
  (newId) => {
    if (newId && props.modelValue) {
      loadIncidentDetails();
    }
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen && props.incidentId) {
      loadIncidentDetails();
    }
  },
);
</script>

<style scoped lang="scss">
.incident-details-drawer {
  :deep(.q-drawer__content) {
    overflow: hidden;
  }
}
</style>
