<!-- Copyright 2026 OpenObserve Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

<template>
  <q-dialog v-model="isOpen" data-test="destination-preview-dialog">
    <q-card data-test="destination-preview-card" class="preview-card">
      <q-card-section class="row items-center no-wrap">
        <div class="text-h6" data-test="preview-title">
          {{ t('alerts.destinationPreview') }} - {{ getDestinationTypeName(type) }}
        </div>
        <q-space />
        <q-btn
          icon="close"
          flat
          round
          dense
          data-test="preview-close-button"
          @click="isOpen = false"
        />
      </q-card-section>

      <q-separator />

      <q-card-section class="preview-container">
        <!-- Slack Preview -->
        <div v-if="type === 'slack'" data-test="slack-preview" class="slack-message">
          <div class="slack-message-container">
            <div class="slack-avatar">
              <div class="avatar-circle">OO</div>
            </div>
            <div class="slack-content">
              <div class="slack-header">
                <strong data-test="slack-bot-name" class="bot-name">OpenObserve Bot</strong>
                <span class="slack-timestamp">{{ getCurrentTime() }}</span>
              </div>
              <div data-test="slack-message-body" class="slack-body">
                <div class="slack-block-header">🚨 High CPU Usage</div>
                <div class="slack-fields">
                  <div class="slack-field">
                    <div class="field-label">Stream:</div>
                    <div class="field-value">system-metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label">Type:</div>
                    <div class="field-value">metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label">Status:</div>
                    <div class="field-value">🔴 Firing</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label">Count:</div>
                    <div class="field-value">15</div>
                  </div>
                </div>
                <div class="slack-threshold">
                  <strong>Threshold Exceeded:</strong> greater than 80%
                </div>
                <div class="slack-actions">
                  <button class="slack-button">View in OpenObserve</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- MS Teams Preview -->
        <div v-if="type === 'msteams'" data-test="msteams-preview" class="teams-card">
          <div data-test="msteams-card-content" class="teams-card-content">
            <div class="teams-header">
              <div class="teams-title">🚨 Alert: High CPU Usage</div>
              <div class="teams-subtitle">OpenObserve Alert Notification</div>
            </div>
            <div class="teams-facts">
              <div class="teams-fact">
                <div class="fact-name">Stream</div>
                <div class="fact-value">system-metrics</div>
              </div>
              <div class="teams-fact">
                <div class="fact-name">Type</div>
                <div class="fact-value">metrics</div>
              </div>
              <div class="teams-fact">
                <div class="fact-name">Status</div>
                <div class="fact-value">🔴 Firing</div>
              </div>
              <div class="teams-fact">
                <div class="fact-name">Count</div>
                <div class="fact-value">15</div>
              </div>
              <div class="teams-fact">
                <div class="fact-name">Threshold</div>
                <div class="fact-value">greater than 80%</div>
              </div>
              <div class="teams-fact">
                <div class="fact-name">Time</div>
                <div class="fact-value">{{ getCurrentTime() }}</div>
              </div>
            </div>
            <div class="teams-actions">
              <button class="teams-button">View in OpenObserve</button>
            </div>
          </div>
        </div>

        <!-- Email Preview -->
        <div v-if="type === 'email'" data-test="email-preview" class="email-client">
          <div class="email-header">
            <div data-test="email-subject" class="email-subject">
              Subject: 🚨 OpenObserve Alert Notification
            </div>
            <div data-test="email-from" class="email-from">
              From: alerts@openobserve.ai
            </div>
            <div class="email-to">To: admin@example.com</div>
            <div class="email-time">{{ getCurrentTime() }}</div>
          </div>
          <div data-test="email-body" class="email-body">
            <div class="email-alert-header">
              <h1>🚨 Alert Notification</h1>
            </div>
            <div class="email-alert-info">
              <h2>High CPU Usage</h2>
              <p>An alert has been triggered in your OpenObserve monitoring system.</p>
            </div>
            <div class="email-details">
              <div class="email-detail-row">
                <span class="detail-label">Stream:</span>
                <span class="detail-value">system-metrics</span>
              </div>
              <div class="email-detail-row">
                <span class="detail-label">Type:</span>
                <span class="detail-value">metrics</span>
              </div>
              <div class="email-detail-row">
                <span class="detail-label">Status:</span>
                <span class="detail-value">🔴 Firing</span>
              </div>
              <div class="email-detail-row">
                <span class="detail-label">Count:</span>
                <span class="detail-value">15</span>
              </div>
              <div class="email-detail-row">
                <span class="detail-label">Threshold:</span>
                <span class="detail-value">greater than 80%</span>
              </div>
              <div class="email-detail-row">
                <span class="detail-label">Time:</span>
                <span class="detail-value">{{ getCurrentTime() }}</span>
              </div>
            </div>
            <button class="email-button">View in OpenObserve</button>
          </div>
        </div>

        <!-- PagerDuty Preview -->
        <div v-if="type === 'pagerduty'" data-test="pagerduty-preview" class="pagerduty-incident">
          <div class="pagerduty-header">
            <div class="pagerduty-title">PagerDuty Incident</div>
            <div class="pagerduty-status">Triggered</div>
          </div>
          <div class="pagerduty-content">
            <h3>OpenObserve Alert: High CPU Usage</h3>
            <div class="pagerduty-details">
              <div class="pagerduty-field">
                <strong>Source:</strong> openobserve
              </div>
              <div class="pagerduty-field">
                <strong>Severity:</strong> error
              </div>
              <div class="pagerduty-field">
                <strong>Component:</strong> system-metrics
              </div>
              <div class="pagerduty-field">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="pagerduty-link">
              <a href="#">View in OpenObserve</a>
            </div>
          </div>
        </div>

        <!-- ServiceNow Preview -->
        <div v-if="type === 'servicenow'" data-test="servicenow-preview" class="servicenow-incident">
          <div class="servicenow-header">
            <div class="servicenow-title">ServiceNow Incident</div>
            <div class="servicenow-number">INC0000123</div>
          </div>
          <div class="servicenow-content">
            <div class="servicenow-field">
              <strong>Short Description:</strong> OpenObserve Alert: High CPU Usage
            </div>
            <div class="servicenow-field">
              <strong>Category:</strong> Software
            </div>
            <div class="servicenow-field">
              <strong>Priority:</strong> 2 - High
            </div>
            <div class="servicenow-field">
              <strong>State:</strong> New
            </div>
            <div class="servicenow-description">
              <strong>Description:</strong><br>
              Alert Details:<br><br>
              Stream: system-metrics<br>
              Type: metrics<br>
              Count: 15<br>
              Threshold: greater than 80%<br>
              Time: {{ getCurrentTime() }}<br><br>
              View in OpenObserve: https://openobserve.example.com/alerts/123
            </div>
          </div>
        </div>

        <!-- Opsgenie Preview -->
        <div v-if="type === 'opsgenie'" data-test="opsgenie-preview" class="opsgenie-alert">
          <div class="opsgenie-header">
            <div class="opsgenie-title">Opsgenie Alert</div>
            <div class="opsgenie-priority">P3</div>
          </div>
          <div class="opsgenie-content">
            <h3>OpenObserve Alert: High CPU Usage</h3>
            <div class="opsgenie-details">
              <div class="opsgenie-field">
                <strong>Source:</strong> OpenObserve
              </div>
              <div class="opsgenie-field">
                <strong>Entity:</strong> system-metrics
              </div>
              <div class="opsgenie-field">
                <strong>Tags:</strong> openobserve, metrics, system-metrics
              </div>
              <div class="opsgenie-field">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="opsgenie-actions">
              <button>View in OpenObserve</button>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-card-actions align="center">
        <q-btn
          data-test="preview-copy-button"
          label="Copy Template"
          icon="content_copy"
          outline
          no-caps
          @click="copyTemplate"
        />
        <q-btn
          data-test="preview-close-button"
          label="Close"
          flat
          no-caps
          @click="isOpen = false"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    required: true
  },
  templateContent: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['update:modelValue']);
const $q = useQuasar();
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// Get current time for display
const getCurrentTime = (): string => {
  return new Date().toLocaleTimeString();
};

// Get destination type display name
const getDestinationTypeName = (type: string): string => {
  const typeNames = {
    slack: 'Slack',
    msteams: 'Microsoft Teams',
    email: 'Email',
    pagerduty: 'PagerDuty',
    servicenow: 'ServiceNow',
    opsgenie: 'Opsgenie'
  };
  return typeNames[type] || type;
};

// Copy template to clipboard
const copyTemplate = () => {
  navigator.clipboard.writeText(props.templateContent).then(() => {
    $q.notify({
      type: 'positive',
      message: 'Template copied to clipboard',
      timeout: 2000
    });
  }).catch(() => {
    $q.notify({
      type: 'negative',
      message: 'Failed to copy template',
      timeout: 2000
    });
  });
};
</script>

<style lang="scss" scoped>
.preview-card {
  width: 700px;
  max-width: 90vw;
}

.preview-container {
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

// Slack Preview Styles
.slack-message {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.slack-message-container {
  display: flex;
  gap: 0.75rem;
}

.slack-avatar .avatar-circle {
  width: 36px;
  height: 36px;
  background: #4a154b;
  color: white;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 0.875rem;
}

.slack-content {
  flex: 1;
}

.slack-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.bot-name {
  color: #1264a3;
  font-size: 0.9rem;
}

.slack-timestamp {
  color: #616061;
  font-size: 0.75rem;
}

.slack-block-header {
  font-size: 1.125rem;
  font-weight: bold;
  margin-bottom: 0.75rem;
  color: #1d1c1d;
}

.slack-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.slack-field {
  .field-label {
    font-weight: bold;
    color: #1d1c1d;
    font-size: 0.875rem;
  }
  .field-value {
    color: #616061;
    font-size: 0.875rem;
  }
}

.slack-threshold {
  margin-bottom: 0.75rem;
  color: #1d1c1d;
  font-size: 0.875rem;
}

.slack-actions {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}

.slack-button {
  background: #007a5a;
  color: white;
  border: none;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;

  &:hover {
    background: #005a42;
  }
}

// Teams Preview Styles
.teams-card {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.teams-header {
  background: #464775;
  color: white;
  padding: 1rem;

  .teams-title {
    font-size: 1.125rem;
    font-weight: bold;
    margin-bottom: 0.25rem;
  }

  .teams-subtitle {
    font-size: 0.875rem;
    opacity: 0.9;
  }
}

.teams-facts {
  padding: 1rem;
  display: grid;
  gap: 0.5rem;
}

.teams-fact {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  border-bottom: 1px solid #f3f2f1;

  .fact-name {
    font-weight: bold;
    color: #323130;
  }

  .fact-value {
    color: #605e5c;
  }
}

.teams-actions {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.teams-button {
  background: #6264a7;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: #464775;
  }
}

// Email Preview Styles
.email-client {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.email-header {
  background: #f8f9fa;
  padding: 1rem;
  border-bottom: 1px solid #e9ecef;

  .email-subject {
    font-weight: bold;
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .email-from, .email-to, .email-time {
    color: #6c757d;
    font-size: 0.875rem;
    margin-bottom: 0.25rem;
  }
}

.email-body {
  padding: 1.5rem;

  .email-alert-header h1 {
    color: #d63638;
    text-align: center;
    margin-bottom: 1rem;
    font-size: 1.5rem;
  }

  .email-alert-info {
    background: #f8f9fa;
    border-left: 4px solid #d63638;
    padding: 1rem;
    margin: 1rem 0;

    h2 {
      color: #d63638;
      margin: 0 0 0.5rem 0;
      font-size: 1.125rem;
    }

    p {
      margin: 0;
      color: #6c757d;
    }
  }

  .email-details {
    margin: 1rem 0;
  }

  .email-detail-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid #e9ecef;

    .detail-label {
      font-weight: bold;
      color: #495057;
    }

    .detail-value {
      color: #6c757d;
    }
  }
}

.email-button {
  background: #007bff;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  margin: 1rem auto 0;
  cursor: pointer;
  display: block;

  &:hover {
    background: #0056b3;
  }
}

// PagerDuty Preview Styles
.pagerduty-incident {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.pagerduty-header {
  background: #06ac38;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;

  .pagerduty-title {
    font-weight: bold;
    font-size: 1.125rem;
  }

  .pagerduty-status {
    background: #d13212;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
  }
}

.pagerduty-content {
  padding: 1.5rem;

  h3 {
    margin: 0 0 1rem 0;
    color: #2d3748;
  }

  .pagerduty-field {
    margin-bottom: 0.5rem;
    color: #4a5568;
  }

  .pagerduty-link {
    text-align: center;
    margin-top: 1rem;

    a {
      color: #06ac38;
      text-decoration: none;
      font-weight: bold;
    }
  }
}

// ServiceNow Preview Styles
.servicenow-incident {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.servicenow-header {
  background: #81b5a1;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;

  .servicenow-title {
    font-weight: bold;
    font-size: 1.125rem;
  }

  .servicenow-number {
    font-family: monospace;
    font-weight: bold;
  }
}

.servicenow-content {
  padding: 1.5rem;

  .servicenow-field {
    margin-bottom: 0.75rem;
    color: #4a5568;
  }

  .servicenow-description {
    background: #f8f9fa;
    padding: 1rem;
    border-radius: 4px;
    color: #4a5568;
    white-space: pre-line;
    margin-top: 1rem;
  }
}

// Opsgenie Preview Styles
.opsgenie-alert {
  max-width: 600px;
  margin: 0 auto;
  background: #ffffff;
  border: 1px solid #ddd;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.opsgenie-header {
  background: #172b4d;
  color: white;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;

  .opsgenie-title {
    font-weight: bold;
    font-size: 1.125rem;
  }

  .opsgenie-priority {
    background: #ffab00;
    color: #172b4d;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-weight: bold;
  }
}

.opsgenie-content {
  padding: 1.5rem;

  h3 {
    margin: 0 0 1rem 0;
    color: #2d3748;
  }

  .opsgenie-field {
    margin-bottom: 0.5rem;
    color: #4a5568;
  }

  .opsgenie-actions {
    display: flex;
    justify-content: center;
    margin-top: 1rem;

    button {
      background: #172b4d;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;

      &:hover {
        background: #0f1c2e;
      }
    }
  }
}
</style>