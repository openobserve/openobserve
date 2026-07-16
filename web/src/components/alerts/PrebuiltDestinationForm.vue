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
          label="Slack Webhook URL"
          required
          helpText="Get your webhook URL from Slack App settings"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.channel"
          data-test="slack-channel-input"
          label="Channel (optional)"
          helpText="e.g., #alerts"
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
          label="Discord Webhook URL"
          required
          helpText="Get your webhook URL from Discord channel settings"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.username"
          data-test="discord-username-input"
          label="Bot Username (optional)"
          helpText="Custom username for the webhook bot"
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
          label="Microsoft Teams Webhook URL"
          required
          helpText="Get your webhook URL from Teams channel connectors"
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
          label="Integration Key"
          required
          type="password"
          helpText="Get your integration key from PagerDuty service settings"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.severity"
          data-test="pagerduty-severity-select"
          :options="severityOptions"
          label="Default Severity"
          required
          labelKey="label"
          valueKey="value"
          helpText="Select the default severity for PagerDuty incidents"
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
          label="ServiceNow Instance URL"
          required
          helpText="https://your-instance.service-now.com/api/now/table/incident"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.username"
          data-test="servicenow-username-input"
          label="Username"
          required
          helpText="ServiceNow username with incident creation permissions"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.password"
          data-test="servicenow-password-input"
          label="Password"
          required
          type="password"
          helpText="ServiceNow password or API token"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormInput
          name="credentials.assignmentGroup"
          data-test="servicenow-assignment-group-input"
          label="Assignment Group (optional)"
          helpText="Group to assign incidents to (e.g., IT Operations)"
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
          label="Recipient Email Addresses"
          required
          helpText="Comma-separated email addresses"
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
          label="Opsgenie API Key"
          required
          type="password"
          helpText="Get your API key from Opsgenie integration settings"
          tabindex="0"
        />
      </div>
      <div class="w-1/2 py-1">
        <OFormSelect
          name="credentials.priority"
          data-test="opsgenie-priority-select"
          :options="priorityOptions"
          label="Default Priority"
          labelKey="label"
          valueKey="value"
          helpText="Select the default priority for Opsgenie alerts"
          tabindex="0"
        />
      </div>
      <div class="w-full py-1">
        <OFormSwitch
          name="credentials.euRegion"
          data-test="opsgenie-eu-region-toggle"
          label="EU Region"
        />
        <span class="text-xs text-gray-400">
          Enable for EU-based Opsgenie instances
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
          Preview
        </OButton>
        <OButton
          data-test="destination-test-button"
          :loading="isTesting"
          variant="outline"
          size="sm"
          @click="$emit('test')"
          icon-left="send"
        >
          Test
        </OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import OButton from '@/lib/core/Button/OButton.vue';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import OFormSelect from '@/lib/forms/Select/OFormSelect.vue';
import OFormSwitch from '@/lib/forms/Switch/OFormSwitch.vue';

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

defineEmits(['preview', 'test']);

// PagerDuty severity options
const severityOptions = [
  { label: 'Critical', value: 'critical' },
  { label: 'Error', value: 'error' },
  { label: 'Warning', value: 'warning' },
  { label: 'Info', value: 'info' }
];

// Opsgenie priority options
const priorityOptions = [
  { label: 'P1 (Critical)', value: 'P1' },
  { label: 'P2 (High)', value: 'P2' },
  { label: 'P3 (Moderate)', value: 'P3' },
  { label: 'P4 (Low)', value: 'P4' },
  { label: 'P5 (Informational)', value: 'P5' }
];
</script>
