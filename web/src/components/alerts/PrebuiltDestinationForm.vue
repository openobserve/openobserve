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
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.webhookUrl"
          data-test="slack-webhook-url-input"
          label="Slack Webhook URL *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Webhook URL is required',
            (val: any) => val.startsWith('https://hooks.slack.com/') || 'Invalid Slack webhook URL'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Get your webhook URL from Slack App settings
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.channel"
          data-test="slack-channel-input"
          label="Channel (optional)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              e.g., #alerts
            </span>
          </template>
        </q-input>
      </div>
    </template>

    <!-- Discord Fields -->
    <template v-if="destinationType === 'discord'">
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.webhookUrl"
          data-test="discord-webhook-url-input"
          label="Discord Webhook URL *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Webhook URL is required',
            (val: any) => val.includes('discord.com/api/webhooks/') || 'Invalid Discord webhook URL'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Get your webhook URL from Discord channel settings
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.username"
          data-test="discord-username-input"
          label="Bot Username (optional)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Custom username for the webhook bot
            </span>
          </template>
        </q-input>
      </div>
    </template>

    <!-- MS Teams Fields -->
    <template v-if="destinationType === 'msteams'">
      <div class="col-12 q-py-xs">
        <q-input
          v-model="credentials.webhookUrl"
          data-test="msteams-webhook-url-input"
          label="Microsoft Teams Webhook URL *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Webhook URL is required',
            (val: any) => (val.includes('outlook.office.com') || val.includes('webhook.office.com')) || 'Invalid Microsoft Teams webhook URL'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Get your webhook URL from Teams channel connectors
            </span>
          </template>
        </q-input>
      </div>
    </template>

    <!-- PagerDuty Fields -->
    <template v-if="destinationType === 'pagerduty'">
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.integrationKey"
          data-test="pagerduty-integration-key-input"
          label="Integration Key *"
          type="password"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Integration key is required',
            (val: any) => val.length === 32 || 'PagerDuty integration key should be 32 characters'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Get your integration key from PagerDuty service settings
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-select
          v-model="credentials.severity"
          data-test="pagerduty-severity-select"
          :options="severityOptions"
          label="Default Severity *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          emit-value
          map-options
          :rules="[(val: any) => !!val || 'Severity is required']"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Select the default severity for PagerDuty incidents
            </span>
          </template>
        </q-select>
      </div>
    </template>

    <!-- ServiceNow Fields -->
    <template v-if="destinationType === 'servicenow'">
      <div class="col-12 q-py-xs">
        <q-input
          v-model="credentials.instanceUrl"
          data-test="servicenow-instance-url-input"
          label="ServiceNow Instance URL *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Instance URL is required',
            (val: any) => (val.includes('.service-now.com') && val.includes('/api/now/table/incident')) || 'URL should be like https://instance.service-now.com/api/now/table/incident'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              https://your-instance.service-now.com/api/now/table/incident
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.username"
          data-test="servicenow-username-input"
          label="Username *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[(val: any) => !!val || 'Username is required']"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              ServiceNow username with incident creation permissions
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.password"
          data-test="servicenow-password-input"
          label="Password *"
          type="password"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[(val: any) => !!val || 'Password is required']"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              ServiceNow password or API token
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-12 q-py-xs">
        <q-input
          v-model="credentials.assignmentGroup"
          data-test="servicenow-assignment-group-input"
          label="Assignment Group (optional)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Group to assign incidents to (e.g., IT Operations)
            </span>
          </template>
        </q-input>
      </div>
    </template>

    <!-- Email Fields -->
    <template v-if="destinationType === 'email'">
      <div class="col-12 q-py-xs">
        <q-input
          v-model="credentials.recipients"
          data-test="email-recipients-input"
          label="Recipient Email Addresses *"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'Recipients are required',
            (val: any) => validateEmailList(val) || 'Please enter valid email addresses'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Comma-separated email addresses
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.ccRecipients"
          data-test="email-cc-input"
          label="CC Recipients (optional)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Comma-separated CC email addresses
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.subject"
          data-test="email-subject-input"
          label="Email Subject (optional)"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Custom subject line (defaults to alert name)
            </span>
          </template>
        </q-input>
      </div>
    </template>

    <!-- Opsgenie Fields -->
    <template v-if="destinationType === 'opsgenie'">
      <div class="col-6 q-py-xs">
        <q-input
          v-model="credentials.apiKey"
          data-test="opsgenie-api-key-input"
          label="Opsgenie API Key *"
          type="password"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          :rules="[
            (val: any) => !!val || 'API key is required',
            (val: any) => val.length > 30 || 'Opsgenie API key should be longer than 30 characters'
          ]"
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Get your API key from Opsgenie integration settings
            </span>
          </template>
        </q-input>
      </div>
      <div class="col-6 q-py-xs">
        <q-select
          v-model="credentials.priority"
          data-test="opsgenie-priority-select"
          :options="priorityOptions"
          label="Default Priority"
          class="showLabelOnTop"
          stack-label
          borderless
          dense
          hide-bottom-space
          emit-value
          map-options
          tabindex="0"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Select the default priority for Opsgenie alerts
            </span>
          </template>
        </q-select>
      </div>
      <div class="col-12 q-py-xs">
        <q-toggle
          v-model="credentials.euRegion"
          data-test="opsgenie-eu-region-toggle"
          label="EU Region"
          class="o2-toggle-button-lg"
          size="lg"
        >
          <template v-slot:hint>
            <span class="text-caption text-grey-7">
              Enable for EU-based Opsgenie instances
            </span>
          </template>
        </q-toggle>
      </div>
    </template>

    <!-- Test and Preview Actions -->
    <div v-if="!hideActions" class="col-12 q-py-md">
      <div class="flex items-center q-gutter-sm">
        <q-btn
          data-test="destination-preview-button"
          label="Preview"
          icon="preview"
          outline
          no-caps
          @click="$emit('preview')"
        />
        <q-btn
          data-test="destination-test-button"
          :loading="isTesting"
          label="Test"
          icon="send"
          outline
          no-caps
          @click="$emit('test')"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { PropType } from 'vue';

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

// Email validation function
const validateEmailList = (emails: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailList = emails.split(',').map(e => e.trim());
  return emailList.every(email => emailRegex.test(email));
};
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