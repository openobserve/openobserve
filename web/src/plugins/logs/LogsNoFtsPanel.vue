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
      class="shrink-0"
      icon="search-off"
      data-test="logs-no-fts-panel"
      :title="title"
      :text="description"
    >
      <template #actions>
        <OButton
          variant="primary"
          data-test="logs-no-fts-search-fields-btn"
          @click="openFieldSearch"
        >
          {{ t("search.noFtsRecovery.searchField") }}
        </OButton>
        <OButton data-test="logs-no-fts-clear-run-btn" @click="emit('clear-run')">
          {{ t("search.noFtsRecovery.clearRun") }}
        </OButton>
      </template>
      <template v-if="configureStream || (streams.length > 1 && withoutText.length)" #extra>
        <OButton
          v-if="configureStream"
          variant="link"
          :disabled="!canConfigure"
          :disabled-reason="canConfigure ? undefined : t('search.noFtsRecovery.editPermission')"
          data-test="logs-no-fts-configure-btn"
          @click="emit('configure', configureStream)"
        >
          {{ t("search.freeTextSetField") }}
        </OButton>
        <span v-if="configureStream && canConfigure" class="text-text-secondary text-compact">
          {{ t("search.noFtsRecovery.configureHint") }}
        </span>
        <span
          v-if="streams.length > 1 && withoutText.length"
          class="text-text-secondary text-compact"
          data-test="logs-no-fts-no-text-streams"
        >
          {{ t("search.freeTextNoTextFieldsNamed", { streams: withoutText.join(", ") }) }}
        </span>
      </template>
    </OEmptyState>
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
import { computed, toRef } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
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
