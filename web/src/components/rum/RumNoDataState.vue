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
  <OEmptyState
    icon="radar"
    :title="t('rum.emptyState.title')"
    :text="t('rum.emptyState.description')"
  >
    <template #actions>
      <OButton variant="primary" data-test="rum-empty-web-card" @click="getStarted">
        {{ t("rum.emptyState.webApp") }}
      </OButton>
      <OButton data-test="rum-empty-session-card" @click="getStarted">
        {{ t("rum.emptyState.sessionReplay") }}
      </OButton>
    </template>

    <template #extra>
      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span class="text-text-secondary text-compact">{{ t("rum.emptyState.learnMore") }}</span>
        <OButton
          variant="link"
          icon-end="open-in-new"
          href="https://openobserve.ai/frontend-monitoring/#quick-implementation"
          target="_blank"
          rel="noopener noreferrer"
          data-test="rum-empty-quickstart-btn"
        >
          {{ t("rum.emptyState.quickImpl") }}
        </OButton>
        <OButton
          variant="link"
          icon-end="open-in-new"
          href="https://openobserve.ai/blog/frontend-monitoring-basics/"
          target="_blank"
          rel="noopener noreferrer"
          data-test="rum-empty-blog-btn"
        >
          {{ t("rum.emptyState.blogPost") }}
        </OButton>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";

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
