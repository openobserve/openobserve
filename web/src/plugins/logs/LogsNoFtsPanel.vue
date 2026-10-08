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
  <div class="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-4">
    <OEmptyState
      illustration="no-results"
      size="block"
      :hide-action="true"
      class="w-full shrink-0"
      :class="fieldSearchOpen && 'min-h-0! py-4! [&>div]:gap-3!'"
      data-test="logs-no-fts-panel"
    >
      <template #title>{{ title }}</template>
      <template #description>{{ description }}</template>
      <template #actions>
        <EmptyStateActionCard
          :hide-chevron="true"
          class="max-w-80! gap-2! [&>span:first-child]:size-8 md:[&>span>span:first-child]:whitespace-nowrap"
          icon="search"
          :label="t('search.noFtsRecovery.searchField')"
          :sublabel="t('search.noFtsRecovery.searchFieldHint', { term })"
          data-test="logs-no-fts-search-fields-btn"
          @click="openFieldSearch"
        />
        <EmptyStateActionCard
          :hide-chevron="true"
          class="max-w-80! gap-2! [&>span:first-child]:size-8 md:[&>span>span:first-child]:whitespace-nowrap"
          icon="list"
          :label="t('search.noFtsRecovery.clearRun')"
          :sublabel="t('search.noFtsRecovery.clearRunHint', { term })"
          data-test="logs-no-fts-clear-run-btn"
          @click="emit('clear-run')"
        />
        <EmptyStateActionCard
          :hide-chevron="true"
          class="max-w-80! gap-2! [&>span:first-child]:size-8 md:[&>span>span:first-child]:whitespace-nowrap"
          v-if="configureStream"
          icon="settings"
          :label="t('search.freeTextSetField')"
          :sublabel="
            canConfigure
              ? t('search.noFtsRecovery.configureHint')
              : t('search.noFtsRecovery.editPermission')
          "
          :aria-disabled="!canConfigure || undefined"
          :class="
            !canConfigure &&
            'hover:border-border-default! hover:bg-surface-base! [&>span:first-child]:bg-section-header-bg! [&>span:first-child]:text-text-disabled! [&>span>span:first-child]:text-text-disabled! cursor-not-allowed! hover:shadow-none!'
          "
          :aria-describedby="!canConfigure ? permissionId : undefined"
          data-test="logs-no-fts-configure-btn"
          @click="canConfigure && emit('configure', configureStream)"
        />
      </template>
      <template v-if="streams.length > 1 && withoutText.length" #extra>
        <span class="text-text-secondary text-sm" data-test="logs-no-fts-no-text-streams">
          {{ t("search.freeTextNoTextFieldsNamed", { streams: withoutText.join(", ") }) }}
        </span>
      </template>
    </OEmptyState>
    <span v-if="!canConfigure" :id="permissionId" class="sr-only">{{
      t("search.noFtsRecovery.editPermission")
    }}</span>
    <div v-if="fieldSearchOpen" class="px-page-edge w-full shrink-0 pb-4">
      <LogsNoFtsFieldSearch
        :streams="recoveryStreams"
        :selected-streams="selectedStreams"
        :term="term"
        @cancel="closeFieldSearch"
        @submit="(values) => emit('field-search', values)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, useId } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import LogsNoFtsFieldSearch from "./LogsNoFtsFieldSearch.vue";
import type { NoFtsRecoveryStream, NoFtsFieldSubmission } from "./LogsNoFtsFieldSearch.schema";
import { useNoFtsRecovery } from "./useNoFtsRecovery";
import type { NoFtsStream } from "@/composables/useLogs/freeTextSearch";

const props = withDefaults(
  defineProps<{
    streams: NoFtsStream[];
    configureDenied?: boolean;
    term?: string;
    recoveryStreams?: NoFtsRecoveryStream[];
    selectedStreams?: string[];
  }>(),
  { term: "", recoveryStreams: () => [], selectedStreams: () => [] },
);

const emit = defineEmits<{
  configure: [stream: string];
  "clear-run": [];
  "field-search": [values: NoFtsFieldSubmission];
}>();

const { t } = useI18nTyped();
const { canConfigure, fieldSearchOpen, openFieldSearch, closeFieldSearch } = useNoFtsRecovery(
  toRef(props, "configureDenied"),
);
const permissionId = `${useId()}-configure-reason`;

const withoutText = computed(() =>
  props.streams.filter((stream) => !stream.hasTextFields).map((stream) => stream.name),
);

const title = computed(() =>
  props.streams.length === 1
    ? t("search.noFtsRecovery.title", { stream: props.streams[0].name })
    : t("search.freeTextNoFtsTitleMulti"),
);

const description = computed(() =>
  props.streams.length === 1 && withoutText.value.length === 1
    ? t("search.freeTextNoTextFields")
    : t("search.noFtsRecovery.description", { term: props.term }),
);

const configureStream = computed(() => props.streams[0]?.name ?? "");
</script>
