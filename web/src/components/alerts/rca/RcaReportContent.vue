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

<!-- A rendered RCA report (sanitized HTML from `renderRcaReport` or an equally
     escaped caller) with the shared `.rca-report-content` styles. -->
<template>
  <div
    data-test="rca-report-content"
    class="rca-content text-sm whitespace-pre-wrap"
    :class="{ 'rca-content--dark': isDarkMode }"
    v-html="html"
  />
</template>

<script setup lang="ts">
defineProps<{
  /** Sanitized report HTML wrapped in `.rca-report-content`. */
  html: string;
  isDarkMode: boolean;
}>();
</script>

<style scoped>
/* keep(generated-content): the RCA report is markdown rendered through
   `v-html="html"` above — the .rca-report-content wrapper and all
   of its children are built and sanitized as an HTML string by renderRcaReport in
   utils/incidents/rcaReportMarkdown.ts, so there is no template to hang Tailwind utilities on. This
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

/* Dark mode comes from the `isDarkMode` prop: the class sits on this component's
   root, which carries the scope id, so it compiles to
   `.rca-content--dark[data-v] .rca-report-content`. */
.rca-content--dark :deep(.rca-report-content) {
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
      content: "»";
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
    /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
    border: 1px solid var(--rca-border-secondary);

    thead {
      background: linear-gradient(
        to bottom,
        var(--rca-bg-secondary) 0%,
        var(--rca-bg-secondary) 100%
      );
      border-bottom: 0.125rem solid var(--rca-border-primary);
    }

    th {
      padding: 0.5rem 0.75rem;
      color: var(--rca-text-primary);
      font-weight: 700;
      font-size: var(--text-3xs);
      letter-spacing: 0.08em;
      text-align: left;
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
      border-right: 1px solid var(--rca-border-secondary);

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 0.5rem 0.75rem;
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
      border-bottom: 1px solid var(--rca-border-table);
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
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

  /* Emphasis, not a link: same colour as the prose around it. */
  strong {
    color: var(--rca-text-secondary);
  }

  em {
    color: var(--rca-text-em);
  }

  p {
    color: var(--rca-text-secondary);
  }
}
</style>
