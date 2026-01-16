<!-- Copyright 2026 OpenObserve Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. -->

<template>
  <div data-test="destination-test-result" class="test-result-container">
    <!-- Success State -->
    <q-banner
      v-if="result && result.success"
      data-test="test-result-success"
      class="test-success"
      dense
      rounded
    >
      <template #avatar>
        <q-icon name="check_circle" color="positive" />
      </template>

      <div class="test-result-content">
        <div data-test="test-success-message" class="test-message">
          {{ t('alerts.testSuccessMessage') }}
        </div>
        <div data-test="test-success-timestamp" class="test-timestamp">
          {{ formatTimestamp(result.timestamp) }}
        </div>

        <!-- Success Details (Optional) -->
        <div v-if="result.statusCode" class="test-details">
          <span class="status-code success">{{ result.statusCode }}</span>
          <span v-if="result.responseTime" class="response-time">
            {{ result.responseTime }}ms
          </span>
        </div>
      </div>
    </q-banner>

    <!-- Failure State -->
    <q-banner
      v-else-if="result && !result.success"
      data-test="test-result-failure"
      class="test-failure"
      dense
      rounded
    >
      <template #avatar>
        <q-icon name="error" color="negative" />
      </template>

      <div class="test-result-content">
        <div data-test="test-failure-message" class="test-message">
          {{ getFailureMessage(result) }}
        </div>
        <div v-if="result.timestamp" data-test="test-failure-timestamp" class="test-timestamp">
          {{ formatTimestamp(result.timestamp) }}
        </div>

        <!-- Failure Details -->
        <div class="test-details">
          <span v-if="result.statusCode" class="status-code failure">
            {{ result.statusCode }}
          </span>
          <span v-if="result.responseTime" class="response-time">
            {{ result.responseTime }}ms
          </span>
        </div>

        <!-- Expandable Error Details -->
        <q-expansion-item
          v-if="result.error || result.responseBody"
          data-test="test-failure-details-expansion"
          :label="t('alerts.viewDetails')"
          class="error-details-expansion"
          dense
        >
          <div data-test="test-failure-details" class="error-details">
            <div v-if="result.error" data-test="test-error-message" class="error-field">
              <strong>{{ t('alerts.error') }}:</strong>
              <code class="error-text">{{ result.error }}</code>
            </div>

            <div v-if="result.statusCode" data-test="test-http-status" class="error-field">
              <strong>{{ t('alerts.httpStatus') }}:</strong>
              <span class="status-code">{{ result.statusCode }} {{ getStatusText(result.statusCode) }}</span>
            </div>

            <div v-if="result.responseBody" data-test="test-response-body" class="error-field">
              <strong>{{ t('alerts.responseBody') }}:</strong>
              <pre class="response-body">{{ formatResponseBody(result.responseBody) }}</pre>
            </div>

            <div v-if="result.headers" data-test="test-response-headers" class="error-field">
              <strong>{{ t('alerts.responseHeaders') }}:</strong>
              <pre class="response-headers">{{ JSON.stringify(result.headers, null, 2) }}</pre>
            </div>
          </div>
        </q-expansion-item>

        <!-- Suggested Fixes -->
        <div v-if="getSuggestedFix(result)" class="suggested-fixes">
          <q-icon name="lightbulb" color="warning" size="sm" />
          <span class="suggestion-text">{{ getSuggestedFix(result) }}</span>
        </div>
      </div>

      <template #action>
        <q-btn
          data-test="test-retry-button"
          flat
          color="primary"
          :label="t('alerts.retry')"
          @click="$emit('retry')"
        />
      </template>
    </q-banner>

    <!-- Loading State -->
    <q-banner
      v-else-if="isLoading"
      data-test="test-result-loading"
      class="test-loading"
      dense
      rounded
    >
      <template #avatar>
        <q-spinner color="primary" size="sm" />
      </template>

      <div class="test-result-content">
        <div class="test-message">
          {{ t('alerts.testInProgress') }}
        </div>
        <div class="test-subtext">
          {{ t('alerts.sendingNotification') }}
        </div>
      </div>
    </q-banner>

    <!-- Idle State -->
    <div
      v-else
      data-test="test-result-idle"
      class="test-idle"
    >
      <q-icon name="play_circle_outline" color="grey-6" size="sm" />
      <span class="idle-text">
        {{ t('alerts.testIdleMessage') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { date } from 'quasar';
import type { TestResult } from '@/utils/prebuilt-templates/types';

// Define component props
interface Props {
  result?: TestResult | null;
  isLoading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  result: null,
  isLoading: false
});

// Define component emits
interface Emits {
  (e: 'retry'): void;
}

const emit = defineEmits<Emits>();

// Composables
const { t } = useI18n();

// Methods
function formatTimestamp(timestamp?: number | string): string {
  if (!timestamp) return '';

  const ts = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return date.formatDate(ts, 'MMM DD, HH:mm:ss');
}

function getFailureMessage(result: TestResult): string {
  if (result.error) {
    // Check for common error patterns
    if (result.error.includes('ENOTFOUND') || result.error.includes('DNS')) {
      return t('alerts.testErrorDNS');
    }
    if (result.error.includes('ECONNREFUSED') || result.error.includes('connection')) {
      return t('alerts.testErrorConnection');
    }
    if (result.error.includes('timeout')) {
      return t('alerts.testErrorTimeout');
    }
    if (result.error.includes('certificate') || result.error.includes('SSL')) {
      return t('alerts.testErrorSSL');
    }

    return t('alerts.testErrorGeneric');
  }

  if (result.statusCode) {
    if (result.statusCode >= 400 && result.statusCode < 500) {
      return t('alerts.testErrorClientError');
    }
    if (result.statusCode >= 500) {
      return t('alerts.testErrorServerError');
    }
  }

  return t('alerts.testFailedMessage');
}

function getStatusText(statusCode: number): string {
  const statusMessages: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };

  return statusMessages[statusCode] || 'Unknown';
}

function formatResponseBody(body: string): string {
  try {
    // Try to parse and prettify JSON
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Return as-is if not JSON
    return body;
  }
}

function getSuggestedFix(result: TestResult): string | null {
  if (!result.error && !result.statusCode) return null;

  // DNS/Connection errors
  if (result.error?.includes('ENOTFOUND')) {
    return t('alerts.suggestCheckUrl');
  }

  if (result.error?.includes('ECONNREFUSED')) {
    return t('alerts.suggestCheckFirewall');
  }

  // HTTP status code suggestions
  if (result.statusCode === 401) {
    return t('alerts.suggestCheckCredentials');
  }

  if (result.statusCode === 403) {
    return t('alerts.suggestCheckPermissions');
  }

  if (result.statusCode === 404) {
    return t('alerts.suggestCheckEndpoint');
  }

  if (result.statusCode === 429) {
    return t('alerts.suggestRateLimit');
  }

  if (result.statusCode && result.statusCode >= 500) {
    return t('alerts.suggestServerIssue');
  }

  return null;
}
</script>

<style scoped lang="scss">
.test-result-container {
  margin-top: 1rem;

  .test-success {
    background-color: rgba(76, 175, 80, 0.1);
    border-left: 4px solid #4caf50;
  }

  .test-failure {
    background-color: rgba(244, 67, 54, 0.1);
    border-left: 4px solid #f44336;
  }

  .test-loading {
    background-color: rgba(33, 150, 243, 0.1);
    border-left: 4px solid #2196f3;
  }

  .test-result-content {
    .test-message {
      font-weight: 500;
      margin-bottom: 0.25rem;
    }

    .test-timestamp {
      font-size: 0.8rem;
      opacity: 0.7;
      margin-bottom: 0.5rem;
    }

    .test-subtext {
      font-size: 0.85rem;
      opacity: 0.8;
    }

    .test-details {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;

      .status-code {
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        font-weight: 600;
        font-family: 'Monaco', 'Consolas', monospace;

        &.success {
          background-color: #4caf50;
          color: white;
        }

        &.failure {
          background-color: #f44336;
          color: white;
        }
      }

      .response-time {
        font-size: 0.8rem;
        color: var(--q-text-secondary);
        font-family: 'Monaco', 'Consolas', monospace;
      }
    }

    .error-details {
      margin-top: 0.5rem;

      .error-field {
        margin-bottom: 0.75rem;

        strong {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.85rem;
        }
      }

      .error-text {
        background-color: rgba(244, 67, 54, 0.1);
        padding: 0.5rem;
        border-radius: 4px;
        display: block;
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 0.8rem;
        white-space: pre-wrap;
        word-break: break-all;
      }

      .response-body,
      .response-headers {
        background-color: var(--q-field-bg);
        padding: 0.5rem;
        border-radius: 4px;
        font-family: 'Monaco', 'Consolas', monospace;
        font-size: 0.75rem;
        max-height: 200px;
        overflow-y: auto;
        margin: 0;
        white-space: pre;
      }
    }

    .suggested-fixes {
      margin-top: 0.75rem;
      padding: 0.5rem;
      background-color: rgba(255, 193, 7, 0.1);
      border-radius: 4px;
      border-left: 3px solid #ffc107;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;

      .suggestion-text {
        font-size: 0.85rem;
        line-height: 1.4;
      }
    }
  }

  .test-idle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    color: var(--q-text-secondary);
    font-size: 0.9rem;
    border: 1px dashed var(--q-border-color);
    border-radius: 4px;
    text-align: center;
    justify-content: center;
  }
}

.error-details-expansion {
  margin-top: 0.5rem;

  :deep(.q-expansion-item__header) {
    padding: 0.5rem 0;
    font-size: 0.85rem;
  }

  :deep(.q-expansion-item__content) {
    padding: 0.5rem 0 0 0;
  }
}

// Dark mode adjustments
body.body--dark {
  .test-success {
    background-color: rgba(76, 175, 80, 0.2);
  }

  .test-failure {
    background-color: rgba(244, 67, 54, 0.2);
  }

  .test-loading {
    background-color: rgba(33, 150, 243, 0.2);
  }

  .suggested-fixes {
    background-color: rgba(255, 193, 7, 0.2);
  }

  .error-text {
    background-color: rgba(244, 67, 54, 0.2);
  }
}
</style>