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
  LogsNoDataState — shown when the selected organization has no log streams yet.
  Each card routes to a distinct, real ingestion path in OpenObserve.
-->
<template>
  <OEmptyState illustration="hourglass" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noData.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Curl / HTTP API — simplest quick-start -->
      <button
        type="button"
        class="nd-card"
        data-test="logs-no-data-curl-card"
        @click="go('curl')"
      >
        <span class="nd-card__icon">
          <OIcon name="terminal" size="md" />
        </span>
        <span class="nd-card__body">
          <span class="nd-card__label">{{ t("logs.noData.curl") }}</span>
          <span class="nd-card__sublabel">{{ t("logs.noData.curlDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="nd-card__chevron" />
      </button>

      <!-- Log shippers — Filebeat, Fluentbit, Fluentd, Vector, SyslogNg -->
      <button
        type="button"
        class="nd-card"
        data-test="logs-no-data-shippers-card"
        @click="go('ingestLogs')"
      >
        <span class="nd-card__icon nd-card__icon--teal">
          <OIcon name="shuffle" size="md" />
        </span>
        <span class="nd-card__body">
          <span class="nd-card__label">{{ t("logs.noData.shippers") }}</span>
          <span class="nd-card__sublabel">{{ t("logs.noData.shippersDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="nd-card__chevron" />
      </button>

      <!-- OpenTelemetry -->
      <button
        type="button"
        class="nd-card"
        data-test="logs-no-data-otel-card"
        @click="go('ingestLogsFromOtel')"
      >
        <span class="nd-card__icon nd-card__icon--amber">
          <OIcon name="cable" size="md" />
        </span>
        <span class="nd-card__body">
          <span class="nd-card__label">{{ t("logs.noData.otel") }}</span>
          <span class="nd-card__sublabel">{{ t("logs.noData.otelDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="nd-card__chevron" />
      </button>
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("logs.noData.or") }}
        </span>
        <button type="button" class="nd-chip" data-test="logs-no-data-kubernetes-btn" @click="go('ingestFromKubernetes')">
          <OIcon name="layers" size="xs" class="tw:shrink-0" />
          {{ t("logs.noData.kubernetes") }}
        </button>
        <button type="button" class="nd-chip" data-test="logs-no-data-aws-btn" @click="go('AWSConfig')">
          <OIcon name="cloud" size="xs" class="tw:shrink-0" />
          {{ t("logs.noData.aws") }}
        </button>
        <button type="button" class="nd-chip" data-test="logs-no-data-linux-btn" @click="go('ingestFromLinux')">
          <OIcon name="dns" size="xs" class="tw:shrink-0" />
          {{ t("logs.noData.linux") }}
        </button>
        <button type="button" class="nd-chip" data-test="logs-no-data-windows-btn" @click="go('ingestFromWindows')">
          <OIcon name="monitor" size="xs" class="tw:shrink-0" />
          {{ t("logs.noData.windows") }}
        </button>
        <button
          v-if="aiEnabled"
          type="button"
          class="nd-chip"
          data-test="logs-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <OIcon name="bolt" size="xs" class="tw:shrink-0" />
          {{ t("logs.noData.askAi") }}
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

const props = defineProps<{
  aiEnabled: boolean;
}>();

const emit = defineEmits<{
  "ask-ai": [];
}>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("logs.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>

<style scoped>
.nd-card {
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
.nd-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.nd-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.nd-card__icon {
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
.nd-card__icon--teal {
  background: color-mix(in srgb, #0d9488 12%, transparent);
  color: #0d9488;
}
.nd-card__icon--amber {
  background: color-mix(in srgb, #d97706 12%, transparent);
  color: #d97706;
}
.nd-card:hover .nd-card__icon,
.nd-card:hover .nd-card__icon--teal,
.nd-card:hover .nd-card__icon--amber {
  background: var(--color-primary-600);
  color: #fff;
}

.nd-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.nd-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nd-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.nd-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.nd-card:hover .nd-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

.nd-chip {
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
.nd-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.nd-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
