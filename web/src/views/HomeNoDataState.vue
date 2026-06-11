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
  HomeNoDataState — empty state for the Home/Usage tab when the org has no ingested data.
  Each card and chip routes to a distinct, real ingestion path in OpenObserve,
  covering logs, traces, metrics, and AI integrations.
-->
<template>
  <OEmptyState illustration="wave-bars" size="hero" :hide-action="true">
    <template #title>{{ t("home.noDataState.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Send Logs -->
      <button type="button" class="hnd-card" data-test="home-no-data-logs-card" @click="go('curl')">
        <span class="hnd-card__icon hnd-card__icon--blue">
          <OIcon name="search" size="md" />
        </span>
        <span class="hnd-card__body">
          <span class="hnd-card__label">{{ t("home.noDataState.logs") }}</span>
          <span class="hnd-card__sublabel">{{ t("home.noDataState.logsDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="hnd-card__chevron" />
      </button>

      <!-- Send Traces -->
      <button type="button" class="hnd-card" data-test="home-no-data-traces-card" @click="go('tracesOTLP')">
        <span class="hnd-card__icon hnd-card__icon--purple">
          <OIcon name="account-tree" size="md" />
        </span>
        <span class="hnd-card__body">
          <span class="hnd-card__label">{{ t("home.noDataState.traces") }}</span>
          <span class="hnd-card__sublabel">{{ t("home.noDataState.tracesDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="hnd-card__chevron" />
      </button>

      <!-- Send Metrics -->
      <button type="button" class="hnd-card" data-test="home-no-data-metrics-card" @click="go('prometheus')">
        <span class="hnd-card__icon hnd-card__icon--teal">
          <OIcon name="bar-chart" size="md" />
        </span>
        <span class="hnd-card__body">
          <span class="hnd-card__label">{{ t("home.noDataState.metrics") }}</span>
          <span class="hnd-card__sublabel">{{ t("home.noDataState.metricsDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="hnd-card__chevron" />
      </button>
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("home.noDataState.or") }}
        </span>
        <button type="button" class="hnd-chip" data-test="home-no-data-otel-btn" @click="go('ingestLogsFromOtel')">
          <OIcon name="hub" size="xs" class="tw:shrink-0" />
          {{ t("home.noDataState.otel") }}
        </button>
        <button type="button" class="hnd-chip" data-test="home-no-data-kubernetes-btn" @click="go('ingestFromKubernetes')">
          <OIcon name="layers" size="xs" class="tw:shrink-0" />
          {{ t("home.noDataState.kubernetes") }}
        </button>
        <button type="button" class="hnd-chip" data-test="home-no-data-aws-btn" @click="go('AWSConfig')">
          <OIcon name="cloud" size="xs" class="tw:shrink-0" />
          {{ t("home.noDataState.aws") }}
        </button>
        <button type="button" class="hnd-chip" data-test="home-no-data-ai-btn" @click="go('ai-integrations')">
          <OIcon name="insights" size="xs" class="tw:shrink-0" />
          {{ t("home.noDataState.aiIntegrations") }}
        </button>
        <button type="button" class="hnd-chip" data-test="home-no-data-shippers-btn" @click="go('ingestLogs')">
          <OIcon name="alt-route" size="xs" class="tw:shrink-0" />
          {{ t("home.noDataState.shippers") }}
        </button>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("home.noDataState.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>

<style scoped>
.hnd-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 18rem;
  max-width: 100%;
  min-height: 4rem;
  padding: 0.625rem 0.875rem 0.625rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-base);
  box-shadow: var(--shadow-sm);
  text-align: left;
  cursor: pointer;
  transition: color 150ms, background-color 150ms, border-color 150ms, box-shadow 150ms;
  outline: none;
}
.hnd-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.hnd-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.hnd-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  transition: background-color 150ms, color 150ms;
}
.hnd-card__icon--blue  { background: color-mix(in srgb, #3b82f6 12%, transparent); color: #3b82f6; }
.hnd-card__icon--purple { background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
.hnd-card__icon--teal  { background: color-mix(in srgb, #0d9488 12%, transparent); color: #0d9488; }

.hnd-card:hover .hnd-card__icon,
.hnd-card:hover .hnd-card__icon--blue,
.hnd-card:hover .hnd-card__icon--purple,
.hnd-card:hover .hnd-card__icon--teal {
  background: var(--color-primary-600);
  color: #fff;
}

.hnd-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.hnd-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hnd-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.hnd-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.hnd-card:hover .hnd-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

.hnd-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.25rem 0.75rem;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-surface-panel);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: border-color 150ms, color 150ms, background-color 150ms;
  outline: none;
}
.hnd-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.hnd-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
