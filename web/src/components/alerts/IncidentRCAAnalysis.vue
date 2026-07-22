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

<template>
  <div data-test="rca-analysis-container" class="flex flex-col flex-1 overflow-hidden">
    <!-- Persistent failure state. Rendered above any existing report so a failed
         reanalysis is visible without hiding the previous result. -->
    <OBanner
      v-if="rcaError && !isRunning"
      data-test="rca-error-banner"
      variant="error"
      icon="error-outline"
      class="mb-2 flex-shrink-0"
    >
      <p class="font-medium mb-0">{{ t('alerts.incidents.rcaFailed') }}</p>
      <p data-test="rca-error-reason" class="text-xs mt-0.5 mb-0 opacity-90">
        {{ rcaError.reason }}
      </p>
      <p
        v-if="rcaError.details"
        data-test="rca-error-details"
        class="text-xs mt-1 mb-0 opacity-70 break-words"
      >
        {{ rcaError.details }}
      </p>
      <template #actions>
        <OButton
          data-test="rca-retry-btn"
          variant="outline"
          size="sm"
          @click="$emit('trigger-rca')"
        >
          <OIcon name="refresh" size="sm" class="mr-1" />
          {{ t('alerts.incidents.rcaRetry') }}
        </OButton>
      </template>
    </OBanner>

    <!-- Trigger button when nothing has run, nothing is running, and nothing failed -->
    <div
      v-if="!hasExistingRca && !isRunning && !rcaError"
      data-test="rca-trigger-section"
      class="mb-2 flex-shrink-0"
    >
      <OButton
        data-test="trigger-rca-btn"
        variant="outline"
        size="sm"
        @click="$emit('trigger-rca')"
      >
        {{ t('alerts.incidents.rcaAnalyzeIncident') }}
      </OButton>
    </div>

    <!-- Analysis in progress: both background (in-flight) and user-triggered (rcaLoading) -->
    <OBanner
      v-if="isRunning"
      data-test="rca-inflight-container"
      :variant="analysisIsStale ? 'warning' : 'info'"
      inline-actions
      class="mb-2 flex-shrink-0"
    >
      <template #icon>
        <OSpinner v-if="!analysisIsStale" variant="dots" size="xs" />
        <OIcon v-else name="warning" size="sm" />
      </template>

      <div class="flex items-center gap-2">
        <p data-test="rca-inflight-message" class="text-sm font-medium mb-0">
          {{ hasExistingRca ? t('alerts.incidents.rcaReanalyzing') : t('alerts.incidents.rcaAnalyzing') }}
        </p>
        <span
          v-if="analysisElapsedLabel"
          data-test="rca-elapsed"
          class="text-xs opacity-70 whitespace-nowrap"
        >
          {{ t('alerts.incidents.rcaStartedAgo', { time: analysisElapsedLabel }) }}
        </span>
      </div>
      <p class="text-xs mt-0.5 mb-0 opacity-70">
        {{
          analysisIsStale
            ? t('alerts.incidents.rcaStale')
            : hasExistingRca
              ? t('alerts.incidents.rcaReanalyzingHint')
              : t('alerts.incidents.rcaAnalyzingHint')
        }}
      </p>

      <template #actions>
        <OButton
          data-test="rca-cancel-btn"
          variant="outline"
          size="sm"
          :disabled="rcaCancelling"
          @click="$emit('cancel-rca')"
        >
          {{ rcaCancelling ? t('alerts.incidents.rcaCancelling') : t('alerts.incidents.rcaCancel') }}
        </OButton>
      </template>
    </OBanner>

    <!-- Report toolbar: when it ran, which version, and what you can do with it.
         Only meaningful once a report exists and nothing is streaming over it. -->
    <div
      v-if="hasExistingRca && !(rcaLoading && rcaStreamContent)"
      data-test="rca-toolbar"
      class="flex items-center gap-2 flex-wrap mb-2 flex-shrink-0"
    >
      <span
        v-if="analyzedAgoLabel"
        data-test="rca-analyzed-ago"
        class="text-xs text-text-secondary"
      >
        {{ t('alerts.incidents.rcaAnalyzedAgo', { time: analyzedAgoLabel }) }}
      </span>

      <!-- Version picker, shown only when there is history to pick from -->
      <ODropdown v-if="rcaHistory.length" align="start">
        <template #trigger>
          <OButton data-test="rca-history-btn" variant="ghost-muted" size="sm">
            <OIcon name="history" size="sm" class="mr-1" />
            {{ t('alerts.incidents.rcaHistory') }}
            <OIcon name="keyboard-arrow-down" size="xs" class="ml-1" />
          </OButton>
        </template>

        <ODropdownItem
          data-test="rca-history-current"
          :disabled="viewingArchivedIndex === null"
          @select="$emit('view-report', null)"
        >
          {{ t('alerts.incidents.rcaHistoryCurrent') }}
        </ODropdownItem>
        <ODropdownItem
          v-for="(report, idx) in rcaHistory"
          :key="report.archived_at"
          :data-test="`rca-history-item-${idx}`"
          :disabled="viewingArchivedIndex === idx"
          @select="$emit('view-report', idx)"
        >
          {{ formatArchivedAt(report.archived_at) }}
        </ODropdownItem>
      </ODropdown>

      <div class="flex-1" />

      <OButton
        data-test="rca-copy-btn"
        variant="ghost-muted"
        size="sm"
        @click="$emit('copy-report')"
      >
        <OIcon name="content-copy" size="sm" class="mr-1" />
        {{ t('alerts.incidents.rcaCopy') }}
      </OButton>
      <OButton
        data-test="rca-download-btn"
        variant="ghost-muted"
        size="sm"
        @click="$emit('download-report')"
      >
        <OIcon name="download" size="sm" class="mr-1" />
        {{ t('alerts.incidents.rcaDownload') }}
      </OButton>

      <!-- Re-run. Fresh is the default; continuity is the deliberate choice. -->
      <ODropdown v-if="!isRunning" align="end">
        <template #trigger>
          <OButton data-test="rca-reanalyze-btn" variant="outline" size="sm">
            <OIcon name="refresh" size="sm" class="mr-1" />
            {{ t('alerts.incidents.rcaReanalyze') }}
            <OIcon name="keyboard-arrow-down" size="xs" class="ml-1" />
          </OButton>
        </template>

        <ODropdownItem
          data-test="rca-reanalyze-fresh"
          @select="$emit('trigger-rca', { buildOnPrevious: false })"
        >
          <span class="flex flex-col">
            <span>{{ t('alerts.incidents.rcaFreshAnalysis') }}</span>
            <span class="text-xs text-text-secondary">
              {{ t('alerts.incidents.rcaFreshAnalysisHint') }}
            </span>
          </span>
        </ODropdownItem>
        <ODropdownItem
          data-test="rca-reanalyze-build"
          @select="$emit('trigger-rca', { buildOnPrevious: true })"
        >
          <span class="flex flex-col">
            <span>{{ t('alerts.incidents.rcaBuildOnPrevious') }}</span>
            <span class="text-xs text-text-secondary">
              {{ t('alerts.incidents.rcaBuildOnPreviousHint') }}
            </span>
          </span>
        </ODropdownItem>
      </ODropdown>
    </div>

    <!-- Viewing an archived report: make it unmistakable this is not current -->
    <OBanner
      v-if="viewingArchivedIndex !== null"
      data-test="rca-archived-banner"
      variant="warning"
      icon="history"
      dense
      inline-actions
      class="mb-2 flex-shrink-0"
    >
      {{ t('alerts.incidents.rcaViewingArchived') }}
      <template #actions>
        <OButton
          data-test="rca-back-to-current-btn"
          variant="outline"
          size="sm"
          @click="$emit('view-report', null)"
        >
          {{ t('alerts.incidents.rcaBackToCurrent') }}
        </OButton>
      </template>
    </OBanner>

    <!-- Streaming content while loading -->
    <div
      v-if="rcaLoading && rcaStreamContent"
      data-test="rca-stream-container"
      class="rca-container rounded-default p-3 flex-1 overflow-auto border bg-surface-base border-border-default"
    >
      <div
        data-test="rca-stream-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>

    <!-- Existing analysis content. Kept mounted while a reanalysis runs so the previous
         report stays readable instead of blanking for the duration of the request. -->
    <div
      v-else-if="hasExistingRca"
      data-test="rca-existing-container"
      class="rca-container rounded-default p-3 flex-1 overflow-auto border bg-surface-base border-border-default"
    >
      <div
        data-test="rca-existing-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import DOMPurify from "dompurify";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { ArchivedRcaReport } from "@/services/incidents";

interface RcaError {
  reason: string;
  details: string;
}

/** Compact "3m" / "2h 5m" / "4d" elapsed label from a millisecond delta. */
function humanizeElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export default defineComponent({
  name: "IncidentRCAAnalysis",
  components: { OBanner, OButton, ODropdown, ODropdownItem, OIcon, OSpinner },
  props: {
    hasExistingRca: {
      type: Boolean,
      required: true,
    },
    rcaLoading: {
      type: Boolean,
      required: true,
    },
    rcaStreamContent: {
      type: String,
      default: "",
    },
    formattedRcaContent: {
      type: String,
      default: "",
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
    analysisInFlight: {
      type: Boolean,
      default: false,
    },
    /** Last terminal failure, or null when the most recent run did not fail. */
    rcaError: {
      type: Object as () => RcaError | null,
      default: null,
    },
    rcaCancelling: {
      type: Boolean,
      default: false,
    },
    /** Preformatted elapsed time for the running analysis, e.g. "4m". */
    analysisElapsedLabel: {
      type: String,
      default: "",
    },
    /** True once a run outlives the server's staleness window and is likely dead. */
    analysisIsStale: {
      type: Boolean,
      default: false,
    },
    /** Superseded reports for this incident, newest first. */
    rcaHistory: {
      type: Array as () => ArchivedRcaReport[],
      default: () => [],
    },
    /** Index into rcaHistory being viewed, or null when showing the current report. */
    viewingArchivedIndex: {
      type: Number as () => number | null,
      default: null,
    },
    /** Epoch micros the current report was produced, for the "Analyzed X ago" label. */
    analyzedAt: {
      type: Number as () => number | null,
      default: null,
    },
  },
  emits: ["trigger-rca", "cancel-rca", "view-report", "copy-report", "download-report"],
  setup(props) {
    const { t } = useI18n();

    // A run is active whether it was started here (rcaLoading) or in the background
    // (analysisInFlight); both render the same banner and both are cancellable.
    const isRunning = computed(() => props.analysisInFlight || props.rcaLoading);

    const analyzedAgoLabel = computed(() => {
      if (!props.analyzedAt) return "";
      // Timestamps arrive as microseconds since epoch.
      const elapsed = Date.now() - props.analyzedAt / 1000;
      return elapsed < 0 ? "" : humanizeElapsed(elapsed);
    });

    const formatArchivedAt = (micros: number): string =>
      new Date(micros / 1000).toLocaleString();

    const sanitize = (html: string): string => DOMPurify.sanitize(html);

    return { t, isRunning, analyzedAgoLabel, formatArchivedAt, sanitize };
  },
});
</script>

<style lang="scss" scoped>
/* keep(generated-content): the RCA report is markdown rendered through
   `v-html="sanitize(formattedRcaContent)"` above — the .rca-report-content wrapper
   and all of its children are built as an HTML string in IncidentDetailDrawer.vue
   (formatRcaContent), so there is no template to hang Tailwind utilities on. This
   is ladder step 5 of O2_STYLE_MIGRATION_PLAN.md §3.1.

   Moved out of the token layer (W1.a, F9), tokenised in W2.c. `:deep()` is required
   and deliberate: v-html children never receive the scope id, so a plain scoped
   selector would not match them. The private --rca-* vocabulary now aliases global
   tokens; entries whose token already flips in dark mode carry no dark override.
   Judgment mappings (near-identical values, flagged for the §7.4 eyeball pass):
   slate text → neutral text tokens; inline-code pink (rose-700) → status-error-text. */
:deep(.rca-report-content) {
  --rca-bg-primary: var(--color-blue-50);
  --rca-bg-secondary: var(--color-blue-50);
  --rca-bg-code: var(--color-surface-subtle);
  --rca-bg-table-even: var(--color-blue-50);
  --rca-bg-table-hover: var(--color-blue-100);
  --rca-bg-section: color-mix(in srgb, var(--color-blue-600) 5%, transparent);
  --rca-bg-blockquote: var(--color-blue-50);

  --rca-text-primary: var(--color-text-heading);
  --rca-text-secondary: var(--color-text-body);
  --rca-text-tertiary: var(--color-text-secondary);
  --rca-text-heading: var(--color-blue-600);
  --rca-text-code: var(--color-status-error-text);
  --rca-text-blockquote: var(--color-blue-800);
  --rca-text-strong: var(--color-blue-800);
  --rca-text-em: var(--color-text-secondary);
  --rca-text-list: var(--color-text-body);

  --rca-border-primary: var(--color-border-strong);
  --rca-border-secondary: var(--color-blue-200);
  --rca-border-tertiary: var(--color-border-default);
  --rca-border-table: var(--color-blue-200);
  --rca-border-accent: var(--color-blue-500);

  --rca-icon-color: var(--color-text-body);
  --rca-shadow: var(--shadow-md);

  font-family: var(--font-sans);
  line-height: 1.6;
  color: var(--rca-text-secondary);
}

/* `.dark` lives on <html>, which never carries this component's scope id, so
   `.dark :deep(.rca-report-content)` would compile to `.dark[data-v] .rca-report-content`
   and never match — dark mode would silently fall back to the light blue-50 washes.
   Anchoring on `.rca-content` (a real element in this template, and a descendant of
   html.dark) puts the scope id where it belongs: `.dark .rca-content[data-v] .rca-report-content`. */
.dark .rca-content :deep(.rca-report-content) {
  /* Only the entries whose dark value differs from what the aliased token flips
     to on its own: the info-blue washes go neutral/deep-blue, accents brighten. */
  --rca-bg-primary: var(--color-surface-panel);
  --rca-bg-secondary: var(--color-surface-subtle);
  --rca-bg-table-even: color-mix(in srgb, var(--color-blue-900) 35%, var(--color-surface-base));
  --rca-bg-table-hover: color-mix(in srgb, var(--color-blue-800) 30%, var(--color-surface-panel));
  --rca-bg-section: color-mix(in srgb, var(--color-blue-400) 8%, transparent);
  --rca-bg-blockquote: var(--color-blue-900);

  --rca-text-heading: var(--color-blue-400);
  --rca-text-blockquote: var(--color-blue-400);
  --rca-text-strong: var(--color-blue-400);

  --rca-border-secondary: var(--color-border-default);
  --rca-border-table: var(--color-border-default);
  --rca-border-accent: var(--color-blue-400);

  --rca-shadow: var(--shadow-lg);
}

:deep(.rca-report-content) {
  .rca-h1 {
    color: var(--rca-text-primary);
    border-bottom-color: var(--rca-border-primary);
  }

  .rca-h2 {
    color: var(--rca-text-heading);
    border-left-color: var(--rca-text-heading);
  }

  .rca-section-bg {
    background-color: var(--rca-bg-section);
  }

  .rca-h3 {
    color: var(--rca-text-secondary);
    position: relative;
    padding-left: 1rem;

    &::before {
      content: '»';
      position: absolute;
      left: 0rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--rca-icon-color);
      font-size: var(--text-xl);
      line-height: 1;
    }
  }

  .rca-h4 {
    color: var(--rca-text-tertiary);
  }

  .rca-ul,
  .rca-ol {
    list-style-position: outside;
  }

  .rca-ul {
    list-style-type: disc;
  }

  .rca-list-item {
    color: var(--rca-text-list);
  }

  .rca-ol-item {
    color: var(--rca-text-list);
  }

  .rca-code-block {
    background-color: var(--rca-bg-code);
    border-color: var(--rca-border-tertiary);

    pre {
      color: var(--rca-text-list);
    }
  }

  .rca-inline-code {
    background-color: var(--rca-bg-code);
    color: var(--rca-text-code);
  }

  .rca-table-wrapper {
    border-radius: var(--radius-surface);
    overflow: hidden;
    box-shadow: var(--rca-shadow);
  }

  .rca-table {
    border-collapse: separate;
    border-spacing: 0;
    background-color: var(--rca-bg-primary);
    border: 1px solid var(--rca-border-secondary);

    thead {
      background: linear-gradient(to bottom, var(--rca-bg-secondary) 0%, var(--rca-bg-secondary) 100%);
      border-bottom: 0.125rem solid var(--rca-border-primary);
    }

    th {
      padding: 0.5rem 0.75rem;
      color: var(--rca-text-primary);
      font-weight: 700;
      text-transform: uppercase;
      font-size: var(--text-3xs);
      letter-spacing: 0.08em;
      text-align: left;
      border-right: 1px solid var(--rca-border-secondary);

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--rca-border-table);
      border-right: 1px solid var(--rca-border-table);
      color: var(--rca-text-secondary);
      font-size: var(--text-compact);
      line-height: 1.6;
      vertical-align: top;

      &:last-child {
        border-right: none;
      }
    }

    tbody {
      tr {
        &:last-child td {
          border-bottom: none;
        }

        &:hover {
          background-color: var(--rca-bg-table-hover);
        }
      }
    }

    td:first-child,
    td.rca-first-cell {
      font-weight: 600;
      color: var(--rca-text-tertiary);
      white-space: nowrap;
      background-color: var(--rca-bg-secondary);
      min-width: 10rem;
    }

    tbody tr:hover td:first-child,
    tbody tr:hover td.rca-first-cell {
      background-color: var(--rca-bg-table-hover);
    }
  }

  .rca-blockquote {
    background-color: var(--rca-bg-blockquote);
    border-left-color: var(--rca-border-accent);
    color: var(--rca-text-blockquote);
  }

  hr {
    border-top-color: var(--rca-border-tertiary);
  }

  strong {
    color: var(--rca-text-strong);
  }

  em {
    color: var(--rca-text-em);
  }

  p {
    color: var(--rca-text-secondary);
  }
}
</style>
