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
    size="hero"
    illustration="alert"
    hide-action
    :title="noData ? t('alerts.firstRun.noDataTitle') : t('alerts.firstRun.title')"
    :description="
      noData ? t('alerts.firstRun.noDataDescription') : t('alerts.firstRun.description')
    "
    data-test="alert-list-first-run"
  >
    <template #actions>
      <div
        v-if="!noData && suggestions.length"
        class="flex basis-full flex-wrap justify-center gap-3"
        data-test="alert-list-first-run-suggestions"
      >
        <AlertSuggestionCard
          v-for="suggestion in suggestions"
          :key="suggestion.key"
          :suggestion="suggestion"
          class="max-w-72"
          @choose="emit('choose', $event)"
        />
      </div>
      <EmptyStateActionCard
        v-if="noData"
        icon="bolt"
        :label="t('alerts.firstRun.ingest')"
        :sublabel="t('alerts.firstRun.ingestDesc')"
        data-test="alert-list-first-run-ingest"
        @click="goToIngestion"
      />
      <EmptyStateActionCard
        icon="add"
        :label="t('alerts.firstRun.create')"
        :sublabel="t('alerts.firstRun.createDesc')"
        data-test="alert-list-first-run-create"
        @click="emit('blank')"
      />
      <EmptyStateActionCard
        v-if="!noData"
        icon="lightbulb"
        :label="t('alerts.firstRun.situation')"
        :sublabel="t('alerts.firstRun.situationDesc')"
        data-test="alert-list-first-run-situations"
        @click="emit('situations')"
      />
      <EmptyStateActionCard
        icon="upload-file"
        :label="t('alerts.firstRun.import')"
        :sublabel="t('alerts.firstRun.importDesc')"
        data-test="alert-list-first-run-import"
        @click="emit('import')"
      />
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import AlertSuggestionCard from "@/components/alerts/AlertSuggestionCard.vue";
import { useAlertSuggestions } from "@/composables/alerts/useAlertSuggestions";
import type { AlertPrefill } from "@/ts/interfaces/alertPrefill";

const props = defineProps<{ hasData: boolean | null }>();
const emit = defineEmits<{
  choose: [prefill: AlertPrefill];
  situations: [];
  import: [];
  blank: [];
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { suggestions, load } = useAlertSuggestions();

const noData = computed(() => props.hasData === false);

const goToIngestion = () => {
  void router.push({
    name: "ingestion",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};

onMounted(() => {
  if (!noData.value) void load();
});
</script>
