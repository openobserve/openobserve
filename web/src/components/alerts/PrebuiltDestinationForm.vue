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
    <!-- OWNER of this embedded <OForm> (Rule ③): the credential fields are
         config-driven per destinationType, validated by the dynamically-built
         schema. The parent submits this form by its id (`form-id` bridge, R4). -->
    <OForm :form="form" id="prebuilt-destination-form">
      <!-- Slack Fields -->
      <template v-if="destinationType === 'slack'">
        <div class="w-1/2 py-1">
          <OFormInput
            name="webhookUrl"
            data-test="slack-webhook-url-input"
            label="Slack Webhook URL"
            required
            helpText="Get your webhook URL from Slack App settings"
            tabindex="0"
          />
        </div>
        <div class="w-1/2 py-1">
          <OFormInput
            name="channel"
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
            name="webhookUrl"
            data-test="discord-webhook-url-input"
            label="Discord Webhook URL"
            required
            helpText="Get your webhook URL from Discord channel settings"
            tabindex="0"
          />
        </div>
        <div class="w-1/2 py-1">
          <OFormInput
            name="username"
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
            name="webhookUrl"
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
            name="integrationKey"
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
            name="severity"
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
            name="instanceUrl"
            data-test="servicenow-instance-url-input"
            label="ServiceNow Instance URL"
            required
            helpText="https://your-instance.service-now.com/api/now/table/incident"
            tabindex="0"
          />
        </div>
        <div class="w-1/2 py-1">
          <OFormInput
            name="username"
            data-test="servicenow-username-input"
            label="Username"
            required
            helpText="ServiceNow username with incident creation permissions"
            tabindex="0"
          />
        </div>
        <div class="w-1/2 py-1">
          <OFormInput
            name="password"
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
            name="assignmentGroup"
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
            name="recipients"
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
            name="apiKey"
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
            name="priority"
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
            name="euRegion"
            data-test="opsgenie-eu-region-toggle"
            label="EU Region"
          />
          <span class="text-xs text-gray-400">
            Enable for EU-based Opsgenie instances
          </span>
        </div>
      </template>
    </OForm>

    <!-- Test and Preview Actions (kept OUTSIDE <OForm>; they are plain
         event-emitting buttons, not form fields). -->
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
import { watch } from 'vue';
import type { PropType } from 'vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OForm from '@/lib/forms/Form/OForm.vue';
import OFormInput from '@/lib/forms/Input/OFormInput.vue';
import OFormSelect from '@/lib/forms/Select/OFormSelect.vue';
import OFormSwitch from '@/lib/forms/Switch/OFormSwitch.vue';
import { useI18n } from 'vue-i18n';
import { useOForm } from '@/lib/forms/Form/useOForm';
import {
  makePrebuiltDestinationSchema,
  prebuiltDestinationDefaults,
} from './PrebuiltDestinationForm.schema';

const props = defineProps({
  destinationType: {
    type: String,
    required: true
  },
  modelValue: {
    type: Object as PropType<Record<string, any>>,
    default: () => ({})
  },
  isTesting: {
    type: Boolean,
    default: false
  },
  hideActions: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'preview', 'test', 'submit']);

const { t } = useI18n();

// OWNER pattern (Rule ③): create the form here so the credential fields are
// name=-owned by the single TanStack form. The schema + defaults are built for
// the ACTIVE type from the shared getPrebuiltConfig() config (single source of
// truth). The parent remounts this component on type change (:key), so setup()
// re-runs with a fresh schema for the new type.
const form = useOForm<Record<string, unknown>>({
  defaultValues: prebuiltDestinationDefaults(
    props.destinationType,
    props.modelValue,
  ),
  schema: makePrebuiltDestinationSchema(t, props.destinationType),
  // Fires only once the credential schema passes → tell the parent to save.
  onSubmit: (value) => {
    emit('submit', value);
  },
});

// Egress to the parent (Rule ③): keep the parent's v-model (`prebuiltCredentials`)
// in sync by watching the form store — NEVER form.store.subscribe. Used by the
// parent's Preview/Test buttons.
const values = form.useStore((s: any) => s.values);
watch(
  values,
  (v) => emit('update:modelValue', { ...(v as Record<string, unknown>) }),
  { deep: true },
);

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
