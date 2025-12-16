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
  <div
    :class="[store.state.theme === 'dark' ? 'bg-dark' : 'bg-white']"
    class="tw-h-full tw-flex tw-flex-col"
    style="width: 90vw"
  >
    <!-- Header -->
    <div class="incident-detail-header row items-center no-wrap q-px-md tw-p-4">
      <div class="col">
        <div class="tw-text-[18px] tw-flex tw-items-center">
          {{ t("alerts.incidents.header") }}
          <!-- Incident name with colored indicator -->
          <span
            :class="[
              'tw-font-bold tw-mr-4 tw-px-2 tw-py-1 tw-rounded-md tw-ml-2 tw-max-w-xs tw-truncate tw-inline-block',
              store.state.theme === 'dark'
                ? 'tw-text-blue-400 tw-bg-blue-900/50'
                : 'tw-text-blue-600 tw-bg-blue-50'
            ]"
            data-test="incident-detail-title"
          >
            {{ incidentDetails?.title }}
            <q-tooltip v-if="incidentDetails && incidentDetails.title.length > 35" class="tw-text-xs">
              {{ incidentDetails.title }}
            </q-tooltip>
          </span>
        </div>
      </div>
      <div class="col-auto">
        <q-btn
          data-test="incident-detail-close-btn"
          v-close-popup="true"
          round
          flat
          icon="cancel"
        />
      </div>
    </div>
    <q-separator />

    <!-- Content -->
    <div v-if="!loading && incidentDetails" class="tw-flex-1 tw-flex tw-overflow-hidden">
      <!-- Left Column: Incident Details -->
      <div class="incident-details-column tw-w-[400px] tw-flex-shrink-0 tw-p-4 q-px-md tw-overflow-auto" :class="store.state.theme === 'dark' ? 'tw-border-r tw-border-gray-700' : 'tw-border-r tw-border-gray-200'">
        <!-- Status, Severity, Alerts - Vertical Stack -->
        <div class="tw-flex tw-flex-col tw-gap-3 tw-mb-4">
          <!-- Status Tile -->
          <div class="tile">
            <div
              class="tile-content tw-rounded-lg tw-p-3 tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
              :class="store.state.theme === 'dark' ? 'tile-content-dark tw-border-gray-700' : 'tile-content-light tw-border-gray-200'"
            >
              <div class="tile-header tw-flex tw-justify-between tw-items-start">
                <div
                  class="tile-title tw-text-xs tw-font-bold tw-text-left"
                  :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
                >
                  {{ t("alerts.incidents.status") }}
                </div>
                <div class="tile-icon tw-opacity-80">
                  <q-icon name="info" size="24px" :color="getStatusColor(incidentDetails.status)" />
                </div>
              </div>
              <div
                class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start"
                :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-gray-900'"
              >
                {{ getStatusLabel(incidentDetails.status) }}
              </div>
            </div>
          </div>

          <!-- Severity Tile -->
          <div class="tile">
            <div
              class="tile-content tw-rounded-lg tw-p-3 tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
              :class="store.state.theme === 'dark' ? 'tile-content-dark tw-border-gray-700' : 'tile-content-light tw-border-gray-200'"
            >
              <div class="tile-header tw-flex tw-justify-between tw-items-start">
                <div
                  class="tile-title tw-text-xs tw-font-bold tw-text-left"
                  :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
                >
                  {{ t("alerts.incidents.severity") }}
                </div>
                <div class="tile-icon tw-opacity-80">
                  <q-icon name="warning" size="24px" :color="getSeverityColor(incidentDetails.severity)" />
                </div>
              </div>
              <div
                class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start"
                :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-gray-900'"
              >
                {{ incidentDetails.severity }}
              </div>
            </div>
          </div>

          <!-- Alert Count Tile -->
          <div class="tile">
            <div
              class="tile-content tw-rounded-lg tw-p-3 tw-border tw-shadow-sm tw-h-20 tw-flex tw-flex-col tw-justify-between"
              :class="store.state.theme === 'dark' ? 'tile-content-dark tw-border-gray-700' : 'tile-content-light tw-border-gray-200'"
            >
              <div class="tile-header tw-flex tw-justify-between tw-items-start">
                <div
                  class="tile-title tw-text-xs tw-font-bold tw-text-left"
                  :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-500'"
                >
                  {{ t("alerts.incidents.alertCount") }}
                </div>
                <div class="tile-icon tw-opacity-80">
                  <q-icon name="notifications_active" size="24px" color="primary" />
                </div>
              </div>
              <div
                class="tile-value tw-text-lg tw-flex tw-items-end tw-justify-start"
                :class="store.state.theme === 'dark' ? 'tw-text-white' : 'tw-text-gray-900'"
              >
                {{ incidentDetails.alert_count }}
              </div>
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="tw-mb-4">
          <div class="tw-flex tw-gap-2">
            <q-btn
              v-if="incidentDetails.status === 'open'"
              color="warning"
              no-caps
              unelevated
              dense
              @click="acknowledgeIncident"
              :loading="updating"
              align="left"
              class="action-btn-compact tw-justify-start tw-flex-1"
            >
              <q-icon name="check_circle" size="xs" class="tw-mr-1.5" />
              <span class="tw-text-xs tw-font-medium">{{ t("alerts.incidents.acknowledge") }}</span>
              <q-tooltip :delay="500">Mark incident as acknowledged and being worked on</q-tooltip>
            </q-btn>
            <q-btn
              v-if="incidentDetails.status !== 'resolved'"
              color="positive"
              no-caps
              unelevated
              dense
              @click="resolveIncident"
              :loading="updating"
              align="left"
              class="action-btn-compact tw-justify-start tw-flex-1"
            >
              <q-icon name="task_alt" size="xs" class="tw-mr-1.5" />
              <span class="tw-text-xs tw-font-medium">{{ t("alerts.incidents.resolve") }}</span>
              <q-tooltip :delay="500">Mark incident as resolved and close it</q-tooltip>
            </q-btn>
            <q-btn
              v-if="incidentDetails.status === 'resolved'"
              color="negative"
              no-caps
              unelevated
              dense
              @click="reopenIncident"
              :loading="updating"
              align="left"
              class="action-btn-compact tw-justify-start"
            >
              <q-icon name="restart_alt" size="xs" class="tw-mr-1.5" />
              <span class="tw-text-xs tw-font-medium">{{ t("alerts.incidents.reopen") }}</span>
              <q-tooltip :delay="500">Reopen this resolved incident</q-tooltip>
            </q-btn>
          </div>
        </div>

        <!-- Timeline with UTC timestamps -->
        <div
          :class="[
            'tw-rounded-lg tw-border tw-mb-4 tw-overflow-hidden',
            store.state.theme === 'dark'
              ? 'tw-border-gray-700'
              : 'tw-border-gray-200'
          ]"
        >
          <!-- Header -->
          <div
            :class="[
              'tw-px-3 tw-py-2 tw-flex tw-items-center tw-justify-between tw-border-b',
              store.state.theme === 'dark'
                ? 'tw-bg-gray-800 tw-border-gray-700'
                : 'tw-bg-gray-100 tw-border-gray-200'
            ]"
          >
            <div class="tw-flex tw-items-center tw-gap-2">
              <q-icon name="schedule" size="16px" class="tw-opacity-80" />
              <span :class="store.state.theme === 'dark' ? 'tw-text-gray-300' : 'tw-text-gray-700'" class="tw-text-xs tw-font-semibold">
                Timeline
              </span>
            </div>
            <span
              :class="[
                'tw-text-[10px] tw-font-medium tw-px-2 tw-py-0.5 tw-rounded-full',
                store.state.theme === 'dark'
                  ? 'tw-text-blue-300 tw-bg-blue-900/30'
                  : 'tw-text-blue-700 tw-bg-blue-100'
              ]"
            >
              UTC
            </span>
          </div>

          <!-- Content -->
          <div :class="store.state.theme === 'dark' ? 'tw-bg-gray-800/30' : 'tw-bg-white'" class="tw-p-3">
            <div class="tw-space-y-3">
              <div class="tw-flex tw-items-start tw-gap-2">
                <q-icon name="play_arrow" size="14px" :class="store.state.theme === 'dark' ? 'tw-text-green-400' : 'tw-text-green-600'" class="tw-mt-0.5" />
                <div class="tw-flex-1">
                  <div :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-600'" class="tw-text-[11px] tw-mb-0.5">
                    First Alert
                  </div>
                  <div
                    :class="[
                      'tw-text-xs tw-font-semibold tw-font-mono',
                      store.state.theme === 'dark' ? 'tw-text-gray-200' : 'tw-text-gray-900'
                    ]"
                  >
                    {{ formatTimestampUTC(incidentDetails.first_alert_at) }}
                  </div>
                </div>
              </div>

              <div class="tw-flex tw-items-start tw-gap-2">
                <q-icon name="flag" size="14px" :class="store.state.theme === 'dark' ? 'tw-text-orange-400' : 'tw-text-orange-600'" class="tw-mt-0.5" />
                <div class="tw-flex-1">
                  <div :class="store.state.theme === 'dark' ? 'tw-text-gray-400' : 'tw-text-gray-600'" class="tw-text-[11px] tw-mb-0.5">
                    Last Alert
                  </div>
                  <div
                    :class="[
                      'tw-text-xs tw-font-semibold tw-font-mono',
                      store.state.theme === 'dark' ? 'tw-text-gray-200' : 'tw-text-gray-900'
                    ]"
                  >
                    {{ formatTimestampUTC(incidentDetails.last_alert_at) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Dimensions & Topology - side by side -->
        <div class="tw-flex tw-gap-3 tw-mb-4">
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
      </div>

      <!-- Right Column: Tabs and Content -->
      <div class="tabs-content-column tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden">
        <!-- Tabs -->
        <div class="tw-flex tw-items-center tw-justify-between tw-px-4 tw-pt-4 tw-pb-2 q-px-md tw-flex-shrink-0">
          <q-tabs v-model="activeTab" inline-label dense no-caps align="left">
            <q-tab
              name="incidentAnalysis"
              icon="psychology"
              label="Incident Analysis"
            />
            <q-tab
              name="alertTriggers"
              icon="notifications_active"
            >
              <template #default>
                <div class="tw-flex tw-items-center tw-gap-1.5">
                  <span>Alert Triggers</span>
                  <span class="tw-text-xs tw-opacity-70">({{ triggers.length }})</span>
                </div>
              </template>
            </q-tab>
          </q-tabs>
          <!-- AI Chat Button -->
          <q-btn
            size="sm"
            flat
            dense
            @click="openSREChat"
            class="tw-ml-auto"
          >
            <img :src="getAIIconURL()" class="tw-w-5 tw-h-5" />
            <q-tooltip :delay="500" style="width: 180px;">Chat with SRE Assistant</q-tooltip>
          </q-btn>
        </div>

        <!-- Tab Content Area -->
        <div class="tw-flex-1 tw-flex tw-flex-col tw-px-4 tw-pt-2 q-px-md tw-pb-2 tw-overflow-hidden">
        <!-- Incident Analysis Tab Content -->
        <div v-if="activeTab === 'incidentAnalysis'" class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden">
          <!-- Trigger button when no analysis exists and not loading -->
          <div v-if="!hasExistingRca && !rcaLoading" class="tw-mb-2 tw-flex-shrink-0">
            <q-btn
              size="sm"
              color="primary"
              outline
              no-caps
              @click="triggerRca"
              :disable="rcaLoading"
            >
              Analyze Incident
            </q-btn>
          </div>

          <!-- Loading state with streaming content -->
          <div v-if="rcaLoading" class="rca-container tw-rounded tw-p-3 tw-flex-1 tw-overflow-auto tw-border" :class="isDarkMode ? 'tw-bg-gray-800 tw-border-gray-700' : 'tw-bg-blue-50 tw-border-blue-200'">
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
          <div v-else-if="hasExistingRca" class="rca-container tw-rounded tw-p-3 tw-flex-1 tw-overflow-auto tw-border" :class="isDarkMode ? 'tw-bg-gray-800 tw-border-gray-700' : 'tw-bg-blue-50 tw-border-blue-200'">
            <div
              class="tw-text-sm tw-whitespace-pre-wrap rca-content"
              v-html="formatRcaContent(incidentDetails.topology_context.suggested_root_cause)"
            />
          </div>

          <!-- No analysis yet -->
          <div v-else class="tw-rounded tw-p-3 tw-text-sm tw-flex-1 tw-border" :class="isDarkMode ? 'tw-bg-gray-700 tw-border-gray-600 tw-text-gray-300' : 'tw-bg-gray-50 tw-border-gray-200 tw-text-gray-500'">
            No analysis performed yet
          </div>
        </div>

        <!-- Alert Triggers Tab Content -->
        <div v-if="activeTab === 'alertTriggers'" class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden">
          <div class="tw-flex-1 tw-overflow-auto">
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
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="tw-flex-1 tw-flex tw-items-center tw-justify-center">
      <q-spinner-hourglass size="lg" color="primary" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { date } from "quasar";
import incidentsService, { Incident, IncidentWithAlerts, IncidentAlert } from "@/services/incidents";
import { getImageURL } from "@/utils/zincutils";

export default defineComponent({
  name: "IncidentDetailDrawer",
  props: {
    incident: {
      type: Object as PropType<Incident | null>,
      default: null,
    },
  },
  emits: ["close", "status-updated"],
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

    // Tab management
    const activeTab = ref("incidentAnalysis");

    // Computed to check if analysis already exists
    const hasExistingRca = computed(() => {
      return !!incidentDetails.value?.topology_context?.suggested_root_cause;
    });

    // Check if dark mode is active
    const isDarkMode = computed(() => {
      return store.state.theme === "dark";
    });

    const loadDetails = async (incidentId: string) => {
      loading.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.get(org, incidentId);
        incidentDetails.value = response.data;
        triggers.value = (response.data as any).triggers || [];
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

    watch(
      () => props.incident,
      (incident) => {
        if (incident) {
          loadDetails(incident.id);
        }
      },
      { immediate: true }
    );

    const close = () => {
      emit("close");
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

    const getStatusDotColor = (status: string) => {
      switch (status) {
        case "open":
          return "#ef4444"; // red-500
        case "acknowledged":
          return "#f59e0b"; // amber-500
        case "resolved":
          return "#10b981"; // green-500
        default:
          return "#6b7280"; // gray-500
      }
    };

    const getStatusTextColor = (status: string) => {
      switch (status) {
        case "open":
          return "#dc2626"; // red-600
        case "acknowledged":
          return "#d97706"; // amber-600
        case "resolved":
          return "#059669"; // green-600
        default:
          return "#4b5563"; // gray-600
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

    const getSeverityDotColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "#991b1b"; // red-900
        case "P2":
          return "#ea580c"; // orange-600
        case "P3":
          return "#f59e0b"; // amber-500
        case "P4":
          return "#6b7280"; // gray-500
        default:
          return "#9ca3af"; // gray-400
      }
    };

    const getSeverityTextColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "#b91c1c"; // red-700
        case "P2":
          return "#c2410c"; // orange-700
        case "P3":
          return "#d97706"; // amber-600
        case "P4":
          return "#6b7280"; // gray-500
        default:
          return "#6b7280"; // gray-500
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

    const formatTimestampUTC = (timestamp: number) => {
      // Backend sends microseconds, format in UTC
      const d = new Date(timestamp / 1000);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const minutes = String(d.getUTCMinutes()).padStart(2, '0');
      const seconds = String(d.getUTCSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const escapeHtml = (text: string): string => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    const formatRcaContent = (content: string) => {
      // First, escape all HTML to prevent XSS attacks
      const escaped = escapeHtml(content);

      // Collapse only consecutive/multiple newlines (2 or more) into single newline
      let normalized = escaped.replace(/\n{2,}/g, '\n');

      // Simple markdown-like formatting for RCA content
      let formatted = normalized;

      // Convert # headers with better styling
      formatted = formatted.replace(/^# (.+)$/gm, '<div class="tw-font-bold tw-text-base tw-mt-5 tw-mb-3 tw-border-b tw-pb-2 tw-text-gray-800">$1</div>');
      formatted = formatted.replace(/^## (.+)$/gm, '<div class="tw-font-bold tw-text-sm tw-mt-4 tw-mb-2 tw-text-blue-600">$1</div>');
      formatted = formatted.replace(/^### (.+)$/gm, '<div class="tw-font-semibold tw-text-sm tw-mt-3 tw-mb-2 tw-text-gray-700">$1</div>');

      // Convert **bold** to <strong>
      formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong class="tw-font-semibold tw-text-gray-900">$1</strong>');

      // Convert - list items with better spacing
      formatted = formatted.replace(/^- (.+)$/gm, '<div class="tw-flex tw-gap-2 tw-ml-2 tw-mb-2"><span class="tw-text-blue-500 tw-font-bold">•</span><span class="tw-flex-1">$1</span></div>');

      // Convert numbered lists with better spacing
      formatted = formatted.replace(/^(\d+)\. (.+)$/gm, '<div class="tw-flex tw-gap-2 tw-ml-2 tw-mb-2"><span class="tw-font-semibold tw-text-gray-600 tw-min-w-[20px]">$1.</span><span class="tw-flex-1">$2</span></div>');

      // Convert remaining single newlines to <br>
      formatted = formatted.replace(/\n/g, '<br>');

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
      // Set SRE chat context with full incident context
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

      // Close the drawer first
      close();

      // Then open the SRE chat
      store.dispatch("setIsSREChatOpen", true);
    };

    const getTimezone = () => {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    };

    const getAIIconURL = () => {
      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg');
    };

    return {
      t,
      store,
      loading,
      updating,
      incidentDetails,
      triggers,
      alerts,
      rcaLoading,
      rcaStreamContent,
      hasExistingRca,
      isDarkMode,
      activeTab,
      close,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      triggerRca,
      openSREChat,
      getStatusColor,
      getStatusDotColor,
      getStatusTextColor,
      getStatusLabel,
      getSeverityColor,
      getSeverityDotColor,
      getSeverityTextColor,
      getReasonColor,
      getReasonLabel,
      formatTimestamp,
      formatTimestampUTC,
      formatRcaContent,
      getTimezone,
      getAIIconURL,
    };
  },
});
</script>

<style scoped>
.incident-detail-header {
  min-height: 60px;
}

/* Tile Styles - matching schema.vue */
.tile-content-light {
  background-color: #ffffff;
  transition: all 0.2s ease;
}

.tile-content-dark {
  background-color: #1e1e1e;
  transition: all 0.2s ease;
}

.tile-content:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

body.body--dark .tile-content:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* Action Buttons - Compact */
.action-btn-compact {
  min-height: 28px;
  padding: 4px 12px;
  border-radius: 4px;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.action-btn-compact:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn-compact:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.rca-content {
  line-height: 1.7;
  font-size: 14px;
}

/* RCA Content Styling - Dark Mode */
body.body--dark .rca-content :deep(strong) {
  font-weight: 600;
  color: #cbd5e1; /* slate-300 - soft, readable */
}

body.body--dark .rca-content :deep(.tw-text-blue-600) {
  color: #94a3b8; /* slate-400 - muted */
}

body.body--dark .rca-content :deep(.tw-text-blue-500) {
  color: #94a3b8; /* slate-400 - muted bullet */
}

body.body--dark .rca-content :deep(.tw-text-gray-800) {
  color: #e5e7eb; /* gray-200 */
}

body.body--dark .rca-content :deep(.tw-text-gray-700) {
  color: #d1d5db; /* gray-300 */
}

body.body--dark .rca-content :deep(.tw-text-gray-600) {
  color: #9ca3af; /* gray-400 */
}

body.body--dark .rca-content :deep(.tw-text-gray-900) {
  color: #f3f4f6; /* gray-100 */
}

body.body--dark .rca-content :deep(.tw-border-b) {
  border-color: #4b5563; /* gray-600 border */
}

/* RCA Content Styling - Light Mode */
.rca-content :deep(strong) {
  font-weight: 600;
  color: #1e40af; /* blue-800 */
}

.rca-content :deep(.tw-text-blue-600) {
  color: #2563eb; /* blue-600 */
}

.rca-content :deep(.tw-border-b) {
  border-color: #bfdbfe; /* blue-200 */
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

/* Two-Column Layout Styles */
.incident-details-column {
  min-width: 400px;
  max-width: 400px;
}

.tabs-content-column {
  min-width: 0; /* Allow flex shrinking */
}

/* Responsive scrolling */
.incident-details-column::-webkit-scrollbar,
.tabs-content-column .tw-overflow-auto::-webkit-scrollbar {
  width: 6px;
}

.incident-details-column::-webkit-scrollbar-track,
.tabs-content-column .tw-overflow-auto::-webkit-scrollbar-track {
  background: transparent;
}

.incident-details-column::-webkit-scrollbar-thumb,
.tabs-content-column .tw-overflow-auto::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

body.body--dark .incident-details-column::-webkit-scrollbar-thumb,
body.body--dark .tabs-content-column .tw-overflow-auto::-webkit-scrollbar-thumb {
  background: #475569;
}
</style>
