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
  <div data-test="destination-test-result" class="mt-3">
    <!-- Success State -->
    <div
      v-if="result && result.success"
      data-test="test-result-success"
      class="flex gap-3 py-3 px-4 rounded-default border-l-[3px] border-solid border-status-positive bg-[rgba(76,175,80,0.08)] dark:bg-[rgba(76,175,80,0.12)]"
    >
      <div class="shrink-0 pt-0.5 text-status-positive">
        <OIcon name="check-circle" size="md" />
      </div>
      <div class="flex-1 min-w-0">
        <div data-test="test-success-message" class="text-compact font-medium leading-[1.4] mb-1">
          {{ t('alerts.testSuccessMessage') }}
        </div>
        <div data-test="test-success-timestamp" class="text-2xs text-text-secondary flex items-center gap-2 flex-wrap">
          {{ formatTimestamp(result.timestamp) }}
          <OTag v-if="result.statusCode" type="httpStatus" :value="httpStatusBucket(result.statusCode)">
            {{ result.statusCode }}
          </OTag>
          <span v-if="result.responseTime" class="font-mono text-text-secondary">
            {{ result.responseTime }}ms
          </span>
        </div>
      </div>
    </div>

    <!-- Failure State -->
    <div
      v-else-if="result && !result.success"
      data-test="test-result-failure"
      class="flex gap-3 py-3 px-4 rounded-default border-l-[3px] border-solid border-status-negative bg-[rgba(244,67,54,0.08)] dark:bg-[rgba(244,67,54,0.12)]"
    >
      <div class="shrink-0 pt-0.5 text-status-negative">
        <OIcon name="error" size="md" />
      </div>
      <div class="flex-1 min-w-0">
        <div data-test="test-failure-message" class="text-compact font-medium leading-[1.4] mb-1">
          {{ getFailureMessage(result) }}
        </div>
        <div v-if="result.timestamp" data-test="test-failure-timestamp" class="text-2xs text-text-secondary flex items-center gap-2 flex-wrap">
          {{ formatTimestamp(result.timestamp) }}
          <OTag v-if="result.statusCode" type="httpStatus" :value="httpStatusBucket(result.statusCode)">
            {{ result.statusCode }}
          </OTag>
          <span v-if="result.responseTime" class="font-mono text-text-secondary">
            {{ result.responseTime }}ms
          </span>
        </div>

        <!-- Suggested Fix -->
        <div v-if="getSuggestedFix(result)" class="result-suggestion flex items-start gap-2 mt-2 p-2 bg-[rgba(255,193,7,0.1)] dark:bg-[rgba(255,193,7,0.15)] rounded-default text-2xs text-text-secondary leading-[1.4]">
          <OIcon name="lightbulb" size="sm" />
          <span>{{ getSuggestedFix(result) }}</span>
        </div>

        <!-- Error Details Expansion -->
        <OCollapsible
          v-if="result.error || result.responseBody"
          v-model="errorDetailsOpen"
          data-test="test-failure-details-expansion"
          class="mt-2 bg-transparent"
        >
          <template #trigger>
            <div class="flex items-center text-text-secondary text-2xs">
              <OIcon name="info" size="xs" class="mr-1" />
              <span class="text-xs">{{ t('alerts.viewDetails') }}</span>
            </div>
          </template>

          <div data-test="test-failure-details" class="pt-2">
            <div v-if="result.error" data-test="test-error-message" class="error-item mb-3">
              <div class="text-3xs font-semibold uppercase tracking-[0.5px] text-text-secondary mb-1">{{ t('alerts.error') }}</div>
              <div class="text-2xs text-text-body leading-[1.5] break-words">{{ result.error }}</div>
            </div>

            <div v-if="result.statusCode" data-test="test-http-status" class="error-item mb-3">
              <div class="text-3xs font-semibold uppercase tracking-[0.5px] text-text-secondary mb-1">{{ t('alerts.httpStatus') }}</div>
              <div class="text-2xs text-text-body leading-[1.5] break-words">{{ result.statusCode }} {{ getStatusText(result.statusCode) }}</div>
            </div>

            <div v-if="result.responseBody" data-test="test-response-body" class="error-item mb-3">
              <div class="text-3xs font-semibold uppercase tracking-[0.5px] text-text-secondary mb-1">{{ t('alerts.responseBody') }}</div>
              <pre class="bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.05)] border border-[rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.1)] rounded-default p-2 font-mono text-3xs leading-[1.5] max-h-37.5 overflow-y-auto m-0 whitespace-pre text-text-body">{{ formatResponseBody(result.responseBody) }}</pre>
            </div>
          </div>
        </OCollapsible>

        <!-- Retry Button -->
        <div class="mt-3 pt-2 border-t border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]">
          <OButton
            data-test="test-retry-button"
            variant="ghost-primary"
            size="xs"
            @click="$emit('retry')"
            icon-left="refresh"
          >
            {{ t('alerts.retry') }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-else-if="isLoading"
      data-test="test-result-loading"
      class="flex gap-3 py-3 px-4 rounded-default border-l-[3px] border-solid border-theme-accent bg-[rgba(33,150,243,0.08)] dark:bg-[rgba(33,150,243,0.12)]"
    >
      <div class="shrink-0 pt-0.5 text-theme-accent">
        <OSpinner size="xs" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-compact font-medium leading-[1.4] mb-1">
          {{ t('alerts.testInProgress') }}
        </div>
        <div class="text-2xs text-text-secondary flex items-center gap-2 flex-wrap">
          {{ t('alerts.sendingNotification') }}
        </div>
      </div>
    </div>

    <!-- Idle State -->
    <div
      v-else
      data-test="test-result-idle"
      class="flex items-center gap-2 py-2.5 px-3 rounded-default bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.02)] border border-[rgba(0,0,0,0.08)] dark:border-[rgba(255,255,255,0.08)]"
    >
      <OIcon name="info" size="sm" />
      <span class="text-2xs text-text-secondary leading-[1.4]">
        {{ t('alerts.testIdleMessage') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import OButton from '@/lib/core/Button/OButton.vue';
import { formatDate } from "@/utils/date";
import type { TestResult } from '@/utils/prebuilt-templates/types';
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { httpStatusBucket } from "@/lib/core/Badge/badgeGroups";
import { ref } from 'vue';

// Define component props
interface Props {
  // Backend test responses also include responseTime (ms); shared TestResult omits it.
  result?: (TestResult & { responseTime?: number }) | null;
  isLoading?: boolean;
}

withDefaults(defineProps<Props>(), {
  result: null,
  isLoading: false
});

// Define component emits
interface Emits {
  (e: 'retry'): void;
}

defineEmits<Emits>();

// Composables
const { t } = useI18n();

const errorDetailsOpen = ref(false);

// Methods
function formatTimestamp(timestamp?: number | string): string {
  if (!timestamp) return '';

  const ts = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return formatDate(ts, "MMM DD, HH:mm:ss");
}

function getFailureMessage(result: TestResult): string {
  // First, try to show the actual backend error message
  if (result.responseBody) {
    try {
      const parsed = JSON.parse(result.responseBody);
      // Common error message fields from various APIs
      const errorMessage = parsed.error || parsed.message || parsed.errors || parsed.detail;
      if (errorMessage) {
        // If it's a string, return it directly
        if (typeof errorMessage === 'string') {
          return `Test failed: ${errorMessage}`;
        }
        // If it's an array, join the messages
        if (Array.isArray(errorMessage)) {
          return `Test failed: ${errorMessage.join(', ')}`;
        }
      }
    } catch {
      // If parsing fails, try to use responseBody as-is if it's short enough
      if (result.responseBody.length < 100) {
        return `Test failed: ${result.responseBody}`;
      }
    }
  }

  // If we have an error message, show it directly
  if (result.error) {
    // Check for common error patterns that need specific guidance
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

    // For other errors, show the actual error message
    return `Test failed: ${result.error}`;
  }

  // Fall back to generic messages based on status code
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
