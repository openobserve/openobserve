<template>
  <div class="q-pa-md">
    <LicensePeriod @updateLicense="showUpdateFormAndFocus"></LicensePeriod>
    <div class="text-h6 q-mb-md">License Management</div>

    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner size="40px" />
      <div class="q-mt-md">Loading license information...</div>
    </div>
    <div v-else class="tw:grid tw:grid-cols-1 lg:tw:grid-cols-2 tw:gap-4 tw:items-start tw:pb-4">

    <div class="tw:col-span-1 tw:min-h-0" >
      <div v-if="licenseData.license === null || !licenseData.license">
        <q-card class="q-mb-md">
          <q-card-section>
            <div class="text-h6">No License Found</div>
            <div class="q-mt-sm text-body2">
              Installation ID: <strong>{{ licenseData.installation_id || 'N/A' }}</strong>
            </div>
            <div class="q-mt-md text-body2">
              Contact your administrator for getting a license and paste the key here, <strong>or:</strong>
              <q-btn
                color="primary"
                no-caps
                label="Get License"
                @click="redirectToGetLicense"
                class="q-ml-sm"
                size="sm"
                borderless
              />
            </div>
          </q-card-section>
        </q-card>

        <q-card>
          <q-card-section>
            <div class="text-subtitle1 q-mb-md">Enter License Key</div>
            <q-input
              v-model="licenseKey"
              outlined
              type="textarea"
              rows="8"
              placeholder="Paste your license key here..."
              style="height: 200px;"
            />
            <div v-if="isLicenseKeyAutoFilled" class="q-mt-sm q-mb-md">
              <div class="modern-info-banner">
                <q-icon name="check_circle" class="text-green-6 q-mr-sm" size="20px" />
                <span class="text-body2">License key auto-filled from URL. Click "Update License" to apply.</span>
              </div>
            </div>
            <q-btn
              color="primary"
              label="Update License"
              @click="updateLicense"
              :loading="updating"
              :disable="!licenseKey.trim()"
            />
          </q-card-section>
        </q-card>
      </div>

      <div v-else>
        <q-card>
          <q-card-section>
            <div class="text-h6 q-mb-md">License Information</div>
            <q-markup-table flat bordered dense class="compact-table">
              <tbody>
                <tr>
                  <td class="text-weight-bold">Installation ID</td>
                  <td>{{ licenseData.installation_id }}</td>
                </tr>
                <tr>
                  <td class="text-weight-bold">License ID</td>
                  <td>{{ licenseData.license.license_id }}</td>
                </tr>
                <tr>
                  <td class="text-weight-bold">Status</td>
                  <td>
                    <q-badge :color="licenseData?.expired ? 'red' : 'green'">
                      {{ licenseData?.expired ? 'Expired' : 'Active' }}
                    </q-badge>
                  </td>
                </tr>
                <tr>
                  <td class="text-weight-bold">Created At</td>
                  <td>{{ formatDate(licenseData.license.created_at) }}</td>
                </tr>
                <tr>
                  <td class="text-weight-bold">Expires At</td>
                  <td>{{ formatDate(licenseData.license.expires_at) }}</td>
                </tr>
                <tr>
                  <td class="text-weight-bold">Company</td>
                  <td>{{ licenseData.license.company }}</td>
                </tr>
                <tr v-if="licenseData.key">
                  <td class="text-weight-bold">License Key</td>
                  <td>
                    <div class="row items-center q-gutter-sm">
                      <span>{{ getMaskedLicenseKey() }}</span>
                      <q-btn
                        flat
                        round
                        dense
                        icon="visibility"
                        size="sm"
                        @click="showLicenseKeyModal = true"
                        class="q-ml-sm"
                      />
                    </div>
                  </td>
                </tr>
                <tr v-if="licenseData.license.contact_name">
                  <td class="text-weight-bold">Contact Name</td>
                  <td>{{ licenseData.license.contact_name }}</td>
                </tr>
                <tr v-if="licenseData.license.contact_email">
                  <td class="text-weight-bold">Contact Email</td>
                  <td>{{ licenseData.license.contact_email }}</td>
                </tr>
              </tbody>
            </q-markup-table>
            <div class="tw:mt-3 tw:flex tw:gap-3">
              <q-btn
                no-caps
                label="Request new License"
                class="o2-primary-button"
                @click="redirectToGetLicense"
              />
              <q-btn
                no-caps
                class="o2-primary-button"
                label="Add New License Key"
                @click="showUpdateFormAndFocus"
              />
            </div>
          </q-card-section>
        </q-card>

          <q-card v-show="showUpdateForm" class="q-mt-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-sm">Update License Key</div>
              <q-input
                v-model="licenseKey"
                outlined
                type="textarea"
                rows="6"
                placeholder="Paste new license key here..."
                style="min-height: 150px;"
              />
              <div v-if="isLicenseKeyAutoFilled" class="q-mt-sm q-mb-md">
                <div class="modern-info-banner">
                  <q-icon name="check_circle" class="text-green-6 q-mr-sm" size="20px" />
                  <span class="text-body2">License key auto-filled from URL. Click "Update License" to apply.</span>
                </div>
              </div>
              <div class="row q-gutter-sm">
                <q-btn
                  no-caps
                  label="Cancel"
                  class="o2-secondary-button"
                  @click="showUpdateForm = false; licenseKey = ''"
                />
                <q-btn
                  color="primary"
                  no-caps
                  label="Update License"
                  @click="updateLicense"
                  :loading="updating"
                  :disable="!licenseKey.trim()"
                />
              </div>
            </q-card-section>
          </q-card>
      </div>
    </div>

    <div class="tw:col-span-1 tw:self-start">
            <q-card class="futuristic-card">
              <q-card-section class="tw:p-3">
                <div class="futuristic-header">
                  <div class="header-glow"></div>
                  <div class="text-h6 tw:relative tw:z-10">Usage Information</div>
                </div>

                <div class="tw:flex tw:flex-col tw:gap-2 tw:mt-3">
                  <!-- Summary Message -->
                  <div class="ingestion-summary-compact">
                    <div class="summary-text-compact text-body2">
                      <!-- Line 1: License Info -->
                      <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
                        <q-icon
                          name="info"
                          size="18px"
                          class="tw:flex-shrink-0"
                        />
                        <span>
                          Your license allows <strong>{{ !licenseData?.expired && licenseData?.license?.limits?.Ingestion?.value ? `${licenseData?.license?.limits?.Ingestion?.value} GB` : '100 GB' }}</strong> of data ingestion per day.
                        </span>
                      </div>

                      <!-- Line 2: Exceeded Status -->
                      <div class="tw:flex tw:items-center tw:gap-2">
                        <q-icon
                          v-if="licenseData?.ingestion_exceeded && licenseData?.ingestion_exceeded > 3"
                          name="warning"
                          size="18px"
                          class="text-negative tw:flex-shrink-0"
                        />
                        <q-icon
                          v-else-if="licenseData?.ingestion_exceeded && licenseData?.ingestion_exceeded > 0"
                          name="check_circle"
                          size="18px"
                          class="text-warning tw:flex-shrink-0"
                        />
                        <q-icon
                          v-else
                          name="check_circle"
                          size="18px"
                          class="text-positive tw:flex-shrink-0"
                        />
                        <span>
                          <span v-if="licenseData?.ingestion_exceeded && licenseData?.ingestion_exceeded > 3">
                            Limit exceeded on <strong :class="licenseData?.ingestion_exceeded > 30 ? 'text-negative' : 'text-warning'">{{ licenseData?.ingestion_exceeded }} day{{ licenseData?.ingestion_exceeded > 1 ? 's' : '' }}</strong> this month<span v-if="licenseData?.ingestion_exceeded > 3" class="warning-message"> (max 3 days allowed). Application feature will be restricted</span><span v-else class="info-message"> ({{ 3 - licenseData?.ingestion_exceeded }} allowance{{ (3 - licenseData?.ingestion_exceeded) > 1 ? 's' : '' }} left of 3 max)</span>.
                          </span>
                          <span v-else>
                            No limit exceedances this month (max 3 allowed per month).
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Chart -->
                  <div v-if="usageDashboardData">
                    <div class="chart-wrapper">
                      <div class="usage-chart-container">
                        <RenderDashboardCharts
                          :key="dashboardRenderKey"
                          :dashboardData="usageDashboardData"
                          :currentTimeObj="currentTimeObj"
                          :viewOnly="true"
                          :allowAlertCreation="false"
                          searchType="dashboards"
                        />
                      </div>
                      <div v-if="isIngestionUnlimited" class="text-caption text-grey-6 tw:mt-1 tw:text-center" style="font-size: 10px;">
                        * Usage shows 0% for unlimited plans
                      </div>
                    </div>
                  </div>
                </div>
              </q-card-section>
            </q-card>
    </div>
  </div>

    <!-- License Key Modal -->
    <q-dialog v-model="showLicenseKeyModal" persistent>
      <q-card style="min-width: 500px">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6">License Key</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-card-section>
          <div class="text-body2 q-mb-md">Your complete license key:</div>
          <q-input
            v-model="licenseData.key"
            outlined
            readonly
            type="textarea"
            rows="8"
            class="q-mb-md"
            style="font-family: monospace; font-size: 12px;"
          />
        </q-card-section>

        <q-card-actions align="right" class="q-pt-none">
          <q-btn
            no-caps
            label="Cancel"
            class="o2-secondary-button"
            v-close-popup
              />
          <q-btn
            color="primary"
            label="Copy Key"
            no-caps
            @click="copyLicenseKey"
            :disable="!licenseData.key"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, computed, defineAsyncComponent } from "vue";
import { useQuasar } from "quasar";
import licenseServer from "@/services/license_server";
import { useStore } from "vuex";
import LicensePeriod from "@/enterprise/components/billings/LicensePeriod.vue";

const RenderDashboardCharts = defineAsyncComponent(
  () => import("@/views/Dashboards/RenderDashboardCharts.vue")
);

export default defineComponent({
  name: "License",
  components: {
    LicensePeriod,
    RenderDashboardCharts,
  },
  setup() {
    const $q = useQuasar();
    const loading = ref(false);
    const updating = ref(false);
    const licenseData = ref<any>({});
    const licenseKey = ref("");
    const showUpdateForm = ref(false);
    const showLicenseKeyModal = ref(false);
    const isLicenseKeyAutoFilled = ref(false);
    const store = useStore();
    const usageDashboardData = ref<any>(null);
    const dashboardRenderKey = ref(0);

    const loadLicenseData = async () => {
      try {
        loading.value = true;
        const response = await licenseServer.get_license();
        licenseData.value = response.data;
        checkAndAutoFillLicenseFromUrl();
      } catch (error) {
        console.error("Error loading license data:", error);
        $q.notify({
          type: "negative",
          message: "Failed to load license information",
        });
      } finally {
        loading.value = false;
      }
    };

    const updateLicense = async () => {
      try {
        updating.value = true;
        await licenseServer.update_license(licenseKey.value.trim());
        $q.notify({
          type: "positive",
          message: "License updated successfully",
        });
        licenseKey.value = "";
        isLicenseKeyAutoFilled.value = false;
        showUpdateForm.value = false;
        
        // Clear URL parameters after successful license update
        const url = new URL(window.location.href);
        url.searchParams.delete('installation_id');
        url.searchParams.delete('license_key');
        window.history.replaceState({}, document.title, url.toString());
        
        await loadLicenseData();
      } catch (error) {
        console.error("Error updating license:", error);
        $q.notify({
          type: "negative",
          message: "Failed to update license",
        });
      } finally {
        updating.value = false;
      }
    };

    const showUpdateFormAndFocus = () => {
      showUpdateForm.value = true;
      setTimeout(() => {
        const textarea = document.querySelector('textarea[placeholder="Paste new license key here..."]') as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
        }
      }, 100);
    };

    const maskKey = (key: string) => {
      if (!key) return '';
      if (key.length <= 10) return key; // If key is too short, show as is
      const start = key.substring(0, 5);
      const end = key.substring(key.length - 5);
      const masked = '*'.repeat(18);
      return `${start}${masked}${end}`;
    };

    const getMaskedLicenseKey = () => {
      if (!licenseData.value.key) return '';
      return maskKey(licenseData.value.key);
    };

    const copyLicenseKey = async () => {
      try {
        if (!licenseData.value.key) return;
        await navigator.clipboard.writeText(licenseData.value.key);
        $q.notify({
          type: "positive",
          message: "License key copied to clipboard",
        });
        showLicenseKeyModal.value = false;
      } catch (error) {
        console.error("Error copying license key:", error);
        $q.notify({
          type: "negative",
          message: "Failed to copy license key",
        });
      }
    };

    const redirectToGetLicense = () => {
      const baseUrl = window.location.origin;
      const installationId = licenseData.value.installation_id || '';
      const licenseUrl = `${store.state.zoConfig.license_server_url}/user/request-license?base_url=${encodeURIComponent(baseUrl)}&license_id=${encodeURIComponent(installationId)}`;
      window.open(licenseUrl, '_blank');
    };

    const checkAndAutoFillLicenseFromUrl = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const urlInstallationId = urlParams.get('installation_id');
      const urlLicenseKey = urlParams.get('license_key');
      
      if (urlInstallationId && urlLicenseKey && licenseData.value.installation_id) {
        if (urlInstallationId === licenseData.value.installation_id) {
          // Check if license is already active
          if (licenseData.value.license && licenseData.value.license.active) {
            // License is active, show dialog asking if they want to update
            $q.dialog({
              title: 'License Already Active',
              message: 'Your license is still active. Do you want to update it with the new license key?',
              persistent: true,
              ok: {
                label: 'Yes, update license',
                color: 'primary',
                noCaps: true,
                unelevated: true
              },
              cancel: {
                label: 'No, keep current',
                color: 'grey-7',
                noCaps: true,
                outline: true
              }
            }).onOk(() => {
              // User wants to update, fill the key and show update form
              licenseKey.value = urlLicenseKey;
              isLicenseKeyAutoFilled.value = true;
              showUpdateFormAndFocus();
            }).onCancel(() => {
              // User doesn't want to update, clear URL parameters
              const url = new URL(window.location.href);
              url.searchParams.delete('installation_id');
              url.searchParams.delete('license_key');
              window.history.replaceState({}, document.title, url.toString());
            });
          } else {
            // No active license, proceed with normal auto-fill
            licenseKey.value = urlLicenseKey;
            isLicenseKeyAutoFilled.value = true;
          }
        }
      }
    };

    const formatDate = (timestamp: number) => {
      return new Date(timestamp / 1000).toLocaleString();
    };

    const isIngestionUnlimited = computed(() => {
      return licenseData.value.license?.limits?.Ingestion?.typ === "Unlimited";
    });

    const ingestionUsagePercent = computed(() => {
      if (isIngestionUnlimited.value) {
        return 0;
      }
      return Math.ceil(licenseData.value.ingestion_used * 100) / 100 || 0;
    });

    const getIngestionUsageColor = () => {
      const percent = ingestionUsagePercent.value;
      if (percent < 60) return "green";
      if (percent < 90) return "orange";
      return "red";
    };

    const showLicenseExpiryWarning = computed(() => {
      if (!store.state.zoConfig.license_expiry) return false;
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      return daysUntilExpiry < 14;
    });

    const getLicenseExpiryMessage = () => {
      if (!store.state.zoConfig.license_expiry) return '';
      const now = Date.now();
      const expiryDate = store.state.zoConfig.license_expiry;
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry > 1) {
        return `${daysUntilExpiry} days remaining until your license expires`;
      } else if (daysUntilExpiry === 1) {
        return `1 day remaining until your license expires`;
      } else {
        return 'Your license has expired';
      }
    };

    // Current time object for dashboard (calendar start date to current date)
    // Similar to TelemetryCorrelationDashboard, we pass microsecond timestamps to Date constructor
    const currentTimeObj = computed(() => {
      const now = new Date();
      const calendarStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

      // Convert to microseconds (16 digits) and pass to Date constructor
      const startTimeMicros = calendarStartDate.getTime() * 1000;
      const endTimeMicros = now.getTime() * 1000;

      return {
        __global: {
          start_time: new Date(startTimeMicros),
          end_time: new Date(endTimeMicros),
        },
      };
    });

    // Get ingestion limit value for threshold
    const ingestionLimitGB = computed(() => {
      if (isIngestionUnlimited.value) {
        return null; // No limit for unlimited plans
      }
      return licenseData.value?.license?.limits?.Ingestion?.value || 100;
    });

    // Generate usage dashboard data
    const generateUsageDashboard = () => {
      const ingestionLimit = ingestionLimitGB.value;

      // Build the threshold configuration - using correct format for mark_line
      const thresholds: any[] = [];
      if (ingestionLimit !== null && ingestionLimit > 0) {

        // Add critical threshold at 100% of limit
        thresholds.push({
          type: "yAxis",
          name: "Limit Exceeded",
          value: ingestionLimitGB,
          color: "#FF0000", // Red
          lineStyle: "solid",
          width: 2,
        });
      }

      const query = `SELECT histogram(_timestamp, '1 day') AS x_axis_1, sum(size) AS y_axis_1 FROM "usage" WHERE event = 'Ingestion' GROUP BY x_axis_1 ORDER BY x_axis_1`;

      // Get timestamps in microseconds (16 digits)
      const now = new Date();
      const calendarStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const startTimeMicros = calendarStartDate.getTime() * 1000;
      const endTimeMicros = now.getTime() * 1000;

      const dashboard = {
        version: 8,
        dashboardId: "",
        title: "Ingestion Usage",
        description: "Daily ingestion usage with threshold limits",
        role: "",
        owner: "",
        created: new Date().toISOString(),
        tabs: [
          {
            tabId: "default",
            name: "Default",
            panels: [
              {
                id: "Panel_ID_License_Usage",
                type: "bar",
                title: "",
                description: "",
                config: {
                  show_legends: false,
                  legends_position: null,
                  unit: "megabytes",
                  decimals: 0,
                  line_thickness: 1.5,
                  step_value: "0",
                  top_results_others: false,
                  axis_border_show: true,
                  label_option: {
                    rotate: 0,
                  },
                  axis_label_rotate: 0,
                  show_symbol: false,
                  line_interpolation: "smooth",
                  legend_width: {
                    unit: "px",
                  },
                  legend_height: {
                    unit: "px",
                  },
                  base_map: {
                    type: "osm",
                  },
                  map_type: {
                    type: "world",
                  },
                  map_view: {
                    zoom: 1,
                    lat: 0,
                    lng: 0,
                  },
                  map_symbol_style: {
                    size: "by Value",
                    size_by_value: {
                      min: 1,
                      max: 100,
                    },
                    size_fixed: 2,
                  },
                  drilldown: [],
                  mark_line: thresholds,
                  override_config: [],
                  connect_nulls: false,
                  no_value_replacement: "",
                  wrap_table_cells: false,
                  table_transpose: false,
                  table_dynamic_columns: false,
                  mappings: [],
                  color: {
                    mode: "palette-classic-by-series",
                    fixedColor: ["#FF0000"],
                    seriesBy: "last",
                    colorBySeries: [],
                  },
                  trellis: {
                    layout: null,
                    num_of_columns: 1,
                    group_by_y_axis: false,
                  },
                  show_gridlines: true,
                  aggregation: "last",
                  lat_label: "latitude",
                  lon_label: "longitude",
                  weight_label: "weight",
                  name_label: "name",
                  table_aggregations: ["last"],
                  promql_table_mode: "single",
                  visible_columns: [],
                  hidden_columns: [],
                  sticky_columns: [],
                },
                queryType: "sql",
                queries: [
                  {
                    query: query,
                    vrlFunctionQuery: "",
                    customQuery: true,
                    fields: {
                      stream: "usage",
                      stream_type: "logs",
                      x: [
                        {
                          label: "Timestamp",
                          alias: "x_axis_1",
                          column: "x_axis_1",
                          color: null,
                          isDerived: false,
                        },
                      ],
                      y: [
                        {
                          label: "Ingestion (GB)",
                          alias: "y_axis_1",
                          column: "y_axis_1",
                          color: "#FF0000",
                          isDerived: false,
                        },
                      ],
                      z: [],
                      breakdown: [],
                      filter: {
                        filterType: "group",
                        logicalOperator: "AND",
                        conditions: [],
                      },
                    },
                    config: {
                      promql_legend: "",
                      layer_type: "scatter",
                      weight_fixed: 1,
                      limit: 0,
                      min: 0,
                      max: 100,
                      time_shift: [],
                    },
                    joins: [],
                  },
                ],
                layout: {
                  "x": 0,
                  "y": 0,
                  "w": 192,
                  "h": 16,
                  "i": 1
                },
                htmlContent: "",
                markdownContent: "",
                customChartContent: "",
              },
            ],
          },
        ],
        variables: {
          list: [],
          showDynamicFilters: false,
        },
        defaultDatetimeDuration: {
          type: "absolute",
          startTime: startTimeMicros,
          endTime: endTimeMicros,
        },
      };

      usageDashboardData.value = dashboard;
      dashboardRenderKey.value++;
    };

    onMounted(() => {
      loadLicenseData();
      generateUsageDashboard();
    });

    return {
      loading,
      updating,
      licenseData,
      licenseKey,
      showUpdateForm,
      showLicenseKeyModal,
      updateLicense,
      formatDate,
      isIngestionUnlimited,
      ingestionUsagePercent,
      getIngestionUsageColor,
      showLicenseExpiryWarning,
      getLicenseExpiryMessage,
      showUpdateFormAndFocus,
      maskKey,
      getMaskedLicenseKey,
      copyLicenseKey,
      redirectToGetLicense,
      isLicenseKeyAutoFilled,
      checkAndAutoFillLicenseFromUrl,
      usageDashboardData,
      dashboardRenderKey,
      currentTimeObj,
      ingestionLimitGB,
      generateUsageDashboard,
    };
  },
});
</script>

<style>
.gradient-banner {
  background: linear-gradient(
    to right,
    transparent 60%,
    #f7f7ff 70%,
    #cdf7e4 100%  );
}

.license-expiry-container {
  border: 1px solid #D7D7D7;
  border-radius: 6px;
}

.o2-license-message {
  font-size: 18px;
  font-weight: 600;
  line-height: 32px;
}

.o2-license-subtitle {
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}

.compact-table {
  td, th {
    padding: 8px 12px !important;
    line-height: 1.2;
  }
}

.usage-chart-container {
  width: 100%;
  overflow: visible;
  padding: 0;
  margin: 0 auto;

  .grid-stack-item-content {
    border: 0px !important; 
  }
}

@media (max-width: 1023px) {
  .usage-chart-container {
    height: 320px !important;
    min-height: 320px !important;
  }
}

.chart-wrapper {
  position: relative;

  .chart-title {
    color: inherit;
    opacity: 0.9;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
}

.limit-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: #f97316;
  backdrop-filter: blur(10px);
}

.ingestion-summary-compact {
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 8px;
  padding: 12px 14px;
  backdrop-filter: blur(10px);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 3px;
    height: 100%;
    background: linear-gradient(180deg, var(--o2-menu-color) 0%, var(--o2-menu-color) 100%);
    opacity: 0.6;
  }

  .summary-text-compact {
    line-height: 1.6;
    color: inherit;
    font-size: 13px;

    strong {
      font-weight: 700;
      background: linear-gradient(135deg, var(--o2-menu-color) 0%, var(--o2-menu-color) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
  }

  .warning-message {
    display: inline-flex;
    align-items: center;
    color: inherit;
    font-weight: 600;
  }

  .info-message {
    font-size: 12px;
    opacity: 0.8;
    font-style: italic;
  }
}

.modern-info-banner {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 8px;
  backdrop-filter: blur(10px);
  transition: all 0.2s ease;
}

.body--dark {
  .gradient-banner {
    background: linear-gradient(
      to right,
      transparent 60%,
      #24262F 70%,
      #2C3934 100%  );
  }

  .license-expiry-container {
    border: 1px solid #454F5B;
  }

  .modern-info-banner {
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .futuristic-card {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%);
    border: 1px solid rgba(99, 102, 241, 0.25);

    &::before {
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(99, 102, 241, 0.7) 20%,
        rgba(168, 85, 247, 0.7) 80%,
        transparent 100%
      );
    }
  }

  .futuristic-header {
    .header-glow {
      background: radial-gradient(ellipse at center, rgba(99, 102, 241, 0.15) 0%, transparent 70%);
    }
  }

  .ingestion-summary-compact {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
    border: 1px solid rgba(99, 102, 241, 0.3);

    &::before {
      opacity: 0.8;
    }
  }

  .limit-badge {
    background: rgba(249, 115, 22, 0.15);
    border: 1px solid rgba(249, 115, 22, 0.4);
  }
}
</style>