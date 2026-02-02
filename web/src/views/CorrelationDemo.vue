<template>
  <q-page class="q-pa-md">
    <div class="row q-col-gutter-md">
      <!-- Left: Simulated Log Viewer -->
      <div class="col-8">
        <q-card>
          <q-card-section>
            <div class="text-h6">Sample Logs (Click to See Correlation)</div>
          </q-card-section>

          <q-separator />

          <q-card-section>
            <div class="log-viewer">
              <!-- Sample Log 1 -->
              <div
                class="log-line"
                @click="selectLog(sampleLog1)"
              >
                <div class="log-timestamp">2025-12-02 10:23:45</div>
                <div class="log-content">
                  <div><strong>service.name:</strong> checkout-api</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>k8s.deployment.name:</strong> checkout-v2</div>
                  <div><strong>message:</strong> Payment processing failed - timeout</div>
                </div>
                <q-icon name="link" class="correlation-hint" />
              </div>

              <!-- Sample Log 2 -->
              <div
                class="log-line"
                @click="selectLog(sampleLog2)"
              >
                <div class="log-timestamp">2025-12-02 10:24:12</div>
                <div class="log-content">
                  <div><strong>service.name:</strong> inventory-service</div>
                  <div><strong>k8s.cluster:</strong> prod-us-east</div>
                  <div><strong>environment:</strong> production</div>
                  <div><strong>message:</strong> Database connection timeout</div>
                </div>
                <q-icon name="link" class="correlation-hint" />
              </div>

              <!-- Sample Log 3 -->
              <div
                class="log-line"
                @click="selectLog(sampleLog3)"
              >
                <div class="log-timestamp">2025-12-02 10:25:30</div>
                <div class="log-content">
                  <div><strong>service.name:</strong> user-auth</div>
                  <div><strong>k8s.cluster:</strong> prod-us-west</div>
                  <div><strong>region:</strong> us-west-2</div>
                  <div><strong>message:</strong> Authentication successful for user_123</div>
                </div>
                <q-icon name="link" class="correlation-hint" />
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Instructions -->
        <q-card class="q-mt-md">
          <q-card-section>
            <div class="text-h6">How to Use</div>
            <ol class="q-ma-sm">
              <li>Click any log line above to see related telemetry</li>
              <li>The correlation panel will appear on the right</li>
              <li>View the extracted service dimensions</li>
              <li>See which traces and metrics are related</li>
              <li>Click "View" to navigate (demo mode shows query)</li>
            </ol>

            <q-separator class="q-my-md" />

            <div class="text-subtitle2 q-mb-sm">Current Status:</div>
            <div>
              <q-badge v-if="isServiceStreamsEnabled" color="positive" label="Service Streams: Enabled" />
              <q-badge v-else color="negative" label="Service Streams: Disabled" />
            </div>
            <div class="q-mt-xs text-caption text-grey-7">
              Note: This is a demo using simulated data. In production, correlation will use real service_streams data.
            </div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Right: Correlation Panel -->
      <div class="col-4">
        <TelemetryCorrelationPanel
          :show="showCorrelation"
          :context="selectedContext"
          source-type="logs"
          :time-window-minutes="5"
          @close="showCorrelation = false"
        />

        <!-- Fallback when panel is closed -->
        <q-card v-if="!showCorrelation">
          <q-card-section class="text-center q-pa-lg">
            <q-icon name="info" size="lg" color="grey-5" />
            <div class="text-grey-6 q-mt-md">
              Click a log line to see related telemetry
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Query Preview Dialog -->
    <q-dialog v-model="showQueryDialog">
      <q-card style="min-width: 600px">
        <q-card-section class="row items-center">
          <div class="text-h6">Generated Query</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup />
        </q-card-section>

        <q-separator />

        <q-card-section>
          <div class="text-caption text-grey-7 q-mb-sm">
            This query would be executed to fetch related {{ queryPreview.type }}:
          </div>
          <pre class="query-preview">{{ queryPreview.sql }}</pre>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Close" color="primary" v-close-popup />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from "vue";
import TelemetryCorrelationPanel from "@/components/TelemetryCorrelationPanel.vue";
import type { TelemetryContext } from "@/utils/telemetryCorrelation";

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

<style scoped lang="scss">
.log-viewer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-line {
  padding: 16px;
  background: var(--q-dark-page, #f5f5f5);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    border-color: var(--q-primary);
    background: var(--q-dark-page, #eeeeee);

    .correlation-hint {
      opacity: 1;
    }
  }

  .log-timestamp {
    font-family: monospace;
    font-size: 12px;
    color: var(--q-primary);
    margin-bottom: 8px;
  }

  .log-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;

    div {
      display: flex;
      gap: 8px;
    }

    strong {
      min-width: 150px;
      color: var(--q-text-secondary, #757575);
    }
  }

  .correlation-hint {
    position: absolute;
    top: 16px;
    right: 16px;
    opacity: 0;
    transition: opacity 0.2s;
    color: var(--q-primary);
  }
}

.query-preview {
  background: var(--q-dark-page, #f5f5f5);
  padding: 16px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}
</style>
