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
    <!-- Trigger button when no analysis exists and not loading and not in-flight -->
    <div v-if="!hasExistingRca && !rcaLoading && !analysisInFlight" data-test="rca-trigger-section" class="mb-2 flex-shrink-0">
      <OButton
        data-test="trigger-rca-btn"
        variant="outline"
        size="sm"
        :disabled="rcaLoading"
        @click="$emit('trigger-rca')"
      >
        Analyze Incident
      </OButton>
    </div>

    <!-- Analysis in progress: both background (in-flight) and user-triggered (rcaLoading) -->
    <div
      v-if="analysisInFlight || rcaLoading"
      data-test="rca-inflight-container"
      class="flex items-center gap-3 rounded-lg px-4 py-3 mb-2 flex-shrink-0 bg-status-info-bg border border-banner-info-border"
    >
      <OSpinner variant="dots" size="xs" />
      <div>
        <p
          class="text-sm font-medium mb-0 text-status-info-text"
        >
          {{ hasExistingRca ? 'AI SRE Agent is seeing what changed since the last analysis…' : 'AI SRE Agent is analyzing this incident, please wait…' }}
        </p>
        <p
          class="text-xs mt-0.5 mb-0 text-status-info-text opacity-70"
        >
          {{ hasExistingRca ? 'The report will be updated once the analysis is complete.' : 'The report will appear here once the analysis is complete.' }}
        </p>
      </div>
    </div>

    <!-- Streaming content while loading -->
    <div
      v-if="rcaLoading && rcaStreamContent"
      data-test="rca-stream-container"
      class="rca-container rounded-sm p-3 flex-1 overflow-auto border bg-surface-base border-border-default"
    >
      <div
        data-test="rca-stream-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>

    <!-- Existing analysis content -->
    <div v-else-if="hasExistingRca && !rcaLoading" data-test="rca-existing-container" class="rca-container rounded-sm p-3 flex-1 overflow-auto border bg-surface-base border-border-default">
      <div
        data-test="rca-existing-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import DOMPurify from "dompurify";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";

export default defineComponent({
  name: "IncidentRCAAnalysis",
  components: { OButton, OSpinner },
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
  },
  emits: ['trigger-rca'],
  methods: {
    sanitize(html: string): string {
      return DOMPurify.sanitize(html);
    },
  },
});
</script>

<style lang="scss" scoped>
/* keep(generated-content): the RCA report is markdown rendered through
   `v-html="sanitize(formattedRcaContent)"` above — the .rca-report-content wrapper
   and all of its children are built as an HTML string in IncidentDetailDrawer.vue
   (formatRcaContent), so there is no template to hang Tailwind utilities on. This
   is ladder step 5 of O2_STYLE_MIGRATION_PLAN.md §3.1.

   Moved verbatim out of the token layer (W1.a, F9). `:deep()` is required and
   deliberate: v-html children never receive the scope id, so a plain scoped
   selector would not match them. Values are UNCHANGED — the hex → --color-*
   tokenisation of the private --rca-* vocabulary belongs to W2.c, where the
   incident RCA report gets eyeballed in both themes (plan §7.4). */
:deep(.rca-report-content) {
  --rca-bg-primary: #eff6ff;
  --rca-bg-secondary: #eff6ff;
  --rca-bg-code: #f3f4f6;
  --rca-bg-table-even: #eff6ff;
  --rca-bg-table-hover: #dbeafe;
  --rca-bg-section: rgba(37, 99, 235, 0.05);
  --rca-bg-blockquote: #eff6ff;

  --rca-text-primary: #1e293b;
  --rca-text-secondary: #334155;
  --rca-text-tertiary: #475569;
  --rca-text-heading: #2563eb;
  --rca-text-code: #be185d;
  --rca-text-blockquote: #1e40af;
  --rca-text-strong: #1e40af;
  --rca-text-em: #475569;
  --rca-text-list: #1f2937;

  --rca-border-primary: #cbd5e1;
  --rca-border-secondary: #bfdbfe;
  --rca-border-tertiary: #d1d5db;
  --rca-border-table: #bfdbfe;
  --rca-border-accent: #3b82f6;

  --rca-icon-color: #334155;
  --rca-shadow: 0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06);

  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  line-height: 1.6;
  color: var(--rca-text-secondary);
}

.dark :deep(.rca-report-content) {
  --rca-bg-primary: #1f2937;
  --rca-bg-secondary: #1e293b;
  --rca-bg-code: #1f2937;
  --rca-bg-table-even: #1a2332;
  --rca-bg-table-hover: #2d3748;
  --rca-bg-section: rgba(96, 165, 250, 0.08);
  --rca-bg-blockquote: #1e3a5f;

  --rca-text-primary: #e5e7eb;
  --rca-text-secondary: #cbd5e1;
  --rca-text-tertiary: #94a3b8;
  --rca-text-heading: #67a6ff;
  --rca-text-code: #fda4af;
  --rca-text-blockquote: #67a6ff;
  --rca-text-strong: #639ced;
  --rca-text-em: #cbd5e1;
  --rca-text-list: #d1d5db;

  --rca-border-primary: #4b5563;
  --rca-border-secondary: #374151;
  --rca-border-tertiary: #374151;
  --rca-border-table: #334155;
  --rca-border-accent: #60a5fa;

  --rca-icon-color: #cbd5e1;
  --rca-shadow: 0 2px 8px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.3);
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
      font-size: 20px;
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
    border-radius: 8px;
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
      border-bottom: 2px solid var(--rca-border-primary);
    }

    th {
      padding: 8px 12px;
      color: var(--rca-text-primary);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.8px;
      text-align: left;
      border-right: 1px solid var(--rca-border-secondary);

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--rca-border-table);
      border-right: 1px solid var(--rca-border-table);
      color: var(--rca-text-secondary);
      font-size: 13px;
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
      min-width: 160px;
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
