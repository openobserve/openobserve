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

    <div data-test="destination-preview-card" class="w-full">
        <!-- Slack Preview -->
        <div v-if="type === 'slack'" data-test="slack-preview" class="slack-message max-w-[600px] mx-auto bg-white border border-(--o2-border) rounded-lg p-4 shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="slack-message-container flex gap-3">
            <div class="slack-avatar">
              <div class="avatar-circle w-[36px] h-[36px] bg-[#4a154b] text-white rounded flex items-center justify-center font-bold text-[0.875rem]">OO</div>
            </div>
            <div class="slack-content flex-1">
              <div class="slack-header flex items-center gap-2 mb-2">
                <strong data-test="slack-bot-name" class="bot-name text-[#1264a3] text-[0.9rem]">OpenObserve Bot</strong>
                <span class="slack-timestamp text-[#616061] text-xs">{{ getCurrentTime() }}</span>
              </div>
              <div data-test="slack-message-body" class="slack-body">
                <div class="slack-block-header text-lg font-bold mb-3 text-[#1d1c1d]">🚨 High CPU Usage</div>
                <div class="slack-fields grid grid-cols-2 gap-2 mb-3">
                  <div class="slack-field">
                    <div class="field-label font-bold text-[#1d1c1d] text-[0.875rem]">Stream:</div>
                    <div class="field-value text-[#616061] text-[0.875rem]">system-metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label font-bold text-[#1d1c1d] text-[0.875rem]">Type:</div>
                    <div class="field-value text-[#616061] text-[0.875rem]">metrics</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label font-bold text-[#1d1c1d] text-[0.875rem]">Status:</div>
                    <div class="field-value text-[#616061] text-[0.875rem]">🔴 Firing</div>
                  </div>
                  <div class="slack-field">
                    <div class="field-label font-bold text-[#1d1c1d] text-[0.875rem]">Count:</div>
                    <div class="field-value text-[#616061] text-[0.875rem]">15</div>
                  </div>
                </div>
                <div class="slack-threshold mb-3 text-[#1d1c1d] text-sm">
                  <strong>Threshold Exceeded:</strong> greater than 80%
                </div>
                <div class="slack-actions flex justify-center mt-4">
                  <OButton variant="preview-slack">View in OpenObserve</OButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- MS Teams Preview -->
        <div v-if="type === 'msteams'" data-test="msteams-preview" class="teams-card max-w-[600px] mx-auto bg-white border border-[#e1e5e9] rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div data-test="msteams-card-content" class="teams-card-content">
            <div class="teams-header bg-[#464775] text-white p-4">
              <div class="teams-title text-[1.125rem] font-bold mb-1">🚨 Alert: High CPU Usage</div>
              <div class="teams-subtitle text-[0.875rem] opacity-90">OpenObserve Alert Notification</div>
            </div>
            <div class="teams-facts p-4 grid gap-2">
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Stream</div>
                <div class="fact-value text-[#605e5c]">system-metrics</div>
              </div>
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Type</div>
                <div class="fact-value text-[#605e5c]">metrics</div>
              </div>
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Status</div>
                <div class="fact-value text-[#605e5c]">🔴 Firing</div>
              </div>
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Count</div>
                <div class="fact-value text-[#605e5c]">15</div>
              </div>
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Threshold</div>
                <div class="fact-value text-[#605e5c]">greater than 80%</div>
              </div>
              <div class="teams-fact flex justify-between py-1 border-b border-[#f3f2f1]">
                <div class="fact-name font-bold text-[#323130]">Time</div>
                <div class="fact-value text-[#605e5c]">{{ getCurrentTime() }}</div>
              </div>
            </div>
            <div class="teams-actions flex justify-center p-4">
              <OButton variant="preview-teams">View in OpenObserve</OButton>
            </div>
          </div>
        </div>

        <!-- Email Preview -->
        <div v-if="type === 'email'" data-test="email-preview" class="email-client max-w-[600px] mx-auto bg-white border border-[#ddd] rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="email-header bg-[#f8f9fa] p-4 border-b border-[#e9ecef]">
            <div data-test="email-subject" class="email-subject font-bold text-base mb-2">
              Subject: 🚨 OpenObserve Alert Notification
            </div>
            <div data-test="email-from" class="email-from text-[#6c757d] text-[0.875rem] mb-1">
              From: alerts@openobserve.ai
            </div>
            <div class="email-to text-[#6c757d] text-[0.875rem] mb-1">To: admin@example.com</div>
            <div class="email-time text-[#6c757d] text-[0.875rem] mb-1">{{ getCurrentTime() }}</div>
          </div>
          <div data-test="email-body" class="email-body p-6">
            <div class="email-alert-header">
              <div class="text-[#d63638] text-center mb-4 text-[1.5rem] font-bold">🚨 Alert Notification</div>
            </div>
            <div class="email-alert-info bg-[#f8f9fa] border-l-4 border-[#d63638] p-4 my-4">
              <div class="text-[#d63638] m-0 mb-2 text-[1.125rem] font-bold">High CPU Usage</div>
              <p class="m-0 text-[#6c757d]">An alert has been triggered in your OpenObserve monitoring system.</p>
            </div>
            <div class="email-details my-4">
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Stream:</span>
                <span class="detail-value text-[#6c757d]">system-metrics</span>
              </div>
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Type:</span>
                <span class="detail-value text-[#6c757d]">metrics</span>
              </div>
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Status:</span>
                <span class="detail-value text-[#6c757d]">🔴 Firing</span>
              </div>
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Count:</span>
                <span class="detail-value text-[#6c757d]">15</span>
              </div>
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Threshold:</span>
                <span class="detail-value text-[#6c757d]">greater than 80%</span>
              </div>
              <div class="email-detail-row flex justify-between py-2 border-b border-[#e9ecef]">
                <span class="detail-label font-bold text-[#495057]">Time:</span>
                <span class="detail-value text-[#6c757d]">{{ getCurrentTime() }}</span>
              </div>
            </div>
            <OButton variant="preview-email">View in OpenObserve</OButton>
          </div>
        </div>

        <!-- PagerDuty Preview -->
        <div v-if="type === 'pagerduty'" data-test="pagerduty-preview" class="pagerduty-incident max-w-[600px] mx-auto bg-white border border-[#ddd] rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="pagerduty-header bg-[#06ac38] text-white p-4 flex justify-between items-center">
            <div class="pagerduty-title font-bold text-[1.125rem]">PagerDuty Incident</div>
            <div class="pagerduty-status bg-[#d13212] py-1 px-2 rounded text-xs font-bold">Triggered</div>
          </div>
          <div class="pagerduty-content p-6">
            <div class="m-0 mb-4 text-[#2d3748] font-bold text-[1.17rem]">OpenObserve Alert: High CPU Usage</div>
            <div class="pagerduty-details">
              <div class="pagerduty-field mb-2 text-[#4a5568]">
                <strong>Source:</strong> openobserve
              </div>
              <div class="pagerduty-field mb-2 text-[#4a5568]">
                <strong>Severity:</strong> error
              </div>
              <div class="pagerduty-field mb-2 text-[#4a5568]">
                <strong>Component:</strong> system-metrics
              </div>
              <div class="pagerduty-field mb-2 text-[#4a5568]">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="pagerduty-link text-center mt-4">
              <a href="#" class="text-[#06ac38] no-underline font-bold">View in OpenObserve</a>
            </div>
          </div>
        </div>

        <!-- ServiceNow Preview -->
        <div v-if="type === 'servicenow'" data-test="servicenow-preview" class="servicenow-incident max-w-[600px] mx-auto bg-white border border-[#ddd] rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="servicenow-header bg-[#81b5a1] text-white p-4 flex justify-between items-center">
            <div class="servicenow-title font-bold text-[1.125rem]">ServiceNow Incident</div>
            <div class="servicenow-number [font-family:monospace] font-bold">INC0000123</div>
          </div>
          <div class="servicenow-content p-6">
            <div class="servicenow-field mb-3 text-[#4a5568]">
              <strong>Short Description:</strong> OpenObserve Alert: High CPU Usage
            </div>
            <div class="servicenow-field mb-3 text-[#4a5568]">
              <strong>Category:</strong> Software
            </div>
            <div class="servicenow-field mb-3 text-[#4a5568]">
              <strong>Priority:</strong> 2 - High
            </div>
            <div class="servicenow-field mb-3 text-[#4a5568]">
              <strong>State:</strong> New
            </div>
            <div class="servicenow-description bg-[#f8f9fa] p-4 rounded text-[#4a5568] [white-space:pre-line] mt-4">
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
        <div v-if="type === 'opsgenie'" data-test="opsgenie-preview" class="opsgenie-alert max-w-[600px] mx-auto bg-white border border-[#ddd] rounded-lg overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]">
          <div class="opsgenie-header bg-[#172b4d] text-white p-4 flex justify-between items-center">
            <div class="opsgenie-title font-bold text-[1.125rem]">Opsgenie Alert</div>
            <div class="opsgenie-priority bg-[#ffab00] text-[#172b4d] py-1 px-2 rounded font-bold">P3</div>
          </div>
          <div class="opsgenie-content p-6">
            <div class="m-0 mb-4 text-[#2d3748] font-bold text-[1.17rem]">OpenObserve Alert: High CPU Usage</div>
            <div class="opsgenie-details">
              <div class="opsgenie-field mb-2 text-[#4a5568]">
                <strong>Source:</strong> OpenObserve
              </div>
              <div class="opsgenie-field mb-2 text-[#4a5568]">
                <strong>Entity:</strong> system-metrics
              </div>
              <div class="opsgenie-field mb-2 text-[#4a5568]">
                <strong>Tags:</strong> openobserve, metrics, system-metrics
              </div>
              <div class="opsgenie-field mb-2 text-[#4a5568]">
                <strong>Time:</strong> {{ getCurrentTime() }}
              </div>
            </div>
            <div class="opsgenie-actions flex justify-center mt-4">
              <OButton variant="preview-action">View in OpenObserve</OButton>
            </div>
          </div>
        </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-center gap-2 w-full">
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
   inline `text-[#06ac38]` utility, turning this link the theme link color.
   This selector's specificity wins it back to PagerDuty green, like main. */
.pagerduty-link a {
  color: #06ac38;
  text-decoration: none;
}

/* Same issue as the link above: the global `p { color: var(--o2-text-body) }`
   rule (light text in dark mode) overrides the inline utility, making this
   message unreadable on the email card's fixed light background. */
.email-alert-info p {
  color: #6c757d;
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
