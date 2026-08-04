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
    :title="raw(`${t('alerts.destinationPreview')} - ${getDestinationTypeName(type)}`)"
    data-test="destination-preview-dialog"
  >
    <div data-test="destination-preview-card" class="w-full">
      <!-- Mock notification preview: mirrors the server-rendered alert message, which is
           NOT localised — every string here is deliberately untranslated (raw). -->
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
              {{ raw("OO") }}
            </div>
          </div>
          <div class="slack-content flex-1">
            <div class="slack-header mb-2 flex items-center gap-2">
              <strong
                data-test="slack-bot-name"
                class="bot-name text-sm text-[var(--color-brand-slack-link)]"
                >{{ raw("OpenObserve Bot") }}</strong
              >
              <span class="slack-timestamp text-xs text-[var(--color-brand-slack-meta)]">{{
                getCurrentTime()
              }}</span>
            </div>
            <div data-test="slack-message-body" class="slack-body">
              <div
                class="slack-block-header mb-3 text-lg font-bold text-[var(--color-brand-slack-text)]"
              >
                {{ raw("🚨 High CPU Usage") }}
              </div>
              <div class="slack-fields mb-3 grid grid-cols-2 gap-2">
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    {{ raw("Stream:") }}
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    {{ raw("system-metrics") }}
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    {{ raw("Type:") }}
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    {{ raw("metrics") }}
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    {{ raw("Status:") }}
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    {{ raw("🔴 Firing") }}
                  </div>
                </div>
                <div class="slack-field">
                  <div class="field-label text-sm font-bold text-[var(--color-brand-slack-text)]">
                    {{ raw("Count:") }}
                  </div>
                  <div class="field-value text-sm text-[var(--color-brand-slack-meta)]">
                    {{ raw("15") }}
                  </div>
                </div>
              </div>
              <div class="slack-threshold mb-3 text-sm text-[var(--color-brand-slack-text)]">
                <strong>{{ raw("Threshold Exceeded:") }}</strong> {{ raw("greater than 80%") }}
              </div>
              <div class="slack-actions mt-4 flex justify-center">
                <OButton variant="preview-slack">{{ raw("View in OpenObserve") }}</OButton>
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
            <div class="teams-title mb-1 text-lg font-bold">
              {{ raw("🚨 Alert: High CPU Usage") }}
            </div>
            <div class="teams-subtitle text-sm opacity-90">
              {{ raw("OpenObserve Alert Notification") }}
            </div>
          </div>
          <div class="teams-facts grid gap-2 p-4">
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Stream") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
                {{ raw("system-metrics") }}
              </div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Type") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
                {{ raw("metrics") }}
              </div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Status") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
                {{ raw("🔴 Firing") }}
              </div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Count") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">{{ raw("15") }}</div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Threshold") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
                {{ raw("greater than 80%") }}
              </div>
            </div>
            <div
              class="teams-fact flex justify-between border-b border-[var(--color-brand-teams-bg)] py-1"
            >
              <div class="fact-name font-bold text-[var(--color-brand-teams-ink)]">
                {{ raw("Time") }}
              </div>
              <div class="fact-value text-[var(--color-brand-teams-text)]">
                {{ getCurrentTime() }}
              </div>
            </div>
          </div>
          <div class="teams-actions flex justify-center p-4">
            <OButton variant="preview-teams">{{ raw("View in OpenObserve") }}</OButton>
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
            {{ raw("Subject: 🚨 OpenObserve Alert Notification") }}
          </div>
          <div
            data-test="email-from"
            class="email-from mb-1 text-sm text-[var(--color-brand-msg-meta)]"
          >
            {{ raw("From: alerts@openobserve.ai") }}
          </div>
          <div class="email-to mb-1 text-sm text-[var(--color-brand-msg-meta)]">
            {{ raw("To: admin@example.com") }}
          </div>
          <div class="email-time mb-1 text-sm text-[var(--color-brand-msg-meta)]">
            {{ getCurrentTime() }}
          </div>
        </div>
        <div data-test="email-body" class="email-body p-6">
          <div class="email-alert-header">
            <div class="mb-4 text-center text-2xl font-bold text-[var(--color-brand-msg-error)]">
              {{ raw("🚨 Alert Notification") }}
            </div>
          </div>
          <div
            class="email-alert-info my-4 border-l-4 border-[var(--color-brand-msg-error)] bg-[var(--color-brand-msg-bg)] p-4"
          >
            <div class="m-0 mb-2 text-lg font-bold text-[var(--color-brand-msg-error)]">
              {{ raw("High CPU Usage") }}
            </div>
            <p class="m-0 text-[var(--color-brand-msg-meta)]">
              {{ raw("An alert has been triggered in your OpenObserve monitoring system.") }}
            </p>
          </div>
          <div class="email-details my-4">
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Stream:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                raw("system-metrics")
              }}</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Type:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                raw("metrics")
              }}</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Status:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                raw("🔴 Firing")
              }}</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Count:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{ raw("15") }}</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Threshold:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                raw("greater than 80%")
              }}</span>
            </div>
            <div
              class="email-detail-row flex justify-between border-b border-[var(--color-brand-msg-border)] py-2"
            >
              <span class="detail-label font-bold text-[var(--color-brand-msg-text-strong)]">{{
                raw("Time:")
              }}</span>
              <span class="detail-value text-[var(--color-brand-msg-meta)]">{{
                getCurrentTime()
              }}</span>
            </div>
          </div>
          <OButton variant="preview-email">{{ raw("View in OpenObserve") }}</OButton>
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
          <div class="pagerduty-title text-lg font-bold">{{ raw("PagerDuty Incident") }}</div>
          <div
            class="pagerduty-status rounded-default bg-[var(--color-brand-email-accent)] px-2 py-1 text-xs font-bold"
          >
            {{ raw("Triggered") }}
          </div>
        </div>
        <div class="pagerduty-content p-6">
          <div class="m-0 mb-4 text-lg font-bold text-[var(--color-brand-msg-text-dark)]">
            {{ raw("OpenObserve Alert: High CPU Usage") }}
          </div>
          <div class="pagerduty-details">
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Source:") }}</strong> {{ raw("openobserve") }}
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Severity:") }}</strong> {{ raw("error") }}
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Component:") }}</strong> {{ raw("system-metrics") }}
            </div>
            <div class="pagerduty-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Time:") }}</strong> {{ getCurrentTime() }}
            </div>
          </div>
          <div class="pagerduty-link mt-4 text-center">
            <a href="#" class="font-bold text-[var(--color-brand-slack-green)] no-underline">{{
              raw("View in OpenObserve")
            }}</a>
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
          <div class="servicenow-title text-lg font-bold">{{ raw("ServiceNow Incident") }}</div>
          <div class="servicenow-number font-mono font-bold">{{ raw("INC0000123") }}</div>
        </div>
        <div class="servicenow-content p-6">
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>{{ raw("Short Description:") }}</strong>
            {{ raw("OpenObserve Alert: High CPU Usage") }}
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>{{ raw("Category:") }}</strong> {{ raw("Software") }}
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>{{ raw("Priority:") }}</strong> {{ raw("2 - High") }}
          </div>
          <div class="servicenow-field mb-3 text-[var(--color-brand-msg-text)]">
            <strong>{{ raw("State:") }}</strong> {{ raw("New") }}
          </div>
          <div
            class="servicenow-description rounded-default mt-4 bg-[var(--color-brand-msg-bg)] p-4 [white-space:pre-line] text-[var(--color-brand-msg-text)]"
          >
            <strong>{{ raw("Description:") }}</strong
            ><br />
            {{ raw("Alert Details:") }}<br /><br />
            {{ raw("Stream: system-metrics") }}<br />
            {{ raw("Type: metrics") }}<br />
            {{ raw("Count: 15") }}<br />
            {{ raw("Threshold: greater than 80%") }}<br />
            {{ raw("Time:") }} {{ getCurrentTime() }}<br /><br />
            {{ raw("View in OpenObserve: https://openobserve.example.com/alerts/123") }}
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
          <div class="opsgenie-title text-lg font-bold">{{ raw("Opsgenie Alert") }}</div>
          <div
            class="opsgenie-priority rounded-default bg-[var(--color-brand-email-warning)] px-2 py-1 font-bold text-[var(--color-brand-email-ink)]"
          >
            {{ raw("P3") }}
          </div>
        </div>
        <div class="opsgenie-content p-6">
          <div class="m-0 mb-4 text-lg font-bold text-[var(--color-brand-msg-text-dark)]">
            {{ raw("OpenObserve Alert: High CPU Usage") }}
          </div>
          <div class="opsgenie-details">
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Source:") }}</strong> {{ raw("OpenObserve") }}
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Entity:") }}</strong> {{ raw("system-metrics") }}
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Tags:") }}</strong> {{ raw("openobserve, metrics, system-metrics") }}
            </div>
            <div class="opsgenie-field mb-2 text-[var(--color-brand-msg-text)]">
              <strong>{{ raw("Time:") }}</strong> {{ getCurrentTime() }}
            </div>
          </div>
          <div class="opsgenie-actions mt-4 flex justify-center">
            <OButton variant="preview-action">{{ raw("View in OpenObserve") }}</OButton>
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
          {{ t("alerts.previewCopyTemplateBtn") }}
        </OButton>
        <OButton variant="outline" size="sm-action" @click="isOpen = false">
          {{ t("common.close") }}
        </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
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
const { t } = useI18nTyped();

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
  copyToClipboard(props.templateContent, t, {
    successMessage: t("alerts.previewCopyTemplateSuccess"),
    errorMessage: t("alerts.previewCopyTemplateError"),
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
