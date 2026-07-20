<template>
  <div class="rounded-md p-3">
    <div class="flex gap-3">
      <!-- Left: Simulated Log Viewer -->
      <div class="w-2/3">
        <OCard>
          <OCardSection role="header">
            <div class="text-xl font-semibold">Sample Logs (Click to See Correlation)</div>
          </OCardSection>

          <OSeparator />

          <OCardSection role="body">
            <div class="log-viewer flex flex-col gap-3">
              <!-- Sample Log 1 -->
              <div class="log-line group p-4 bg-(--q-dark-page,#f5f5f5) rounded-lg border-2 border-transparent cursor-pointer transition-all duration-200 relative hover:border-(--q-primary) hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog1)">
                <div class="log-timestamp font-mono text-xs text-[var(--q-primary)] mb-2">2025-12-02 10:23:45</div>
                <div class="log-content flex flex-col gap-1 text-[13px]">
                  <div><strong>service.name:</strong> checkout-api</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>k8s.deployment.name:</strong> checkout-v2</div>
                  <div>
                    <strong>message:</strong> Payment processing failed -
                    timeout
                  </div>
                </div>
                <OIcon name="link" size="sm" class="absolute top-4 right-4 opacity-0 transition-opacity duration-200 text-[var(--q-primary)] group-hover:opacity-100" />
              </div>

              <!-- Sample Log 2 -->
              <div class="log-line group p-4 bg-(--q-dark-page,#f5f5f5) rounded-lg border-2 border-transparent cursor-pointer transition-all duration-200 relative hover:border-(--q-primary) hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog2)">
                <div class="log-timestamp font-mono text-xs text-[var(--q-primary)] mb-2">2025-12-02 10:24:12</div>
                <div class="log-content flex flex-col gap-1 text-[13px]">
                  <div><strong>service.name:</strong> inventory-service</div>
                  <div><strong>k8s.cluster:</strong> prod-us-east</div>
                  <div><strong>environment:</strong> production</div>
                  <div>
                    <strong>message:</strong> Database connection timeout
                  </div>
                </div>
                <OIcon name="link" size="sm" class="absolute top-4 right-4 opacity-0 transition-opacity duration-200 text-[var(--q-primary)] group-hover:opacity-100" />
              </div>

              <!-- Sample Log 3 -->
              <div class="log-line group p-4 bg-(--q-dark-page,#f5f5f5) rounded-lg border-2 border-transparent cursor-pointer transition-all duration-200 relative hover:border-(--q-primary) hover:bg-(--q-dark-page,#eeeeee)" @click="selectLog(sampleLog3)">
                <div class="log-timestamp font-mono text-xs text-[var(--q-primary)] mb-2">2025-12-02 10:25:30</div>
                <div class="log-content flex flex-col gap-1 text-[13px]">
                  <div><strong>service.name:</strong> user-auth</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>region:</strong> us-west-2</div>
                  <div>
                    <strong>message:</strong> Authentication successful for
                    user_123
                  </div>
                </div>
                <OIcon name="link" size="sm" class="absolute top-4 right-4 opacity-0 transition-opacity duration-200 text-[var(--q-primary)] group-hover:opacity-100" />
              </div>
            </div>
          </OCardSection>
        </OCard>

        <!-- Instructions -->
        <OCard class="mt-4">
          <OCardSection role="body">
            <div class="text-xl font-semibold">How to Use</div>
            <ol class="m-2">
              <li>Click any log line above to see related telemetry</li>
              <li>The correlation panel will appear on the right</li>
              <li>View the extracted service dimensions</li>
              <li>See which traces and metrics are related</li>
              <li>Click "View" to navigate (demo mode shows query)</li>
            </ol>

            <OSeparator class="my-4" />

            <div class="text-sm font-medium mb-2">Current Status:</div>
            <div>
              <OTag v-if="isServiceStreamsEnabled" type="featureStatus" value="enabled">
                Service Streams: Enabled
              </OTag>
              <OTag v-else type="featureStatus" value="disabled">
                Service Streams: Disabled
              </OTag>
            </div>
            <div class="mt-1 text-xs text-gray-400">
              Note: This is a demo using simulated data. In production,
              correlation will use real service_streams data.
            </div>
          </OCardSection>
        </OCard>
      </div>

      <!-- Right: Correlation Panel -->
      <div class="w-1/3">
        <TelemetryCorrelationPanel
          :show="showCorrelation"
          :context="selectedContext"
          source-type="logs"
          :time-window-minutes="5"
          @close="showCorrelation = false"
        />

        <!-- Fallback when panel is closed -->
        <OCard v-if="!showCorrelation">
          <OCardSection class="text-center p-6">
            <OIcon name="info" size="lg" />
            <div class="text-gray-400 mt-3">
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
        <div class="text-xs text-gray-400 mb-2">
          This query would be executed to fetch related
          {{ queryPreview.type }}:
        </div>
        <pre class="query-preview bg-(--q-dark-page,#f5f5f5) p-4 rounded font-mono text-xs overflow-x-auto whitespace-pre-wrap wrap-break-word">{{ queryPreview.sql }}</pre>
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
import OTag from "@/lib/core/Badge/OTag.vue";
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
