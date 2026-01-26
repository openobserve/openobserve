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
  <div data-test="destination-test-result" class="o2-test-result">
    <!-- Success State -->
    <div
      v-if="result && result.success"
      data-test="test-result-success"
      class="o2-test-success"
    >
      <div class="result-icon">
        <q-icon name="check_circle" size="20px" />
      </div>
      <div class="result-content">
        <div data-test="test-success-message" class="result-title">
          {{ t('alerts.testSuccessMessage') }}
        </div>
        <div data-test="test-success-timestamp" class="result-meta">
          {{ formatTimestamp(result.timestamp) }}
          <span v-if="result.statusCode" class="status-badge success-badge">
            {{ result.statusCode }}
          </span>
          <span v-if="result.responseTime" class="response-time">
            {{ result.responseTime }}ms
          </span>
        </div>
      </div>
    </div>

    <!-- Failure State -->
    <div
      v-else-if="result && !result.success"
      data-test="test-result-failure"
      class="o2-test-failure"
    >
      <div class="result-icon">
        <q-icon name="error" size="20px" />
      </div>
      <div class="result-content">
        <div data-test="test-failure-message" class="result-title">
          {{ getFailureMessage(result) }}
        </div>
        <div v-if="result.timestamp" data-test="test-failure-timestamp" class="result-meta">
          {{ formatTimestamp(result.timestamp) }}
          <span v-if="result.statusCode" class="status-badge error-badge">
            {{ result.statusCode }}
          </span>
          <span v-if="result.responseTime" class="response-time">
            {{ result.responseTime }}ms
          </span>
        </div>

        <!-- Suggested Fix -->
        <div v-if="getSuggestedFix(result)" class="result-suggestion">
          <q-icon name="lightbulb" size="16px" />
          <span>{{ getSuggestedFix(result) }}</span>
        </div>

        <!-- Error Details Expansion -->
        <q-expansion-item
          v-if="result.error || result.responseBody"
          data-test="test-failure-details-expansion"
          class="error-expansion"
          dense
          expand-icon-class="text-grey-7"
        >
          <template #header>
            <div class="expansion-header">
              <q-icon name="info" size="14px" class="q-mr-xs" />
              <span class="text-caption">{{ t('alerts.viewDetails') }}</span>
            </div>
          </template>

          <div data-test="test-failure-details" class="error-details-content">
            <div v-if="result.error" data-test="test-error-message" class="error-item">
              <div class="error-label">{{ t('alerts.error') }}</div>
              <div class="error-value">{{ result.error }}</div>
            </div>

            <div v-if="result.statusCode" data-test="test-http-status" class="error-item">
              <div class="error-label">{{ t('alerts.httpStatus') }}</div>
              <div class="error-value">{{ result.statusCode }} {{ getStatusText(result.statusCode) }}</div>
            </div>

            <div v-if="result.responseBody" data-test="test-response-body" class="error-item">
              <div class="error-label">{{ t('alerts.responseBody') }}</div>
              <pre class="error-code">{{ formatResponseBody(result.responseBody) }}</pre>
            </div>
          </div>
        </q-expansion-item>

        <!-- Retry Button -->
        <div class="result-actions">
          <q-btn
            data-test="test-retry-button"
            flat
            no-caps
            dense
            size="sm"
            color="primary"
            :label="t('alerts.retry')"
            icon="refresh"
            @click="$emit('retry')"
          />
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-else-if="isLoading"
      data-test="test-result-loading"
      class="o2-test-loading"
    >
      <div class="result-icon">
        <q-spinner color="primary" size="20px" />
      </div>
      <div class="result-content">
        <div class="result-title">
          {{ t('alerts.testInProgress') }}
        </div>
        <div class="result-meta">
          {{ t('alerts.sendingNotification') }}
        </div>
      </div>
    </div>

    <!-- Idle State -->
    <div
      v-else
      data-test="test-result-idle"
      class="o2-test-idle"
    >
      <q-icon name="info" size="16px" />
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
.o2-test-result {
  margin-top: 12px;

  .o2-test-success,
  .o2-test-failure,
  .o2-test-loading {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 4px;
    border-left: 3px solid;
    background-color: var(--q-field-bg);
  }

  .o2-test-success {
    border-left-color: var(--q-positive);
    background-color: rgba(76, 175, 80, 0.08);

    .result-icon {
      color: var(--q-positive);
    }
  }

  .o2-test-failure {
    border-left-color: var(--q-negative);
    background-color: rgba(244, 67, 54, 0.08);

    .result-icon {
      color: var(--q-negative);
    }
  }

  .o2-test-loading {
    border-left-color: var(--q-primary);
    background-color: rgba(33, 150, 243, 0.08);

    .result-icon {
      color: var(--q-primary);
    }
  }

  .result-icon {
    flex-shrink: 0;
    padding-top: 2px;
  }

  .result-content {
    flex: 1;
    min-width: 0;

    .result-title {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      margin-bottom: 4px;
    }

    .result-meta {
      font-size: 11px;
      color: var(--q-text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;

      .status-badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
        letter-spacing: 0.3px;

        &.success-badge {
          background-color: var(--q-positive);
          color: white;
        }

        &.error-badge {
          background-color: var(--q-negative);
          color: white;
        }
      }

      .response-time {
        font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
        color: var(--q-text-secondary);
      }
    }

    .result-suggestion {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 8px;
      padding: 8px;
      background-color: rgba(255, 193, 7, 0.1);
      border-radius: 3px;
      font-size: 11px;
      color: var(--q-text);
      line-height: 1.4;

      .q-icon {
        color: var(--q-warning);
        flex-shrink: 0;
        margin-top: 1px;
      }
    }

    .error-expansion {
      margin-top: 8px;
      background-color: transparent;

      .expansion-header {
        display: flex;
        align-items: center;
        color: var(--q-text-secondary);
        font-size: 11px;
      }
    }

    .error-details-content {
      padding: 8px 0 0 0;

      .error-item {
        margin-bottom: 12px;

        &:last-child {
          margin-bottom: 0;
        }

        .error-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--q-text-secondary);
          margin-bottom: 4px;
        }

        .error-value {
          font-size: 11px;
          color: var(--q-text);
          line-height: 1.5;
          word-break: break-word;
        }

        .error-code {
          background-color: rgba(0, 0, 0, 0.05);
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 3px;
          padding: 8px;
          font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
          font-size: 10px;
          line-height: 1.5;
          max-height: 150px;
          overflow-y: auto;
          margin: 0;
          white-space: pre;
          color: var(--q-text);
        }
      }
    }

    .result-actions {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 0, 0, 0.08);
    }
  }

  .o2-test-idle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 4px;
    background-color: rgba(0, 0, 0, 0.02);
    border: 1px solid rgba(0, 0, 0, 0.08);

    .q-icon {
      color: var(--q-text-secondary);
      opacity: 0.7;
    }

    .idle-text {
      font-size: 11px;
      color: var(--q-text-secondary);
      line-height: 1.4;
    }
  }
}

// Dark theme adjustments
body.body--dark {
  .o2-test-result {
    .o2-test-success,
    .o2-test-failure,
    .o2-test-loading {
      background-color: rgba(255, 255, 255, 0.03);
    }

    .o2-test-success {
      background-color: rgba(76, 175, 80, 0.12);
    }

    .o2-test-failure {
      background-color: rgba(244, 67, 54, 0.12);
    }

    .o2-test-loading {
      background-color: rgba(33, 150, 243, 0.12);
    }

    .result-suggestion {
      background-color: rgba(255, 193, 7, 0.15);
    }

    .error-code {
      background-color: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .o2-test-idle {
      background-color: rgba(255, 255, 255, 0.02);
      border-color: rgba(255, 255, 255, 0.08);
    }

    .result-actions {
      border-top-color: rgba(255, 255, 255, 0.08);
    }
  }
}
</style>
