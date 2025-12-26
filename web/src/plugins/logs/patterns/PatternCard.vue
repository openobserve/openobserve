<!-- Copyright 2023 OpenObserve Inc.

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
    class="tw:flex tw:items-center tw:border-b tw:cursor-pointer hover:tw:bg-[var(--o2-hover-gray)] table-row-hover"
    @click="$emit('click', pattern, index)"
    :data-test="`pattern-card-${index}`"
  >
    <!-- Pattern Column -->
    <div class="tw:flex-1 tw:min-w-0 tw:px-2">
      <div
        class="tw:truncate pattern-template-text"
        :class="store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-8'"
        :data-test="`pattern-card-${index}-template`"
        :title="pattern.template"
      >
        {{ pattern.template }}
      </div>
      <span
        v-if="pattern.is_anomaly"
        class="text-negative text-weight-bold tw:text-[0.625rem]"
        :data-test="`pattern-card-${index}-anomaly-badge`"
        >⚠️ {{ t("search.anomalyLabel") }}</span
      >
    </div>

    <!-- Occurrence Column -->
    <div class="tw:w-16 tw:flex-shrink-0 tw:px-2 tw:text-right">
      <span
        class="text-weight-bold text-primary"
        :data-test="`pattern-card-${index}-frequency`"
      >
        {{ pattern.frequency.toLocaleString() }}
      </span>
    </div>

    <!-- Percentage Column -->
    <div class="tw:w-14 tw:flex-shrink-0 tw:px-2 tw:text-right">
      <span
        class="text-weight-bold text-primary"
        :data-test="`pattern-card-${index}-percentage`"
        >{{ pattern.percentage.toFixed(2) }}%</span
      >
    </div>

    <!-- Actions Column -->
    <div class="tw:w-20 tw:flex-shrink-0 tw:px-2 tw:flex tw:items-center">
      <q-btn
        size="6px"
        @click.stop="$emit('include', pattern)"
        :title="t('search.includePatternInSearch')"
        round
        :data-test="`pattern-card-${index}-include-btn`"
      >
        <q-icon style="height: 8px; width: 8px">
          <EqualIcon></EqualIcon>
        </q-icon>
      </q-btn>
      <q-btn
        size="6px"
        @click.stop="$emit('exclude', pattern)"
        :title="t('search.excludePatternFromSearch')"
        round
        :data-test="`pattern-card-${index}-exclude-btn`"
      >
        <q-icon style="height: 8px; width: 8px">
          <NotEqualIcon></NotEqualIcon>
        </q-icon>
      </q-btn>
      <q-btn
        size="6px"
        class="cursor-pointer"
        round
        :data-test="`pattern-card-${index}-details-icon`"
        @click.stop="$emit('click', pattern, index)"
      >
        <q-icon name="info" style="height: 8px; width: 8px">
          <q-tooltip>{{
            t("search.showPatternDetails", {
              variables: pattern.examples?.[0]?.variables
                ? Object.keys(pattern.examples[0].variables).length
                : 0,
              examples: pattern.examples?.length || 0,
            })
          }}</q-tooltip>
        </q-icon>
      </q-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";

defineProps<{
  pattern: any;
  index: number;
}>();

defineEmits<{
  (e: "click", pattern: any, index: number): void;
  (e: "include", pattern: any): void;
  (e: "exclude", pattern: any): void;
}>();

const store = useStore();
const { t } = useI18n();
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";

.pattern-template-text {
  font-family: monospace;
  font-size: 12px;
}
</style>
