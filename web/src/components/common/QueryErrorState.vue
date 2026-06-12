<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  QueryErrorState — universal query-error display for logs, metrics, traces,
  dashboards, RUM, and alerts.

  ┌─ Sizes ─────────────────────────────────────────────────────────────────┐
  │  hero   Full-page context (logs, traces, metrics explorer).             │
  │         Animated illustration + title + description + action cards.     │
  │                                                                         │
  │  block  Panel / card context (dashboard panels, alert test queries).    │
  │         Compact: no illustration, smaller type, inline action buttons.  │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─ Smart error parsing ────────────────────────────────────────────────────┐
  │  Backed by useQueryError composable:                                     │
  │  • Strips HTML from backend messages                                     │
  │  • Extracts TraceID from embedded <span>                                 │
  │  • Splits long messages (field lists) into summary + expandable detail   │
  │  • Maps error codes to human-readable titles / descriptions              │
  │  • Classifies which codes warrant a "Fix query" recovery action          │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─ Default actions per error code ────────────────────────────────────────┐
  │  20001 SQL syntax       → Fix query card  + Ask AI                      │
  │  20002 Stream not found → (informational)                               │
  │  20003 FTS not set      → Configure resource card                       │
  │  20004 Field not found  → Fix query card  + Ask AI                      │
  │  20005 Fn not defined   → Fix query card  + Ask AI                      │
  │  20006 Data unavailable → Try wider range card                          │
  │  20007 Type mismatch    → Fix query card  + Ask AI                      │
  │  20008 Execute error    → Fix query card  + Ask AI                      │
  │  10001 Server error     → (informational)                               │
  │  0 / other              → (informational) + Ask AI (if aiEnabled)       │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─ Customisation ──────────────────────────────────────────────────────────┐
  │  Slot #actions  — override the default action cards entirely.           │
  │  Slot #extra    — append content below the detail panel (hero only).    │
  │                                                                         │
  │  Props title / description override the i18n defaults.                  │
  │  Prop  illustration overrides the "broken-panel" default.               │
  └─────────────────────────────────────────────────────────────────────────┘

  Usage examples:
    <!-- Logs / Traces / Metrics (full page) -->
    <QueryErrorState
      :error-code="searchObj.data.errorCode"
      :error-msg="searchObj.data.errorMsg"
      :error-detail="searchObj.data.errorDetail"
      :ai-enabled="isAiEnabled"
      size="hero"
      @ask-ai="onAskAi"
      @fix-query="onFixQuery"
      @configure-resource="onConfigureStream"
      @widen-range="onWidenRange"
    />

    <!-- Dashboard panel (compact) -->
    <QueryErrorState
      :error-code="state.errorDetail.code"
      :error-msg="state.errorDetail.message"
      size="block"
    />

    <!-- Alert test query result -->
    <QueryErrorState
      :error-msg="testResult.error"
      size="block"
      :ai-enabled="isAiEnabled"
      @ask-ai="onAskAi"
    />
-->
<template>
  <!-- ── HERO layout ──────────────────────────────────────────────────── -->
  <div
    v-if="size === 'hero'"
    class="tw:w-full tw:h-full tw:overflow-y-auto tw:flex tw:flex-col tw:items-center tw:pb-8"
    data-test="query-error-state"
  >
    <!-- Illustration + title + description + action cards -->
    <OEmptyState
      :illustration="illustration ?? 'broken-panel'"
      size="block"
      :hide-action="true"
      class="tw:w-full tw:shrink-0"
    >
      <template #title>{{ resolvedTitle }}</template>
      <template #description>{{ resolvedDescription }}</template>
      <template #actions>
        <!-- Caller can replace all action cards via #actions slot -->
        <slot name="actions" v-bind="slotProps">
          <EmptyStateActionCard
            v-if="errorCode === 20003"
            icon="settings"
            :label="t('queryError.configureResource')"
            :sublabel="t('queryError.configureResourceDesc')"
            data-test="query-error-configure-resource-card"
            @click="emit('configure-resource')"
          />
          <EmptyStateActionCard
            v-else-if="isQueryError"
            icon="edit"
            :label="t('queryError.fixQuery')"
            :sublabel="t('queryError.fixQueryDesc')"
            data-test="query-error-fix-query-card"
            @click="emit('fix-query')"
          />
          <EmptyStateActionCard
            v-else-if="errorCode === 20006"
            icon="schedule"
            :label="t('queryError.expandRange')"
            :sublabel="t('queryError.expandRangeDesc')"
            data-test="query-error-expand-range-card"
            @click="emit('widen-range')"
          />
        </slot>
      </template>
    </OEmptyState>

    <!-- Detail panel + buttons (outside OEmptyState — avoids its overflow:hidden) -->
    <div
      v-if="hasAnyContent"
      class="tw:w-full tw:max-w-2xl tw:mx-auto tw:px-6 tw:flex tw:flex-col tw:gap-3"
    >
      <ErrorDetailPanel
        :summary-line="summaryLine"
        :detail-body="detailBody"
        :has-detail="hasDetail"
        :trace-id="traceId"
        :show-detail="showDetail"
        @toggle-detail="showDetail = !showDetail"
      />

      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <OButton
          variant="ghost"
          size="sm"
          :icon-left="copied ? 'check' : 'content-copy'"
          data-test="query-error-copy-btn"
          @click="handleCopy"
        >
          {{ copied ? t("queryError.copied") : t("queryError.copyError") }}
        </OButton>
        <OButton
          v-if="aiEnabled && (isQueryError || errorCode === 0)"
          variant="ghost"
          size="sm"
          class="ai-hover-btn"
          data-test="query-error-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon-left>
            <img :src="aiIconSrc" class="tw:w-4 tw:h-4 tw:shrink-0" alt="" />
          </template>
          {{ t("queryError.askAi") }}
        </OButton>
      </div>
    </div>

    <!-- AI button when there's nothing to show in the detail panel -->
    <div
      v-else-if="aiEnabled && (isQueryError || errorCode === 0)"
      class="tw:flex tw:justify-center tw:mt-2"
    >
      <OButton
        variant="ghost"
        size="sm"
        icon-left="bolt"
        class="ai-hover-btn"
        data-test="query-error-ask-ai-btn"
        @click="emit('ask-ai')"
      >
        {{ t("queryError.askAi") }}
      </OButton>
    </div>

    <!-- Caller-supplied extra content (below everything) -->
    <slot name="extra" />
  </div>

  <!-- ── BLOCK layout (dashboard panels, alerts) ───────────────────────── -->
  <div
    v-else
    class="tw:w-full tw:flex tw:flex-col tw:gap-3 tw:p-4"
    data-test="query-error-state"
  >
    <!-- Title row -->
    <div class="tw:flex tw:items-start tw:gap-2">
      <OIcon
        name="error-outline"
        size="sm"
        class="tw:text-status-error tw:shrink-0 tw:mt-0.5"
      />
      <div class="tw:flex tw:flex-col tw:gap-0.5 tw:min-w-0">
        <p class="tw:text-sm tw:font-semibold tw:text-text-body tw:m-0">
          {{ resolvedTitle }}
        </p>
        <p
          v-if="summaryLine"
          class="tw:text-xs tw:text-text-secondary tw:m-0 tw:break-words"
          data-test="query-error-summary"
        >
          {{ summaryLine }}
        </p>
      </div>
    </div>

    <!-- Expandable detail -->
    <template v-if="hasDetail">
      <button
        type="button"
        class="tw:flex tw:items-center tw:gap-1 tw:text-xs tw:text-text-secondary tw:cursor-pointer tw:bg-transparent tw:border-0 tw:p-0 tw:self-start tw:hover:text-text-body tw:transition-colors"
        data-test="query-error-toggle-detail-btn"
        @click="showDetail = !showDetail"
      >
        <OIcon :name="showDetail ? 'expand-less' : 'expand-more'" size="xs" />
        {{ showDetail ? t("queryError.hideDetail") : t("queryError.showDetail") }}
      </button>
      <div
        v-if="showDetail"
        class="tw:rounded tw:bg-surface-panel tw:border tw:border-border-default tw:px-3 tw:py-2 tw:max-h-40 tw:overflow-y-auto"
        data-test="query-error-detail-expanded"
      >
        <p
          class="tw:text-xs tw:font-mono tw:text-text-secondary tw:m-0 tw:whitespace-pre-wrap tw:break-all"
        >
          {{ detailBody }}
        </p>
      </div>
    </template>

    <!-- Trace ID (block) -->
    <small v-if="traceId" class="tw:text-text-caption" data-test="query-error-trace-id">
      <span class="tw:font-medium">{{ t("queryError.traceId") }}</span>
      {{ traceId }}
    </small>

    <!-- Action row (block) -->
    <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
      <!-- Default slot for module-specific actions -->
      <slot name="actions" v-bind="slotProps">
        <OButton
          v-if="errorCode === 20003"
          variant="outline"
          size="sm"
          icon-left="settings"
          data-test="query-error-configure-resource-btn"
          @click="emit('configure-resource')"
        >
          {{ t("queryError.configureResource") }}
        </OButton>
        <OButton
          v-else-if="isQueryError"
          variant="outline"
          size="sm"
          icon-left="edit"
          data-test="query-error-fix-query-btn"
          @click="emit('fix-query')"
        >
          {{ t("queryError.fixQuery") }}
        </OButton>
        <OButton
          v-else-if="errorCode === 20006"
          variant="outline"
          size="sm"
          icon-left="schedule"
          data-test="query-error-expand-range-btn"
          @click="emit('widen-range')"
        >
          {{ t("queryError.expandRange") }}
        </OButton>
      </slot>

      <OButton
        variant="ghost"
        size="sm"
        :icon-left="copied ? 'check' : 'content-copy'"
        data-test="query-error-copy-btn"
        @click="handleCopy"
      >
        {{ copied ? t("queryError.copied") : t("queryError.copyError") }}
      </OButton>
      <OButton
        v-if="aiEnabled && (isQueryError || errorCode === 0)"
        variant="ghost"
        size="sm"
        icon-left="bolt"
        class="ai-hover-btn"
        data-test="query-error-ask-ai-btn"
        @click="emit('ask-ai')"
      >
        {{ t("queryError.askAi") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAiIcon } from "@/composables/useAiIcon";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations/index";
import { useQueryError } from "@/composables/useQueryError";
import ErrorDetailPanel from "./ErrorDetailPanel.vue";

// ── Props ──────────────────────────────────────────────────────────────────

const props = withDefaults(
  defineProps<{
    /** Backend error code (0 = generic/unknown). */
    errorCode?: number | string;
    /** Raw error message from backend. May contain HTML and embedded TraceID. */
    errorMsg?: string;
    /** Raw SQL parse position or DataFusion execution detail. */
    errorDetail?: string;
    /** Show the "Ask AI" ghost button (enterprise + ai_enabled). */
    aiEnabled?: boolean;
    /** Resource name (stream, metric) for the 20003 configure CTA. */
    resourceName?: string;
    /**
     * hero  — full-page layout: illustration + action cards + detail panel.
     * block — compact inline layout for panels, cards, and form results.
     */
    size?: "hero" | "block";
    /** Override the default "broken-panel" illustration (hero size only). */
    illustration?: IllustrationName;
    /** Override the error code's default title. */
    title?: string;
    /** Override the error code's default description. */
    description?: string;
  }>(),
  { size: "hero", aiEnabled: false },
);

// ── Emits ──────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  /** User clicked "Ask AI to fix my query". */
  "ask-ai": [];
  /** User clicked "Fix the query" — parent should focus the editor. */
  "fix-query": [];
  /** User clicked "Configure resource" (FTS error 20003). */
  "configure-resource": [];
  /** User clicked "Try a different time range". */
  "widen-range": [];
}>();

// ── Error parsing ──────────────────────────────────────────────────────────

const {
  errorCode,
  traceId,
  summaryLine,
  detailBody,
  hasDetail,
  hasAnyContent,
  isQueryError,
  defaultTitle,
  defaultDescription,
  showDetail,
  copyErrorDetails,
} = useQueryError({
  errorCode: () => props.errorCode,
  errorMsg: () => props.errorMsg,
  errorDetail: () => props.errorDetail,
});

// ── Resolved copy ──────────────────────────────────────────────────────────

const { t } = useI18n();
const resolvedTitle = computed(() => props.title ?? defaultTitle.value);
const resolvedDescription = computed(
  () => props.description ?? defaultDescription.value,
);

// ── Copy feedback — show "Copied!" for 2 s after the user clicks ───────────

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

const handleCopy = () => {
  copyErrorDetails();
  copied.value = true;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copied.value = false;
    copyTimer = null;
  }, 2000);
};

// ── Slot binding (passed to #actions slot so callers can read state) ───────

const slotProps = computed(() => ({
  errorCode: errorCode.value,
  isQueryError: isQueryError.value,
  emit,
}));

const { aiIconSrc } = useAiIcon();
</script>
