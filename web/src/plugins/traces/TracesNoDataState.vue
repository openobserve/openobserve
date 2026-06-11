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
  TracesNoDataState — shown when no trace streams exist in the org yet.
  Each card routes to a distinct, real tracing ingestion path.
-->
<template>
  <OEmptyState illustration="trace" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noData.title") }}</template>
    <template #description><span v-html="description" /></template>

    <template #actions>
      <!-- OpenTelemetry OTLP — primary path for traces -->
      <button type="button" class="tnd-card" data-test="traces-no-data-otlp-card" @click="go('tracesOTLP')">
        <span class="tnd-card__icon tnd-card__icon--purple">
          <OIcon name="account-tree" size="md" />
        </span>
        <span class="tnd-card__body">
          <span class="tnd-card__label">{{ t("traces.noData.otlp") }}</span>
          <span class="tnd-card__sublabel">{{ t("traces.noData.otlpDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="tnd-card__chevron" />
      </button>

      <!-- OTel Collector / agent -->
      <button type="button" class="tnd-card" data-test="traces-no-data-otel-card" @click="go('ingestTracesFromOtel')">
        <span class="tnd-card__icon tnd-card__icon--blue">
          <OIcon name="hub" size="md" />
        </span>
        <span class="tnd-card__body">
          <span class="tnd-card__label">{{ t("traces.noData.otelCollector") }}</span>
          <span class="tnd-card__sublabel">{{ t("traces.noData.otelCollectorDesc") }}</span>
        </span>
        <OIcon name="chevron-right" size="sm" class="tnd-card__chevron" />
      </button>
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("traces.noData.or") }}
        </span>
        <button type="button" class="tnd-chip" data-test="traces-no-data-kubernetes-btn" @click="go('ingestFromKubernetes')">
          <OIcon name="layers" size="xs" class="tw:shrink-0" />
          {{ t("traces.noData.kubernetes") }}
        </button>
        <button type="button" class="tnd-chip" data-test="traces-no-data-python-btn" @click="go('python')">
          <OIcon name="code" size="xs" class="tw:shrink-0" />
          {{ t("traces.noData.python") }}
        </button>
        <button type="button" class="tnd-chip" data-test="traces-no-data-java-btn" @click="go('java')">
          <OIcon name="code" size="xs" class="tw:shrink-0" />
          {{ t("traces.noData.java") }}
        </button>
        <button type="button" class="tnd-chip" data-test="traces-no-data-nodejs-btn" @click="go('nodejs')">
          <OIcon name="code" size="xs" class="tw:shrink-0" />
          {{ t("traces.noData.nodejs") }}
        </button>
        <button
          v-if="aiEnabled"
          type="button"
          class="tnd-chip"
          data-test="traces-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <OIcon name="bolt" size="xs" class="tw:shrink-0" />
          {{ t("traces.noData.askAi") }}
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

const props = defineProps<{ aiEnabled: boolean }>();
const emit = defineEmits<{ "ask-ai": [] }>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

const description = computed(() => t("traces.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>

<style scoped>
.tnd-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 19rem;
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
.tnd-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-400);
  background: var(--color-tabs-hover-bg);
}
.tnd-card:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}

.tnd-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.5rem;
  transition: background-color 150ms, color 150ms;
}
.tnd-card__icon--purple { background: color-mix(in srgb, #8b5cf6 12%, transparent); color: #8b5cf6; }
.tnd-card__icon--blue   { background: color-mix(in srgb, #3b82f6 12%, transparent); color: #3b82f6; }

.tnd-card:hover .tnd-card__icon,
.tnd-card:hover .tnd-card__icon--purple,
.tnd-card:hover .tnd-card__icon--blue {
  background: var(--color-primary-600);
  color: #fff;
}

.tnd-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.tnd-card__label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tnd-card__sublabel {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.tnd-card__chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 150ms, color 150ms;
}
.tnd-card:hover .tnd-card__chevron {
  transform: translateX(0.125rem);
  color: var(--color-primary-600);
}

.tnd-chip {
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
.tnd-chip:hover {
  border-color: var(--color-primary-400);
  color: var(--color-primary-600);
  background: color-mix(in srgb, var(--color-primary-500) 6%, transparent);
}
.tnd-chip:focus-visible {
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--color-primary-500) 40%, transparent);
}
</style>
