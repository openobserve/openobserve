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
  <q-card
    flat
    class="tw-mb-[0.375rem] cursor-pointer tw-border tw-border-solid tw-border-[var(--o2-border-color)] hover:tw-bg-[var(--o2-hover-gray)]"
    @click="$emit('click', pattern, index)"
    :data-test="`pattern-card-${index}`"
  >
    <!-- Three Column Layout: Pattern | Occurrence | Percentage -->
    <q-card-section class="tw-p-[0.625rem]">
      <div class="row items-center q-col-gutter-md no-wrap">
        <!-- Pattern Column -->
        <div class="col">
          <div
            class="text-body2 ellipsis tw-text-[0.8rem] o2-monospace-font"
            :class="
              store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-8'
            "
            :data-test="`pattern-card-${index}-template`"
          >
            {{ pattern.template }}
          </div>
          <span
            v-if="pattern.is_anomaly"
            class="text-negative text-weight-bold text-caption"
            :data-test="`pattern-card-${index}-anomaly-badge`"
            >⚠️ {{ t("search.anomalyLabel") }}</span
          >
        </div>

        <!-- Occurrence Column -->
        <div class="col-auto" style="min-width: 120px">
          <span
            class="text-body2 text-weight-bold text-primary"
            :data-test="`pattern-card-${index}-frequency`"
          >
            {{ pattern.frequency.toLocaleString() }}
          </span>
        </div>

        <!-- Percentage Column -->
        <div class="col-auto" style="min-width: 80px">
          <span
            class="text-body2 text-weight-bold text-primary"
            :data-test="`pattern-card-${index}-percentage`"
            >{{ pattern.percentage.toFixed(2) }}%</span
          >
        </div>

        <!-- Actions Column -->
        <div
          class="col-auto row items-center q-gutter-xs pattern-block-actions"
        >
          <q-btn
            size="0.375rem"
            @click.stop="$emit('include', pattern)"
            :title="t('search.includePatternInSearch')"
            round
            flat
            dense
            :data-test="`pattern-card-${index}-include-btn`"
          >
            <q-icon color="currentColor">
              <EqualIcon></EqualIcon>
            </q-icon>
          </q-btn>
          <q-btn
            size="0.375rem"
            @click.stop="$emit('exclude', pattern)"
            :title="t('search.excludePatternFromSearch')"
            round
            flat
            dense
            :data-test="`pattern-card-${index}-exclude-btn`"
          >
            <q-icon class="tw-text-[var(--o2-text-color)]">
              <NotEqualIcon></NotEqualIcon>
            </q-icon>
          </q-btn>
          <q-icon
            name="info"
            size="1.0625rem"
            class="cursor-pointer"
            :data-test="`pattern-card-${index}-details-icon`"
          >
            <q-tooltip>{{
              t("search.showPatternDetails", {
                variables: pattern.examples?.[0]?.variables
                  ? Object.keys(pattern.examples[0].variables).length
                  : 0,
                examples: pattern.examples?.length || 0,
              })
            }}</q-tooltip>
          </q-icon>
        </div>
      </div>
    </q-card-section>
  </q-card>
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
</style>
