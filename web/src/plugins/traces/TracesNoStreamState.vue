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
  TracesNoStreamState — shown when no trace stream has been selected yet.
  Mirrors the LogsNoStreamState pattern: explorer illustration, two action cards,
  and a recent-stream chip loaded from localStorage.
-->
<template>
  <OEmptyState illustration="explorer" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noStream.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Select a stream -->
      <button
        type="button"
        class="tns-card"
        data-test="traces-no-stream-select-stream-card"
        @click="emit('select-stream')"
      >
        <span class="tns-card__icon">
          <OIcon name="account-tree" size="md" />
        </span>
        <span class="tns-card__body">
          <span class="tns-card__label">{{ t("traces.noStream.selectStream") }}</span>
          <span class="tns-card__sublabel">{{ t("traces.noStream.selectStreamDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="tns-card__chevron" />
      </button>

      <!-- Read the query guide -->
      <a
        class="tns-card"
        href="https://openobserve.ai/docs/features/distributed-tracing/#overview"
        target="_blank"
        rel="noopener noreferrer"
        data-test="traces-no-stream-query-guide-card"
        @click.prevent="openGuide"
      >
        <span class="tns-card__icon tns-card__icon--teal">
          <OIcon name="menu-book" size="md" />
        </span>
        <span class="tns-card__body">
          <span class="tns-card__label">{{ t("traces.noStream.queryGuide") }}</span>
          <span class="tns-card__sublabel">{{ t("traces.noStream.queryGuideDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="tns-card__chevron" />
      </a>
    </template>

    <template v-if="recentStream" #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("traces.noStream.recent") }}
        </span>
        <button
          type="button"
          class="tns-chip"
          :data-test="`traces-no-stream-recent-${recentStream}`"
          @click="emit('pick-stream', recentStream)"
        >
          <OIcon name="account-tree" size="xs" class="tw:shrink-0" />
          <span class="tw:truncate tw:max-w-[10rem]">{{ recentStream }}</span>
        </button>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { restoreTracesStream } from "@/utils/streamPersist";

const props = defineProps<{
  orgId: string;
}>();

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18n();

const recentStream = computed<string>(() => {
  if (!props.orgId) return "";
  return restoreTracesStream(props.orgId);
});

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("traces.noStream.description"));

const openGuide = () => {
  window.open("https://openobserve.ai/docs/features/distributed-tracing/#overview", "_blank", "noopener,noreferrer");
};
</script>

<style scoped>
.tns-card {
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
  transition: color 150ms, background-color 150ms, border-color 150ms, box-shadow 150ms;
  outline: none;
}
.tns-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.tns-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.tns-card__icon {
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
.tns-card__icon--teal {
  background: color-mix(in srgb, #0d9488 12%, transparent);
  color: #0d9488;
}
.tns-card:hover .tns-card__icon,
.tns-card:hover .tns-card__icon--teal {
  background: var(--color-primary-600);
  color: #fff;
}

.tns-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.tns-card__label {
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
.tns-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.tns-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.tns-card:hover .tns-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

.tns-chip {
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
.tns-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.tns-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
