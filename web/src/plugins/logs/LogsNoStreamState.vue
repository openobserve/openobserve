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
  LogsNoStreamState — shown when no stream has been selected yet.
  Displays two action cards (Select a stream / Read the query guide)
  and a recent-streams chip row loaded from localStorage.
-->
<template>
  <OEmptyState illustration="explorer" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noStream.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Select a stream card — wider than default EmptyStateActionCard -->
      <button
        type="button"
        class="ns-card"
        data-test="logs-no-stream-select-stream-card"
        @click="emit('select-stream')"
      >
        <span class="ns-card__icon">
          <OIcon name="storage" size="md" />
        </span>
        <span class="ns-card__body">
          <span class="ns-card__label">{{ t("logs.noStream.selectStream") }}</span>
          <span class="ns-card__sublabel">{{ t("logs.noStream.selectStreamDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="ns-card__chevron" />
      </button>

      <!-- Read the query guide card -->
      <a
        class="ns-card"
        href="https://openobserve.ai/docs/example-queries/"
        target="_blank"
        rel="noopener noreferrer"
        data-test="logs-no-stream-query-guide-card"
        @click.prevent="openQueryGuide"
      >
        <span class="ns-card__icon">
          <OIcon name="menu-book" size="md" />
        </span>
        <span class="ns-card__body">
          <span class="ns-card__label">{{ t("logs.noStream.queryGuide") }}</span>
          <span class="ns-card__sublabel">{{ t("logs.noStream.queryGuideDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="ns-card__chevron" />
      </a>
    </template>

    <template v-if="recentStreams.length" #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary">
          {{ t("logs.noStream.recent") }}
        </span>
        <button
          v-for="stream in recentStreams"
          :key="stream"
          type="button"
          class="ns-chip"
          :data-test="`logs-no-stream-recent-${stream}`"
          @click="emit('pick-stream', stream)"
        >
          <OIcon name="storage" size="xs" class="tw:shrink-0" />
          <span class="tw:truncate tw:max-w-[10rem]">{{ stream }}</span>
        </button>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { restoreLogsStream } from "@/utils/streamPersist";

const props = defineProps<{
  /** Org identifier — used to look up recently used streams from localStorage. */
  orgId: string;
}>();

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18n();

// Show up to 3 recently used streams (deduplicated, most recent first).
const recentStreams = computed<string[]>(() => {
  if (!props.orgId) return [];
  return restoreLogsStream(props.orgId).slice(0, 3);
});

// Uses v-html — content is fully i18n-controlled, no user input.
const description = computed(() => t("logs.noStream.description"));

const openQueryGuide = () => {
  window.open("https://openobserve.ai/docs/example-queries/", "_blank", "noopener,noreferrer");
};
</script>

<style scoped>
/* Action cards — wider than the default EmptyStateActionCard (w-64)
   so they fill a comfortable reading width at hero scale. */
.ns-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 20rem;
  max-width: 100%;
  min-height: 4rem;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-base);
  box-shadow: var(--shadow-sm);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: color 150ms, background-color 150ms, border-color 150ms,
    box-shadow 150ms, transform 150ms;
  outline: none;
}
.ns-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.ns-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.ns-card__icon {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  background: var(--color-tabs-active-bg);
  color: var(--color-tabs-active-text);
  transition: background-color 150ms, color 150ms;
}
.ns-card:hover .ns-card__icon {
  background: var(--color-primary-600);
  color: #fff;
}

.ns-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.ns-card__label {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ns-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}


.ns-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.ns-card:hover .ns-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

/* Recent stream chips */
.ns-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.25rem 0.625rem;
  font-size: var(--text-sm);
  font-style: italic;
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-panel);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: border-color 150ms, color 150ms, background-color 150ms;
  outline: none;
}
.ns-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.ns-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
