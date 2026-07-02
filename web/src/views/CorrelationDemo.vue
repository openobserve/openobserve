<template>
  <div class="tw:rounded-md tw:p-3">
    <div class="tw:flex tw:gap-3">
      <!-- Left: Simulated Log Viewer -->
      <div class="tw:w-2/3">
        <OCard>
          <OCardSection role="header">
            <div class="tw:text-xl tw:font-semibold">Sample Logs (Click to See Correlation)</div>
          </OCardSection>

          <OSeparator />

          <OCardSection role="body">
            <div class="log-viewer tw:flex tw:flex-col tw:gap-3">
              <!-- Sample Log 1 -->
              <div class="log-line tw:group tw:p-4 tw:bg-(--q-dark-page,#f5f5f5) tw:rounded-lg tw:border-2 tw:border-transparent tw:cursor-pointer tw:transition-all tw:duration-200 tw:relative tw:hover:border-(--q-primary) tw:hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog1)">
                <div class="log-timestamp tw:font-mono tw:text-xs tw:text-[var(--q-primary)] tw:mb-2">2025-12-02 10:23:45</div>
                <div class="log-content tw:flex tw:flex-col tw:gap-1 tw:text-[13px]">
                  <div><strong>service.name:</strong> checkout-api</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>k8s.deployment.name:</strong> checkout-v2</div>
                  <div>
                    <strong>message:</strong> Payment processing failed -
                    timeout
                  </div>
                </div>
                <OIcon name="link" size="sm" class="tw:absolute tw:top-4 tw:right-4 tw:opacity-0 tw:transition-opacity tw:duration-200 tw:text-[var(--q-primary)] tw:group-hover:opacity-100" />
              </div>

              <!-- Sample Log 2 -->
              <div class="log-line tw:group tw:p-4 tw:bg-(--q-dark-page,#f5f5f5) tw:rounded-lg tw:border-2 tw:border-transparent tw:cursor-pointer tw:transition-all tw:duration-200 tw:relative tw:hover:border-(--q-primary) tw:hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog2)">
                <div class="log-timestamp tw:font-mono tw:text-xs tw:text-[var(--q-primary)] tw:mb-2">2025-12-02 10:24:12</div>
                <div class="log-content tw:flex tw:flex-col tw:gap-1 tw:text-[13px]">
                  <div><strong>service.name:</strong> inventory-service</div>
                  <div><strong>k8s.cluster:</strong> prod-us-east</div>
                  <div><strong>environment:</strong> production</div>
                  <div>
                    <strong>message:</strong> Database connection timeout
                  </div>
                </div>
                <OIcon name="link" size="sm" class="tw:absolute tw:top-4 tw:right-4 tw:opacity-0 tw:transition-opacity tw:duration-200 tw:text-[var(--q-primary)] tw:group-hover:opacity-100" />
              </div>

              <!-- Sample Log 3 -->
              <div class="log-line tw:group tw:p-4 tw:bg-(--q-dark-page,#f5f5f5) tw:rounded-lg tw:border-2 tw:border-transparent tw:cursor-pointer tw:transition-all tw:duration-200 tw:relative tw:hover:border-(--q-primary) tw:hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog3)">
                <div class="log-timestamp tw:font-mono tw:text-xs tw:text-[var(--q-primary)] tw:mb-2">2025-12-02 10:25:30</div>
                <div class="log-content tw:flex tw:flex-col tw:gap-1 tw:text-[13px]">
                  <div><strong>service.name:</strong> user-auth</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>region:</strong> us-west-2</div>
                  <div>
                    <strong>message:</strong> Authentication successful for
                    user_123
                  </div>
                </div>
                <OIcon name="link" size="sm" class="tw:absolute tw:top-4 tw:right-4 tw:opacity-0 tw:transition-opacity tw:duration-200 tw:text-[var(--q-primary)] tw:group-hover:opacity-100" />
              </div>
            </div>
          </OCardSection>
        </OCard>

        <!-- Instructions -->
        <OCard class="tw:mt-4">
          <OCardSection role="body">
            <div class="tw:text-xl tw:font-semibold">How to Use</div>
            <ol class="tw:m-2">
              <li>Click any log line above to see related telemetry</li>
              <li>The correlation panel will appear on the right</li>
              <li>View the extracted service dimensions</li>
              <li>See which traces and metrics are related</li>
              <li>Click "View" to navigate (demo mode shows query)</li>
            </ol>

            <OSeparator class="tw:my-4" />

            <div class="tw:text-sm tw:font-medium tw:mb-2">Current Status:</div>
            <div>
              <OBadge v-if="isServiceStreamsEnabled" variant="success">
                Service Streams: Enabled
              </OBadge>
              <OBadge v-else variant="error">
                Service Streams: Disabled
              </OBadge>
            </div>
            <div class="tw:mt-1 tw:text-xs tw:text-gray-400">
              Note: This is a demo using simulated data. In production,
              correlation will use real service_streams data.
            </div>
          </OCardSection>
        </OCard>
      </div>

      <!-- Right: Correlation Panel -->
      <div class="tw:w-1/3">
        <TelemetryCorrelationPanel
          :show="showCorrelation"
          :context="selectedContext"
          source-type="logs"
          :time-window-minutes="5"
          @close="showCorrelation = false"
        />

        <!-- Fallback when panel is closed -->
        <OCard v-if="!showCorrelation">
          <OCardSection class="tw:text-center tw:p-6">
            <OIcon name="info" size="lg" />
            <div class="tw:text-gray-400 tw:mt-3">
              Click a log line to see related telemetry
            </div>
          </OCardSection>
        </OCard>
      </div>
    </div>

    <!-- Query Preview Dialog -->
    <ODialog
      data-test="correlation-demo-query-dialog"
      v-model:open="showQueryDialog"
      size="md"
      title="Generated Query"
      primary-button-label="Close"
      @click:primary="showQueryDialog = false"
    >
      <div>
        <div class="tw:text-xs tw:text-gray-400 tw:mb-2">
          This query would be executed to fetch related
          {{ queryPreview.type }}:
        </div>
        <pre class="query-preview tw:bg-(--q-dark-page,#f5f5f5) tw:p-4 tw:rounded tw:font-mono tw:text-xs tw:overflow-x-auto tw:whitespace-pre-wrap tw:wrap-break-word">{{ queryPreview.sql }}</pre>
      </div>
    </ODialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import TelemetryCorrelationPanel from "@/components/TelemetryCorrelationPanel.vue";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";

// Demo state
const showCorrelation = ref(false);
const selectedContext = ref<TelemetryContext | null>(null);
const showQueryDialog = ref(false);
const queryPreview = ref({ type: "", sql: "" });
const isServiceStreamsEnabled = ref(true); // Simulated

// Sample log data with realistic semantic fields
const sampleLog1 = {
  _timestamp: Date.now() * 1000, // Microseconds
  "service.name": "checkout-api",
  "k8s.cluster": "prod-us-west",
  "k8s.deployment.name": "checkout-v2",
  environment: "production",
  level: "ERROR",
  message: "Payment processing failed - timeout",
};

const sampleLog2 = {
  _timestamp: Date.now() * 1000,
  "service.name": "inventory-service",
  "k8s.cluster": "prod-us-east",
  "k8s.namespace": "backend",
  environment: "production",
  level: "WARN",
  message: "Database connection timeout",
};

const sampleLog3 = {
  _timestamp: Date.now() * 1000,
  "service.name": "user-auth",
  "k8s.cluster": "prod-us-west",
  region: "us-west-2",
  environment: "production",
  level: "INFO",
  message: "Authentication successful for user_123",
};

/**
 * Handle log selection
 */
function selectLog(log: any) {
  selectedContext.value = {
    timestamp: log._timestamp,
    fields: log,
  };
  showCorrelation.value = true;
}
</script>

<style>
.log-line .log-content div {
  display: flex;
  gap: 8px;
}

.log-line .log-content strong {
  min-width: 150px;
  color: var(--q-text-secondary, #757575);
}

</style>
