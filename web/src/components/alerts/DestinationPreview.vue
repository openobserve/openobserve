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
        class="slack-message border-border-default rounded-default mx-auto max-w-150 border bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div class="slack-message-container flex gap-3">
          <div class="slack-avatar">
            <div
              class="avatar-circle rounded-default flex h-9 w-9 items-center justify-center bg-[var(--color-brand-slack-aubergine)] text-sm font-bold text-white"
            >
              OO
            </div>
          </div>
          <div class="slack-content flex-1">
            <div class="slack-header mb-2 flex items-center gap-2">
              <strong
                data-test="slack-bot-name"
                class="bot-name text-sm text-[var(--color-brand-slack-link)]"
                >OpenObserve Bot</strong
              >
              <span class="slack-timestamp text-xs text-[var(--color-brand-slack-meta)]">{{
                getCurrentTime()
              }}</span>
            </div>
            <div data-test="slack-message-body" class="slack-body">
              <div
                class="slack-block-header mb-3 text-lg font-bold text-[var(--color-brand-slack-text)]"
              >
                🚨 High CPU Usage
              </div>
              <div class="slack-fields mb-3 grid grid-cols-2 gap-2">
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    Stream:
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    system-metrics
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    Type:
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    metrics
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    Status:
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    🔴 Firing
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    Count:
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">15</div>
                </div>
              </div>
              <div class="slack-threshold mb-3 text-sm text-[var(--color-brand-slack-text)]">
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
        class="teams-card rounded-default mx-auto max-w-150 overflow-hidden border border-[var(--color-brand-msg-border-2)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div data-test="msteams-card-content" class="teams-card-content">
          <div class="teams-header bg-brand-teams-hover p-4 text-white">
            <div class="teams-title mb-1 text-lg font-bold">🚨 Alert: High CPU Usage</div>
            <div class="teams-subtitle text-sm opacity-90">OpenObserve Alert Notification</div>
          </div>
          <div class="teams-facts grid gap-2 p-4">
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Stream</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">system-metrics</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Type</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">metrics</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Status</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">🔴 Firing</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Count</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">15</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">Threshold</div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">greater than 80%</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
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
        class="email-client rounded-default mx-auto max-w-150 overflow-hidden border border-[var(--color-brand-msg-divider)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="email-header border-b border-[var(--color-brand-msg-border)] bg-[var(--color-brand-msg-bg)] p-4"
        >
          <div
            data-test="email-subject"
            class="email-subject mb-2 text-base font-bold text-[var(--color-brand-msg-text-strong)]"
          >
            Subject: 🚨 OpenObserve Alert Notification
          </div>
          <div
            data-test="email-from"
            class="email-from mb-1 text-sm text-[var(--color-brand-msg-meta)]"
          >
            From: alerts@openobserve.ai
          </div>
          <div class="email-to mb-1 text-sm text-[var(--color-brand-msg-meta)]">
            To: admin@example.com
          </div>
          <div class="email-time mb-1 text-sm text-[var(--color-brand-msg-meta)]">
            {{ getCurrentTime() }}
          </div>
        </div>
        <div data-test="email-body" class="email-body p-6">
          <div class="email-alert-header">
            <div class="mb-4 text-center text-2xl font-bold text-[var(--color-brand-msg-error)]">
              🚨 Alert Notification
            </div>
          </div>
          <div
            class="email-alert-info my-4 border-l-4 border-[var(--color-brand-msg-error)] bg-[var(--color-brand-msg-bg)] p-4"
          >
            <div class="m-0 mb-2 text-lg font-bold text-[var(--color-brand-msg-error)]">
              High CPU Usage
            </div>
            <p class="m-0 text-[var(--color-brand-msg-meta)]">
              An alert has been triggered in your OpenObserve monitoring system.
            </p>
          </div>
          <div class="email-details my-4">
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Stream:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">system-metrics</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Type:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">metrics</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Status:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">🔴 Firing</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Count:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">15</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]"
                >Threshold:</span
              >
              <span class="detail-value text-[var(--color-brand-msg-meta)]">greater than 80%</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
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
        class="pagerduty-incident rounded-default mx-auto max-w-150 overflow-hidden border border-[var(--color-brand-msg-divider)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="pagerduty-header flex items-center justify-between bg-[var(--color-brand-slack-green)] p-4 text-white"
        >
          <div class="pagerduty-title text-lg font-bold">PagerDuty Incident</div>
          <div
            class="pagerduty-status rounded-default bg-[var(--color-brand-email-accent)] px-2 py-1 text-xs font-bold"
          >
            Triggered
          </div>
        </div>
        <div class="pagerduty-content p-6">
          <div class="m-0 mb-4 text-lg font-bold text-[var(--color-brand-msg-text-dark)]">
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
          <div class="pagerduty-link mt-4 text-center">
            <a href="#" class="font-bold text-[var(--color-brand-slack-green)] no-underline"
              >View in OpenObserve</a
            >
          </div>
        </div>
      </div>

      <!-- ServiceNow Preview -->
      <div
        v-if="type === 'servicenow'"
        data-test="servicenow-preview"
        class="servicenow-incident rounded-default mx-auto max-w-150 overflow-hidden border border-[var(--color-brand-msg-divider)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="servicenow-header flex items-center justify-between bg-[var(--color-brand-slack-avatar)] p-4 text-white"
        >
          <div class="servicenow-title text-lg font-bold">ServiceNow Incident</div>
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
            class="servicenow-description rounded-default mt-4 bg-[var(--color-brand-msg-bg)] p-4 [white-space:pre-line] text-[var(--color-brand-msg-text)]"
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
        class="opsgenie-alert rounded-default mx-auto max-w-150 overflow-hidden border border-[var(--color-brand-msg-divider)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
      >
        <div
          class="opsgenie-header flex items-center justify-between bg-[var(--color-brand-email-ink)] p-4 text-white"
        >
          <div class="opsgenie-title text-lg font-bold">Opsgenie Alert</div>
          <div
            class="opsgenie-priority rounded-default bg-[var(--color-brand-email-warning)] px-2 py-1 font-bold text-[var(--color-brand-email-ink)]"
          >
            P3
          </div>
        </div>
        <div class="opsgenie-content p-6">
          <div class="m-0 mb-4 text-lg font-bold text-[var(--color-brand-msg-text-dark)]">
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
          <div class="opsgenie-actions mt-4 flex justify-center">
            <OButton variant="preview-action">View in OpenObserve</OButton>
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

<style scoped>
/* keep(brand): pixel-accurate Slack/Teams/Email replicas, colors are external brands (D12) */
/* The global unlayered `a` link-color rule outranks the inline brand-green
   utility on this anchor, retinting it to the theme link color. This selector's
   higher specificity wins it back to PagerDuty green, matching main. */
.pagerduty-link a {
  color: var(--color-brand-slack-green);
  text-decoration: none;
}

/* Same issue as the link above: the global `p` body-text rule (light text in
   dark mode) overrides the inline utility, making this message unreadable on the
   email card's fixed light background. */
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
