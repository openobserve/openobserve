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

  The verdict card says what the agent concluded; this is the working behind
  it, and the only thing that makes the conclusion checkable. Renders nothing
  until a report exists — a deployment with no agent must not grow an empty
  panel that reads as a broken one.
-->

<template>
  <OCard v-if="loading || report" variant="glass" data-test="oncall-report-card">
    <OCardSection role="header" dense class="flex-wrap">
      <OText variant="card-title">{{ t("oncall.reportTitle") }}</OText>
      <span v-if="report" class="text-text-secondary text-xs">
        <template v-if="report.model">{{ raw(report.model) }} · </template>
        <OTimeCell :value="report.generated_at" unit="us" />
      </span>
    </OCardSection>

    <OCardSection role="body" dense>
      <div v-if="loading" class="flex flex-col gap-2" data-test="oncall-report-loading">
        <OSkeleton type="text" class="h-4 w-1/2" />
        <OSkeleton type="text" class="h-4 w-5/6" />
        <OSkeleton type="text" class="h-4 w-2/3" />
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify below -->
      <div v-else class="report-body text-text-body text-sm" v-html="rendered"></div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OnCallResponseReport } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{ report: OnCallResponseReport | null; loading?: boolean }>();

const { t } = useI18nTyped();

// The same tag set the incident drawer allows, so one report reads the same
// whichever subject carried it.
const ALLOWED_TAGS =
  "h1 h2 h3 h4 p ul ol li strong em code pre table thead tbody tr th td blockquote hr div span".split(
    " ",
  );

const rendered = computed(() => {
  const body = props.report?.report;
  if (!body) return "";
  // The verdict block is machine input that the card above already renders as
  // a sentence; showing the raw JSON again would bury the report's own prose.
  const prose = body.replace(/```json\s+verdict[\s\S]*?```/g, "").trim();
  return DOMPurify.sanitize(marked.parse(prose, { async: false }) as string, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["id"],
    KEEP_CONTENT: true,
  });
});
</script>

<style scoped lang="scss">
/* The agent writes markdown, so the rendered tags need spacing the card does
   not give them. `:deep()` is required: v-html children never receive the
   scope id. Tokens, not @apply — utilities do not resolve inside a scoped
   SFC style block under Tailwind v4. */
.report-body {
  /* A report is prose. Past ~70 characters a line is measurably harder to
     scan, and this is read at 3am. */
  max-width: 68ch;

  /* Capped at the screen's own 14px ceiling: a heading ramp taller than the
     page title reads as a different application embedded in the card. */
  :deep(h1) {
    font-size: 1rem;
  }
  :deep(h2) {
    font-size: 0.9375rem;
  }
  :deep(h3),
  :deep(h4) {
    font-size: 0.875rem;
  }
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    color: var(--color-text-heading);
    font-weight: 600;
    line-height: 1.4;
  }
  /* A section break and a subsection break must not look the same. */
  :deep(h1),
  :deep(h2) {
    margin: 2rem 0 0.5rem;
  }
  :deep(h3),
  :deep(h4) {
    margin: 1rem 0 0.25rem;
  }
  :deep(> :first-child) {
    margin-top: 0;
  }
  :deep(p),
  :deep(ul),
  :deep(ol),
  :deep(table),
  :deep(pre) {
    margin-bottom: 0.5rem;
  }
  :deep(ul),
  :deep(ol) {
    padding-left: 1.25rem;
    list-style-position: outside;
  }
  :deep(ul) {
    list-style-type: disc;
  }
  :deep(ol) {
    list-style-type: decimal;
  }
  :deep(code) {
    background: var(--color-surface-subtle);
    border-radius: 0.25rem;
    padding: 0 0.25rem;
    font-size: 0.75rem;
  }
  :deep(pre) {
    background: var(--color-surface-subtle);
    border-radius: 0.25rem;
    padding: 0.5rem;
    overflow-x: auto;
    font-size: 0.75rem;
  }
  /* Inline padding on the first line of a block indents it past the rest, and
     the chip background doubles up on the block's own. */
  :deep(pre code) {
    background: none;
    border-radius: 0;
    padding: 0;
  }
  :deep(table) {
    width: 100%;
    font-size: 0.75rem;
  }
  :deep(th),
  :deep(td) {
    /* `subtle` is ~1.07:1 on the card in light mode — the rule vanishes. */
    border-bottom: 1px solid var(--color-border-default);
    padding: 0.25rem 0.75rem 0.25rem 0;
    text-align: left;
  }
  :deep(blockquote) {
    border-left: 2px solid var(--color-border-default);
    padding-left: 0.75rem;
    color: var(--color-text-secondary);
  }
}
</style>
