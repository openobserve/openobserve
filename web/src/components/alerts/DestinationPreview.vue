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
      <div
        v-if="type === 'slack'"
        data-test="slack-preview"
        class="slack-message border-border-default rounded-default mx-auto max-w-150 border bg-white p-4 shadow-sm"
      >
        <div class="slack-message-container flex gap-3">
          <div class="slack-avatar">
            <div
              class="avatar-circle rounded-default bg-brand-slack-aubergine flex h-9 w-9 items-center justify-center text-sm font-bold text-white"
            >
              OO
            </div>
          </div>
          <div class="slack-content flex-1">
            <div class="slack-header mb-2 flex items-center gap-2">
              <strong data-test="slack-bot-name" class="bot-name text-brand-slack-link text-sm"
                >OpenObserve Bot</strong
              >
              <span class="slack-timestamp text-brand-slack-meta text-xs">{{
                getCurrentTime()
              }}</span>
            </div>
            <div data-test="slack-message-body" class="slack-body">
              <div class="slack-block-header text-brand-slack-text mb-3 text-lg font-bold">
                🚨 High CPU Usage
              </div>
              <div class="slack-fields mb-3 grid grid-cols-2 gap-2">
                <div class="slack-field">
                  <div class="field-label text-brand-slack-text text-sm font-bold">Stream:</div>
                  <div class="field-value text-brand-slack-meta text-sm">system-metrics</div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-brand-slack-text text-sm font-bold">Type:</div>
                  <div class="field-value text-brand-slack-meta text-sm">metrics</div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-brand-slack-text text-sm font-bold">Status:</div>
                  <div class="field-value text-brand-slack-meta text-sm">🔴 Firing</div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-brand-slack-text text-sm font-bold">Count:</div>
                  <div class="field-value text-brand-slack-meta text-sm">15</div>
                </div>
              </div>
              <div class="slack-threshold text-brand-slack-text mb-3 text-sm">
                <strong>Threshold Exceeded:</strong> greater than 80%
              </div>
              <div class="slack-actions mt-4 flex justify-center">
                <OButton variant="preview-slack">View in OpenObserve</OButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- MS Teams Preview -->
      <div
        v-if="type === 'msteams'"
        data-test="msteams-preview"
        class="teams-card rounded-default border-brand-msg-border-2 mx-auto max-w-150 overflow-hidden border bg-white shadow-sm"
      >
        <div data-test="msteams-card-content" class="teams-card-content">
          <div class="teams-header bg-brand-teams-hover p-4 text-white">
            <div class="teams-title mb-1 text-lg font-bold">🚨 Alert: High CPU Usage</div>
            <div class="teams-subtitle text-sm opacity-90">OpenObserve Alert Notification</div>
          </div>
          <div class="teams-facts grid gap-2 p-4">
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Stream</div>
              <div class="fact-value text-brand-teams-text">system-metrics</div>
            </div>
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Type</div>
              <div class="fact-value text-brand-teams-text">metrics</div>
            </div>
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Status</div>
              <div class="fact-value text-brand-teams-text">🔴 Firing</div>
            </div>
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Count</div>
              <div class="fact-value text-brand-teams-text">15</div>
            </div>
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Threshold</div>
              <div class="fact-value text-brand-teams-text">greater than 80%</div>
            </div>
            <div class="teams-fact border-brand-teams-bg flex justify-between border-b py-1">
              <div class="fact-name text-brand-teams-ink font-bold">Time</div>
              <div class="fact-value text-brand-teams-text">
                {{ getCurrentTime() }}
              </div>
            </div>
          </div>
          <div class="teams-actions flex justify-center p-4">
            <OButton variant="preview-teams">View in OpenObserve</OButton>
          </div>
        </div>
      </div>

      <!-- Email Preview -->
      <div
        v-if="type === 'email'"
        data-test="email-preview"
        class="email-client rounded-default border-brand-msg-divider mx-auto max-w-150 overflow-hidden border bg-white shadow-sm"
      >
        <div class="email-header border-brand-msg-border bg-brand-msg-bg border-b p-4">
          <div
            data-test="email-subject"
            class="email-subject text-brand-msg-text-strong mb-2 text-base font-bold"
          >
            Subject: 🚨 OpenObserve Alert Notification
          </div>
          <div data-test="email-from" class="email-from text-brand-msg-meta mb-1 text-sm">
            From: alerts@openobserve.ai
          </div>
          <div class="email-to text-brand-msg-meta mb-1 text-sm">To: admin@example.com</div>
          <div class="email-time text-brand-msg-meta mb-1 text-sm">
            {{ getCurrentTime() }}
          </div>
        </div>
        <div data-test="email-body" class="email-body p-6">
          <div class="email-alert-header">
            <div class="text-brand-msg-error mb-4 text-center text-2xl font-bold">
              🚨 Alert Notification
            </div>
          </div>
          <div class="email-alert-info border-brand-msg-error bg-brand-msg-bg my-4 border-l-4 p-4">
            <div class="text-brand-msg-error m-0 mb-2 text-lg font-bold">High CPU Usage</div>
            <p class="text-brand-msg-meta! m-0">
              An alert has been triggered in your OpenObserve monitoring system.
            </p>
          </div>
          <div class="email-details my-4">
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Stream:</span>
              <span class="detail-value text-brand-msg-meta">system-metrics</span>
            </div>
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Type:</span>
              <span class="detail-value text-brand-msg-meta">metrics</span>
            </div>
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Status:</span>
              <span class="detail-value text-brand-msg-meta">🔴 Firing</span>
            </div>
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Count:</span>
              <span class="detail-value text-brand-msg-meta">15</span>
            </div>
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Threshold:</span>
              <span class="detail-value text-brand-msg-meta">greater than 80%</span>
            </div>
            <div
              class="email-detail-row border-brand-msg-border flex justify-between border-b py-2"
            >
              <span class="detail-label text-brand-msg-text-strong font-bold">Time:</span>
              <span class="detail-value text-brand-msg-meta">{{ getCurrentTime() }}</span>
            </div>
          </div>
          <OButton variant="preview-email">View in OpenObserve</OButton>
        </div>
      </div>

      <!-- PagerDuty Preview -->
      <div
        v-if="type === 'pagerduty'"
        data-test="pagerduty-preview"
        class="pagerduty-incident rounded-default border-brand-msg-divider mx-auto max-w-150 overflow-hidden border bg-white shadow-sm"
      >
        <div
          class="pagerduty-header bg-brand-slack-green flex items-center justify-between p-4 text-white"
        >
          <div class="pagerduty-title text-lg font-bold">PagerDuty Incident</div>
          <div
            class="pagerduty-status rounded-default bg-brand-email-accent px-2 py-1 text-xs font-bold"
          >
            Triggered
          </div>
        </div>
        <div class="pagerduty-content p-6">
          <div class="text-brand-msg-text-dark m-0 mb-4 text-lg font-bold">
            OpenObserve Alert: High CPU Usage
          </div>
          <div class="pagerduty-details">
            <div class="pagerduty-field text-brand-msg-text mb-2">
              <strong>Source:</strong> openobserve
            </div>
            <div class="pagerduty-field text-brand-msg-text mb-2">
              <strong>Severity:</strong> error
            </div>
            <div class="pagerduty-field text-brand-msg-text mb-2">
              <strong>Component:</strong> system-metrics
            </div>
            <div class="pagerduty-field text-brand-msg-text mb-2">
              <strong>Time:</strong> {{ getCurrentTime() }}
            </div>
          </div>
          <div class="pagerduty-link mt-4 text-center">
            <a href="#" class="text-brand-slack-green! font-bold no-underline"
              >View in OpenObserve</a
            >
          </div>
        </div>
      </div>

      <!-- ServiceNow Preview -->
      <div
        v-if="type === 'servicenow'"
        data-test="servicenow-preview"
        class="servicenow-incident rounded-default border-brand-msg-divider mx-auto max-w-150 overflow-hidden border bg-white shadow-sm"
      >
        <div
          class="servicenow-header bg-brand-slack-avatar flex items-center justify-between p-4 text-white"
        >
          <div class="servicenow-title text-lg font-bold">ServiceNow Incident</div>
          <div class="servicenow-number font-mono font-bold">INC0000123</div>
        </div>
        <div class="servicenow-content p-6">
          <div class="servicenow-field text-brand-msg-text mb-3">
            <strong>Short Description:</strong> OpenObserve Alert: High CPU Usage
          </div>
          <div class="servicenow-field text-brand-msg-text mb-3">
            <strong>Category:</strong> Software
          </div>
          <div class="servicenow-field text-brand-msg-text mb-3">
            <strong>Priority:</strong> 2 - High
          </div>
          <div class="servicenow-field text-brand-msg-text mb-3"><strong>State:</strong> New</div>
          <div
            class="servicenow-description rounded-default bg-brand-msg-bg text-brand-msg-text mt-4 p-4 [white-space:pre-line]"
          >
            <strong>Description:</strong><br />
            Alert Details:<br /><br />
            Stream: system-metrics<br />
            Type: metrics<br />
            Count: 15<br />
            Threshold: greater than 80%<br />
            Time: {{ getCurrentTime() }}<br /><br />
            View in OpenObserve: https://openobserve.example.com/alerts/123
          </div>
        </div>
      </div>

      <!-- Opsgenie Preview -->
      <div
        v-if="type === 'opsgenie'"
        data-test="opsgenie-preview"
        class="opsgenie-alert rounded-default border-brand-msg-divider mx-auto max-w-150 overflow-hidden border bg-white shadow-sm"
      >
        <div
          class="opsgenie-header bg-brand-email-ink flex items-center justify-between p-4 text-white"
        >
          <div class="opsgenie-title text-lg font-bold">Opsgenie Alert</div>
          <div
            class="opsgenie-priority rounded-default bg-brand-email-warning text-brand-email-ink px-2 py-1 font-bold"
          >
            P3
          </div>
        </div>
        <div class="opsgenie-content p-6">
          <div class="text-brand-msg-text-dark m-0 mb-4 text-lg font-bold">
            OpenObserve Alert: High CPU Usage
          </div>
          <div class="opsgenie-details">
            <div class="opsgenie-field text-brand-msg-text mb-2">
              <strong>Source:</strong> OpenObserve
            </div>
            <div class="opsgenie-field text-brand-msg-text mb-2">
              <strong>Entity:</strong> system-metrics
            </div>
            <div class="opsgenie-field text-brand-msg-text mb-2">
              <strong>Tags:</strong> openobserve, metrics, system-metrics
            </div>
            <div class="opsgenie-field text-brand-msg-text mb-2">
              <strong>Time:</strong> {{ getCurrentTime() }}
            </div>
          </div>
          <div class="opsgenie-actions mt-4 flex justify-center">
            <OButton variant="preview-opsgenie">View in OpenObserve</OButton>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-center gap-2">
        <OButton
          data-test="preview-copy-button"
          variant="outline"
          size="sm-action"
          @click="copyTemplate"
          icon-left="content-copy"
        >
          Copy Template
        </OButton>
        <OButton variant="outline" size="sm-action" @click="isOpen = false"> Close </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { copyToClipboard } from "@/utils/clipboard";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  type: {
    type: String,
    required: true,
  },
  templateContent: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue"]);
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// Get current time for display
const getCurrentTime = (): string => {
  return new Date().toLocaleTimeString();
};

// Get destination type display name
const getDestinationTypeName = (type: string): string => {
  const typeNames: Record<string, string> = {
    slack: "Slack",
    msteams: "Microsoft Teams",
    email: "Email",
    pagerduty: "PagerDuty",
    servicenow: "ServiceNow",
    opsgenie: "Opsgenie",
  };
  return typeNames[type] || type;
};

// Copy template to clipboard
const copyTemplate = () => {
  copyToClipboard(props.templateContent, {
    successMessage: "Template copied to clipboard",
    errorMessage: "Failed to copy template",
    timeout: 2000,
  });
};
</script>
