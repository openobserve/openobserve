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
  <div
    class="px-page-edge bg-status-warning-bg flex flex-col gap-2 py-2 text-xs"
    data-test="logs-missing-stream-banner"
    :class="noFtsStreams.length ? 'text-text-heading' : 'text-status-warning-text'"
  >
    <div
      class="flex flex-wrap items-center gap-2"
      :data-test="noFtsStreams.length ? 'logs-no-fts-mixed-banner' : undefined"
    >
      <OIcon v-if="!noFtsStreams.length" name="warning" size="sm" />
      <div v-if="noFtsStreams.length" class="flex w-full items-start gap-2">
        <OIcon name="warning" size="sm" />
        <div class="flex min-w-0 flex-col gap-1">
          <span v-for="stream in noFtsStreams" :key="stream" class="font-semibold">{{
            t("search.noFtsRecovery.skipped", { stream })
          }}</span>
          <span>{{
            t("search.noFtsRecovery.resultsScope", {
              streams: selectedStreams.filter((name) => !noFtsStreams.includes(name)).join(", "),
            })
          }}</span>
        </div>
      </div>
      <span v-else>{{ message }}</span>
      <template v-if="noFtsStreams.length">
        <OButton
          variant="outline"
          size="chip"
          data-test="logs-no-fts-search-fields-btn"
          @click="openFieldSearch"
          >{{ t("search.noFtsRecovery.searchField") }}</OButton
        >
        <OButton
          variant="outline"
          size="chip"
          data-test="logs-no-fts-clear-run-btn"
          @click="emit('clear-run')"
          >{{ t("search.noFtsRecovery.clearRun") }}</OButton
        >
        <OButton
          variant="outline"
          size="chip"
          data-test="logs-no-fts-configure-btn"
          :aria-disabled="!canConfigure || undefined"
          :class="
            !canConfigure &&
            'text-text-disabled! hover:border-button-outline-border! cursor-not-allowed! hover:bg-transparent!'
          "
          :aria-describedby="!canConfigure ? permissionId : undefined"
          @click="openSettings"
          >{{ t("search.freeTextSetField") }}</OButton
        >
        <span v-if="!canConfigure" :id="permissionId">{{
          t("search.noFtsRecovery.editPermission")
        }}</span>
      </template>
    </div>
    <LogsNoFtsFieldSearch
      v-if="fieldSearchOpen"
      :streams="recoveryStreams"
      :selected-streams="selectedStreams"
      :term="term"
      @cancel="closeFieldSearch"
      @submit="(values) => emit('field-search', values)"
    />
  </div>
</template>

<script setup lang="ts">
import { toRef, useId } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import LogsNoFtsFieldSearch from "./LogsNoFtsFieldSearch.vue";
import { useNoFtsRecovery } from "./useNoFtsRecovery";
import type { NoFtsRecoveryStream, NoFtsFieldSubmission } from "./LogsNoFtsFieldSearch.schema";

const props = withDefaults(
  defineProps<{
    message: string;
    noFtsStreams: string[];
    configureDenied?: boolean;
    term?: string;
    recoveryStreams?: NoFtsRecoveryStream[];
    selectedStreams?: string[];
  }>(),
  { term: "", recoveryStreams: () => [], selectedStreams: () => [] },
);

const emit = defineEmits<{ "clear-run": []; "field-search": [values: NoFtsFieldSubmission] }>();
const { t } = useI18nTyped();
const router = useRouter();
const { canConfigure, fieldSearchOpen, openFieldSearch, closeFieldSearch } = useNoFtsRecovery(
  toRef(props, "configureDenied"),
);
const permissionId = `${useId()}-configure-reason`;

// Routes only; the stream settings dialog owns the write.
const openSettings = () => {
  const stream = props.noFtsStreams[0];
  if (stream && canConfigure.value) router.push(`/streams?dialog=${stream}`);
};
</script>
