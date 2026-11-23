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
      class="rounded-default border-status-positive flex gap-3 border-s-3 border-solid bg-[rgba(76,175,80,0.08)] px-4 py-3 dark:bg-[rgba(76,175,80,0.12)]"
    >
      <div class="text-status-positive shrink-0 pt-0.5">
        <OIcon name="check-circle" size="md" />
      </div>
      <div class="min-w-0 flex-1">
        <div data-test="test-success-message" class="text-compact mb-1 leading-[1.4] font-medium">
          {{
            result.issue
              ? t("alerts.prebuiltDestinations.jiraTestCreated", { key: result.issue.key })
              : result.genericSample
                ? t("alerts.testSuccessGenericSample")
                : t("alerts.testSuccessMessage")
          }}
        </div>
        <OButton
          v-if="result.issue && /^https?:\/\//i.test(result.issue.url)"
          data-test="test-success-issue-link"
          :href="result.issue.url"
          target="_blank"
          rel="noopener noreferrer"
          variant="accent-ghost"
          size="sm"
          icon-end="open-in-new"
          class="mb-1"
        >
          {{ t("alerts.prebuiltDestinations.jiraOpenIssue") }}
        </OButton>
        <div
          data-test="test-success-timestamp"
          class="text-2xs text-text-secondary flex flex-wrap items-center gap-2"
        >
          {{ formatTimestamp(result.timestamp) }}
          <OTag
            v-if="result.statusCode"
            type="httpStatus"
            :value="httpStatusBucket(result.statusCode)"
          >
            {{ result.statusCode }}
          </OTag>
          <span v-if="result.responseTime" class="text-text-secondary font-mono">
            {{ result.responseTime }}{{ t("alerts.ms") }}
          </span>
        </div>
      </div>
    </div>

    <!-- Failure State -->
    <div
      v-else-if="result && !result.success"
      data-test="test-result-failure"
      class="rounded-default border-status-negative flex gap-3 border-s-3 border-solid bg-[rgba(244,67,54,0.08)] px-4 py-3 dark:bg-[rgba(244,67,54,0.12)]"
    >
      <div class="text-status-negative shrink-0 pt-0.5">
        <OIcon name="error" size="md" />
      </div>
      <div class="min-w-0 flex-1">
        <div data-test="test-failure-message" class="text-compact mb-1 leading-[1.4] font-medium">
          {{ getFailureMessage(result) }}
        </div>
        <div
          v-if="result.timestamp"
          data-test="test-failure-timestamp"
          class="text-2xs text-text-secondary flex flex-wrap items-center gap-2"
        >
          {{ formatTimestamp(result.timestamp) }}
          <OTag
            v-if="result.statusCode"
            type="httpStatus"
            :value="httpStatusBucket(result.statusCode)"
          >
            {{ result.statusCode }}
          </OTag>
          <span v-if="result.responseTime" class="text-text-secondary font-mono">
            {{ result.responseTime }}{{ t("alerts.ms") }}
          </span>
        </div>

        <!-- Suggested Fix -->
        <div
          v-if="getSuggestedFix(result)"
          class="result-suggestion rounded-default text-2xs text-text-secondary mt-2 flex items-start gap-2 bg-[rgba(255,193,7,0.1)] p-2 leading-[1.4] dark:bg-[rgba(255,193,7,0.15)]"
        >
          <OIcon name="lightbulb" size="sm" />
          <span>{{ getSuggestedFix(result) }}</span>
        </div>

        <!-- Retry Button -->
        <div
          class="mt-3 border-t border-[rgba(0,0,0,0.08)] pt-2 dark:border-[rgba(255,255,255,0.08)]"
        >
          <OButton
            data-test="test-retry-button"
            variant="accent-ghost"
            size="sm"
            @click="$emit('retry')"
            icon="refresh"
          >
            {{ t("alerts.retry") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-else-if="isLoading"
      data-test="test-result-loading"
      class="rounded-default border-theme-accent flex gap-3 border-s-3 border-solid bg-[rgba(33,150,243,0.08)] px-4 py-3 dark:bg-[rgba(33,150,243,0.12)]"
    >
      <div class="text-theme-accent shrink-0 pt-0.5">
        <OSpinner />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-compact mb-1 leading-[1.4] font-medium">
          {{ t("alerts.testInProgress") }}
        </div>
        <div class="text-2xs text-text-secondary flex flex-wrap items-center gap-2">
          {{ t("alerts.sendingNotification") }}
        </div>
      </div>
    </div>

    <!-- Idle State -->
    <div
      v-else
      data-test="test-result-idle"
      class="rounded-default flex items-center gap-2 border border-[rgba(0,0,0,0.08)] bg-[rgba(0,0,0,0.02)] px-3 py-2.5 dark:border-[rgba(255,255,255,0.08)] dark:bg-[rgba(255,255,255,0.02)]"
    >
      <OIcon name="info" size="sm" />
      <span class="text-2xs text-text-secondary leading-[1.4]">
        {{ t("alerts.testIdleMessage") }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { formatDate } from "@/utils/date";
import type { TestResult } from "@/utils/prebuilt-templates/types";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { httpStatusBucket } from "@/lib/core/Badge/badgeGroups";

// Define component props
interface Props {
  // Backend test responses also include responseTime (ms); shared TestResult omits it.
  result?: (TestResult & { responseTime?: number }) | null;
  isLoading?: boolean;
}

withDefaults(defineProps<Props>(), {
  result: null,
  isLoading: false,
});

// Define component emits
interface Emits {
  (e: "retry"): void;
}

defineEmits<Emits>();

// Composables
const { t } = useI18nTyped();

// Methods
function formatTimestamp(timestamp?: number | string): string {
  if (!timestamp) return "";

  const ts = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
  return formatDate(ts, "MMM DD, HH:mm:ss");
}

function getFailureMessage(result: TestResult): string {
  // The status-based message is translated, while the backend's error is English.
  if (result.statusCode && result.statusCode >= 500) {
    return t("alerts.testErrorServerError");
  }
  if (result.statusCode && result.statusCode >= 400) {
    return t("alerts.testErrorClientError");
  }

  if (result.error) {
    // Check for common error patterns that need specific guidance
    if (result.error.includes("ENOTFOUND") || result.error.includes("DNS")) {
      return t("alerts.testErrorDNS");
    }
    if (result.error.includes("ECONNREFUSED") || result.error.includes("connection")) {
      return t("alerts.testErrorConnection");
    }
    if (result.error.includes("timeout")) {
      return t("alerts.testErrorTimeout");
    }
    if (result.error.includes("certificate") || result.error.includes("SSL")) {
      return t("alerts.testErrorSSL");
    }

    // For other errors, show the actual error message
    return t("alerts.testFailedWithReason", { reason: result.error });
  }

  return t("alerts.testFailedMessage");
}

function getSuggestedFix(result: TestResult): string | null {
  if (!result.error && !result.statusCode) return null;

  // DNS/Connection errors
  if (result.error?.includes("ENOTFOUND")) {
    return t("alerts.suggestCheckUrl");
  }

  if (result.error?.includes("ECONNREFUSED")) {
    return t("alerts.suggestCheckFirewall");
  }

  // HTTP status code suggestions
  if (result.statusCode === 401) {
    return t("alerts.suggestCheckCredentials");
  }

  if (result.statusCode === 403) {
    return t("alerts.suggestCheckPermissions");
  }

  if (result.statusCode === 404) {
    return t("alerts.suggestCheckEndpoint");
  }

  if (result.statusCode === 429) {
    return t("alerts.suggestRateLimit");
  }

  if (result.statusCode && result.statusCode >= 500) {
    return t("alerts.suggestServerIssue");
  }

  return null;
}
</script>
