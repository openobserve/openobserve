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
  <div data-test="prebuilt-destination-form" class="prebuilt-destination-form">
    <!-- Presentational DESCENDANT (Rule ③): this component renders NO <OForm> of
         its own. The per-type credential inputs are OForm* controls named
         `credentials.<key>`, so they inject the PARENT AddDestination form
         (FORM_CONTEXT_KEY) and become part of the ONE form — Enter/Save submit
         that single form and its schema (AddDestination.schema.ts) validates
         these credentials via `makePrebuiltDestinationSchema`. No nested <form>. -->
    <!-- Slack Fields -->
    <template v-if="destinationType === 'slack'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.webhookUrl"
          data-test="slack-webhook-url-input"
          :label="t('alerts.prebuiltDestinations.slackWebhookUrl')"
          required
          :helpText="t('alerts.prebuiltDestinations.slackWebhookUrlHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.channel"
          data-test="slack-channel-input"
          :label="t('alerts.prebuiltDestinations.slackChannel')"
          :helpText="t('alerts.prebuiltDestinations.slackChannelHelp')"
          tabindex="0"
        />
      </div>
    </template>

    <!-- Discord Fields -->
    <template v-if="destinationType === 'discord'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.webhookUrl"
          data-test="discord-webhook-url-input"
          :label="t('alerts.prebuiltDestinations.discordWebhookUrl')"
          required
          :helpText="t('alerts.prebuiltDestinations.discordWebhookUrlHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.username"
          data-test="discord-username-input"
          :label="t('alerts.prebuiltDestinations.discordUsername')"
          :helpText="t('alerts.prebuiltDestinations.discordUsernameHelp')"
          tabindex="0"
        />
      </div>
    </template>

    <!-- MS Teams Fields -->
    <template v-if="destinationType === 'msteams'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.webhookUrl"
          data-test="msteams-webhook-url-input"
          :label="t('alerts.prebuiltDestinations.msteamsWebhookUrl')"
          required
          :helpText="t('alerts.prebuiltDestinations.msteamsWebhookUrlHelp')"
          tabindex="0"
        />
      </div>
    </template>

    <!-- PagerDuty Fields -->
    <template v-if="destinationType === 'pagerduty'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.integrationKey"
          data-test="pagerduty-integration-key-input"
          :label="t('alerts.prebuiltDestinations.pagerdutyIntegrationKey')"
          required
          type="password"
          :helpText="t('alerts.prebuiltDestinations.pagerdutyIntegrationKeyHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.severity"
          data-test="pagerduty-severity-select"
          :options="severityOptions"
          :label="t('alerts.prebuiltDestinations.pagerdutySeverity')"
          required
          labelKey="label"
          valueKey="value"
          :helpText="t('alerts.prebuiltDestinations.pagerdutySeverityHelp')"
          tabindex="0"
        />
      </div>
    </template>

    <!-- ServiceNow Fields -->
    <template v-if="destinationType === 'servicenow'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.instanceUrl"
          data-test="servicenow-instance-url-input"
          :label="t('alerts.prebuiltDestinations.servicenowInstanceUrl')"
          required
          :helpText="t('alerts.prebuiltDestinations.servicenowInstanceUrlHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.username"
          data-test="servicenow-username-input"
          :label="t('common.username')"
          required
          :helpText="t('alerts.prebuiltDestinations.servicenowUsernameHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.password"
          data-test="servicenow-password-input"
          :label="t('common.password')"
          required
          type="password"
          :helpText="t('alerts.prebuiltDestinations.servicenowPasswordHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.assignmentGroup"
          data-test="servicenow-assignment-group-input"
          :label="t('alerts.prebuiltDestinations.servicenowAssignmentGroup')"
          :helpText="t('alerts.prebuiltDestinations.servicenowAssignmentGroupHelp')"
          tabindex="0"
        />
      </div>
    </template>

    <!-- Email Fields -->
    <template v-if="destinationType === 'email'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.recipients"
          data-test="email-recipients-input"
          :label="t('alerts.prebuiltDestinations.emailRecipients')"
          required
          :helpText="t('alerts.prebuiltDestinations.emailRecipientsHelp')"
          tabindex="0"
        />
      </div>
      <!-- CC and Subject fields hidden - not supported by backend Email struct -->
    </template>

    <!-- Opsgenie Fields -->
    <template v-if="destinationType === 'opsgenie'">
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.apiKey"
          data-test="opsgenie-api-key-input"
          :label="t('alerts.prebuiltDestinations.opsgenieApiKey')"
          required
          type="password"
          :helpText="t('alerts.prebuiltDestinations.opsgenieApiKeyHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.priority"
          data-test="opsgenie-priority-select"
          :options="priorityOptions"
          :label="t('alerts.prebuiltDestinations.opsgeniePriority')"
          labelKey="label"
          valueKey="value"
          :helpText="t('alerts.prebuiltDestinations.opsgeniePriorityHelp')"
          tabindex="0"
        />
      </div>
      <div class="w-full py-1">
        <OFormSwitch
          name="credentials.euRegion"
          data-test="opsgenie-eu-region-toggle"
          :label="t('alerts.prebuiltDestinations.opsgenieEuRegion')"
        />
        <span class="text-text-secondary text-xs">
          {{ t("alerts.prebuiltDestinations.opsgenieEuRegionHelp") }}
        </span>
      </div>
    </template>

    <!-- Test and Preview Actions (plain event-emitting buttons, not form fields). -->
    <div v-if="!hideActions" class="w-full py-3">
      <div class="flex items-center gap-2">
        <OButton
          data-test="destination-preview-button"
          variant="outline"
          size="sm"
          @click="$emit('preview')"
          icon-left="preview"
        >
          {{ t("alerts.preview") }}
        </OButton>
        <OButton
          data-test="destination-test-button"
          :loading="isTesting"
          variant="outline"
          size="sm"
          @click="$emit('test')"
          icon-left="send"
        >
          {{ t("common.test") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";

// Presentational only: renders the active type's credential OForm* fields into
// the parent AddDestination form (they carry `name="credentials.<key>"` and
// inject the parent's FORM_CONTEXT_KEY). Requiredness + validators live in the
// parent schema (AddDestination.schema → makePrebuiltDestinationSchema), so this
// component owns no form, no schema, and no v-model — the single source of truth
// is the parent form's `credentials` sub-object.
defineProps({
  destinationType: {
    type: String,
    required: true,
  },
  isTesting: {
    type: Boolean,
    default: false,
  },
  hideActions: {
    type: Boolean,
    default: false,
  },
});

defineEmits(["preview", "test"]);

const { t } = useI18n();

// PagerDuty severity options — computed so the labels re-resolve on locale change.
const severityOptions = computed(() => [
  { label: t("alerts.prebuiltDestinations.severityCritical"), value: "critical" },
  { label: t("alerts.prebuiltDestinations.severityError"), value: "error" },
  { label: t("alerts.prebuiltDestinations.severityWarning"), value: "warning" },
  { label: t("alerts.prebuiltDestinations.severityInfo"), value: "info" },
]);

// Opsgenie priority options — computed so the labels re-resolve on locale change.
const priorityOptions = computed(() => [
  { label: t("alerts.prebuiltDestinations.priorityP1"), value: "P1" },
  { label: t("alerts.prebuiltDestinations.priorityP2"), value: "P2" },
  { label: t("alerts.prebuiltDestinations.priorityP3"), value: "P3" },
  { label: t("alerts.prebuiltDestinations.priorityP4"), value: "P4" },
  { label: t("alerts.prebuiltDestinations.priorityP5"), value: "P5" },
]);
</script>
