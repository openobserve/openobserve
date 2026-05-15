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
  <OButton
    data-test="logs-search-bar-utilities-menu-btn"
    class="group-menu-btn element-box-shadow"
    variant="outline"
    size="xs"
  >
    <Ellipsis class="tw:size-3.5 tw:shrink-0" />
    More
    <q-menu anchor="bottom left" self="top left">
      <q-list>
        <!-- Histogram Toggle -->
        <q-item
          v-if="shouldMoveSqlToggleToMenu"
          clickable
          @click="
            searchObj.meta.showHistogram = !searchObj.meta.showHistogram
          "
          data-test="logs-search-bar-menu-histogram-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center">
              <div
                style="
                  width: 28px;
                  display: flex;
                  align-items: center;
                  margin-right: 12px;
                "
              >
                <q-toggle
                  v-model="searchObj.meta.showHistogram"
                  size="xs"
                  flat
                  class="o2-toggle-button-xs"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-toggle-button-xs-dark'
                      : 'o2-toggle-button-xs-light'
                  "
                  @click.stop
                />
              </div>
              {{ t("search.showHistogramLabel") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <!-- SQL Mode Toggle (moved from toolbar at <= 1300px) -->
        <q-item
          v-if="shouldMoveSqlToggleToMenu"
          clickable
          @click="
            !isSqlModeDisabled &&
            (searchObj.meta.sqlMode = !searchObj.meta.sqlMode)
          "
          data-test="logs-search-bar-menu-sql-mode-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center">
              <div
                style="
                  width: 28px;
                  display: flex;
                  align-items: center;
                  margin-right: 12px;
                "
              >
                <q-toggle
                  v-model="searchObj.meta.sqlMode"
                  :disable="isSqlModeDisabled"
                  size="xs"
                  flat
                  class="o2-toggle-button-xs"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-toggle-button-xs-dark'
                      : 'o2-toggle-button-xs-light'
                  "
                  @click.stop
                />
              </div>
              {{ t("search.sqlModeLabel") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <!-- Quick Mode Toggle (always in menu) -->
        <q-item
          clickable
          @click="handleQuickMode"
          data-test="logs-search-bar-quick-mode-toggle-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center">
              <div
                style="
                  width: 28px;
                  display: flex;
                  align-items: center;
                  margin-right: 12px;
                "
              >
                <q-toggle
                  :model-value="searchObj.meta.quickMode"
                  size="xs"
                  flat
                  data-test="logs-search-bar-quick-mode-toggle"
                  class="o2-toggle-button-xs"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-toggle-button-xs-dark'
                      : 'o2-toggle-button-xs-light'
                  "
                  @click.stop="handleQuickMode"
                />
              </div>
              {{ t("search.quickModeLabel") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <q-separator />

        <!-- === SAVED VIEWS GROUP (moved from toolbar at <= 1500px) === -->

        <!-- List Saved Views -->
        <q-item
          v-if="shouldMoveSavedViewToMenu"
          clickable
          v-close-popup
          @click="emit('open-saved-views-list')"
          data-test="logs-search-bar-menu-list-saved-views-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="saved_search" size="xs" />
              {{ t("search.listSavedViews") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <!-- Create Saved View -->
        <q-item
          v-if="shouldMoveSavedViewToMenu"
          clickable
          v-close-popup
          @click="emit('save-view')"
          data-test="logs-search-bar-menu-create-saved-view-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="add_circle_outline" size="xs" />
              {{ t("search.createSavedView") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <q-separator v-if="shouldMoveSavedViewToMenu" />

        <!-- === ACTIONS GROUP === -->

        <!-- Reset Filters (moved from toolbar at <= 1500px) -->
        <q-item
          v-if="shouldMoveSavedViewToMenu"
          clickable
          v-close-popup
          @click="emit('reset-filters')"
          data-test="logs-search-bar-menu-reset-filters-btn"
          class="q-pa-sm saved-view-item"
        >
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="restart_alt" size="xs" />
              {{ t("search.resetFilters") }}
            </q-item-label>
          </q-item-section>
        </q-item>

        <q-separator v-if="shouldMoveSavedViewToMenu" />

        <!-- Syntax Guide -->
        <q-item class="q-pa-sm saved-view-item syntax-guide-menu-item">
          <q-item-section>
            <q-item-label class="tw:flex tw:items-center tw:gap-2">
              <syntax-guide
                data-test="logs-search-bar-sql-mode-toggle-btn"
                :sqlmode="searchObj.meta.sqlMode"
                no-border
                :label="t('search.syntaxGuideLabel')"
              />
            </q-item-label>
          </q-item-section>
        </q-item>
      </q-list>
    </q-menu>
  </OButton>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import { searchState } from "@/composables/useLogs/searchState";
import SyntaxGuide from "../SyntaxGuide.vue";

const { t } = useI18n();
const store = useStore();
const { searchObj } = searchState();

defineProps<{
  shouldMoveSqlToggleToMenu: boolean;
  isSqlModeDisabled: boolean;
  shouldMoveSavedViewToMenu: boolean;
}>();

const emit = defineEmits<{
  "quick-mode": [];
  "open-saved-views-list": [];
  "save-view": [];
  "reset-filters": [];
}>();

const handleQuickMode = () => {
  emit("quick-mode");
};
</script>
