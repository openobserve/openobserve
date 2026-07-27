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

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import useIngestion from "@/composables/useIngestion";
import { b64EncodeStandard } from "@/utils/zincutils";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { parseCard } from "./parseCard";
import { renderCardSegments, safeHttpUrl, type CardSubstitutions } from "./renderMarkdown";

const props = defineProps<{
  /** Raw `data-source-ui.md` content for this integration. */
  content: string;
  /** Optional documentation URL shown as a footer link. */
  docUrl?: string;
}>();

const store = useStore();
const { endpoint } = useIngestion();

// The {url}/{org}/{token} the snippets are substituted with. `token` is the
// base64 of email:password (the same value used for ingest tokens), WITHOUT the
// "Basic " prefix — the snippets add that themselves. Computed from the store so
// it stays correct if the org / credentials load asynchronously.
const subs = computed<CardSubstitutions>(() => {
  const email = store.state.userInfo?.email ?? "";
  const passcode = store.state.organizationData?.organizationPasscode ?? "";
  return {
    url: endpoint.value?.url ?? "",
    org: store.state.selectedOrganization?.identifier ?? "",
    token: b64EncodeStandard(`${email}:${passcode}`) ?? "",
  };
});

const parsed = computed(() => parseCard(props.content));
const metadata = computed(() => parsed.value.metadata);
const warnings = computed(() => parsed.value.warnings);

// Each section becomes an ordered list of segments: prose (sanitized HTML,
// rendered via v-html) and code blocks (rendered with <OCodeBlock>). Recomputes
// if the content or the substitution values change.
const renderedSections = computed(() =>
  parsed.value.sections.map((s) => ({
    title: s.title,
    segments: renderCardSegments(s.body, subs.value),
  })),
);
</script>

<template>
  <div class="o2-card min-w-0" data-test="ai-integration-card">
    <div class="o2-card-inner min-w-0">
      <!-- Header chrome -->
      <header class="mb-5">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="m-0 text-xl leading-tight font-semibold">
            {{ metadata.displayName }}
          </h2>
          <OTag v-if="metadata.category" type="integrationMeta" value="category">
            {{ metadata.category }}
          </OTag>
          <OTag v-if="metadata.runtime" type="integrationMeta" value="runtime">
            {{ metadata.runtime }}
          </OTag>
        </div>
        <p v-if="metadata.tagline" class="mt-1.5 mb-0 text-sm opacity-60">
          {{ metadata.tagline }}
        </p>
      </header>

      <!-- Callouts (e.g. codex "logs, not traces") -->
      <OBanner
        v-for="(w, i) in warnings"
        :key="`warn-${i}`"
        variant="warning"
        :content="w"
        class="mb-5"
      />

      <!-- Sections (all open — install guides read top to bottom) -->
      <section v-for="section in renderedSections" :key="section.title" class="o2-section min-w-0">
        <h3 class="o2-section-title">{{ section.title }}</h3>
        <template v-for="(seg, j) in section.segments" :key="j">
          <div
            v-if="seg.type === 'html'"
            class="o2-card-md prose prose-sm dark:prose-invert max-w-none min-w-0"
            v-html="seg.html"
          ></div>
          <OCodeBlock v-else :code="seg.code" :lang="seg.lang" data-test="ai-md-code" />
        </template>
      </section>

      <!-- Documentation link — identical markup to the legacy ingestion cards
           (AIIntegrationDetail.vue) so it looks the same across all sections. -->
      <div v-if="docUrl" class="pt-6 pb-2 font-bold">
        Click
        <a
          :href="safeHttpUrl(docUrl)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-text-link hover:text-text-link-hover"
          style="text-decoration: underline"
          >here</a
        >
        to check further documentation.
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
/* keep(generated-content): .o2-card-md wraps markdown rendered at runtime — the
   :deep(:not(pre) > code)::before/::after backtick strip and :deep(table) rules
   target nodes this template never writes, so they cannot be utilities. */
.o2-card {
  padding: 1.5rem 1.75rem;
}

.o2-card-inner {
  max-width: 61.25rem;
}

.o2-section {
  padding: 1.25rem 0;
  border-top: 1px solid var(--color-border-default);

  &:first-of-type {
    border-top: none;
    padding-top: 0.25rem;
  }
}

.o2-section-title {
  font-size: var(--text-base);
  font-weight: 600;
  margin: 0 0 0.5rem;
  letter-spacing: 0.01em;
}

/* keep long prose content inside the card so the page never scrolls sideways */
.o2-card-md {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Inline code: drop prose's backtick quotes, render a subtle chip */
.o2-card-md :deep(:not(pre) > code)::before,
.o2-card-md :deep(:not(pre) > code)::after {
  content: "" !important;
}

.o2-card-md :deep(:not(pre) > code) {
  background: var(--color-code-bg);
  padding: 0.1rem 0.35rem;
  border-radius: var(--radius-default);
  font-weight: 400;
}

/* Tables: keep inside the card */
.o2-card-md :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  font-size: var(--text-compact);
}
</style>
