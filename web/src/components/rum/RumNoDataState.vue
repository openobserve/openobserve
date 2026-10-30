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
  <OEmptyState illustration="radar" size="hero" :hide-action="true">
    <template #title>{{ t("rum.emptyState.title") }}</template>
    <template #description>{{ t("rum.emptyState.description") }}</template>

    <template #actions>
      <EmptyStateIngestionCard
        icon="devices"
        :label="t('rum.emptyState.webApp')"
        :sublabel="t('rum.emptyState.webAppDesc', { product: raw('JavaScript') })"
        icon-variant="blue"
        data-test="rum-empty-web-card"
        @click="getStarted"
      />
      <EmptyStateIngestionCard
        icon="play-circle"
        :label="t('rum.emptyState.sessionReplay')"
        :sublabel="t('rum.emptyState.sessionReplayDesc')"
        icon-variant="purple"
        data-test="rum-empty-session-card"
        @click="getStarted"
      />
    </template>

    <template #extra>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="text-text-secondary me-1 text-sm font-semibold">
          {{ t("rum.emptyState.learnMore") }}
        </span>
        <EmptyStateIngestionChip
          icon="bolt"
          href="https://openobserve.ai/frontend-monitoring/#quick-implementation"
          data-test="rum-empty-quickstart-btn"
          >{{ t("rum.emptyState.quickImpl") }}</EmptyStateIngestionChip
        >
        <EmptyStateIngestionChip
          icon="menu-book"
          href="https://openobserve.ai/blog/frontend-monitoring-basics/"
          data-test="rum-empty-blog-btn"
          >{{ t("rum.emptyState.blogPost") }}</EmptyStateIngestionChip
        >
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const getStarted = () => {
  void router.push({
    name: "frontendMonitoring",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};
</script>
