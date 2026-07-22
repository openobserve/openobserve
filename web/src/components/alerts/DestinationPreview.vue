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
        class="slack-message max-w-150 mx-auto bg-white border border-border-default rounded-default p-4 shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div class="slack-message-container flex gap-3">
          <div class="slack-avatar">
            <div
              class="avatar-circle w-9 h-9 bg-[var(--color-brand-slack-aubergine)] text-white rounded-default flex items-center justify-center font-bold text-sm"
            >
              OO
            </div>
          </div>
          <div class="slack-content flex-1">
            <div class="slack-header flex items-center gap-2 mb-2">
              <strong
                data-test="slack-bot-name"
                class="bot-name text-[var(--color-brand-slack-link)] text-sm"
                >OpenObserve Bot</strong
              >
              <span class="slack-timestamp text-[var(--color-brand-slack-meta)] text-xs">{{
                getCurrentTime()
              }}</span>
            </div>
            <div data-test="slack-message-body" class="slack-body">
              <div
                class="slack-block-header text-lg font-bold mb-3 text-[var(--color-brand-slack-text)]"
              >
                🚨 High CPU Usage
              </div>
              <div class="slack-fields grid grid-cols-2 gap-2 mb-3">
                <div class="slack-field">
                  <div class="field-label font-bold text-[var(--color-brand-slack-text)] text-sm">
                    Stream:
                  </div>
                  <div class="field-value text-[var(--color-brand-slack-meta)] text-sm">
                    system-metrics
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label font-bold text-[var(--color-brand-slack-text)] text-sm">
                    Type:
                  </div>
                  <div class="field-value text-[var(--color-brand-slack-meta)] text-sm">
                    metrics
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label font-bold text-[var(--color-brand-slack-text)] text-sm">
                    Status:
                  </div>
                  <div class="field-value text-[var(--color-brand-slack-meta)] text-sm">
                    🔴 Firing
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label font-bold text-[var(--color-brand-slack-text)] text-sm">
                    Count:
                  </div>
                  <div class="field-value text-[var(--color-brand-slack-meta)] text-sm">15</div>
                </div>
              </div>
              <div class="slack-threshold mb-3 text-[var(--color-brand-slack-text)] text-sm">
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
      <div
        v-if="type === 'msteams'"
        data-test="msteams-preview"
        class="teams-card max-w-150 mx-auto bg-white border border-[var(--color-brand-msg-border-2)] rounded-default overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div data-test="msteams-card-content" class="teams-card-content">
          <div class="teams-header bg-brand-teams-hover text-white p-4">
            <div class="teams-title text-lg font-bold mb-1">🚨 Alert: High CPU Usage</div>
            <div class="teams-subtitle text-sm opacity-90">OpenObserve Alert Notification</div>
          </div>
          <div class="teams-facts p-4 grid gap-2">
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Stream</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">system-metrics</div>
            </div>
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Type</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">metrics</div>
            </div>
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Status</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">🔴 Firing</div>
            </div>
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Count</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">15</div>
            </div>
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Threshold</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">greater than 80%</div>
            </div>
            <div
              class="teams-fact flex justify-between py-1 border-b border-[var(--color-brand-teams-bg)]"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Time</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
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
        class="email-client max-w-150 mx-auto bg-white border border-[var(--color-brand-msg-divider)] rounded-default overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="email-header bg-[var(--color-brand-msg-bg)] p-4 border-b border-[var(--color-brand-msg-border)]"
        >
          <div data-test="email-subject" class="email-subject font-bold text-base mb-2">
            Subject: 🚨 OpenObserve Alert Notification
          </div>
          <div
            data-test="email-from"
            class="email-from text-[var(--color-brand-msg-meta)] text-sm mb-1"
          >
            From: alerts@openobserve.ai
          </div>
          <div class="email-to text-[var(--color-brand-msg-meta)] text-sm mb-1">
            To: admin@example.com
          </div>
          <div class="email-time text-[var(--color-brand-msg-meta)] text-sm mb-1">
            {{ getCurrentTime() }}
          </div>
        </div>
        <div data-test="email-body" class="email-body p-6">
          <div class="email-alert-header">
            <div class="text-[var(--color-brand-msg-error)] text-center mb-4 text-2xl font-bold">
              🚨 Alert Notification
            </div>
          </div>
          <div
            class="email-alert-info bg-[var(--color-brand-msg-bg)] border-l-4 border-[var(--color-brand-msg-error)] p-4 my-4"
          >
            <div class="text-[var(--color-brand-msg-error)] m-0 mb-2 text-lg font-bold">
              High CPU Usage
            </div>
            <p class="m-0 text-[var(--color-brand-msg-meta)]">
              An alert has been triggered in your OpenObserve monitoring system.
            </p>
          </div>
          <div class="email-details my-4">
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Stream:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">system-metrics</span>
            </div>
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Type:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">metrics</span>
            </div>
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Status:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">🔴 Firing</span>
            </div>
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Count:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">15</span>
            </div>
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Threshold:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">greater than 80%</span>
            </div>
            <div
              class="email-detail-row flex justify-between py-2 border-b border-[var(--color-brand-msg-border)]"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Time:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                getCurrentTime()
              }}</span>
            </div>
          </div>
          <OButton variant="preview-email">View in OpenObserve</OButton>
        </div>
      </div>

      <!-- PagerDuty Preview -->
      <div
        v-if="type === 'pagerduty'"
        data-test="pagerduty-preview"
        class="pagerduty-incident max-w-150 mx-auto bg-white border border-[var(--color-brand-msg-divider)] rounded-default overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="pagerduty-header bg-[var(--color-brand-slack-green)] text-white p-4 flex justify-between items-center"
        >
          <div class="pagerduty-title font-bold text-lg">PagerDuty Incident</div>
          <div
            class="pagerduty-status bg-[var(--color-brand-email-accent)] py-1 px-2 rounded-default text-xs font-bold"
          >
            Triggered
          </div>
        </div>
        <div class="pagerduty-content p-6">
          <div class="m-0 mb-4 text-[var(--color-brand-msg-text-dark)] font-bold text-lg">
            OpenObserve Alert: High CPU Usage
          </div>
          <div class="pagerduty-details">
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Source:</strong> openobserve
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Severity:</strong> error
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Component:</strong> system-metrics
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Time:</strong> {{ getCurrentTime() }}
            </div>
          </div>
          <div class="pagerduty-link text-center mt-4">
            <a href="#" class="text-[var(--color-brand-slack-green)] no-underline font-bold"
              >View in OpenObserve</a
            >
          </div>
        </div>
      </div>

      <!-- ServiceNow Preview -->
      <div
        v-if="type === 'servicenow'"
        data-test="servicenow-preview"
        class="servicenow-incident max-w-150 mx-auto bg-white border border-[var(--color-brand-msg-divider)] rounded-default overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="servicenow-header bg-[var(--color-brand-slack-avatar)] text-white p-4 flex justify-between items-center"
        >
          <div class="servicenow-title font-bold text-lg">ServiceNow Incident</div>
          <div class="servicenow-number font-mono font-bold">INC0000123</div>
        </div>
        <div class="servicenow-content p-6">
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>Short Description:</strong> OpenObserve Alert: High CPU Usage
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>Category:</strong> Software
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>Priority:</strong> 2 - High
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>State:</strong> New
          </div>
          <div
            class="servicenow-description bg-[var(--color-brand-msg-bg)] p-4 rounded-default text-[var(--color-brand-msg-text)] [white-space:pre-line] mt-4"
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
        class="opsgenie-alert max-w-150 mx-auto bg-white border border-[var(--color-brand-msg-divider)] rounded-default overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="opsgenie-header bg-[var(--color-brand-email-ink)] text-white p-4 flex justify-between items-center"
        >
          <div class="opsgenie-title font-bold text-lg">Opsgenie Alert</div>
          <div
            class="opsgenie-priority bg-[var(--color-brand-email-warning)] text-[var(--color-brand-email-ink)] py-1 px-2 rounded-default font-bold"
          >
            P3
          </div>
        </div>
        <div class="opsgenie-content p-6">
          <div class="m-0 mb-4 text-[var(--color-brand-msg-text-dark)] font-bold text-lg">
            OpenObserve Alert: High CPU Usage
          </div>
          <div class="opsgenie-details">
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Source:</strong> OpenObserve
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Entity:</strong> system-metrics
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>Tags:</strong> openobserve, metrics, system-metrics
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
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

<style scoped>
/* keep(brand): pixel-accurate Slack/Teams/Email replicas, colors are external brands (D12) */
/* The global `a { color: var(--color-text-link) }` rule (unlayered) outranks the
   inline `text-[var(--color-brand-slack-green)]` utility, turning this link the theme link color.
   This selector's specificity wins it back to PagerDuty green, like main. */
.pagerduty-link a {
  color: var(--color-brand-slack-green);
  text-decoration: none;
}

/* Same issue as the link above: the global `p { color: var(--color-text-body) }`
   rule (light text in dark mode) overrides the inline utility, making this
   message unreadable on the email card's fixed light background. */
.email-alert-info p {
  color: var(--color-brand-msg-meta);
}

.opsgenie-content .opsgenie-actions button {
  background: var(--color-brand-email-ink);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  cursor: pointer;
}

.opsgenie-content .opsgenie-actions button:hover {
  background: var(--color-brand-email-ink-deep);
}
</style>
