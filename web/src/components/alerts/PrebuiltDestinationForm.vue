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
    <!-- Slack Fields -->
    <template v-if="destinationType === 'slack'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.webhookUrl"
          data-test="slack-webhook-url-input"
          label="Slack Webhook URL *"
          helpText="Get your webhook URL from Slack App settings"
          tabindex="0"
          :error="!!fieldErrors.webhookUrl"
          :error-message="fieldErrors.webhookUrl"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.channel"
          data-test="slack-channel-input"
          label="Channel (optional)"
          helpText="e.g., #alerts"
          tabindex="0"
        />
      </div>
    </template>

    <!-- Discord Fields -->
    <template v-if="destinationType === 'discord'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.webhookUrl"
          data-test="discord-webhook-url-input"
          label="Discord Webhook URL *"
          helpText="Get your webhook URL from Discord channel settings"
          tabindex="0"
          :error="!!fieldErrors.webhookUrl"
          :error-message="fieldErrors.webhookUrl"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.username"
          data-test="discord-username-input"
          label="Bot Username (optional)"
          helpText="Custom username for the webhook bot"
          tabindex="0"
        />
      </div>
    </template>

    <!-- MS Teams Fields -->
    <template v-if="destinationType === 'msteams'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.webhookUrl"
          data-test="msteams-webhook-url-input"
          label="Microsoft Teams Webhook URL *"
          helpText="Get your webhook URL from Teams channel connectors"
          tabindex="0"
          :error="!!fieldErrors.webhookUrl"
          :error-message="fieldErrors.webhookUrl"
        />
      </div>
    </template>

    <!-- PagerDuty Fields -->
    <template v-if="destinationType === 'pagerduty'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.integrationKey"
          data-test="pagerduty-integration-key-input"
          label="Integration Key *"
          type="password"
          helpText="Get your integration key from PagerDuty service settings"
          tabindex="0"
          :error="!!fieldErrors.integrationKey"
          :error-message="fieldErrors.integrationKey"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OSelect
          v-model="credentials.severity"
          data-test="pagerduty-severity-select"
          :options="severityOptions"
          label="Default Severity *"
          labelKey="label"
          valueKey="value"
          helpText="Select the default severity for PagerDuty incidents"
          tabindex="0"
        />
      </div>
    </template>

    <!-- ServiceNow Fields -->
    <template v-if="destinationType === 'servicenow'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.instanceUrl"
          data-test="servicenow-instance-url-input"
          label="ServiceNow Instance URL *"
          helpText="https://your-instance.service-now.com/api/now/table/incident"
          tabindex="0"
          :error="!!fieldErrors.instanceUrl"
          :error-message="fieldErrors.instanceUrl"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.username"
          data-test="servicenow-username-input"
          label="Username *"
          helpText="ServiceNow username with incident creation permissions"
          tabindex="0"
          :error="!!fieldErrors.username"
          :error-message="fieldErrors.username"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.password"
          data-test="servicenow-password-input"
          label="Password *"
          type="password"
          helpText="ServiceNow password or API token"
          tabindex="0"
          :error="!!fieldErrors.password"
          :error-message="fieldErrors.password"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.assignmentGroup"
          data-test="servicenow-assignment-group-input"
          label="Assignment Group (optional)"
          helpText="Group to assign incidents to (e.g., IT Operations)"
          tabindex="0"
        />
      </div>
    </template>

    <!-- Email Fields -->
    <template v-if="destinationType === 'email'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.recipients"
          data-test="email-recipients-input"
          label="Recipient Email Addresses *"
          helpText="Comma-separated email addresses"
          tabindex="0"
          :error="!!fieldErrors.recipients"
          :error-message="fieldErrors.recipients"
        />
      </div>
      <!-- CC and Subject fields tw:hidden - not supported by backend Email struct -->
      <!-- <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.ccRecipients"
          data-test="email-cc-input"
          label="CC Recipients (optional)"
          class="showLabelOnTop"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="tw:text-xs tw:text-gray-400">
              Comma-separated CC email addresses
            </span>
          </template>
        </OInput>
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.subject"
          data-test="email-subject-input"
          label="Email Subject (optional)"
          class="showLabelOnTop"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="tw:text-xs tw:text-gray-400">
              Custom subject line (defaults to alert name)
            </span>
          </template>
        </OInput>
      </div> -->
    </template>

    <!-- Opsgenie Fields -->
    <template v-if="destinationType === 'opsgenie'">
      <div class="tw:w-1/2 tw:py-1">
        <OInput
          v-model="credentials.apiKey"
          data-test="opsgenie-api-key-input"
          label="Opsgenie API Key *"
          type="password"
          helpText="Get your API key from Opsgenie integration settings"
          tabindex="0"
          :error="!!fieldErrors.apiKey"
          :error-message="fieldErrors.apiKey"
        />
      </div>
      <div class="tw:w-1/2 tw:py-1">
        <OSelect
          v-model="credentials.priority"
          data-test="opsgenie-priority-select"
          :options="priorityOptions"
          label="Default Priority"
          labelKey="label"
          valueKey="value"
          helpText="Select the default priority for Opsgenie alerts"
          tabindex="0"
        />
      </div>
      <div class="tw:w-full tw:py-1">
        <OSwitch
          v-model="credentials.euRegion"
          data-test="opsgenie-eu-region-toggle"
          label="EU Region"
        >
          <template v-slot:hint>
            <span class="tw:text-xs tw:text-gray-400">
              Enable for EU-based Opsgenie instances
            </span>
          </template>
        </OSwitch>
      </div>
    </template>

    <!-- Test and Preview Actions -->
    <div v-if="!hideActions" class="tw:w-full tw:py-3">
      <div class="tw:flex tw:items-center tw:gap-2">
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
import { computed, reactive } from 'vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OInput from '@/lib/forms/Input/OInput.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OSwitch from '@/lib/forms/Switch/OSwitch.vue';
import type { PropType } from 'vue';
import { getPrebuiltConfig } from '@/utils/prebuilt-templates';
import type { PrebuiltTypeId } from '@/utils/prebuilt-templates/types';

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

const emit = defineEmits(['update:modelValue', 'preview', 'test']);

// Computed credentials that sync with modelValue
const credentials = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const fieldErrors = reactive<Record<string, string>>({});

function validate(): boolean {
  Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k]);
  const config = getPrebuiltConfig(props.destinationType as PrebuiltTypeId);
  if (!config) return true;
  for (const field of config.credentialFields) {
    const value = credentials.value[field.key];
    if (field.required && (!value || value.toString().trim() === '')) {
      fieldErrors[field.key] = `${field.label} is required`;
      continue;
    }
    if (!field.required && (!value || value.toString().trim() === '')) continue;
    if (field.validator && value) {
      const result = field.validator(value.toString());
      if (result !== true) fieldErrors[field.key] = result as string;
    }
  }
  return Object.keys(fieldErrors).length === 0;
}

defineExpose({ validate });

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

<style lang="scss" scoped>
.prebuilt-destination-form {
  .q-field {
    margin-bottom: 0.5rem;
  }

  .q-banner pre {
    font-size: 0.75rem;
    background-color: rgba(255, 255, 255, 0.1);
    padding: 0.5rem;
    border-radius: 4px;
    margin-top: 0.5rem;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
}
</style>
