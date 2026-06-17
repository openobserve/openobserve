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
import OBadge from "@/lib/core/Badge/OBadge.vue";
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

const isDark = computed(() => store.state?.theme === "dark");

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
  <div class="o2-card tw:min-w-0" data-test="ai-integration-card">
    <div class="o2-card-inner tw:min-w-0">
      <!-- Header chrome -->
      <header class="tw:mb-5">
        <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
          <h2 class="tw:text-xl tw:font-semibold tw:m-0 tw:leading-tight">
            {{ metadata.displayName }}
          </h2>
          <OBadge v-if="metadata.category" variant="primary-soft" size="sm">
            {{ metadata.category }}
          </OBadge>
          <OBadge v-if="metadata.runtime" variant="default" size="sm">
            {{ metadata.runtime }}
          </OBadge>
        </div>
        <p
          v-if="metadata.tagline"
          class="tw:text-sm tw:opacity-60 tw:mt-1.5 tw:mb-0"
        >
          {{ metadata.tagline }}
        </p>
      </header>

      <!-- Callouts (e.g. codex "logs, not traces") -->
      <OBanner
        v-for="(w, i) in warnings"
        :key="`warn-${i}`"
        variant="warning"
        :content="w"
        class="tw:mb-5"
      />

      <!-- Sections (all open — install guides read top to bottom) -->
      <section
        v-for="section in renderedSections"
        :key="section.title"
        class="o2-section tw:min-w-0"
      >
        <h3 class="o2-section-title">{{ section.title }}</h3>
        <template v-for="(seg, j) in section.segments" :key="j">
          <div
            v-if="seg.type === 'html'"
            class="o2-card-md tw:prose tw:prose-sm tw:max-w-none tw:min-w-0"
            :class="{ 'tw:prose-invert': isDark }"
            v-html="seg.html"
          ></div>
          <OCodeBlock v-else :code="seg.code" :lang="seg.lang" data-test="ai-md-code" />
        </template>
      </section>

      <!-- Documentation link — identical markup to the legacy ingestion cards
           (AIIntegrationDetail.vue) so it looks the same across all sections. -->
      <div v-if="docUrl" class="tw:font-bold tw:pt-6 tw:pb-2">
        Click
        <a
          :href="safeHttpUrl(docUrl)"
          target="_blank"
          rel="noopener noreferrer"
          class="text-blue-500 hover:text-blue-600"
          style="text-decoration: underline"
          >here</a
        >
        to check further documentation.
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.o2-card {
  padding: 1.5rem 1.75rem;
}

.o2-card-inner {
  max-width: 980px;
}

.o2-section {
  padding: 1.25rem 0;
  border-top: 1px solid rgba(136, 136, 136, 0.18);

  &:first-of-type {
    border-top: none;
    padding-top: 0.25rem;
  }
}

.o2-section-title {
  font-size: 0.95rem;
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
  background: rgba(136, 136, 136, 0.16);
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  font-weight: 400;
}

/* Tables: keep inside the card */
.o2-card-md :deep(table) {
  display: block;
  width: 100%;
  overflow-x: auto;
  font-size: 0.8125rem;
}
</style>
