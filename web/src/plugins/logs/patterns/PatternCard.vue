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
    <!-- Header with Rank and Stats - Compact -->
    <q-card-section class="tw-p-[0.625rem]">
      <div class="row items-center q-col-gutter-md no-wrap">
        <div class="col-auto">
          <q-avatar
            size="2rem"
            color="primary"
            text-color="white"
            class="text-weight-bold"
            :data-test="`pattern-card-${index}-rank`"
          >
            {{ index + 1 }}
          </q-avatar>
        </div>
        <div class="col">
          <!-- Template shown first with info icon -->
          <div class="tw-flex tw-items-center q-mb-xs">
            <div
              class="text-body2 ellipsis"
              :class="
                store.state.theme === 'dark' ? 'text-grey-4' : 'text-grey-8'
              "
              style="
                font-family:
                  &quot;Monaco&quot;, &quot;Menlo&quot;,
                  &quot;Courier New&quot;, monospace;
                font-size: 0.8125rem;
              "
              :data-test="`pattern-card-${index}-template`"
            >
              {{ pattern.template }}
            </div>
            <q-icon
              :name="outlinedInfo"
              size="17px"
              class="q-ml-xs cursor-pointer"
              :class="
                store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
              "
              :data-test="`pattern-card-${index}-info-icon`"
            >
              <q-tooltip
                anchor="center right"
                self="center left"
                max-width="300px"
                style="font-size: 12px"
              >
                <div class="text-weight-bold q-mb-xs">
                  Template vs Description
                </div>
                <div class="q-mb-xs">
                  <strong>Template:</strong> {{ pattern.template }}
                </div>
                <div>
                  <strong>Description:</strong> {{ pattern.description }}
                </div>
              </q-tooltip>
            </q-icon>
          </div>
          <!-- Occurrences and percentage on second line -->
          <div
            class="text-caption"
            :class="
              store.state.theme === 'dark' ? 'text-grey-6' : 'text-grey-6'
            "
          >
            <span
              class="text-weight-bold text-primary"
              :data-test="`pattern-card-${index}-frequency`"
            >
              {{ pattern.frequency.toLocaleString() }}
            </span>
            occurrences 
            <span class="q-mx-xs">•</span>
            <span
              class="text-weight-bold text-primary"
              :data-test="`pattern-card-${index}-percentage`"
              >{{ pattern.percentage.toFixed(2) }}%</span
            >
            <span
              v-if="pattern.is_anomaly"
              class="text-negative text-weight-bold q-ml-sm"
              :data-test="`pattern-card-${index}-anomaly-badge`"
              >⚠️ ANOMALY</span
            >
          </div>
        </div>
        <div
          class="col-auto row items-center q-gutter-xs pattern-block-actions"
        >
          <q-btn
            size="0.375rem"
            @click.stop="$emit('include', pattern)"
            title="Include pattern in search"
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
            title="Exclude pattern from search"
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
            <q-tooltip
              >Show details ({{
                pattern.examples?.[0]?.variables
                  ? Object.keys(pattern.examples[0].variables).length
                  : 0
              }}
              variables,
              {{ pattern.examples?.length || 0 }} examples)</q-tooltip
            >
          </q-icon>
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup lang="ts">
import { useStore } from "vuex";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
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
</script>

<style scoped lang="scss">
@import "@/styles/logs/search-result.scss";
</style>
