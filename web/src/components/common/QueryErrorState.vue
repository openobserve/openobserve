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
  │  20014 Protected stream → Open Alert Calibration card                   │
  │  10001 Server error     → (informational)                               │
  │  0 / other              → (informational) + Ask AI (if aiEnabled)       │
  └─────────────────────────────────────────────────────────────────────────┘

  ┌─ Customisation ──────────────────────────────────────────────────────────┐
  │  Slot #actions  — override the default action cards entirely.           │
  │  Slot #extra    — append content below the detail panel (hero only).    │
  │                                                                         │
  │  Props title / description override the i18n defaults.                  │
  └─────────────────────────────────────────────────────────────────────────┘

  Usage examples:
    Logs / Traces / Metrics (full page):
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

    Dashboard panel (compact):
    <QueryErrorState
      :error-code="state.errorDetail.code"
      :error-msg="state.errorDetail.message"
      size="block"
    />

    Alert test query result:
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
    class="flex h-full w-full flex-col items-center overflow-y-auto pb-8"
    data-test="query-error-state"
  >
    <!-- Illustration + title + description + action cards -->
    <OEmptyState
      :kind="tone === 'error' ? 'denied' : 'error'"
      :title="resolvedTitle"
      :text="resolvedDescription"
      class="w-full shrink-0"
    >
      <template #actions>
        <!-- Caller can replace all actions via #actions slot -->
        <slot name="actions" v-bind="slotProps">
          <OButton
            v-if="showRunSuggestion"
            variant="primary"
            class="max-w-105"
            data-test="query-error-run-suggestion-card"
            @click="emit('run-suggestion', runSuggestionText)"
          >
            <OTruncatedText>{{
              t("queryError.runSuggestion", { query: runSuggestionText })
            }}</OTruncatedText>
          </OButton>
          <OButton
            v-else-if="showSearchText"
            variant="primary"
            class="max-w-105"
            data-test="query-error-search-text-card"
            @click="emit('search-text', searchTextFull)"
          >
            <OTruncatedText>{{
              t("queryError.searchTextFor", { text: searchTextFull })
            }}</OTruncatedText>
          </OButton>
          <OButton
            v-if="errorCode === 20003"
            :variant="fixVariant"
            data-test="query-error-configure-resource-card"
            @click="emit('configure-resource')"
          >
            {{ t("queryError.configureResource") }}
          </OButton>
          <OButton
            v-else-if="isQueryError"
            :variant="fixVariant"
            data-test="query-error-fix-query-card"
            @click="emit('fix-query')"
          >
            {{ t("queryError.fixQuery") }}
          </OButton>
          <OButton
            v-else-if="errorCode === 20006"
            :variant="fixVariant"
            data-test="query-error-expand-range-card"
            @click="emit('widen-range')"
          >
            {{ t("queryError.expandRange") }}
          </OButton>
          <OButton
            v-else-if="errorCode === 20014 && calibrationEnabled"
            :variant="fixVariant"
            icon-end="open-in-new"
            data-test="query-error-open-calibration-card"
            @click="openCalibration"
          >
            {{ t("queryError.openCalibration") }}
          </OButton>
        </slot>
      </template>
    </OEmptyState>

    <!-- Detail panel + buttons (outside OEmptyState — avoids its overflow:hidden) -->
    <div v-if="hasAnyContent" class="mx-auto flex w-full max-w-2xl flex-col gap-3 px-6">
      <ErrorDetailPanel
        :summary-line="explanation ? '' : summaryLine"
        :detail-body="detailBody"
        :has-detail="hasDetail"
        :trace-id="traceId"
        :show-detail="showDetail"
        @toggle-detail="showDetail = !showDetail"
      />

      <div class="flex flex-wrap items-center justify-center gap-2">
        <OButton
          variant="ghost"
          :icon="copied ? 'check' : 'content-copy'"
          data-test="query-error-copy-btn"
          @click="handleCopy"
        >
          {{ copied ? t("queryError.copied") : t("queryError.copyError") }}
        </OButton>
        <OButton
          v-if="aiEnabled && (isQueryError || errorCode === 0)"
          variant="ghost"
          class="group text-ai-accent! hover:shadow-ai-accent/35 dark:shadow-ai-accent/20 dark:hover:shadow-ai-accent/35 [background:var(--color-gradient-ai-subtle)]! [transition:background_var(--duration-control)_var(--ease-control),box-shadow_var(--duration-control)_var(--ease-control),color_var(--duration-control)_var(--ease-control)] hover:text-white! hover:shadow-md hover:[background:var(--color-gradient-ai)]! dark:text-white! dark:shadow-md dark:hover:shadow-md"
          data-test="query-error-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <template #icon>
            <img
              :src="aiIconSrc"
              class="h-4 w-4 shrink-0 group-hover:brightness-0 group-hover:invert group-hover:[transition:filter_var(--duration-control)_var(--ease-control)]"
              alt=""
            />
          </template>
          {{ t("queryError.askAi") }}
        </OButton>
      </div>
    </div>

    <!-- AI button when there's nothing to show in the detail panel -->
    <div
      v-else-if="aiEnabled && (isQueryError || errorCode === 0)"
      class="mt-2 flex justify-center"
    >
      <OButton
        variant="ghost"
        icon="bolt"
        class="text-ai-accent! hover:shadow-ai-accent/35 dark:shadow-ai-accent/20 dark:hover:shadow-ai-accent/35 [background:var(--color-gradient-ai-subtle)]! [transition:background_var(--duration-control)_var(--ease-control),box-shadow_var(--duration-control)_var(--ease-control),color_var(--duration-control)_var(--ease-control)] hover:text-white! hover:shadow-md hover:[background:var(--color-gradient-ai)]! dark:text-white! dark:shadow-md dark:hover:shadow-md"
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
  <div v-else class="flex w-full flex-col gap-3 p-4" data-test="query-error-state">
    <OEmptyState size="compact" kind="error" :title="resolvedTitle">
      <template v-if="explanation || summaryLine" #text>
        <span class="break-words" data-test="query-error-summary">{{
          explanation || summaryLine
        }}</span>
      </template>
    </OEmptyState>

    <!-- Expandable detail -->
    <template v-if="hasDetail">
      <button
        type="button"
        class="text-text-secondary hover:text-text-body flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-xs transition-colors"
        data-test="query-error-toggle-detail-btn"
        @click="showDetail = !showDetail"
      >
        <OIcon :name="showDetail ? 'expand-less' : 'expand-more'" size="xs" />
        {{ showDetail ? t("queryError.hideDetail") : t("queryError.showDetail") }}
      </button>
      <div
        v-if="showDetail"
        class="rounded-default bg-surface-panel border-border-default max-h-40 overflow-y-auto border px-3 py-2"
        data-test="query-error-detail-expanded"
      >
        <p class="text-text-secondary m-0 font-mono text-xs break-all whitespace-pre-wrap">
          {{ detailBody }}
        </p>
      </div>
    </template>

    <!-- Trace ID (block) -->
    <small v-if="traceId" class="text-text-secondary" data-test="query-error-trace-id">
      <span class="font-medium">{{ t("queryError.traceId") }}</span>
      {{ traceId }}
    </small>

    <!-- Action row (block) -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Default slot for module-specific actions -->
      <slot name="actions" v-bind="slotProps">
        <OButton
          v-if="errorCode === 20003"
          variant="secondary"
          size="sm"
          data-test="query-error-configure-resource-btn"
          @click="emit('configure-resource')"
        >
          {{ t("queryError.configureResource") }}
        </OButton>
        <OButton
          v-else-if="isQueryError"
          variant="secondary"
          size="sm"
          data-test="query-error-fix-query-btn"
          @click="emit('fix-query')"
        >
          {{ t("queryError.fixQuery") }}
        </OButton>
        <OButton
          v-else-if="errorCode === 20006"
          variant="secondary"
          size="sm"
          data-test="query-error-expand-range-btn"
          @click="emit('widen-range')"
        >
          {{ t("queryError.expandRange") }}
        </OButton>
      </slot>

      <OButton
        variant="ghost"
        size="sm"
        :icon="copied ? 'check' : 'content-copy'"
        data-test="query-error-copy-btn"
        @click="handleCopy"
      >
        {{ copied ? t("queryError.copied") : t("queryError.copyError") }}
      </OButton>
      <OButton
        v-if="aiEnabled && (isQueryError || errorCode === 0)"
        variant="ghost"
        size="sm"
        icon="bolt"
        class="text-ai-accent! hover:shadow-ai-accent/35 dark:shadow-ai-accent/20 dark:hover:shadow-ai-accent/35 [background:var(--color-gradient-ai-subtle)]! [transition:background_var(--duration-control)_var(--ease-control),box-shadow_var(--duration-control)_var(--ease-control),color_var(--duration-control)_var(--ease-control)] hover:text-white! hover:shadow-md hover:[background:var(--color-gradient-ai)]! dark:text-white! dark:shadow-md dark:hover:shadow-md"
        data-test="query-error-ask-ai-btn"
        @click="emit('ask-ai')"
      >
        {{ t("queryError.askAi") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { useAiIcon } from "@/composables/useAiIcon";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useQueryError } from "@/composables/useQueryError";
import { useOrgId } from "@/composables/query";
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
    /** Override the error code's default title. */
    title?: I18nText;
    /** Override the error code's default description. */
    description?: I18nText;
    freeTextCandidate?: string;
    runSuggestion?: string;
    /** The SQL the error was raised for, so the plain-language reading can name what is missing. */
    query?: string;
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
  "search-text": [text: string];
  "run-suggestion": [suggestion: string];
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
  explanation,
  tone,
  calibrationEnabled,
  showDetail,
  copyErrorDetails,
} = useQueryError({
  errorCode: () => props.errorCode,
  errorMsg: () => props.errorMsg,
  errorDetail: () => props.errorDetail,
  query: () => props.query,
  streamName: () => props.resourceName,
});

// ── Resolved copy ──────────────────────────────────────────────────────────

const { t } = useI18nTyped();
const resolvedTitle = computed(() => props.title ?? defaultTitle.value);
const resolvedDescription = computed(
  () => props.description ?? (explanation.value || defaultDescription.value),
);

const runSuggestionText = computed(() => props.runSuggestion?.trim() ?? "");
const showRunSuggestion = computed(() => isQueryError.value && runSuggestionText.value !== "");
const searchTextFull = computed(() => props.freeTextCandidate?.trim() ?? "");
const showSearchText = computed(
  () => isQueryError.value && searchTextFull.value !== "" && !showRunSuggestion.value,
);
// The quick fix leads when there is one; the error-code fix is then the secondary.
const fixVariant = computed(() =>
  showRunSuggestion.value || showSearchText.value ? "secondary" : "primary",
);

const router = useRouter();
const orgId = useOrgId();
const openCalibration = () =>
  router.push({ name: "alertCalibrationRuns", query: { org_identifier: orgId.value } });

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
