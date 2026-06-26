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
  <ODialog
    v-model:open="isOpen"
    size="md"
    :title="`${t('alerts.destinationPreview')} - ${getDestinationTypeName(type)}`"
    data-test="destination-preview-dialog"
  >

    <div data-test="destination-preview-card" class="tw:w-full">
        <!-- Slack Preview -->
        <div v-if="type === 'slack'" data-test="slack-preview" class="slack-message tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-(--o2-border) tw:rounded-lg tw:p-4 tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="slack-message-container tw:flex tw:gap-3">
            <div class="slack-avatar">
              <div class="avatar-circle tw:w-[36px] tw:h-[36px] tw:bg-[#4a154b] tw:text-white tw:rounded tw:flex tw:items-center tw:justify-center tw:font-bold tw:text-[0.875rem]">OO</div>
            </div>
            <div class="slack-content tw:flex-1">
              <div class="slack-header tw:flex tw:items-center tw:gap-2 tw:mb-2">
                <strong data-test="slack-bot-name" class="bot-name tw:text-[#1264a3] tw:text-[0.9rem]">OpenObserve Bot</strong>
                <span class="slack-timestamp tw:text-[#616061] tw:text-xs">{{ getCurrentTime() }}</span>
              </div>
              <div data-test="slack-message-body" class="slack-body">
                <div class="slack-block-header tw:text-lg tw:font-bold tw:mb-3 tw:text-[#1d1c1d]">🚨 High CPU Usage</div>
                <div class="slack-fields tw:grid tw:grid-cols-2 tw:gap-2 tw:mb-3">
                  <div class="slack-field">
                    <div class="field-label tw:font-bold tw:text-[#1d1c1d] tw:text-[0.875rem]">Stream:</div>
                    <div class="field-value tw:text-[#616061] tw:text-[0.875rem]">system-metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label tw:font-bold tw:text-[#1d1c1d] tw:text-[0.875rem]">Type:</div>
                    <div class="field-value tw:text-[#616061] tw:text-[0.875rem]">metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label tw:font-bold tw:text-[#1d1c1d] tw:text-[0.875rem]">Status:</div>
                    <div class="field-value tw:text-[#616061] tw:text-[0.875rem]">🔴 Firing</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label tw:font-bold tw:text-[#1d1c1d] tw:text-[0.875rem]">Count:</div>
                    <div class="field-value tw:text-[#616061] tw:text-[0.875rem]">15</div>
                  </div>
                </div>
                <div class="slack-threshold tw:mb-3 tw:text-[#1d1c1d] tw:text-sm">
                  <strong>Threshold Exceeded:</strong> greater than 80%
                </div>
                <div class="slack-actions tw:flex tw:justify-center tw:mt-4">
                  <OButton variant="preview-slack">View in OpenObserve</OButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- MS Teams Preview -->
        <div v-if="type === 'msteams'" data-test="msteams-preview" class="teams-card tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-[#e1e5e9] tw:rounded-lg tw:overflow-hidden tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div data-test="msteams-card-content" class="teams-card-content">
            <div class="teams-header tw:bg-[#464775] tw:text-white tw:p-4">
              <div class="teams-title tw:text-[1.125rem] tw:font-bold tw:mb-1">🚨 Alert: High CPU Usage</div>
              <div class="teams-subtitle tw:text-[0.875rem] tw:opacity-90">OpenObserve Alert Notification</div>
            </div>
            <div class="teams-facts tw:p-4 tw:grid tw:gap-2">
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Stream</div>
                <div class="fact-value tw:text-[#605e5c]">system-metrics</div>
              </div>
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Type</div>
                <div class="fact-value tw:text-[#605e5c]">metrics</div>
              </div>
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Status</div>
                <div class="fact-value tw:text-[#605e5c]">🔴 Firing</div>
              </div>
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Count</div>
                <div class="fact-value tw:text-[#605e5c]">15</div>
              </div>
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Threshold</div>
                <div class="fact-value tw:text-[#605e5c]">greater than 80%</div>
              </div>
              <div class="teams-fact tw:flex tw:justify-between tw:py-1 tw:border-b tw:border-[#f3f2f1]">
                <div class="fact-name tw:font-bold tw:text-[#323130]">Time</div>
                <div class="fact-value tw:text-[#605e5c]">{{ getCurrentTime() }}</div>
              </div>
            </div>
            <div class="teams-actions tw:flex tw:justify-center tw:p-4">
              <OButton variant="preview-teams">View in OpenObserve</OButton>
            </div>
          </div>
        </div>

        <!-- Email Preview -->
        <div v-if="type === 'email'" data-test="email-preview" class="email-client tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-[#ddd] tw:rounded-lg tw:overflow-hidden tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="email-header tw:bg-[#f8f9fa] tw:p-4 tw:border-b tw:border-[#e9ecef]">
            <div data-test="email-subject" class="email-subject tw:font-bold tw:text-base tw:mb-2">
              Subject: 🚨 OpenObserve Alert Notification
            </div>
            <div data-test="email-from" class="email-from tw:text-[#6c757d] tw:text-[0.875rem] tw:mb-1">
              From: alerts@openobserve.ai
            </div>
            <div class="email-to tw:text-[#6c757d] tw:text-[0.875rem] tw:mb-1">To: admin@example.com</div>
            <div class="email-time tw:text-[#6c757d] tw:text-[0.875rem] tw:mb-1">{{ getCurrentTime() }}</div>
          </div>
          <div data-test="email-body" class="email-body tw:p-6">
            <div class="email-alert-header">
              <div class="tw:text-[#d63638] tw:text-center tw:mb-4 tw:text-[1.5rem] tw:font-bold">🚨 Alert Notification</div>
            </div>
            <div class="email-alert-info tw:bg-[#f8f9fa] tw:border-l-4 tw:border-[#d63638] tw:p-4 tw:my-4">
              <div class="tw:text-[#d63638] tw:m-0 tw:mb-2 tw:text-[1.125rem] tw:font-bold">High CPU Usage</div>
              <p class="tw:m-0 tw:text-[#6c757d]">An alert has been triggered in your OpenObserve monitoring system.</p>
            </div>
            <div class="email-details tw:my-4">
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Stream:</span>
                <span class="detail-value tw:text-[#6c757d]">system-metrics</span>
              </div>
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Type:</span>
                <span class="detail-value tw:text-[#6c757d]">metrics</span>
              </div>
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Status:</span>
                <span class="detail-value tw:text-[#6c757d]">🔴 Firing</span>
              </div>
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Count:</span>
                <span class="detail-value tw:text-[#6c757d]">15</span>
              </div>
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Threshold:</span>
                <span class="detail-value tw:text-[#6c757d]">greater than 80%</span>
              </div>
              <div class="email-detail-row tw:flex tw:justify-between tw:py-2 tw:border-b tw:border-[#e9ecef]">
                <span class="detail-label tw:font-bold tw:text-[#495057]">Time:</span>
                <span class="detail-value tw:text-[#6c757d]">{{ getCurrentTime() }}</span>
              </div>
            </div>
            <OButton variant="preview-email">View in OpenObserve</OButton>
          </div>
        </div>

        <!-- PagerDuty Preview -->
        <div v-if="type === 'pagerduty'" data-test="pagerduty-preview" class="pagerduty-incident tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-[#ddd] tw:rounded-lg tw:overflow-hidden tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="pagerduty-header tw:bg-[#06ac38] tw:text-white tw:p-4 tw:flex tw:justify-between tw:items-center">
            <div class="pagerduty-title tw:font-bold tw:text-[1.125rem]">PagerDuty Incident</div>
            <div class="pagerduty-status tw:bg-[#d13212] tw:py-1 tw:px-2 tw:rounded tw:text-xs tw:font-bold">Triggered</div>
          </div>
          <div class="pagerduty-content tw:p-6">
            <div class="tw:m-0 tw:mb-4 tw:text-[#2d3748] tw:font-bold tw:text-[1.17rem]">OpenObserve Alert: High CPU Usage</div>
            <div class="pagerduty-details">
              <div class="pagerduty-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Source:</strong> openobserve
              </div>
              <div class="pagerduty-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Severity:</strong> error
              </div>
              <div class="pagerduty-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Component:</strong> system-metrics
              </div>
              <div class="pagerduty-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="pagerduty-link tw:text-center tw:mt-4">
              <a href="#" class="tw:text-[#06ac38] tw:no-underline tw:font-bold">View in OpenObserve</a>
            </div>
          </div>
        </div>

        <!-- ServiceNow Preview -->
        <div v-if="type === 'servicenow'" data-test="servicenow-preview" class="servicenow-incident tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-[#ddd] tw:rounded-lg tw:overflow-hidden tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="servicenow-header tw:bg-[#81b5a1] tw:text-white tw:p-4 tw:flex tw:justify-between tw:items-center">
            <div class="servicenow-title tw:font-bold tw:text-[1.125rem]">ServiceNow Incident</div>
            <div class="servicenow-number tw:[font-family:monospace] tw:font-bold">INC0000123</div>
          </div>
          <div class="servicenow-content tw:p-6">
            <div class="servicenow-field tw:mb-3 tw:text-[#4a5568]">
              <strong>Short Description:</strong> OpenObserve Alert: High CPU Usage
            </div>
            <div class="servicenow-field tw:mb-3 tw:text-[#4a5568]">
              <strong>Category:</strong> Software
            </div>
            <div class="servicenow-field tw:mb-3 tw:text-[#4a5568]">
              <strong>Priority:</strong> 2 - High
            </div>
            <div class="servicenow-field tw:mb-3 tw:text-[#4a5568]">
              <strong>State:</strong> New
            </div>
            <div class="servicenow-description tw:bg-[#f8f9fa] tw:p-4 tw:rounded tw:text-[#4a5568] tw:[white-space:pre-line] tw:mt-4">
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
        <div v-if="type === 'opsgenie'" data-test="opsgenie-preview" class="opsgenie-alert tw:max-w-[600px] tw:mx-auto tw:bg-white tw:border tw:border-[#ddd] tw:rounded-lg tw:overflow-hidden tw:shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="opsgenie-header tw:bg-[#172b4d] tw:text-white tw:p-4 tw:flex tw:justify-between tw:items-center">
            <div class="opsgenie-title tw:font-bold tw:text-[1.125rem]">Opsgenie Alert</div>
            <div class="opsgenie-priority tw:bg-[#ffab00] tw:text-[#172b4d] tw:py-1 tw:px-2 tw:rounded tw:font-bold">P3</div>
          </div>
          <div class="opsgenie-content tw:p-6">
            <div class="tw:m-0 tw:mb-4 tw:text-[#2d3748] tw:font-bold tw:text-[1.17rem]">OpenObserve Alert: High CPU Usage</div>
            <div class="opsgenie-details">
              <div class="opsgenie-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Source:</strong> OpenObserve
              </div>
              <div class="opsgenie-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Entity:</strong> system-metrics
              </div>
              <div class="opsgenie-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Tags:</strong> openobserve, metrics, system-metrics
              </div>
              <div class="opsgenie-field tw:mb-2 tw:text-[#4a5568]">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="opsgenie-actions tw:flex tw:justify-center tw:mt-4">
              <OButton variant="preview-action">View in OpenObserve</OButton>
            </div>
          </div>
        </div>
    </div>

    <template #footer>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:w-full">
        <OButton
          data-test="preview-copy-button"
          variant="outline"
          size="sm-action"
          @click="copyTemplate"
          icon-left="content-copy"
        >
          Copy Template
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          @click="isOpen = false"
        >
          Close
        </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import { copyToClipboard } from "@/utils/clipboard";

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
  copyToClipboard(props.templateContent, {
    successMessage: 'Template copied to clipboard',
    errorMessage: 'Failed to copy template',
    timeout: 2000,
  });
};
</script>

<style>
/* The global `a { color: var(--o2-text-link) }` rule (unlayered) outranks the
   inline `tw:text-[#06ac38]` utility, turning this link the theme link color.
   This selector's specificity wins it back to PagerDuty green, like main. */
.pagerduty-link a {
  color: #06ac38;
  text-decoration: none;
}

.opsgenie-content .opsgenie-actions button {
  background: #172b4d;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.opsgenie-content .opsgenie-actions button:hover {
  background: #0f1c2e;
}
</style>
