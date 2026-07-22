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
      class="flex items-center gap-3 rounded-default px-4 py-3 mb-2 flex-shrink-0 bg-status-info-bg border border-banner-info-border"
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
      class="rca-container rounded-default p-3 flex-1 overflow-auto border bg-surface-base border-border-default"
    >
      <div
        data-test="rca-stream-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>

    <!-- Existing analysis content -->
    <div v-else-if="hasExistingRca && !rcaLoading" data-test="rca-existing-container" class="rca-container rounded-default p-3 flex-1 overflow-auto border bg-surface-base border-border-default">
      <div
        data-test="rca-existing-content"
        class="text-sm whitespace-pre-wrap rca-content"
        v-html="sanitize(formattedRcaContent)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
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
