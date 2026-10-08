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
  <div class="flex h-full w-full flex-col items-center overflow-y-auto pb-8">
    <OEmptyState
      illustration="no-results"
      size="block"
      :hide-action="true"
      class="w-full shrink-0"
      data-test="logs-no-fts-panel"
    >
      <template #title>{{ title }}</template>
      <template #description>{{ description }}</template>
      <template #actions>
        <EmptyStateActionCard
          v-if="configureStream"
          icon="settings"
          :label="t('search.freeTextSetField')"
          :sublabel="t('search.freeTextSetFieldDesc')"
          data-test="logs-no-fts-configure-btn"
          @click="emit('configure', configureStream)"
        />
      </template>
      <template v-if="streams.length > 1 && withoutText.length" #extra>
        <span class="text-text-secondary text-sm" data-test="logs-no-fts-no-text-streams">
          {{ t("search.freeTextNoTextFieldsNamed", { streams: withoutText.join(", ") }) }}
        </span>
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import type { NoFtsStream } from "@/composables/useLogs/freeTextSearch";

const props = defineProps<{
  streams: NoFtsStream[];
}>();

const emit = defineEmits<{
  configure: [stream: string];
}>();

const { t } = useI18nTyped();

const withoutText = computed(() =>
  props.streams.filter((stream) => !stream.hasTextFields).map((stream) => stream.name),
);

const title = computed(() =>
  props.streams.length === 1
    ? t("search.freeTextNoFtsTitle", { stream: props.streams[0].name })
    : t("search.freeTextNoFtsTitleMulti"),
);

const description = computed(() =>
  props.streams.length === 1 && withoutText.value.length === 1
    ? t("search.freeTextNoTextFields")
    : t("search.freeTextNoFtsDesc"),
);

const configureStream = computed(() => props.streams[0]?.name ?? "");
</script>
