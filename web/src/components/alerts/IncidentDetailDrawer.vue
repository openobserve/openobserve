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
    v-model="isOpen"
    side="right"
    :width="900"
    bordered
    overlay
    elevated
    class="incident-detail-drawer"
    data-test="incident-detail-drawer"
  >
    <div v-if="incidentDetails" class="tw-h-full tw-flex tw-flex-col">
      <!-- Header -->
      <div class="tw-p-4 tw-border-b tw-flex tw-justify-between tw-items-center">
        <div>
          <div class="tw-text-lg tw-font-semibold">
            {{ incidentDetails.title || t("alerts.incidents.header") }}
          </div>
          <div class="tw-text-sm tw-text-gray-500">
            ID: {{ incidentDetails.id }}
          </div>
        </div>
        <q-btn flat round icon="close" @click="close" />
      </div>

      <!-- Content -->
      <div class="tw-flex-1 tw-overflow-auto tw-p-4">
        <!-- Status, Severity, Alerts row -->
        <div class="tw-flex tw-items-center tw-gap-4 tw-mb-3">
          <div class="tw-flex tw-flex-col tw-items-center">
            <span class="tw-text-xs tw-text-gray-500 tw-mb-1">{{ t("alerts.incidents.status") }}</span>
            <q-badge
              :color="getStatusColor(incidentDetails.status)"
              :label="getStatusLabel(incidentDetails.status)"
              class="tw-text-sm"
            />
          </div>
          <div class="tw-flex tw-flex-col tw-items-center">
            <span class="tw-text-xs tw-text-gray-500 tw-mb-1">{{ t("alerts.incidents.severity") }}</span>
            <q-badge
              :color="getSeverityColor(incidentDetails.severity)"
              :label="incidentDetails.severity"
              class="tw-text-sm"
            />
          </div>
          <div class="tw-flex tw-flex-col tw-items-center">
            <span class="tw-text-xs tw-text-gray-500 tw-mb-1">{{ t("alerts.incidents.alertCount") }}</span>
            <q-badge color="grey-7" :label="incidentDetails.alert_count" class="tw-text-sm" />
          </div>
          <!-- Divider -->
          <div class="tw-h-8 tw-w-px tw-bg-gray-300"></div>
          <!-- Action buttons -->
          <div class="tw-flex tw-gap-2">
            <q-btn
              v-if="incidentDetails.status === 'open'"
              color="warning"
              no-caps
              @click="acknowledgeIncident"
              :loading="updating"
            >
              {{ t("alerts.incidents.acknowledge") }}
            </q-btn>
            <q-btn
              v-if="incidentDetails.status !== 'resolved'"
              color="positive"
              no-caps
              @click="resolveIncident"
              :loading="updating"
            >
              {{ t("alerts.incidents.resolve") }}
            </q-btn>
            <q-btn
              v-if="incidentDetails.status === 'resolved'"
              color="negative"
              no-caps
              @click="reopenIncident"
              :loading="updating"
            >
              {{ t("alerts.incidents.reopen") }}
            </q-btn>
          </div>
        </div>

        <!-- Timestamps - inline -->
        <div class="tw-flex tw-flex-wrap tw-gap-x-4 tw-gap-y-1 tw-text-xs tw-mb-3">
          <span>
            <span class="tw-text-gray-500">{{ t("alerts.incidents.firstAlertAt") }}:</span>
            <span class="tw-ml-1">{{ formatTimestamp(incidentDetails.first_alert_at) }}</span>
          </span>
          <span>
            <span class="tw-text-gray-500">{{ t("alerts.incidents.lastAlertAt") }}:</span>
            <span class="tw-ml-1">{{ formatTimestamp(incidentDetails.last_alert_at) }}</span>
          </span>
          <span v-if="incidentDetails.resolved_at">
            <span class="tw-text-gray-500">{{ t("alerts.incidents.resolvedAt") }}:</span>
            <span class="tw-ml-1">{{ formatTimestamp(incidentDetails.resolved_at) }}</span>
          </span>
        </div>

        <!-- Dimensions & Topology - side by side -->
        <div class="tw-flex tw-gap-3 tw-mb-3">
          <!-- Stable Dimensions -->
          <div class="tw-flex-1 tw-min-w-0">
            <div class="tw-text-xs tw-font-medium tw-mb-1">
              {{ t("alerts.incidents.stableDimensions") }}
            </div>
            <div class="info-box tw-rounded tw-p-2 tw-text-xs" :class="isDarkMode ? 'info-box-dark' : 'info-box-light'">
              <div
                v-for="(value, key) in incidentDetails.stable_dimensions"
                :key="key"
                class="tw-flex"
              >
                <span class="label-text tw-mr-1">{{ key }}:</span>
                <span class="tw-font-mono tw-truncate">{{ value }}</span>
              </div>
              <div
                v-if="Object.keys(incidentDetails.stable_dimensions).length === 0"
                class="muted-text"
              >
                No dimensions
              </div>
            </div>
          </div>

          <!-- Topology Context -->
          <div v-if="incidentDetails.topology_context" class="tw-flex-1 tw-min-w-0">
            <div class="tw-text-xs tw-font-medium tw-mb-1">
              {{ t("alerts.incidents.topology") }}
            </div>
            <div class="info-box tw-rounded tw-p-2 tw-text-xs" :class="isDarkMode ? 'info-box-dark' : 'info-box-light'">
              <div>
                <span class="label-text">Service:</span>
                <span class="tw-ml-1 tw-font-mono">{{ incidentDetails.topology_context.service }}</span>
              </div>
              <div v-if="incidentDetails.topology_context.upstream_services.length" class="tw-mt-1">
                <span class="label-text">{{ t("alerts.incidents.upstreamServices") }}:</span>
                <span class="tw-ml-1">
                  <q-badge
                    v-for="svc in incidentDetails.topology_context.upstream_services"
                    :key="svc"
                    color="blue-grey-4"
                    :label="svc"
                    class="tw-mr-1"
                    size="xs"
                  />
                </span>
              </div>
              <div v-if="incidentDetails.topology_context.downstream_services.length" class="tw-mt-1">
                <span class="label-text">{{ t("alerts.incidents.downstreamServices") }}:</span>
                <span class="tw-ml-1">
                  <q-badge
                    v-for="svc in incidentDetails.topology_context.downstream_services"
                    :key="svc"
                    color="blue-grey-4"
                    :label="svc"
                    class="tw-mr-1"
                    size="xs"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Incident Analysis -->
        <div class="tw-mb-4">
          <div class="tw-text-sm tw-font-medium tw-mb-2 tw-flex tw-items-center tw-gap-2">
            <q-icon name="psychology" color="primary" />
            Incident Analysis
            <!-- Trigger button when no analysis exists and not loading -->
            <q-btn
              v-if="!hasExistingRca && !rcaLoading"
              size="sm"
              color="primary"
              outline
              no-caps
              @click="triggerRca"
              :disable="rcaLoading"
            >
              Analyze Incident
            </q-btn>
            <!-- Chat button -->
            <q-btn
              size="sm"
              color="primary"
              flat
              dense
              icon="chat"
              @click="openSREChat"
            >
              <q-tooltip>Chat with SRE Assistant</q-tooltip>
            </q-btn>
          </div>

          <!-- Loading state with streaming content -->
          <div v-if="rcaLoading" class="rca-container tw-rounded tw-p-3" :class="isDarkMode ? 'rca-container-dark' : 'rca-container-light'">
            <div class="tw-flex tw-items-center tw-gap-2 tw-mb-2">
              <q-spinner size="sm" color="primary" />
              <span class="tw-text-sm">Analysis in progress...</span>
            </div>
            <div
              v-if="rcaStreamContent"
              class="tw-text-sm tw-whitespace-pre-wrap rca-content"
              v-html="formatRcaContent(rcaStreamContent)"
            />
          </div>

          <!-- Existing analysis content -->
          <div v-else-if="hasExistingRca" class="rca-container tw-rounded tw-p-3" :class="isDarkMode ? 'rca-container-dark' : 'rca-container-light'">
            <div
              class="tw-text-sm tw-whitespace-pre-wrap rca-content"
              v-html="formatRcaContent(incidentDetails.topology_context.suggested_root_cause)"
            />
          </div>

          <!-- No analysis yet -->
          <div v-else class="no-rca-container tw-rounded tw-p-3 tw-text-sm" :class="isDarkMode ? 'no-rca-container-dark' : 'no-rca-container-light'">
            No analysis performed yet
          </div>
        </div>

        <!-- Alert Triggers -->
        <div>
          <div class="tw-text-sm tw-font-medium tw-mb-2">
            Alert Triggers
            <span class="tw-text-gray-500">({{ triggers.length }})</span>
          </div>
          <q-list bordered separator class="tw-rounded">
            <q-item v-for="trigger in triggers" :key="trigger.alert_id + trigger.alert_fired_at">
              <q-item-section>
                <q-item-label class="tw-font-medium">
                  {{ trigger.alert_name }}
                </q-item-label>
                <q-item-label caption>
                  {{ formatTimestamp(trigger.alert_fired_at) }}
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-badge
                  :color="getReasonColor(trigger.correlation_reason)"
                  :label="getReasonLabel(trigger.correlation_reason)"
                  outline
                />
              </q-item-section>
            </q-item>
            <q-item v-if="triggers.length === 0">
              <q-item-section class="tw-text-gray-400">
                No triggers loaded
              </q-item-section>
            </q-item>
          </q-list>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="tw-h-full tw-flex tw-items-center tw-justify-center">
      <q-spinner size="lg" color="primary" />
    </div>
  </q-drawer>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { date } from "quasar";
import incidentsService, { Incident, IncidentWithAlerts, IncidentAlert } from "@/services/incidents";

export default defineComponent({
  name: "IncidentDetailDrawer",
  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    incident: {
      type: Object as PropType<Incident | null>,
      default: null,
    },
  },
  emits: ["update:modelValue", "status-updated"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();

    const loading = ref(false);
    const updating = ref(false);
    const incidentDetails = ref<IncidentWithAlerts | null>(null);
    const triggers = ref<IncidentAlert[]>([]);
    const alerts = ref<any[]>([]);
    const rcaLoading = ref(false);
    const rcaStreamContent = ref("");

    const isOpen = ref(props.modelValue);

    // Computed to check if analysis already exists
    const hasExistingRca = computed(() => {
      return !!incidentDetails.value?.topology_context?.suggested_root_cause;
    });

    // Check if dark mode is active
    const isDarkMode = computed(() => {
      return store.state.theme === "dark";
    });

    watch(
      () => props.modelValue,
      (val) => {
        isOpen.value = val;
        if (val && props.incident) {
          loadDetails(props.incident.id);
        }
      }
    );

    watch(isOpen, (val) => {
      emit("update:modelValue", val);
    });

    const loadDetails = async (incidentId: string) => {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.get(org, incidentId);
        incidentDetails.value = response.data;
        triggers.value = response.data.triggers || [];
        alerts.value = response.data.alerts || [];
      } catch (error) {
        console.error("Failed to load incident details:", error);
        $q.notify({
          type: "negative",
          message: "Failed to load incident details",
        });
      } finally {
        loading.value = false;
      }
    };

    const close = () => {
      isOpen.value = false;
    };

    const updateStatus = async (newStatus: "open" | "acknowledged" | "resolved") => {
      if (!incidentDetails.value) return;
      updating.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.updateStatus(
          org,
          incidentDetails.value.id,
          newStatus
        );
        // Update local state
        incidentDetails.value = { ...incidentDetails.value, ...response.data };
        $q.notify({
          type: "positive",
          message: t("alerts.incidents.statusUpdated"),
        });
        emit("status-updated");
      } catch (error) {
        console.error("Failed to update status:", error);
        $q.notify({
          type: "negative",
          message: t("alerts.incidents.statusUpdateFailed"),
        });
      } finally {
        updating.value = false;
      }
    };

    const acknowledgeIncident = () => updateStatus("acknowledged");
    const resolveIncident = () => updateStatus("resolved");
    const reopenIncident = () => updateStatus("open");

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

    const getReasonColor = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return "blue";
        case "manual_extraction":
          return "purple";
        case "temporal":
          return "teal";
        default:
          return "grey";
      }
    };

    const getReasonLabel = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscovery");
        case "manual_extraction":
          return t("alerts.incidents.correlationManualExtraction");
        case "temporal":
          return t("alerts.incidents.correlationTemporal");
        default:
          return reason;
      }
    };

    const formatTimestamp = (timestamp: number) => {
      // Backend sends microseconds
      return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
    };

    const escapeHtml = (text: string): string => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    const formatRcaContent = (content: string) => {
      // First, escape all HTML to prevent XSS attacks
      const escaped = escapeHtml(content);

      // Simple markdown-like formatting for RCA content
      // Convert **bold** to <strong>
      let formatted = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Convert headers (##, ###) to styled divs
      formatted = formatted.replace(/^### (.+)$/gm, '<div class="tw-font-semibold tw-mt-3 tw-mb-1">$1</div>');
      formatted = formatted.replace(/^## (.+)$/gm, '<div class="tw-font-bold tw-text-base tw-mt-4 tw-mb-2">$1</div>');
      // Convert - list items to proper formatting
      formatted = formatted.replace(/^- (.+)$/gm, '<div class="tw-ml-2">• $1</div>');
      // Convert numbered lists
      formatted = formatted.replace(/^(\d+)\. (.+)$/gm, '<div class="tw-ml-2">$1. $2</div>');
      return formatted;
    };

    const triggerRca = async () => {
      if (!incidentDetails.value) return;

      rcaLoading.value = true;
      rcaStreamContent.value = "";

      const org = store.state.selectedOrganization.identifier;

      try {
        const response = await incidentsService.triggerRca(org, incidentDetails.value.id);

        // Set the RCA content immediately
        rcaStreamContent.value = response.data.rca_content;

        $q.notify({
          type: "positive",
          message: t("alerts.incidents.rcaCompleted"),
        });

        // Reload incident to get the saved RCA in topology context
        await loadDetails(incidentDetails.value.id);
      } catch (error: any) {
        console.error("Failed to trigger RCA:", error);
        rcaStreamContent.value = "";
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || error?.message || "Failed to perform RCA analysis",
        });
      } finally {
        rcaLoading.value = false;
      }
    };

    const openSREChat = () => {
      // Open SRE chat with full incident context
      store.state.sreChatContext = {
        type: 'incident',
        data: {
          id: incidentDetails.value?.id,
          title: incidentDetails.value?.title,
          status: incidentDetails.value?.status,
          severity: incidentDetails.value?.severity,
          alert_count: incidentDetails.value?.alert_count,
          first_alert_at: incidentDetails.value?.first_alert_at,
          last_alert_at: incidentDetails.value?.last_alert_at,
          stable_dimensions: incidentDetails.value?.stable_dimensions,
          topology_context: incidentDetails.value?.topology_context,
          triggers: triggers.value,
          rca_analysis: hasExistingRca.value
            ? incidentDetails.value?.topology_context?.suggested_root_cause
            : rcaStreamContent.value,
        },
      };
      store.dispatch("setIsSREChatOpen", true);
    };

    return {
      t,
      isOpen,
      loading,
      updating,
      incidentDetails,
      triggers,
      alerts,
      rcaLoading,
      rcaStreamContent,
      hasExistingRca,
      isDarkMode,
      close,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      triggerRca,
      openSREChat,
      getStatusColor,
      getStatusLabel,
      getSeverityColor,
      getReasonColor,
      getReasonLabel,
      formatTimestamp,
      formatRcaContent,
    };
  },
});
</script>

<style scoped>
.incident-detail-drawer {
  background: white;
}

.incident-detail-drawer :deep(.q-drawer) {
  top: 57px !important;
  height: calc(100vh - 57px) !important;
}

.rca-content {
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
}

/* RCA Container - Light Mode */
.rca-container-light {
  background-color: #eff6ff; /* blue-50 */
  border: 1px solid #bfdbfe; /* blue-200 */
}

.rca-container-light :deep(strong) {
  font-weight: 600;
  color: #1e40af; /* blue-800 */
}

/* RCA Container - Dark Mode */
.rca-container-dark {
  background-color: #1e3a5f; /* dark blue background */
  border: 1px solid #3b5875; /* darker blue border */
}

.rca-container-dark :deep(strong) {
  font-weight: 600;
  color: #93c5fd; /* blue-300 - brighter for dark mode */
}

/* No RCA Container - Light Mode */
.no-rca-container-light {
  background-color: #f9fafb; /* gray-50 */
  border: 1px solid #e5e7eb; /* gray-200 */
  color: #6b7280; /* gray-500 */
}

/* No RCA Container - Dark Mode */
.no-rca-container-dark {
  background-color: #374151; /* gray-700 */
  border: 1px solid #4b5563; /* gray-600 */
  color: #d1d5db; /* gray-300 */
}

/* Info Box (Stable Dimensions, Topology) - Light Mode */
.info-box-light {
  background-color: #f3f4f6; /* gray-100 */
}

/* Info Box - Dark Mode */
.info-box-dark {
  background-color: #374151; /* gray-700 */
}

/* Label text color */
.label-text {
  color: #6b7280; /* gray-500 in light mode */
}

body.body--dark .label-text {
  color: #9ca3af; /* gray-400 in dark mode */
}

/* Muted text color */
.muted-text {
  color: #9ca3af; /* gray-400 in light mode */
}

body.body--dark .muted-text {
  color: #6b7280; /* gray-500 in dark mode */
}
</style>
