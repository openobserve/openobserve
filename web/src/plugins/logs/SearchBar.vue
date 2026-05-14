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
    :class="store.state.theme === 'dark' ? 'dark-theme' : ''"
    class="logs-search-bar-component"
    id="searchBarComponent"
  >
    <div class="row tw:m-0! tw:p-[0.375rem]! tw:items-start!">
      <div
        class="float-right col flex tw:items-center tw:gap-1 tw:flex-nowrap tw:overflow-hidden"
      >
        <!-- View Mode Toggle Group -->
        <OToggleGroup
          :model-value="searchObj.meta.logsVisualizeToggle"
          @update:model-value="onLogsVisualizeToggleUpdate($event)"
        >
          <OToggleGroupItem data-test="logs-logs-toggle" value="logs" size="sm">
            <template #icon-left>
              <ScanSearch class="tw:size-3.5 tw:shrink-0" />
            </template>
            {{ t("common.search") }}
          </OToggleGroupItem>

          <OToggleGroupItem
            data-test="logs-visualize-toggle"
            :disabled="isVisualizeDisabled"
            value="visualize"
            size="sm"
          >
            <template #icon-left>
              <ChartLine class="tw:size-3.5 tw:shrink-0" />
            </template>
            {{ t("search.visualize") }}
            <q-tooltip v-if="isVisualizeDisabled">
              {{ t("search.enableSqlModeOrSelectSingleStream") }}
            </q-tooltip>
          </OToggleGroupItem>

          <OToggleGroupItem
            data-test="logs-build-toggle"
            value="build"
            size="sm"
          >
            <template #icon-left>
              <Wrench class="tw:size-3.5 tw:shrink-0" />
            </template>
            {{ t("search.buildQuery") }}
          </OToggleGroupItem>

          <OToggleGroupItem
            v-if="config.isEnterprise == 'true'"
            data-test="logs-patterns-toggle"
            value="patterns"
            size="sm"
          >
            <template #icon-left>
              <Layers class="tw:size-3.5 tw:shrink-0" />
            </template>
            {{ t("search.showPatternsLabel") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <div
          v-if="!shouldMoveSqlToggleToMenu"
          class="toolbar-toggle-container element-box-shadow"
        >
          <q-toggle
            data-test="logs-search-bar-show-histogram-toggle-btn"
            v-model="searchObj.meta.showHistogram"
            class="o2-toggle-button-xs"
            size="xs"
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-xs-dark'
                : 'o2-toggle-button-xs-light'
            "
          >
            <q-icon name="bar_chart" size="14px" />
            <q-tooltip>{{ t("search.showHistogramLabel") }}</q-tooltip>
          </q-toggle>
        </div>
        <div
          v-if="!shouldMoveSqlToggleToMenu"
          class="toolbar-toggle-container element-box-shadow"
        >
          <q-toggle
            data-test="logs-search-bar-sql-mode-toggle-btn"
            v-model="searchObj.meta.sqlMode"
            :disable="isSqlModeDisabled"
            class="o2-toggle-button-xs"
            size="xs"
            flat
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-xs-dark'
                : 'o2-toggle-button-xs-light'
            "
          >
            <img :src="sqlIcon" alt="SQL Mode" class="toolbar-icon" />
            <q-tooltip v-if="isSqlModeDisabled">
              {{ t("search.sqlModeDisabledForVisualization") }}
            </q-tooltip>
            <q-tooltip v-else>
              {{ t("search.sqlModeLabel") }}
            </q-tooltip>
          </q-toggle>
        </div>
        <OButtonGroup
          v-if="!shouldMoveSavedViewToMenu"
          class="q-ml-xs q-pa-none element-box-shadow tw:border tw:border-button-outline-border"
        >
          <!-- Save current view -->
          <OButton
            data-test="logs-search-saved-views-btn"
            variant="ghost"
            size="icon-toolbar"
            @click="fnSavedView"
          >
            <q-icon name="save" size="16px" />
            <q-tooltip>{{ t("search.savedViewsLabel") }}</q-tooltip>
          </OButton>
          <!-- List saved views dropdown -->
          <ODropdown
            :open="savedViewDropdownModel"
            @update:open="
              (v) => {
                savedViewDropdownModel = v;
                if (v) loadSavedView();
              }
            "
            side="bottom"
            align="start"
          >
            <template #trigger>
              <OButton
                data-test="logs-search-saved-views-expand-btn"
                variant="ghost"
                size="icon-toolbar"
              >
                <q-icon name="saved_search" size="16px" />
                <q-icon name="arrow_drop_down" size="18px" class="tw:-ms-1" />
                <q-tooltip>{{ t("search.listSavedViews") }}</q-tooltip>
              </OButton>
            </template>
            <div
              :style="
                localSavedViews.length > 0
                  ? 'width: 500px; max-height: 400px; overflow-y: auto'
                  : 'width: 250px; max-height: 400px; overflow-y: auto'
              "
            >
              <q-list data-test="logs-search-saved-view-list">
                <q-item style="padding: 0px 0px 0px 0px">
                  <q-item-section
                    class="column"
                    no-hover
                    style="width: 60%; border-right: 1px solid lightgray"
                  >
                    <q-table
                      data-test="log-search-saved-view-list-fields-table"
                      :visible-columns="['view_name']"
                      :rows="searchObj.data.savedViews"
                      :row-key="(row) => 'saved_view_' + row.view_id"
                      :filter="searchObj.data.savedViewFilterFields"
                      :filter-method="filterSavedViewFn"
                      :pagination="{ rowsPerPage }"
                      hide-header
                      :wrap-cells="searchObj.meta.resultGrid.wrapCells"
                      class="saved-view-table full-height"
                      no-hover
                      id="savedViewList"
                      :rows-per-page-options="[]"
                      :hide-bottom="
                        searchObj.data.savedViews.length <= rowsPerPage ||
                        searchObj.data.savedViews.length == 0
                      "
                    >
                      <template #top-right>
                        <div class="full-width">
                          <q-input
                            data-test="log-search-saved-view-field-search-input"
                            v-model="searchObj.data.savedViewFilterFields"
                            data-cy="index-field-search-input"
                            borderless
                            dense
                            clearable
                            debounce="1"
                            class="tw:mx-2 tw:my-2"
                            :placeholder="t('search.searchSavedView')"
                          >
                            <template #prepend>
                              <q-icon name="search" />
                            </template>
                          </q-input>
                        </div>
                        <div
                          v-if="searchObj.loadingSavedView == true"
                          class="full-width float-left"
                        >
                          <div
                            class="text-subtitle2 text-weight-bold float-left"
                          >
                            <q-spinner-hourglass size="20px" />
                            {{ t("confirmDialog.loading") }}
                          </div>
                        </div>
                        <q-tr>
                          <q-td
                            v-if="
                              searchObj.data.savedViews.length == 0 &&
                              searchObj.loadingSavedView == false
                            "
                          >
                            <q-item-label class="q-pl-sm q-pt-sm">{{
                              t("search.savedViewsNotFound")
                            }}</q-item-label>
                          </q-td>
                        </q-tr>
                      </template>
                      <template v-slot:body-cell-view_name="props">
                        <q-td :props="props" class="field_list" no-hover>
                          <q-item
                            class="q-pa-xs saved-view-item"
                            clickable
                            v-close-popup
                          >
                            <q-item-section
                              @click.stop="applySavedView(props.row)"
                              v-close-popup
                              :title="props.row.view_name"
                            >
                              <q-item-label
                                class="ellipsis"
                                style="max-width: 140px"
                                >{{ props.row.view_name }}</q-item-label
                              >
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                              side
                              @click.stop="
                                handleFavoriteSavedView(
                                  props.row,
                                  favoriteViews.includes(props.row.view_id),
                                )
                              "
                            >
                              <OButton
                                :title="t('common.favourite')"
                                class="logs-saved-view-icon"
                                variant="ghost"
                                size="icon"
                              >
                                <q-icon
                                  :name="
                                    favoriteViews.includes(props.row.view_id)
                                      ? 'favorite'
                                      : 'favorite_border'
                                  "
                                  size="xs"
                                />
                              </OButton>
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-update-${props.row.view_name}-saved-view-btn`"
                              side
                              @click.stop="handleUpdateSavedView(props.row)"
                            >
                              <OButton
                                :title="t('common.edit')"
                                class="logs-saved-view-icon"
                                variant="ghost"
                                size="icon"
                              >
                                <q-icon name="edit" size="xs" />
                              </OButton>
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-delete-${props.row.view_name}-saved-view-btn`"
                              side
                              @click.stop="handleDeleteSavedView(props.row)"
                            >
                              <OButton
                                :title="t('common.delete')"
                                class="logs-saved-view-icon"
                                variant="ghost"
                                size="icon"
                              >
                                <q-icon name="delete" size="xs" />
                              </OButton>
                            </q-item-section>
                          </q-item>
                        </q-td>
                      </template>
                    </q-table>
                  </q-item-section>

                  <q-item-section
                    class="column"
                    style="width: 40%; margin-left: 0px"
                    v-if="localSavedViews.length > 0"
                  >
                    <q-table
                      data-test="log-search-saved-view-favorite-list-fields-table"
                      :visible-columns="['view_name']"
                      :rows="localSavedViews"
                      :row-key="(row) => 'favorite_saved_view_' + row.view_name"
                      hide-header
                      hide-bottom
                      :wrap-cells="searchObj.meta.resultGrid.wrapCells"
                      class="saved-view-table full-height"
                      id="savedViewFavoriteList"
                      :rows-per-page-options="[0]"
                    >
                      <template #top-right>
                        <q-item style="padding: 0px">
                          <q-item-label
                            header
                            class="q-pa-sm text-bold favorite-label"
                            >{{ t("search.favoriteViews") }}</q-item-label
                          >
                        </q-item>
                        <q-separator horizontal inset></q-separator>
                      </template>
                      <template v-slot:body-cell-view_name="props">
                        <q-td :props="props" class="field_list q-pa-xs">
                          <q-item
                            class="q-pa-xs saved-view-item"
                            clickable
                            v-close-popup
                          >
                            <q-item-section
                              @click.stop="applySavedView(props.row)"
                              v-close-popup
                            >
                              <q-item-label
                                class="ellipsis"
                                style="max-width: 90px"
                                >{{ props.row.view_name }}</q-item-label
                              >
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                              side
                              @click.stop="
                                handleFavoriteSavedView(
                                  props.row,
                                  favoriteViews.includes(props.row.view_id),
                                )
                              "
                            >
                              <q-icon
                                :name="
                                  favoriteViews.includes(props.row.view_id)
                                    ? 'favorite'
                                    : 'favorite_border'
                                "
                                color="grey"
                                size="xs"
                              />
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-update-${props.row.view_name}-favorite-saved-view-btn`"
                              side
                              @click.stop="handleUpdateSavedView(props.row)"
                            >
                              <OButton
                                :title="t('common.edit')"
                                class="logs-saved-view-icon"
                                variant="ghost"
                                size="icon"
                              >
                                <q-icon name="edit" size="xs" />
                              </OButton>
                            </q-item-section>
                            <q-item-section
                              :data-test="`logs-search-bar-delete-${props.row.view_name}-favorite-saved-view-btn`"
                              side
                              @click.stop="handleDeleteSavedView(props.row)"
                            >
                              <OButton
                                :title="t('common.delete')"
                                class="logs-saved-view-icon"
                                variant="ghost"
                                size="icon"
                              >
                                <q-icon name="delete" size="xs" />
                              </OButton>
                            </q-item-section>
                          </q-item>
                        </q-td>
                      </template>
                    </q-table>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
          </ODropdown>
        </OButtonGroup>
        <!-- reset filters button - directly on toolbar (hidden when moved to menu) -->
        <OButton
          v-if="!shouldMoveSavedViewToMenu"
          data-test="logs-search-bar-reset-filters-btn"
          class="tw:ms-1"
          size="icon-toolbar"
          variant="outline"
          @click="resetFilters"
        >
          <q-icon name="restart_alt" size="16px" />
          <q-tooltip>{{ t("search.resetFilters") }}</q-tooltip>
        </OButton>
        <!-- this is the button group responsible for showing all the utilities -->
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
                @click="openSavedViewsList"
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
                @click="fnSavedView"
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
                @click="resetFilters"
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
      </div>

      <div class="float-right col-auto tw:flex tw:items-center tw:gap-1">
        <transform-selector
          v-if="isActionsEnabled && !shouldMoveShareToMenu"
          :function-options="functionOptions"
          @select:function="populateFunctionImplementation"
          @save:function="fnSavedFunctionDialog"
        />
        <function-selector
          v-else-if="!isActionsEnabled && !shouldMoveShareToMenu"
          :function-options="functionOptions"
          @select:function="populateFunctionImplementation"
          @save:function="fnSavedFunctionDialog"
        />
        <OButton
          data-test="logs-search-bar-more-options-btn"
          class="download-logs-btn"
          variant="outline"
          size="icon-toolbar"
          style="order: 4"
        >
          <q-icon name="menu" size="16px" />
          <q-menu>
            <q-list>
              <!-- Share Link (moved from toolbar at <= 1100px) -->
              <q-item
                v-if="shouldMoveShareToMenu"
                clickable
                v-close-popup
                data-test="logs-search-bar-menu-share-link-btn"
                class="q-pa-sm saved-view-item"
              >
                <q-item-section>
                  <share-button
                    :url="shareURL"
                    variant="outline"
                    size="sm-action"
                    :show-label="true"
                    class="tw:w-full"
                  />
                </q-item-section>
              </q-item>

              <q-separator v-if="shouldMoveShareToMenu" />

              <q-item
                data-test="search-history-item-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
              >
                <q-item-section @click.stop="showSearchHistoryfn">
                  <q-item-label class="tw:flex tw:items-center tw:gap-2">
                    <img
                      :src="searchHistoryIcon"
                      alt="Search History"
                      style="width: 20px; height: 20px"
                    />
                    {{ t("search.searchHistory") }}</q-item-label
                  >
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item
                style="min-width: 150px"
                class="q-pa-sm saved-view-item download-menu-parent"
                clickable
                v-close-popup
                @mouseenter="showDownloadMenu = true"
              >
                <q-item-section class="cursor-pointer">
                  <q-item-label class="tw:flex tw:items-center tw:gap-2">
                    <img
                      :src="downloadTableIcon"
                      alt="Download Table"
                      style="width: 20px; height: 20px"
                    />
                    {{ t("search.downloadTable") }}</q-item-label
                  >
                </q-item-section>
                <q-item-section side>
                  <q-icon name="keyboard_arrow_right" />
                </q-item-section>
                <q-menu
                  v-model="showDownloadMenu"
                  anchor="top end"
                  self="top start"
                  :offset="[0, 0]"
                  @mouseenter="showDownloadMenu = true"
                  @mouseleave="showDownloadMenu = false"
                >
                  <q-list>
                    <q-item
                      data-test="search-download-csv-btn"
                      class="q-pa-sm saved-view-item"
                      clickable
                      v-close-popup
                      @click="
                        downloadLogs(searchObj.data.queryResults.hits, 'csv')
                      "
                    >
                      <q-icon
                        name="grid_on"
                        size="14px"
                        class="q-pr-sm q-pt-xs"
                      />
                      <q-item-section>
                        <q-item-label
                          class="tw:flex tw:items-center tw:gap-2 q-mr-md"
                        >
                          {{ t("search.downloadCSV") }}
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                    <q-item
                      data-test="search-download-json-btn"
                      class="q-pa-sm saved-view-item"
                      clickable
                      v-close-popup
                      @click="
                        downloadLogs(searchObj.data.queryResults.hits, 'json')
                      "
                    >
                      <q-icon
                        name="data_object"
                        size="14px"
                        class="q-pr-sm q-pt-xs"
                      />
                      <q-item-section>
                        <q-item-label
                          class="tw:flex tw:items-center tw:gap-2 q-mr-md"
                        >
                          {{ t("search.downloadJSON") }}
                        </q-item-label>
                      </q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-item>
              <q-item
                class="q-pa-sm saved-view-item"
                style="min-width: 150px"
                clickable
                v-close-popup
              >
                <q-item-section
                  @click.stop="toggleCustomDownloadDialog"
                  v-close-popup
                >
                  <q-item-label class="tw:flex tw:items-center tw:gap-2">
                    <img
                      :src="customRangeIcon"
                      alt="Custom Range"
                      style="width: 20px; height: 20px"
                    />

                    {{ t("search.customRange") }}</q-item-label
                  >
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item
                v-if="searchObj.meta.sqlMode"
                data-test="logs-search-bar-explain-query-menu-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                :disable="
                  !searchObj.data.query || searchObj.data.query.trim() === ''
                "
                @click="openExplainDialog"
              >
                <q-item-section v-close-popup>
                  <q-item-label class="tw:flex tw:items-center tw:gap-2">
                    <q-icon name="lightbulb" size="20px" />
                    {{ t("search.explainQuery") }}</q-item-label
                  >
                </q-item-section>
              </q-item>
              <q-separator v-if="searchObj.meta.sqlMode" />
              <q-item
                v-if="config.isEnterprise == 'true'"
                data-test="search-scheduler-create-new-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                @click="createScheduleJob"
              >
                <q-item-section v-close-popup>
                  <q-item-label
                    class="tw:flex tw:items-center tw:gap-2"
                    data-test="search-scheduler-create-new-label"
                  >
                    <img
                      :src="createScheduledSearchIcon"
                      alt="Create Scheduled Search"
                      style="width: 20px; height: 20px"
                    />
                    {{ t("search.createScheduledSearch") }}</q-item-label
                  >
                </q-item-section>
              </q-item>
              <q-item
                v-if="config.isEnterprise == 'true'"
                data-test="search-scheduler-list-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                @click="routeToSearchSchedule"
              >
                <q-item-section v-close-popup>
                  <q-item-label
                    class="tw:flex tw:items-center tw:gap-2"
                    data-test="search-scheduler-list-label"
                  >
                    <img
                      :src="listScheduledSearchIcon"
                      alt="List Scheduled Search"
                      style="width: 20px; height: 20px"
                    />
                    {{ t("search.listScheduledSearch") }}</q-item-label
                  >
                </q-item-section>
              </q-item>
              <q-separator v-if="config.isEnterprise == 'true'" />
              <q-item
                v-if="
                  config.isEnterprise == 'true' &&
                  config.isCloud == 'false' &&
                  store.state.zoConfig.search_inspector_enabled
                "
                data-test="search-inspect-btn"
                class="q-pa-sm saved-view-item"
                clickable
                v-close-popup
                @click="searchInspectDialog = true"
              >
                <q-item-section v-close-popup>
                  <q-item-label
                    class="tw:flex tw:items-center tw:gap-2"
                    data-test="search-inspect-label"
                  >
                    <q-icon name="troubleshoot" size="20px" />
                    Search Inspect
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
          <q-tooltip style="width: 110px">
            {{ t("search.moreActions") }}
          </q-tooltip>
        </OButton>
        <share-button
          v-if="!shouldMoveShareToMenu"
          data-test="logs-search-bar-share-link-btn"
          :url="shareURL"
          variant="outline"
          size="icon-toolbar"
          style="order: 3"
        />
        <div class="float-left tw:mr-[4px]" style="order: 1">
          <date-time
            ref="dateTimeRef"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            data-test="logs-search-bar-date-time-dropdown"
            :queryRangeRestrictionMsg="
              searchObj.data.datetime.queryRangeRestrictionMsg
            "
            :queryRangeRestrictionInHour="
              searchObj.data.datetime.queryRangeRestrictionInHour
            "
            @on:date-change="updateDateTime"
            @on:timezone-change="updateTimezone"
            :disable="disable"
            class="element-box-shadow"
          />
        </div>
        <div class="search-time float-left" style="order: 2">
          <div class="flex">
            <OButtonGroup
              class="q-pa-none q-mr-xs element-box-shadow el-border"
              v-if="
                config.isEnterprise == 'true' &&
                Object.keys(store.state.regionInfo).length > 0 &&
                store.state.zoConfig.super_cluster_enabled
              "
            >
              <ODropdown
                side="bottom"
                align="start"
                data-test="logs-search-bar-region-btn"
              >
                <template #trigger>
                  <OButton
                    variant="outline"
                    size="sm"
                    class="region-dropdown-btn q-px-xs"
                    :title="t('search.regionTitle')"
                  >
                    {{ t("search.region") }}
                    <q-icon
                      name="arrow_drop_down"
                      size="18px"
                      class="tw:ml-1"
                    />
                  </OButton>
                </template>
                <div class="tw:p-2 tw:min-w-[240px]">
                  <q-input
                    ref="reginFilterRef"
                    borderless
                    dense
                    clearable
                    class="tw:mb-[0.375rem]! indexlist-search-input q-mx-sm q-mt-sm"
                    v-model="regionFilter"
                    :label="t('search.regionFilterMsg')"
                  >
                  </q-input>
                  <q-tree
                    class="col-12 col-sm-6 q-mx-sm q-mb-sm"
                    :nodes="store.state.regionInfo"
                    node-key="label"
                    :filter="regionFilter"
                    :filter-method="regionFilterMethod"
                    tick-strategy="leaf"
                    v-model:ticked="searchObj.meta.clusters"
                  />
                </div>
              </ODropdown>
            </OButtonGroup>
            <div
              v-if="
                searchObj.meta.logsVisualizeToggle === 'visualize' ||
                searchObj.meta.logsVisualizeToggle === 'build'
              "
            >
              <div
                v-if="config.isEnterprise == 'true'"
                class="tw:flex tw:items-center"
              >
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  :title="t('search.cancel')"
                  variant="ghost"
                  class="q-pa-none tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-enterprise-border-radius"
                  @click="cancelVisualizeQueries"
                  >{{ t("search.cancel") }}</OButton
                >
                <!-- Main action button: "Ask AI" when NL detected + AI bar not open, otherwise "Run Query" -->
                <OButton
                  v-else
                  data-test="logs-search-bar-visualize-refresh-btn"
                  variant="ghost"
                  :title="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t('search.generateQueryTooltip')
                      : t('search.runQuery')
                  "
                  :disabled="
                    isGeneratingSQL ||
                    (isNaturalLanguageDetected &&
                      !searchObj.meta.nlpMode &&
                      !searchObj.data.stream.selectedStream.length)
                  "
                  class="q-pa-none tw:h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button'
                      : 'o2-run-query-button o2-color-primary',
                    config.isEnterprise == 'true'
                      ? 'search-button-enterprise-border-radius'
                      : 'search-button-normal-border-radius',
                  ]"
                  @click="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? handleGenerateSQLQuery()
                      : handleRunQueryFn()
                  "
                >
                  {{
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t("search.generateQuery")
                      : t("search.runQuery")
                  }}
                </OButton>
                <q-separator class="tw:h-[1.875rem]! tw:w-[1px]" />
                <ODropdown align="end" side="bottom">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-xs"
                      :class="[
                        !(
                          isNaturalLanguageDetected && !searchObj.meta.nlpMode
                        ) &&
                        config.isEnterprise == 'true' &&
                        visualizeSearchRequestTraceIds.length
                          ? 'o2-color-cancel'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'o2-color-primary'
                            : '',
                        config.isEnterprise == 'true'
                          ? 'search-button-dropdown-enterprise-border-radius'
                          : 'search-button-normal-border-radius',
                      ]"
                    >
                      <q-icon name="arrow_drop_down" size="18px" />
                    </OButton>
                  </template>
                  <ODropdownItem
                    v-if="
                      !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                    "
                    data-test="logs-search-bar-refresh-btn"
                    data-cy="search-bar-visuzlie-hard-refresh-button"
                    :disabled="
                      config.isEnterprise == 'true' &&
                      !!visualizeSearchRequestTraceIds.length
                    "
                    @select="handleRunQueryFn(true)"
                  >
                    <template #icon-left
                      ><q-icon name="refresh" size="16px"
                    /></template>
                    {{ t("search.refreshCacheAndRunQuery") }}
                  </ODropdownItem>
                  <p
                    v-else
                    class="tw:text-xs tw:text-gray-500 tw:text-center tw:px-3 tw:py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
              <div v-else class="tw:flex tw:items-center">
                <!-- Cancel button when query is running -->
                <OButton
                  v-if="visualizeSearchRequestTraceIds.length > 0"
                  data-test="logs-search-bar-visualize-cancel-btn"
                  variant="ghost"
                  :title="t('search.cancel')"
                  class="q-pa-none tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow search-button-enterprise-border-radius"
                  @click="cancelVisualizeQueries"
                  >{{ t("search.cancel") }}</OButton
                >
                <!-- Main action button -->
                <OButton
                  v-else
                  data-test="logs-search-bar-visualize-refresh-btn"
                  variant="ghost"
                  :title="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t('search.generateQueryTooltip')
                      : t('search.runQuery')
                  "
                  :disabled="
                    disable ||
                    isGeneratingSQL ||
                    (isNaturalLanguageDetected &&
                      !searchObj.meta.nlpMode &&
                      !searchObj.data.stream.selectedStream.length)
                  "
                  class="q-pa-none tw:h-[1.875rem]! element-box-shadow"
                  :class="[
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? 'o2-ai-generate-button'
                      : 'o2-run-query-button o2-color-primary',
                    config.isEnterprise == 'true'
                      ? 'search-button-enterprise-border-radius'
                      : 'search-button-normal-border-radius',
                  ]"
                  @click="
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? handleGenerateSQLQuery()
                      : handleRunQueryFn()
                  "
                >
                  {{
                    isNaturalLanguageDetected && !searchObj.meta.nlpMode
                      ? t("search.generateQuery")
                      : t("search.runQuery")
                  }}
                </OButton>
                <q-separator class="tw:h-[1.875rem]! tw:w-[1px]" />
                <ODropdown align="end" side="bottom">
                  <template #trigger>
                    <OButton
                      variant="ghost"
                      size="icon-xs"
                      :class="[
                        !(
                          isNaturalLanguageDetected && !searchObj.meta.nlpMode
                        ) &&
                        config.isEnterprise == 'true' &&
                        visualizeSearchRequestTraceIds.length
                          ? 'o2-color-cancel'
                          : !(
                                isNaturalLanguageDetected &&
                                !searchObj.meta.nlpMode
                              )
                            ? 'o2-color-primary'
                            : '',
                        config.isEnterprise == 'true'
                          ? 'search-button-dropdown-enterprise-border-radius'
                          : 'search-button-normal-border-radius',
                      ]"
                    >
                      <q-icon name="arrow_drop_down" size="18px" />
                    </OButton>
                  </template>
                  <ODropdownItem
                    v-if="
                      !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                    "
                    data-test="logs-search-bar-refresh-btn"
                    data-cy="search-bar-visuzlie-hard-refresh-button"
                    :disabled="
                      config.isEnterprise == 'true' &&
                      !!visualizeSearchRequestTraceIds.length
                    "
                    @select="handleRunQueryFn(true)"
                  >
                    <template #icon-left
                      ><q-icon name="refresh" size="16px"
                    /></template>
                    {{ t("search.refreshCacheAndRunQuery") }}
                  </ODropdownItem>
                  <p
                    v-else
                    class="tw:text-xs tw:text-gray-500 tw:text-center tw:px-3 tw:py-2"
                  >
                    {{ t("nlMode.noAdditionalOptions") }}
                  </p>
                </ODropdown>
              </div>
            </div>
            <div v-else class="tw:flex tw:items-center">
              <OButton
                v-if="
                  config.isEnterprise == 'true' &&
                  (!!searchObj.data.searchRequestTraceIds.length ||
                    !!searchObj.data.searchWebSocketTraceIds.length) &&
                  (searchObj.loading == true ||
                    searchObj.loadingHistogram == true)
                "
                data-test="logs-search-bar-refresh-btn"
                data-cy="search-bar-refresh-button"
                variant="ghost"
                :title="t('search.cancel')"
                class="q-pa-none tw:h-[1.875rem]! o2-run-query-button o2-color-cancel element-box-shadow"
                :class="
                  config.isEnterprise == 'true'
                    ? 'search-button-enterprise-border-radius'
                    : 'search-button-normal-border-radius'
                "
                @click="cancelQuery"
                >{{ t("search.cancel") }}</OButton
              >
              <!-- Main action button: "Ask AI" when NL detected but AI bar not open, otherwise "Run Query" -->
              <OButton
                v-else
                data-test="logs-search-bar-refresh-btn"
                data-cy="search-bar-refresh-button"
                variant="ghost"
                :title="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? t('search.generateQueryTooltip')
                    : t('search.runQuery')
                "
                class="q-pa-none tw:h-[1.875rem]! element-box-shadow"
                :class="[
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? 'o2-ai-generate-button'
                    : 'o2-run-query-button o2-color-primary',
                  config.isEnterprise == 'true' ||
                  store.state.zoConfig.auto_query_enabled
                    ? 'search-button-enterprise-border-radius'
                    : 'search-button-normal-border-radius',
                ]"
                @click="
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? handleGenerateSQLQuery()
                    : handleRunQueryFn()
                "
                :loading="searchObj.loading || searchObj.loadingHistogram"
                :disabled="
                  searchObj.loading == true ||
                  searchObj.loadingHistogram == true ||
                  isGeneratingSQL ||
                  (isNaturalLanguageDetected &&
                    !searchObj.meta.nlpMode &&
                    !searchObj.data.stream.selectedStream.length)
                "
              >
                <q-tooltip
                  v-if="
                    searchObj.meta.liveMode &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  >{{ t("search.autoRunEnabled") }}</q-tooltip
                >
                <q-icon
                  v-if="
                    searchObj.meta.liveMode &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  name="autorenew"
                  size="14px"
                  class="q-mr-xs"
                />
                {{
                  isNaturalLanguageDetected && !searchObj.meta.nlpMode
                    ? t("search.generateQuery")
                    : t("search.runQuery")
                }}
              </OButton>
              <!-- Dropdown: shown for enterprise or when live mode feature is enabled -->
              <q-separator
                v-if="
                  config.isEnterprise == 'true' ||
                  store.state.zoConfig.auto_query_enabled
                "
                class="tw:h-[1.875rem]! tw:w-[1px]"
              />
              <ODropdown
                v-if="
                  config.isEnterprise == 'true' ||
                  store.state.zoConfig.auto_query_enabled
                "
                align="end"
                side="bottom"
              >
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-xs"
                    :class="[
                      !(isNaturalLanguageDetected && !searchObj.meta.nlpMode) &&
                      config.isEnterprise == 'true' &&
                      (!!searchObj.data.searchRequestTraceIds.length ||
                        !!searchObj.data.searchWebSocketTraceIds.length) &&
                      (searchObj.loading == true ||
                        searchObj.loadingHistogram == true)
                        ? 'o2-color-cancel'
                        : !(
                              isNaturalLanguageDetected &&
                              !searchObj.meta.nlpMode
                            )
                          ? 'o2-color-primary'
                          : '',
                      config.isEnterprise == 'true' ||
                      store.state.zoConfig.auto_query_enabled
                        ? 'search-button-dropdown-enterprise-border-radius'
                        : 'search-button-normal-border-radius',
                    ]"
                  >
                    <q-icon name="arrow_drop_down" size="18px" />
                  </OButton>
                </template>
                <!-- Normal mode: Refresh + Live Mode items -->
                <ODropdownItem
                  v-if="
                    config.isEnterprise == 'true' &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  data-test="logs-search-bar-refresh-btn"
                  data-cy="search-bar-refresh-button"
                  :disabled="
                    searchObj.loading == true ||
                    searchObj.loadingHistogram == true
                  "
                  @select="handleRunQueryFn(true)"
                >
                  <template #icon-left
                    ><q-icon name="refresh" size="16px"
                  /></template>
                  {{ t("search.refreshCacheAndRunQuery") }}
                </ODropdownItem>
                <ODropdownSeparator
                  v-if="
                    config.isEnterprise == 'true' &&
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                />
                <ODropdownItem
                  v-if="
                    store.state.zoConfig.auto_query_enabled &&
                    !(isNaturalLanguageDetected && !searchObj.meta.nlpMode)
                  "
                  data-test="logs-search-bar-live-mode-toggle-btn"
                  @select="toggleLiveMode"
                >
                  <template #icon-left>
                    <q-icon
                      :name="
                        searchObj.meta.liveMode ? 'autorenew' : 'sync_disabled'
                      "
                      size="16px"
                      :color="searchObj.meta.liveMode ? 'primary' : ''"
                    />
                  </template>
                  <span>
                    <div class="tw:font-medium tw:text-[12px]">
                      {{
                        searchObj.meta.liveMode
                          ? t("search.turnOffLiveMode")
                          : t("search.turnOnLiveMode")
                      }}
                    </div>
                    <div class="tw:text-[11px] tw:text-muted-foreground">
                      {{ t("search.liveModeTooltip") }}
                    </div>
                  </span>
                </ODropdownItem>
                <!-- NLP mode: info message -->
                <p
                  v-if="isNaturalLanguageDetected && !searchObj.meta.nlpMode"
                  class="tw:text-xs tw:text-gray-500 tw:text-center tw:px-3 tw:py-2"
                >
                  {{ t("nlMode.noAdditionalOptions") }}
                </p>
              </ODropdown>
              <!-- Compact Auto Refresh Button -->
              <auto-refresh-interval
                class="q-ml-xs"
                v-model="searchObj.meta.refreshInterval"
                :trigger="true"
                :is-compact="true"
                :min-refresh-interval="
                  store.state?.zoConfig?.min_auto_refresh_interval ?? 0
                "
                @update:model-value="onRefreshIntervalUpdate"
                @trigger="$emit('onAutoIntervalTrigger')"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="row query-editor-container">
      <div
        class="col tw:h-full"
        :class="{ 'expand-on-focus': isFocused }"
        :style="backgroundColorStyle"
      >
        <q-splitter
          class="logs-search-splitter tw:h-full!"
          no-scroll
          v-model="searchObj.config.fnSplitterModel"
          :limits="searchObj.config.fnSplitterLimit"
        >
          <template #before>
            <div
              class="col tw:border tw:solid tw:border-[var(--o2-border-color)] tw:mb-[0.375rem] tw:rounded-[0.375rem] tw:overflow-hidden tw:h-full tw:relative"
              :class="
                searchObj.data.transformType &&
                searchObj.meta.showTransformEditor
                  ? 'tw:ml-[0.375rem]'
                  : 'tw:ml-[0.375rem]'
              "
            >
              <!-- Unified Query Editor (with built-in AI bar) -->
              <unified-query-editor
                v-if="router.currentRoute.value.name === 'logs'"
                ref="queryEditorRef"
                :query="searchObj.data.query"
                :keywords="effectiveKeywords"
                :suggestions="effectiveSuggestions"
                :debounce-time="100"
                :nlp-mode="searchObj.meta.nlpMode"
                :show-ai-icon="
                  config.isEnterprise == 'true' &&
                  store.state.zoConfig.ai_enabled
                "
                :disable-ai="
                  !searchObj.data.stream.selectedStream.length ||
                  isSqlModeDisabled
                "
                :disable-ai-reason="
                  !searchObj.data.stream.selectedStream.length
                    ? t('search.selectStreamForAI')
                    : t('search.nlpModeDisabledForVisualization')
                "
                data-test="logs-search-bar-query-editor"
                data-test-prefix="logs-search-bar"
                editor-height="100%"
                :style="editorWidthToggleFunction"
                :class="
                  searchObj.data.editorValue == '' &&
                  searchObj.meta.queryEditorPlaceholderFlag
                    ? 'empty-query'
                    : ''
                "
                language="sql"
                :readOnly="
                  searchObj.meta.logsVisualizeToggle === 'build' &&
                  searchObj.meta.buildModeQueryEditorDisabled
                "
                @update:query="updateQueryValue"
                @update:nlp-mode="(val) => (searchObj.meta.nlpMode = val)"
                @run-query="handleRunQueryFn"
                @keydown="handleKeyDown"
                @focus="searchObj.meta.queryEditorPlaceholderFlag = false"
                @blur="searchObj.meta.queryEditorPlaceholderFlag = true"
              />
            </div>
          </template>
          <template #after>
            <div
              data-test="logs-vrl-function-editor"
              v-if="searchObj.data.transformType"
              style="width: 100%; height: 100%"
            >
              <template v-if="showFunctionEditor">
                <div class="tw:relative tw:h-full tw:w-full">
                  <div
                    class="tw:border tw:solid tw:border-[var(--o2-border-color)] tw:mr-[0.375rem] tw:mb-[0.375rem] tw:rounded-[0.375rem] tw:relative tw:h-full"
                  >
                    <!-- Unified Query Editor (with built-in AI bar) -->
                    <unified-query-editor
                      v-if="router.currentRoute.value.name === 'logs'"
                      data-test="logs-vrl-function-editor"
                      ref="fnEditorRef"
                      :languages="['vrl']"
                      :default-language="'vrl'"
                      :query="searchObj.data.tempFunctionContent"
                      :nlp-mode="vrlEditorNlpMode"
                      :hide-nl-toggle="false"
                      :disable-ai="isVrlEditorDisabled"
                      :disable-ai-reason="
                        isVrlEditorDisabled ? t('search.vrlOnlyForTable') : ''
                      "
                      :ai-placeholder="t('search.askAIFunctionPlaceholder')"
                      :ai-tooltip="t('search.enterFunctionPrompt')"
                      :read-only="isVrlEditorDisabled"
                      editor-height="100%"
                      class="monaco-editor"
                      :class="
                        searchObj.data.tempFunctionContent == '' &&
                        searchObj.meta.functionEditorPlaceholderFlag
                          ? 'empty-function'
                          : ''
                      "
                      @update:query="
                        searchObj.data.tempFunctionContent = $event
                      "
                      @update:nlp-mode="(val) => (vrlEditorNlpMode = val)"
                      @keydown="handleKeyDown"
                      @focus="
                        searchObj.meta.functionEditorPlaceholderFlag = false
                      "
                      @blur="
                        searchObj.meta.functionEditorPlaceholderFlag = true
                      "
                    />
                    <!-- VRL disabled warning for non-table charts -->
                    <div
                      v-if="isVrlEditorDisabled"
                      class="tw:absolute tw:bottom-0 tw:w-full"
                      :style="{
                        marginTop: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        backgroundColor:
                          store.state.theme == 'dark'
                            ? 'rgba(255, 255, 255, 0.1)'
                            : 'rgba(0, 0, 0, 0.1)',
                      }"
                      data-test="vrl-editor-disabled-warning"
                    >
                      <q-icon
                        name="warning"
                        color="warning"
                        size="20px"
                        class="q-mx-sm"
                      />
                      <span
                        class="text-negative q-pa-sm"
                        style="font-weight: 600; font-size: 14px"
                        >VRL function is only supported for table chart.</span
                      >
                    </div>
                  </div>
                </div>
              </template>
              <template v-else-if="searchObj.data.transformType === 'action'">
                <code-query-editor
                  v-if="router.currentRoute.value.name === 'logs'"
                  data-test="logs-vrl-function-editor"
                  ref="fnEditorRef"
                  editor-id="fnEditor"
                  class="monaco-editor"
                  :query="actionEditorQuery"
                  read-only
                  language="markdown"
                />
              </template>
            </div>
          </template>
        </q-splitter>
      </div>
      <OButton
        data-test="logs-query-editor-full_screen-btn"
        :title="isFocused ? t('search.collapse') : t('search.expand')"
        variant="ghost"
        size="icon"
        @click="isFocused = !isFocused"
        class="q-pa-xs tw:absolute! tw:z-50 fullscreen-hover-btn"
        :style="{
          top:
            (searchObj.meta.nlpMode && !searchObj.meta.showTransformEditor) ||
            (vrlEditorNlpMode &&
              searchObj.meta.showTransformEditor &&
              searchObj.data.transformType === 'function')
              ? '6.5rem'
              : '3.5rem',
          right:
            (searchObj.meta.nlpMode && !searchObj.meta.showTransformEditor) ||
            (vrlEditorNlpMode &&
              searchObj.meta.showTransformEditor &&
              searchObj.data.transformType === 'function')
              ? '1.6rem'
              : '4rem',
        }"
      >
        <Maximize size="0.8rem" v-if="!isFocused" />
        <Minimize size="0.8rem" v-else />
      </OButton>
    </div>

    <q-dialog ref="confirmDialog" v-model="confirmDialogVisible">
      <q-card>
        <q-card-section>
          {{ confirmMessage }}
        </q-card-section>

        <q-card-actions align="right" class="tw:gap-2">
          <OButton
            data-test="logs-search-bar-confirm-dialog-cancel-btn"
            variant="outline"
            size="sm-action"
            @click="cancelConfirmDialog"
            >{{ t("confirmDialog.cancel") }}</OButton
          >
          <OButton
            data-test="logs-search-bar-confirm-dialog-ok-btn"
            variant="primary"
            size="sm-action"
            @click="confirmDialogOK"
            >{{ t("confirmDialog.ok") }}</OButton
          >
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog
      ref="confirmSavedViewDialog"
      v-model="confirmSavedViewDialogVisible"
    >
      <q-card>
        <q-card-section>
          {{ confirmMessageSavedView }}
        </q-card-section>

        <q-card-actions align="right" class="tw:gap-2">
          <OButton
            data-test="logs-search-bar-confirm-dialog-cancel-btn"
            variant="outline"
            size="sm-action"
            @click="cancelConfirmDialog"
            >{{ t("confirmDialog.cancel") }}</OButton
          >
          <OButton
            data-test="logs-search-bar-confirm-dialog-ok-btn"
            variant="primary"
            size="sm-action"
            @click="confirmDialogOK"
            >{{ t("confirmDialog.ok") }}</OButton
          >
        </q-card-actions>
      </q-card>
    </q-dialog>
    <CustomDownloadDialog v-model="customDownloadDialog" />
    <q-dialog v-model="store.state.savedViewDialog">
      <q-card style="width: 700px; max-width: 80vw">
        <q-card-section>
          <div class="text-h6">{{ t("search.savedViewsLabel") }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div v-if="isSavedViewAction == 'create'">
            <q-input
              data-test="add-alert-name-input"
              v-model="savedViewName"
              :label="t('search.savedViewName')"
              color="input-border"
              bg-color="input-bg"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              :rules="[
                (val) => !!val.trim() || 'This field is required',
                (val) =>
                  /^[-A-Za-z0-9 /@/_]+$/.test(val) ||
                  'Input must be alphanumeric',
              ]"
              tabindex="0"
            />
          </div>
          <div v-else>
            <q-select
              data-test="saved-view-name-select"
              v-model="savedViewSelectedName"
              :options="searchObj.data.savedViews"
              option-label="view_name"
              option-value="view_id"
              :label="t('search.savedViewName')"
              :popup-content-style="{ textTransform: 'capitalize' }"
              color="input-border"
              bg-color="input-bg"
              class="q-py-sm showLabelOnTop"
              stack-label
              borderless
              dense
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="tw:gap-2">
          <OButton
            data-test="saved-view-dialog-cancel-btn"
            variant="outline"
            size="sm-action"
            v-close-popup
            >{{ t("confirmDialog.cancel") }}</OButton
          >
          <OButton
            data-test="saved-view-dialog-save-btn"
            v-if="!saveViewLoader"
            variant="primary"
            size="sm-action"
            @click="handleSavedView"
            >{{ t("common.save") }}</OButton
          >
          <OButton
            data-test="saved-view-dialog-loading-btn"
            v-if="saveViewLoader"
            variant="primary"
            size="sm-action"
            :loading="true"
            >{{ t("confirmDialog.loading") }}</OButton
          >
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="store.state.savedFunctionDialog">
      <q-card style="width: 700px; max-width: 80vw">
        <q-card-section>
          <div class="text-h6">{{ t("search.functionPlaceholder") }}</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="tw:flex tw:items-center">
            <span class="tw:mt-2">Update</span>
            <q-toggle
              data-test="saved-function-action-toggle"
              v-bind:disable="functionOptions.length == 0"
              name="saved_function_action"
              v-model="isSavedFunctionAction"
              true-value="create"
              false-value="update"
              label=""
              size="lg"
              class="o2-toggle-button-lg"
              @change="savedFunctionName = ''"
            />
            <span class="tw:mt-2">Create</span>
          </div>
          <div v-if="isSavedFunctionAction == 'create'">
            <q-input
              data-test="saved-function-name-input"
              v-model="savedFunctionName"
              :label="t('search.saveFunctionName')"
              class="showLabelOnTop"
              stack-label
              borderless
              dense
              :rules="[
                (val) => !!val.trim() || 'This field is required',
                (val) =>
                  /^[-A-Za-z0-9/_]+$/.test(val) || 'Input must be alphanumeric',
              ]"
              tabindex="0"
            />
          </div>
          <div v-else>
            <q-select
              data-test="saved-function-name-select"
              v-model="savedFunctionSelectedName"
              :options="functionOptions"
              option-label="name"
              option-value="name"
              :label="t('search.saveFunctionName')"
              placeholder="Select Function Name"
              :popup-content-style="{ textTransform: 'capitalize' }"
              class="q-py-sm showLabelOnTop"
              stack-label
              borderless
              dense
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="tw:gap-2">
          <OButton
            data-test="saved-function-dialog-cancel-btn"
            variant="outline"
            size="sm-action"
            v-close-popup
            >{{ t("confirmDialog.cancel") }}</OButton
          >
          <OButton
            data-test="saved-view-dialog-save-btn"
            v-if="!saveFunctionLoader"
            variant="primary"
            size="sm-action"
            @click="saveFunction"
            >{{ t("confirmDialog.ok") }}</OButton
          >
          <OButton
            data-test="saved-function-dialog-loading-btn"
            v-if="saveFunctionLoader"
            variant="primary"
            size="sm-action"
            :loading="true"
            >{{ t("confirmDialog.loading") }}</OButton
          >
        </q-card-actions>
      </q-card>
    </q-dialog>
    <SearchSchedulerDialog
      v-model="searchSchedulerJob"
      @submitted="getJobData()"
    />

    <SearchInspectDialog v-model="searchInspectDialog" />

    <ConfirmDialog
      title="Change Query Mode"
      message="Are you sure you want to change the query mode? The data saved for X-Axis, Y-Axis and Filters will be wiped off."
      @update:ok="confirmBuildModeChangeOk"
      @update:cancel="confirmBuildModeChange = false"
      v-model="confirmBuildModeChange"
    />
    <ConfirmDialog
      title="Delete Saved View"
      message="Are you sure you want to delete saved view?"
      @update:ok="confirmDeleteSavedViews"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />
    <ConfirmDialog
      title="Update Saved View"
      message="Are you sure you want to update the saved view? This action will overwrite the existing one."
      @update:ok="confirmUpdateSavedViews"
      @update:cancel="confirmUpdate = false"
      v-model="confirmUpdate"
    />
    <!-- Query Plan Dialog -->
    <QueryPlanDialog v-model="showExplainDialog" :searchObj="searchObj" />

    <!-- Saved Views List Dialog -->
    <q-dialog
      v-model="savedViewsListDialog"
      data-test="saved-views-list-dialog"
    >
      <q-card
        :style="
          localSavedViews.length > 0
            ? 'width: 600px; max-width: 80vw'
            : 'width: 350px; max-width: 80vw'
        "
      >
        <q-card-section class="row items-center q-pb-none q-pa-md">
          <div class="text-h6">{{ t("search.savedViewsLabel") }}</div>
          <q-space />
          <OButton variant="ghost" size="icon-circle" v-close-popup>
            <q-icon name="cancel" />
          </OButton>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-pt-md">
          <q-list data-test="logs-search-saved-view-list">
            <q-item style="padding: 0px 0px 0px 0px">
              <q-item-section
                class="column"
                no-hover
                :style="
                  localSavedViews.length > 0
                    ? 'width: 60%; border-right: 1px solid lightgray'
                    : 'width: 100%'
                "
              >
                <q-table
                  data-test="log-search-saved-view-list-fields-table"
                  :visible-columns="['view_name']"
                  :rows="searchObj.data.savedViews"
                  :row-key="(row) => 'saved_view_' + row.view_id"
                  :filter="searchObj.data.savedViewFilterFields"
                  :filter-method="filterSavedViewFn"
                  :pagination="{ rowsPerPage }"
                  hide-header
                  :wrap-cells="searchObj.meta.resultGrid.wrapCells"
                  class="saved-view-table full-height"
                  no-hover
                  :rows-per-page-options="[]"
                  style="min-height: 420px; height: 420px"
                  :hide-bottom="searchObj.data.savedViews.length == 0"
                >
                  <template #top>
                    <div class="full-width">
                      <q-input
                        data-test="log-search-saved-view-field-search-input"
                        v-model="searchObj.data.savedViewFilterFields"
                        borderless
                        dense
                        clearable
                        debounce="300"
                        class="tw:mx-2 tw:my-2"
                        :placeholder="t('search.searchSavedView')"
                      >
                        <template #prepend>
                          <q-icon name="search" />
                        </template>
                      </q-input>
                    </div>
                    <div
                      v-if="searchObj.loadingSavedView == true"
                      class="full-width q-pa-sm"
                    >
                      <div class="text-subtitle2 text-weight-bold">
                        <q-spinner-hourglass size="20px" />
                        {{ t("confirmDialog.loading") }}
                      </div>
                    </div>
                  </template>
                  <template v-slot:no-data>
                    <div
                      v-if="searchObj.loadingSavedView == false"
                      class="text-center q-pa-sm tw:w-full"
                    >
                      <q-item-label>{{
                        t("search.savedViewsNotFound")
                      }}</q-item-label>
                    </div>
                  </template>
                  <template v-slot:body-cell-view_name="props">
                    <q-td :props="props" class="field_list" no-hover>
                      <q-item class="q-pa-xs saved-view-item" clickable>
                        <q-item-section
                          @click.stop="
                            applySavedView(props.row);
                            savedViewsListDialog = false;
                          "
                          :title="props.row.view_name"
                        >
                          <q-item-label
                            class="ellipsis"
                            style="max-width: 140px"
                            >{{ props.row.view_name }}</q-item-label
                          >
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                          side
                          @click.stop="
                            handleFavoriteSavedView(
                              props.row,
                              favoriteViews.includes(props.row.view_id),
                            )
                          "
                        >
                          <OButton
                            :title="t('common.favourite')"
                            class="logs-saved-view-icon"
                            variant="ghost"
                            size="icon"
                          >
                            <q-icon
                              :name="
                                favoriteViews.includes(props.row.view_id)
                                  ? 'favorite'
                                  : 'favorite_border'
                              "
                              size="xs"
                            />
                          </OButton>
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-update-${props.row.view_name}-saved-view-btn`"
                          side
                          @click.stop="handleUpdateSavedView(props.row)"
                        >
                          <OButton
                            :title="t('common.edit')"
                            class="logs-saved-view-icon"
                            variant="ghost"
                            size="icon"
                          >
                            <q-icon name="edit" size="xs" />
                          </OButton>
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-delete-${props.row.view_name}-saved-view-btn`"
                          side
                          @click.stop="handleDeleteSavedView(props.row)"
                        >
                          <OButton
                            :title="t('common.delete')"
                            class="logs-saved-view-icon"
                            variant="ghost"
                            size="icon"
                          >
                            <q-icon name="delete" size="xs" />
                          </OButton>
                        </q-item-section>
                      </q-item>
                    </q-td>
                  </template>
                </q-table>
              </q-item-section>

              <q-item-section
                class="column"
                style="width: 40%; margin-left: 0px"
                v-if="localSavedViews.length > 0"
              >
                <q-table
                  data-test="log-search-saved-view-favorite-list-fields-table"
                  :visible-columns="['view_name']"
                  :rows="localSavedViews"
                  :row-key="(row) => 'favorite_saved_view_' + row.view_name"
                  hide-header
                  :wrap-cells="searchObj.meta.resultGrid.wrapCells"
                  class="saved-view-table full-height"
                  :rows-per-page-options="[]"
                  :hide-bottom="true"
                >
                  <template #top-right>
                    <q-item style="padding: 0px"
                      ><q-item-label
                        header
                        class="q-pa-sm text-bold favorite-label"
                        >{{ t("search.favoriteViews") }}</q-item-label
                      ></q-item
                    >
                    <q-separator horizontal inset></q-separator>
                  </template>
                  <template v-slot:body-cell-view_name="props">
                    <q-td :props="props" class="field_list q-pa-xs">
                      <q-item class="q-pa-xs saved-view-item" clickable>
                        <q-item-section
                          @click.stop="
                            applySavedView(props.row);
                            savedViewsListDialog = false;
                          "
                        >
                          <q-item-label
                            class="ellipsis"
                            style="max-width: 90px"
                            >{{ props.row.view_name }}</q-item-label
                          >
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-favorite-${props.row.view_name}-saved-view-btn`"
                          side
                          @click.stop="
                            handleFavoriteSavedView(
                              props.row,
                              favoriteViews.includes(props.row.view_id),
                            )
                          "
                        >
                          <q-icon
                            :name="
                              favoriteViews.includes(props.row.view_id)
                                ? 'favorite'
                                : 'favorite_border'
                            "
                            color="grey"
                            size="xs"
                          />
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-update-${props.row.view_name}-favorite-saved-view-btn`"
                          side
                          @click.stop="handleUpdateSavedView(props.row)"
                        >
                          <OButton
                            :title="t('common.edit')"
                            class="logs-saved-view-icon"
                            variant="ghost"
                            size="icon"
                          >
                            <q-icon name="edit" size="xs" />
                          </OButton>
                        </q-item-section>
                        <q-item-section
                          :data-test="`logs-search-bar-delete-${props.row.view_name}-favorite-saved-view-btn`"
                          side
                          @click.stop="handleDeleteSavedView(props.row)"
                        >
                          <OButton
                            :title="t('common.delete')"
                            class="logs-saved-view-icon"
                            variant="ghost"
                            size="icon"
                          >
                            <q-icon name="delete" size="xs" />
                          </OButton>
                        </q-item-section>
                      </q-item>
                    </q-td>
                  </template>
                </q-table>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  onMounted,
  nextTick,
  watch,
  toRaw,
  onActivated,
  onUnmounted,
  onDeactivated,
  defineAsyncComponent,
  onBeforeMount,
  onBeforeUnmount,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuasar, copyToClipboard, is, QTooltip } from "quasar";

import DateTime from "@/components/DateTime.vue";
import ShareButton from "@/components/common/ShareButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import useLogs from "@/composables/useLogs";
import useStreams from "@/composables/useStreams";
import SyntaxGuide from "./SyntaxGuide.vue";
import jsTransformService from "@/services/jstransform";
import searchService from "@/services/search";
import shortURLService from "@/services/short_url";

import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
// Lazy load CodeQueryEditor to avoid loading Monaco Editor eagerly
const CodeQueryEditor = defineAsyncComponent(
  () => import("@/components/CodeQueryEditor.vue"),
);
// Unified QueryEditor for main query editor (with built-in AI bar)
const UnifiedQueryEditor = defineAsyncComponent(
  () => import("@/components/QueryEditor.vue"),
);

import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import useSqlSuggestions from "@/composables/useSuggestions";
import downloadLogsUtil from "@/utils/logs/downloadLogs";
import QueryPlanDialog from "@/components/QueryPlanDialog.vue";
import CustomDownloadDialog from "./components/CustomDownloadDialog.vue";
import SearchSchedulerDialog from "./components/SearchSchedulerDialog.vue";
import SearchInspectDialog from "./components/SearchInspectDialog.vue";
import {
  mergeDeep,
  b64DecodeUnicode,
  getImageURL,
  useLocalInterestingFields,
  useLocalSavedView,
  queryIndexSplit,
  timestampToTimezoneDate,
  b64EncodeUnicode,
  buildDateTimeObject,
} from "@/utils/zincutils";

import { debounce } from "lodash-es";
import savedviewsService from "@/services/saved_views";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import { inject } from "vue";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import { computed } from "vue";
import { useLoading } from "@/composables/useLoading";
import TransformSelector from "./TransformSelector.vue";
import FunctionSelector from "./FunctionSelector.vue";
import useSearchWebSocket from "@/composables/useSearchWebSocket";
import useNotifications from "@/composables/useNotifications";
import histogram_svg from "../../assets/images/common/histogram_image.svg";
import { allSelectionFieldsHaveAlias } from "@/utils/query/visualizationUtils";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import {
  logsUtils,
  removeFieldFromWhereAST,
} from "@/composables/useLogs/logsUtils";
import { searchState } from "@/composables/useLogs/searchState";
import {
  getVisualizationConfig,
  encodeVisualizationConfig,
  decodeVisualizationConfig,
} from "@/composables/useLogs/logsVisualization";

import useSearchBar from "@/composables/useLogs/useSearchBar";
import { useSearchStream } from "@/composables/useLogs/useSearchStream";
import useStreamFields from "@/composables/useLogs/useStreamFields";
import {
  Bookmark,
  ChartLine,
  ChartNoAxesColumn,
  RefreshCcw,
  ScanSearch,
  Share,
  Ellipsis,
  Maximize,
  Minimize,
  Wrench,
  Code2,
  Layers,
} from "lucide-vue-next";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import {
  getFieldFromExpression,
  hasFieldCondition,
  replaceExistingFieldCondition,
  removeFieldCondition,
} from "@/plugins/logs/filterUtils";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

/**
 * Extracts the field name from a filter expression.
 * Handles single: `field = 'val'`, multi: `(field = 'x' OR field = 'y')`,
 * and SQL-prefixed: `"stream".field = 'val'`.
 */
const getFieldFromExpression = (expression: string): string | null => {
  const cleaned = expression.trim().replace(/^\(\s*/, "");
  const match =
    cleaned.match(/^"[^"]+"\."?(\w+)"?\s*(?:=|!=|is)/i) ||
    cleaned.match(/^"?(\w+)"?\s*(?:=|!=|is)/i);
  return match ? match[1] : null;
};

/**
 * Tries to replace an existing condition for `fieldName` in `queryStr` with
 * `newExpression`. Returns the modified string, or the original if not found.
 * Handles both parenthesized multi-value groups and single conditions.
 */
const replaceExistingFieldCondition = (
  queryStr: string,
  fieldName: string,
  newExpression: string,
): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'[^']*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  const fieldPat = `(?:"${esc}"|${esc})`;
  const condPat = `(?:"[^"]+"\\.)?${fieldPat}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(
    `\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`,
    "gi",
  );
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, newExpression);
  }

  // Try single condition
  const singleRegex = new RegExp(condPat, "gi");
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, newExpression);
  }

  return queryStr;
};

export default defineComponent({
  name: "ComponentSearchSearchBar",
  components: {
    OButtonGroup,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    DateTime,
    ShareButton,
    OButton,
    SyntaxGuide,
    AutoRefreshInterval,
    ConfirmDialog,
    TransformSelector,
    FunctionSelector,
    CodeQueryEditor,
    UnifiedQueryEditor,
    QueryPlanDialog,
    CustomDownloadDialog,
    SearchSchedulerDialog,
    SearchInspectDialog,
    ScanSearch,
    ChartLine,
    ChartNoAxesColumn,
    RefreshCcw,
    Bookmark,
    Share,
    Ellipsis,
    Maximize,
    Minimize,
    Wrench,
    Code2,
    Layers,
    OToggleGroup,
    OToggleGroupItem,
  },
  emits: [
    "searchdata",
    "onChangeInterval",
    "onChangeTimezone",
    "handleQuickModeChange",
    "handleRunQueryFn",
    "onAutoIntervalTrigger",
    "showSearchHistory",
    "extractPatterns",
    "buildModeToggle",
  ],
  methods: {
    searchData() {
      if (this.searchObj.loading == false) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
    changeFunctionName(value) {
      // alert(value)
      // console.log(value);
    },
    createNewValue(inputValue, doneFn) {
      // Call the doneFn with the new value
      doneFn(inputValue);
    },
    updateSelectedValue() {
      // Update the selected value with the newly created value
      if (
        this.functionModel &&
        !this.functionOptions.includes(this.functionModel)
      ) {
        this.functionOptions.push(this.functionModel);
      }
    },
    handleDeleteSavedView(item: any) {
      this.savedViewDropdownModel = false;
      this.deleteViewID = item.view_id;
      this.confirmDelete = true;
    },
    handleUpdateSavedView(item: any) {
      if (this.searchObj.data.stream.selectedStream.length == 0) {
        this.$q.notify({
          type: "negative",
          message: "No stream available to update save view.",
        });
        return;
      }
      this.savedViewDropdownModel = false;
      this.updateViewObj = item;
      this.confirmUpdate = true;
    },
    confirmDeleteSavedViews() {
      this.deleteSavedViews();
    },
    toggleCustomDownloadDialog() {
      this.customDownloadDialog = true;
    },
    confirmUpdateSavedViews() {
      this.updateSavedViews(
        this.updateViewObj.view_id,
        this.updateViewObj.view_name,
      );
      return;
    },
    handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        this.handleRunQueryFn();
      }
    },
  },
  props: {
    fieldValues: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const store = useStore();
    const { showErrorNotification } = useNotifications();
    const rowsPerPage = ref(10);
    const regionFilter = ref();
    const regionFilterRef = ref(null);
    const { resetStreamData, searchObj } = searchState();
    const { buildSearch } = useSearchStream();

    const {
      fnParsedSQL,
      fnUnparsedSQL,
      updatedLocalLogFilterField,
      updateUrlQueryParams,
      generateURLQuery,
      isActionsEnabled,
      checkTimestampAlias,
    } = logsUtils();
    const {
      getSavedViews,
      setSelectedStreams,
      onStreamChange,
      getQueryData,
      cancelQuery,
    } = useSearchBar();
    const { loadStreamLists, extractFields } = useStreamFields();

    const {
      refreshData,
      handleRunQuery,
      getJobData,
      routeToSearchSchedule,
      getHistogramTitle,
    } = useLogs();

    const { isStreamExists, isStreamFetched, getStreams, getStream } =
      useStreams();
    const queryEditorRef = ref(null);
    const syntaxGuideRef = ref(null);

    const formData: any = ref(defaultValue());
    const functionOptions = ref(searchObj.data.transforms);

    const { closeSocketWithError } = useSearchWebSocket();

    const transformsExpandState = ref({
      actions: false,
      functions: false,
    });

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);

    const isSavedFunctionAction: string = ref("create");
    const savedFunctionName: string = ref("");
    const savedFunctionSelectedName: string = ref("");
    const saveFunctionLoader = ref(false);

    const isFocused = ref(false);

    const confirmDialogVisible: boolean = ref(false);
    const confirmSavedViewDialogVisible: boolean = ref(false);
    const searchSchedulerJob = ref(false);
    const autoSearchSchedulerJob = ref(false);
    const searchInspectDialog = ref(false);
    let confirmCallback;
    let streamName = "";

    const dateTimeRef = ref(null);
    const saveViewLoader = ref(false);
    const favoriteViews = ref([]);

    const localSavedViews = ref([]);
    let savedViews = useLocalSavedView();
    if (savedViews.value != null) {
      const favoriteValues = [];
      Object.values(savedViews.value).forEach((view) => {
        if (view.org_id === store.state.selectedOrganization.identifier) {
          favoriteViews.value.push(view.view_id);
          favoriteValues.push(view);
        }
      });

      localSavedViews.value.push(...favoriteValues);
    }

    const {
      autoCompleteData,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      effectiveKeywords,
      effectiveSuggestions,
      getSuggestions,
      updateFieldKeywords,
      updateFunctionKeywords,
      updateStreamKeywords,
    } = useSqlSuggestions();

    const refreshTimeChange = (item) => {
      searchObj.meta.refreshInterval = Number(item.value);
    };

    const isSavedViewAction = ref("create");
    const savedViewName = ref("");
    const savedViewSelectedName = ref("");
    const showExplainDialog = ref(false);
    const confirmDelete = ref(false);
    const deleteViewID = ref("");
    const savedViewDropdownModel = ref(false);
    const savedViewsListDialog = ref(false);
    const moreOptionsDropdownModel = ref(false);
    const searchTerm = ref("");

    const filteredFunctionOptions = computed(() => {
      if (searchObj.data.transformType !== "function") return [];
      if (!searchTerm.value) return functionOptions.value;
      return functionOptions.value.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
      );
    });

    const filteredActionOptions = computed(() => {
      if (searchObj.data.transformType !== "action") return [];
      if (!searchTerm.value) return searchObj.data.actions;
      return searchObj.data.actions.filter((item) =>
        item.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
      );
    });

    const filteredTransformOptions = computed(() => {
      if (!searchObj.data.transformType) return [];

      if (searchObj.data.transformType === "action")
        return filteredActionOptions.value;

      if (searchObj.data.transformType === "function")
        return filteredFunctionOptions.value;

      return [];
    });

    // const toggleHistogram = ref(false);

    const toggleHistogram = computed({
      get: () => {
        return searchObj.meta.showHistogram;
      },
      set: (value) => {
        searchObj.meta.showHistogram = value;
      },
    });

    // Track if AI is currently generating SQL query
    // Updated via @generation-start / @generation-end events from QueryEditor
    const isGeneratingSQL = ref(false);

    const hasInteractedWithAI = ref(false); // Track if user has used AI in non-NLP mode
    const isNaturalLanguageDetected = ref(false); // Track NL detection without switching modes

    // Track window width for responsive toolbar layout
    const windowWidth = ref(window.innerWidth);
    const onWindowResize = () => {
      windowWidth.value = window.innerWidth;
    };

    // Responsive breakpoints: progressively move items into menus
    // <= 1440px: saved views + reset ? left hamburger menu
    // <= 1280px: also histogram + SQL toggles ? left hamburger menu
    // <= 1024px: also share + transform selector ? right overflow menu
    const shouldMoveSavedViewToMenu = computed(() => windowWidth.value <= 1440);
    const shouldMoveSqlToggleToMenu = computed(() => windowWidth.value <= 1280);
    const shouldMoveShareToMenu = computed(() => windowWidth.value <= 1100);
    const vrlEditorNlpMode = ref(false); // Track VRL editor's AI mode

    const confirmUpdate = ref(false);
    const updateViewObj = ref({});

    const transformTypes = computed(() => {
      return [
        { label: "Function", value: "function" },
        { label: "Action", value: "action" },
      ];
    });

    const showFunctionEditor = computed(() => {
      // IF actions are disabled, we are reverting to the old behavior of function editor
      if (!isActionsEnabled.value) return searchObj.meta.showTransformEditor;

      return searchObj.data.transformType === "function";
    });

    // Check if VRL editor should be disabled (in visualize mode with non-table chart)
    const isVrlEditorDisabled = computed(() => {
      return (
        searchObj.meta.logsVisualizeToggle === "visualize" &&
        dashboardPanelData.data.type !== "table"
      );
    });

    watch(
      () => searchObj.data.transforms,
      (newVal) => {
        functionOptions.value = newVal;
      },
    );

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      (fields) => {
        if (fields != undefined && fields.length) updateFieldKeywords(fields);
      },
      { immediate: true, deep: true },
    );

    watch(
      () => searchObj.data.streamResults?.list,
      (list) => {
        updateStreamKeywords((list ?? []).map((s: any) => ({ name: s.name })));
      },
      { immediate: true, deep: false },
    );
    watch(
      () => searchObj.meta.showSearchScheduler,
      (showSearchScheduler) => {
        if (showSearchScheduler) {
          searchSchedulerJob.value = true;
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.meta.functionEditorPlaceholderFlag,
      (val) => {
        if (
          searchObj.meta.jobId != "" &&
          val == true &&
          (router.currentRoute.value.query.functionContent ||
            searchObj.data.tempFunctionContent != "")
        ) {
          if (!checkFnQuery(searchObj.data.tempFunctionContent)) {
            $q.notify({
              message: "Job Context have been removed",
              color: "warning",
              position: "bottom",
              timeout: 2000,
            });
            searchObj.meta.jobId = "";
            searchObj.data.queryResults.hits = [];
            // getQueryData(false);
          }
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.meta.showHistogram,
      (val) => {
        if (val == true && searchObj.meta.jobId != "") {
          $q.notify({
            message: "Histogram is not available for scheduled search",
            color: "negative",
            position: "bottom",
            timeout: 2000,
          });
          searchObj.meta.showHistogram = false;
          searchObj.loadingHistogram = false;
        }
      },
      { immediate: true, deep: true },
    );
    watch(
      () => searchObj.data.stream.functions,
      (funs) => {
        if (funs.length) updateFunctionKeywords(funs);
      },
      { immediate: true, deep: true },
    );

    // Watch NLP mode toggle - AI mode is independent of SQL mode
    watch(
      () => searchObj.meta.nlpMode,
      (newNlpMode, oldNlpMode) => {
        if (newNlpMode === true && oldNlpMode === false) {
          // NLP mode turned ON - reset detection flag
          isNaturalLanguageDetected.value = false;
        } else if (newNlpMode === false && oldNlpMode === true) {
          // NLP mode turned OFF - reset flags
          isNaturalLanguageDetected.value = false;
          hasInteractedWithAI.value = false;
        }
      },
    );

    onBeforeUnmount(() => {
      queryEditorRef.value = null;
      fnEditorRef.value = null;
    });

    const transformsLabel = computed(() => {
      if (
        searchObj.data.selectedTransform?.type ===
          searchObj.data.transformType &&
        searchObj.data.transformType
      ) {
        return searchObj.data.selectedTransform.name;
      }

      return searchObj.data.transformType === "action"
        ? "Action"
        : searchObj.data.transformType === "function"
          ? "Function"
          : "Transform";
    });

    const actionEditorQuery = computed(() => {
      if (
        searchObj.data.transformType === "action" &&
        searchObj.data.selectedTransform?.type === "action" &&
        searchObj.data.selectedTransform?.name
      ) {
        return `${searchObj.data.selectedTransform?.name} action applied successfully. Run Query to see results.`;
      }

      return "Select an action to apply";
    });

    const updateAutoComplete = (value) => {
      autoCompleteData.value.query = value;
      autoCompleteData.value.cursorIndex =
        queryEditorRef?.value?.getCursorIndex();
      autoCompleteData.value.fieldValues = props.fieldValues;
      autoCompleteData.value.popup.open =
        queryEditorRef?.value?.triggerAutoComplete;
      // [NEW] Pass stream context for IndexedDB value lookups
      autoCompleteData.value.org = store.state.selectedOrganization.identifier;
      autoCompleteData.value.streamType =
        searchObj.data.stream.streamType ?? "logs";
      autoCompleteData.value.streamName =
        searchObj.data.stream.selectedStream?.[0] ?? "";
      getSuggestions();
    };

    const transformIcon = computed(() => {
      if (searchObj.data.transformType === "function")
        return "img:" + getImageURL("images/common/function.svg");

      if (searchObj.data.transformType === "action") return "code";

      if (!searchObj.data.transformType)
        return "img:" + getImageURL("images/common/transform.svg");
    });

    const getColumnNames = (parsedSQL: any) => {
      const columnData = parsedSQL?.columns;
      let columnNames = [];
      for (const item of columnData) {
        if (item.expr.type === "column_ref") {
          columnNames.push(item.expr.column?.expr?.value);
        } else if (item.expr.type === "aggr_func") {
          if (item.expr.args?.expr?.hasOwnProperty("column")) {
            columnNames.push(item.expr.args?.expr?.column?.value);
          } else if (item.expr.args?.expr?.value) {
            columnNames.push(item.expr.args?.expr?.value);
          }
        } else if (item.expr.type === "function") {
          item.expr.args.value.map((val) => {
            if (val.type === "column_ref") {
              columnNames.push(val.column?.expr?.value);
            }
          });
        }
      }

      if (parsedSQL?._next) {
        columnNames = [
          ...new Set([...columnNames, ...getColumnNames(parsedSQL._next)]),
        ];
      }

      return columnNames;
    };

    const updateQueryValue = (value: string, event?: any) => {
      // During stream changes, the editor's debounced onDidChangeModelContent
      // callback can re-emit a stale value after onStreamChange has cleared the
      // query. Reject these stale re-emissions to prevent the old filter from
      // reappearing in the search bar.
      if (searchObj.loadingStream) {
        return;
      }

      // if (searchObj.meta.jobId != "") {
      //   searchObj.meta.jobId = "";
      //   getQueryData(false);
      // }
      searchObj.data.editorValue = value;
      searchObj.data.query = value;
      if (searchObj.meta.quickMode === true) {
        const parsedSQL = fnParsedSQL();
        if (
          searchObj.meta.sqlMode === true &&
          Object.hasOwn(parsedSQL, "from") &&
          isStreamFetched(searchObj.data.stream.streamType) &&
          isStreamExists(value, searchObj.data.stream.streamType)
        ) {
          setSelectedStreams(value);
          // onStreamChange(value);
        }
        if (parsedSQL != undefined && parsedSQL?.columns?.length > 0) {
          const columnNames = getColumnNames(parsedSQL);

          searchObj.data.stream.interestingFieldList = [];

          const defaultInterestingFields = new Set(
            store.state?.zoConfig?.default_quick_mode_fields || [],
          );

          for (const col of columnNames) {
            if (
              !searchObj.data.stream.interestingFieldList.includes(col) &&
              col != "*"
            ) {
              // searchObj.data.stream.interestingFieldList.push(col);
              const localInterestingFields: any = useLocalInterestingFields();
              let localFields: any = {};
              if (localInterestingFields.value != null) {
                localFields = localInterestingFields.value;
              }
              for (const stream of searchObj.data.stream
                ?.selectedStreamFields || []) {
                if (
                  stream.name == col &&
                  !searchObj.data.stream.interestingFieldList.includes(col) &&
                  col !== store.state.zoConfig?.timestamp_column
                ) {
                  const interestingFieldsCopy = [
                    ...searchObj.data.stream.interestingFieldList,
                  ];

                  searchObj.data.stream.interestingFieldList.push(col);

                  if (!defaultInterestingFields.has(col)) {
                    interestingFieldsCopy.push(col);
                  }

                  localFields[
                    searchObj.organizationIdentifier +
                      "_" +
                      searchObj.data.stream.selectedStream[0]
                  ] = interestingFieldsCopy;
                }
              }
              useLocalInterestingFields(localFields);
            }
          }

          // Add timestamp column to the interesting field list, as it is default interesting field
          searchObj.data.stream.interestingFieldList.unshift(
            store.state.zoConfig?.timestamp_column,
          );

          for (const item of searchObj.data.stream?.selectedStreamFields ||
            []) {
            if (
              searchObj.data.stream.interestingFieldList.includes(item.name)
            ) {
              item.isInterestingField = true;
            } else {
              item.isInterestingField = false;
            }
          }
        }
      }
      if (
        searchObj.meta.sqlMode === false &&
        searchObj.meta.logsVisualizeToggle !== "build" &&
        value.toLowerCase().includes("select") &&
        value.toLowerCase().includes("from")
      ) {
        searchObj.meta.sqlMode = true;
        searchObj.meta.sqlModeManualTrigger = true;
      }

      if (value != "" && searchObj.meta.sqlMode === true) {
        const parsedSQL = fnParsedSQL();
        if (
          (Object.hasOwn(parsedSQL, "from") ||
            Object.hasOwn(parsedSQL, "select")) &&
          isStreamFetched(searchObj.data.stream.streamType) &&
          isStreamExists(value, searchObj.data.stream.streamType)
        ) {
          setSelectedStreams(value);
          // onStreamChange(value);
        }
      }

      updateAutoComplete(value);
      try {
        if (searchObj.meta.sqlMode === true) {
          let parsedQuery = null;
          try {
            parsedQuery = fnParsedSQL(value);
          } catch (e) {
            console.log(e, "Logs: Error while parsing query");
          }

          if (parsedQuery?.from?.length > 0) {
            //this condition is to handle the with queries so for WITH queries the table name is not present in the from array it will be there in the with array
            //the table which is there in from array is the temporary array
            const tableName: string = !parsedQuery.with
              ? parsedQuery.from[0].table ||
                parsedQuery.from[0].expr?.ast?.from?.[0]?.table
              : "";
            if (
              !searchObj.data.stream.selectedStream.includes(tableName) &&
              tableName !== streamName
            ) {
              let streamFound = false;
              searchObj.data.stream.selectedStream = [];

              streamName = tableName;
              searchObj.data.streamResults.list.forEach((stream) => {
                if (stream.name == streamName) {
                  streamFound = true;
                  let itemObj = {
                    label: stream.name,
                    value: stream.name,
                  };

                  // searchObj.data.stream.selectedStream = itemObj;
                  searchObj.data.stream.selectedStream.push(itemObj.value);
                  onStreamChange(searchObj.data.query);
                }
              });

              if (streamFound == false) {
                // searchObj.data.stream.selectedStream = { label: "", value: "" };
                searchObj.data.stream.selectedStream = [];
                searchObj.data.stream.selectedStreamFields = [];
                // $q.notify({
                //   message: "Stream not found",
                //   color: "info",
                //   position: "bottom",
                //   timeout: 2000,
                // });
              }
            }
          }
        }
        //here we reset the job id if user change the query and move outside of the editor
        if (
          searchObj.meta.jobId != "" &&
          searchObj.meta.queryEditorPlaceholderFlag == true
        ) {
          if (!checkQuery(value)) {
            $q.notify({
              message: "Job Context have been removed",
              color: "warning",
              position: "bottom",
              timeout: 2000,
            });
            searchObj.meta.jobId = "";
            searchObj.data.queryResults.hits = [];
            // getQueryData(false);
          }
        }
      } catch (e) {
        console.log(e, "Logs: Error while updating query value");
      }
    };
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        isFocused.value = false;
      }
    };

    // Debounced auto-run for absolute time — gives the user 2.5s to finish
    // typing start/end time before firing the query.
    const debouncedAutoRunAbsolute = debounce(() => {
      emit("searchdata");
    }, 2500);

    let ignoreAutoTrigger = false;
    const updateDateTime = async (value: object) => {
      ignoreAutoTrigger = searchObj.shouldIgnoreWatcher;
      if (
        value.valueType == "absolute" &&
        searchObj.data.stream.selectedStream.length > 0 &&
        searchObj.data.datetime.queryRangeRestrictionInHour > 0 &&
        value.hasOwnProperty("selectedDate") &&
        value.hasOwnProperty("selectedTime") &&
        value.selectedDate.hasOwnProperty("from") &&
        value.selectedTime.hasOwnProperty("startTime")
      ) {
        // Convert hours to microseconds
        let newStartTime =
          parseInt(value.endTime) -
          searchObj.data.datetime.queryRangeRestrictionInHour *
            60 *
            60 *
            1000000;

        if (parseInt(newStartTime) > parseInt(value.startTime)) {
          value.startTime = newStartTime;

          value.selectedDate.from = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "yyyy/MM/DD",
          );
          value.selectedTime.startTime = timestampToTimezoneDate(
            value.startTime / 1000,
            store.state.timezone,
            "HH:mm",
          );

          dateTimeRef.value.setAbsoluteTime(value.startTime, value.endTime);
          dateTimeRef.value.setDateType("absolute");
        }
      }
      searchObj.data.datetime = {
        startTime: value.startTime,
        endTime: value.endTime,
        relativeTimePeriod: value.relativeTimePeriod
          ? value.relativeTimePeriod
          : searchObj.data.datetime.relativeTimePeriod,
        type: value.relativeTimePeriod ? "relative" : "absolute",
        selectedDate: value?.selectedDate,
        selectedTime: value?.selectedTime,
        queryRangeRestrictionMsg:
          searchObj.data.datetime?.queryRangeRestrictionMsg || "",
        queryRangeRestrictionInHour:
          searchObj.data.datetime?.queryRangeRestrictionInHour || 0,
      };

      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();

      if (
        searchObj.loading == false &&
        store.state.zoConfig.query_on_stream_selection == false
      ) {
        searchObj.loading = true;
        searchObj.runQuery = true;
      }

      if (config.isCloud == "true" && value.userChangedValue) {
        segment.track("Button Click", {
          button: "Date Change",
          tab: value.tab,
          value: value,
          //user_org: this.store.state.selectedOrganization.identifier,
          //user_id: this.store.state.userInfo.email,
          stream_name: searchObj.data.stream.selectedStream.join(","),
          page: "Search Logs",
        });
      }

      if (
        value.valueType === "relative" &&
        store.state.zoConfig.query_on_stream_selection == false
      ) {
        emit("searchdata");
        return;
      }

      if (searchObj.meta.liveMode && ignoreAutoTrigger == false) {
        if (value.valueType === "absolute") {
          debouncedAutoRunAbsolute();
        } else {
          emit("searchdata");
        }
      }
    };

    const updateTimezone = () => {
      if (store.state.zoConfig.query_on_stream_selection == false) {
        emit("onChangeTimezone");
      }
    };

    const updateQuery = () => {
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(searchObj.data.query);
    };

    const downloadLogs = async (data: any[], format: "csv" | "json") => {
      await downloadLogsUtil(data, format);
      showDownloadMenu.value = false;
    };

    onMounted(async () => {
      searchObj.data.transformType =
        router.currentRoute.value.query.transformType || "function";

      if (
        router.currentRoute.value.query.transformType === "function" &&
        (router.currentRoute.value.query.functionContent ||
          searchObj.data.tempFunctionContent)
      ) {
        const fnContent = router.currentRoute.value.query.functionContent
          ? b64DecodeUnicode(router.currentRoute.value.query.functionContent)
          : searchObj.data.tempFunctionContent;
        fnEditorRef?.value?.setValue(fnContent);
      }

      updateEditorWidth();

      window.addEventListener("keydown", handleEscKey);
      window.addEventListener("resize", onWindowResize);
    });

    onUnmounted(() => {
      window.removeEventListener("click", () => {
        fnEditorRef?.value?.resetEditorLayout();
      });
      window.removeEventListener("keydown", handleEscKey);
      window.removeEventListener("resize", onWindowResize);
    });

    onActivated(() => {
      updateQuery();

      updateEditorWidth();

      if (
        (router.currentRoute.value.query.functionContent ||
          searchObj.data.tempFunctionContent) &&
        searchObj.data.transformType === "function"
      ) {
        const fnContent = router.currentRoute.value.query.functionContent
          ? b64DecodeUnicode(router.currentRoute.value.query.functionContent)
          : searchObj.data.tempFunctionContent;
        fnEditorRef?.value?.setValue(fnContent);
        fnEditorRef?.value?.resetEditorLayout();
        window.removeEventListener("click", () => {
          fnEditorRef?.value?.resetEditorLayout();
        });
      }

      fnEditorRef?.value?.resetEditorLayout();
    });

    onDeactivated(() => {
      window.removeEventListener("click", () => {
        fnEditorRef?.value?.resetEditorLayout();
      });
    });

    const saveFunction = () => {
      saveFunctionLoader.value = true;
      let callTransform: Promise<{ data: any }>;
      const content = searchObj.data.tempFunctionContent;
      let fnName = "";
      if (isSavedFunctionAction.value == "create") {
        fnName = savedFunctionName.value;
      } else {
        fnName = savedFunctionSelectedName.value.name;
      }

      if (content.trim() == "") {
        $q.notify({
          type: "warning",
          message:
            "The function field must contain a value and cannot be left empty.",
        });
        saveFunctionLoader.value = false;
        return;
      }

      const pattern = /^[a-zA-Z][a-zA-Z0-9_]*$/;
      if (!pattern.test(fnName)) {
        $q.notify({
          type: "negative",
          message: "Function name is not valid.",
        });
        saveFunctionLoader.value = false;
        return;
      }

      formData.value.params = "row";
      formData.value.function = content;
      formData.value.transType = 0;
      formData.value.name = fnName;
      searchObj.data.tempFunctionContent = content;

      // const result = functionOptions.value.find((obj) => obj.name === fnName);
      if (isSavedFunctionAction.value == "create") {
        callTransform = jsTransformService.create(
          store.state.selectedOrganization.identifier,
          formData.value,
        );

        callTransform
          .then((res: { data: any }) => {
            $q.notify({
              type: "positive",
              message: res.data.message,
            });

            functionModel.value = {
              name: formData.value.name,
              function: formData.value.function,
            };
            functionOptions.value.push({
              name: formData.value.name,
              function: formData.value.function,
              transType: 0,
              params: "row",
            });
            store.dispatch("setSavedFunctionDialog", false);
            isSavedFunctionAction.value = "create";
            savedFunctionName.value = "";
            saveFunctionLoader.value = false;
            savedFunctionSelectedName.value = "";
          })
          .catch((err) => {
            saveFunctionLoader.value = false;
            $q.notify({
              type: "negative",
              message:
                JSON.stringify(err.response.data["message"]) ||
                "Function creation failed",
              timeout: 5000,
            });
          });
      } else {
        saveFunctionLoader.value = false;
        showConfirmDialog(() => {
          saveFunctionLoader.value = true;
          callTransform = jsTransformService.update(
            store.state.selectedOrganization.identifier,
            formData.value,
          );

          callTransform
            .then((res: { data: any }) => {
              $q.notify({
                type: "positive",
                message: "Function updated successfully.",
              });

              const transformIndex = searchObj.data.transforms.findIndex(
                (obj) => obj.name === formData.value.name,
              );
              if (transformIndex !== -1) {
                searchObj.data.transforms[transformIndex].name =
                  formData.value.name;
                searchObj.data.transforms[transformIndex].function =
                  formData.value.function;
              }

              functionOptions.value = searchObj.data.transforms;
              store.dispatch("setSavedFunctionDialog", false);
              isSavedFunctionAction.value = "create";
              savedFunctionName.value = "";
              saveFunctionLoader.value = false;
              savedFunctionSelectedName.value = "";
            })
            .catch((err) => {
              saveFunctionLoader.value = false;
              $q.notify({
                type: "negative",
                message:
                  JSON.stringify(err.response.data["message"]) ||
                  "Function updation failed",
                timeout: 5000,
              });
            });
        });
      }
    };

    const resetFunctionContent = () => {
      fnEditorRef?.value?.setValue("");
      store.dispatch("setSavedFunctionDialog", false);
      isSavedFunctionAction.value = "create";
      savedFunctionName.value = "";
      saveFunctionLoader.value = false;
      savedFunctionSelectedName.value = "";
    };

    const resetEditorLayout = () => {
      setTimeout(() => {
        queryEditorRef?.value?.resetEditorLayout();
        fnEditorRef?.value?.resetEditorLayout();
      }, 100);
    };

    const applyAction = (actionId) => {
      searchObj.data.actionId = actionId.id;
    };

    const populateFunctionImplementation = (
      fnValue,
      flag = false,
      openEditor = true,
    ) => {
      if (flag) {
        $q.notify({
          type: "positive",
          message: `${fnValue.name} function applied successfully.`,
          timeout: 3000,
        });
      }

      if (openEditor) {
        searchObj.meta.showTransformEditor = true;
        searchObj.config.fnSplitterModel = 60;
      }
      fnEditorRef?.value?.setValue(fnValue.function);
      searchObj.data.tempFunctionName = fnValue.name;
      searchObj.data.tempFunctionContent = fnValue.function;

      if (store.state.zoConfig?.auto_query_enabled && searchObj.meta.liveMode) {
        emit("searchdata");
      }
    };

    const fnSavedFunctionDialog = () => {
      const content = searchObj.data.tempFunctionContent;
      if (content == "") {
        $q.notify({
          type: "negative",
          message: "No function definition found.",
        });
        return;
      }
      store.dispatch("setSavedFunctionDialog", true);
      isSavedFunctionAction.value = "create";
      savedFunctionName.value = "";
      saveFunctionLoader.value = false;
      savedFunctionSelectedName.value = "";
    };

    const showConfirmDialog = (callback) => {
      confirmDialogVisible.value = true;
      confirmCallback = callback;
    };

    const showSavedViewConfirmDialog = (callback) => {
      confirmSavedViewDialogVisible.value = true;
      confirmCallback = callback;
    };

    const cancelConfirmDialog = () => {
      confirmSavedViewDialogVisible.value = false;
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const confirmDialogOK = () => {
      if (confirmCallback) {
        confirmCallback();
      }
      confirmDialogVisible.value = false;
      confirmCallback = null;
    };

    const filterFn = (val, update) => {
      update(() => {
        if (val === "") {
          functionOptions.value = searchObj.data.transforms;
        } else {
          const needle = val.toLowerCase();
          functionOptions.value = searchObj.data.transforms.filter(
            (v) => v.name?.toLowerCase().indexOf(needle) > -1,
          );
        }
      });
    };

    const onRefreshIntervalUpdate = () => {
      emit("onChangeInterval");
    };

    const fnSavedView = () => {
      if (searchObj.data.stream.selectedStream.length == 0) {
        $q.notify({
          type: "negative",
          message: "No stream available to save view.",
        });
        return;
      }
      store.dispatch("setSavedViewDialog", true);
      isSavedViewAction.value = "create";
      savedViewName.value = "";
      saveViewLoader.value = false;
      savedViewSelectedName.value = "";
      savedViewDropdownModel.value = false;
    };

    const openSavedViewsList = () => {
      loadSavedView();
      savedViewsListDialog.value = true;
    };

    // Common function to restore visualization data and sync to URL
    const restoreVisualizationData = async (visualizationData) => {
      if (!visualizationData) return;

      // Restore visualization config to dashboardPanelData
      if (visualizationData.config) {
        dashboardPanelData.data.config = visualizationData.config;
      }
      if (visualizationData.type) {
        dashboardPanelData.data.type = visualizationData.type;
      }

      // Sync visualization data to URL
      const currentVisualizationData =
        getVisualizationConfig(dashboardPanelData);
      if (currentVisualizationData) {
        const encoded = encodeVisualizationConfig(currentVisualizationData);
        if (encoded) {
          const currentQuery = { ...router.currentRoute.value.query };
          currentQuery.visualization_data = encoded;

          await router.replace({
            name: router.currentRoute.value.name,
            query: currentQuery,
          });
        }
      }
    };

    const applySavedView = async (item) => {
      savedViewDropdownModel.value = false;
      await cancelQuery();
      searchObj.shouldIgnoreWatcher = true;
      searchObj.meta.sqlMode = false;
      savedviewsService
        .getViewDetail(
          store.state.selectedOrganization.identifier,
          item.view_id,
        )
        .then(async (res) => {
          if (res.status == 200) {
            store.dispatch("setSavedViewFlag", true);
            const extractedObj = res.data.data;

            // Resetting columns as its not required in searchObj
            // As we reassign columns from selectedFields and search results
            extractedObj.data.resultGrid.columns = [];

            // As in saved view, we observed field getting duplicated in selectedFields
            // So, we are removing duplicates before applying saved view
            if (extractedObj.data.stream.selectedFields?.length) {
              extractedObj.data.stream.selectedFields = [
                ...new Set(extractedObj.data.stream.selectedFields),
              ];
            }

            if (extractedObj.data?.timezone) {
              store.dispatch("setTimezone", extractedObj.data.timezone);
            }

            if (!extractedObj.data.stream.hasOwnProperty("streamType")) {
              extractedObj.data.stream.streamType = "logs";
            }

            delete searchObj.data.queryResults.aggs;

            if (
              searchObj.data.stream.streamType ==
              extractedObj.data.stream.streamType
            ) {
              // if (
              //   extractedObj.data.stream.selectedStream.value !=
              //   searchObj.data.stream.selectedStream.value
              // ) {
              //   extractedObj.data.stream.streamLists =
              //     searchObj.data.stream.streamLists;
              // }
              // ----- Here we are explicitly handling stream change for multistream -----
              let selectedStreams = [];
              const streamValues = searchObj.data.stream.streamLists.map(
                (item) => item.value,
              );
              if (typeof extractedObj.data.stream.selectedStream == "object") {
                if (
                  extractedObj.data.stream.selectedStream.hasOwnProperty(
                    "value",
                  )
                ) {
                  selectedStreams.push(
                    extractedObj.data.stream.selectedStream.value,
                  );
                } else {
                  selectedStreams.push(
                    ...extractedObj.data.stream.selectedStream,
                  );
                }
              } else {
                selectedStreams.push(extractedObj.data.stream.selectedStream);
              }
              const streamNotExist = selectedStreams.filter(
                (stream_str) => !streamValues.includes(stream_str),
              );
              if (streamNotExist.length > 0) {
                let errMsg = t("search.streamNotExist").replace(
                  "[STREAM_NAME]",
                  streamNotExist,
                );
                throw new Error(errMsg);
                return;
              }
              // extractedObj.data.stream.selectedStream = [];
              // extractedObj.data.stream.selectedStream = selectedStreams;
              delete extractedObj.data.stream.streamLists;
              delete extractedObj.data.stream.selectedStream;
              delete searchObj.data.stream.selectedStream;
              delete searchObj.meta.regions;
              if (extractedObj.meta.hasOwnProperty("regions")) {
                searchObj.meta["regions"] = extractedObj.meta.regions;
              } else {
                searchObj.meta["regions"] = [];
              }
              delete searchObj.data.queryResults.aggs;
              delete searchObj.data.stream.interestingFieldList;
              searchObj.data.stream.selectedStream = [];
              extractedObj.data.transforms = searchObj.data.transforms;
              extractedObj.data.stream.functions =
                searchObj.data.stream.functions;
              extractedObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {},
              };
              extractedObj.data.savedViews = searchObj.data.savedViews;
              extractedObj.data.queryResults = [];
              extractedObj.meta.scrollInfo = {};
              //here we are merging deep to the searchObj with the extractedObj
              mergeDeep(searchObj, extractedObj);
              searchObj.shouldIgnoreWatcher = true;

              // Restore visualization data if available
              if (extractedObj.data.visualizationData) {
                await restoreVisualizationData(
                  extractedObj.data.visualizationData,
                );
              }
              // await nextTick();
              if (extractedObj.data.tempFunctionContent != "") {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: extractedObj.data.tempFunctionContent,
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // Use saved view's editor state
                );
                searchObj.data.tempFunctionContent =
                  extractedObj.data.tempFunctionContent;
                searchObj.meta.functionEditorPlaceholderFlag = false;
                searchObj.data.transformType = "function";
                if (showFunctionEditor.value)
                  searchObj.meta.showTransformEditor = true;
              } else {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: "",
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // No function content, so don't open editor
                );
                searchObj.data.tempFunctionContent = "";
                searchObj.meta.functionEditorPlaceholderFlag = true;
              }

              //here we are getting data so we need to check here
              //before we set the time to the dateTimeRef.value we need to check if the startTime and endTime difference is greater than maxQueryRange in hours
              //solution will be we will do endTime - startTime and convert that difference into hours and check with both global and stream level maxQueryRange and if it is less than or equal to that we will keep that as it is
              //if that exceeds the maxQueryRange we will convert that to relative type (because we cannot assume the start and end date) or we can do that by converting present time - maxQueryRange

              // Validate and adjust time range based on maxQueryRange
              //before we check all this we need to get the current selected stream max query range and also global max query range
              //we need to compare so if max query range of stream is there we will use that otherwise we will use the global max query if both are not present
              //we will skip this below process

              // Get max query range for all selected streams and take the minimum
              // Preference: stream max query range > global max query range
              const globalMaxQueryRange =
                store.state.zoConfig.max_query_range || 0;
              let effectiveMaxQueryRange = -1;

              if (selectedStreams && selectedStreams.length > 0) {
                // Fetch all stream data in parallel
                const streamDataPromises = selectedStreams.map((streamName) =>
                  getStream(
                    streamName,
                    searchObj.data.stream.streamType,
                    false,
                  ),
                );

                try {
                  const streamDataList = await Promise.all(streamDataPromises);

                  // Extract max_query_range from each stream's settings
                  const streamMaxQueryRanges = streamDataList
                    .map(
                      (streamData) =>
                        streamData?.settings?.max_query_range || 0,
                    )
                    .filter((range) => range > 0); // Only consider positive values

                  // If we have stream-specific max query ranges, find the minimum (stream takes preference)
                  if (streamMaxQueryRanges.length > 0) {
                    effectiveMaxQueryRange = Math.min(...streamMaxQueryRanges);
                  } else if (globalMaxQueryRange > 0) {
                    // No stream-specific ranges, fall back to global max query range
                    effectiveMaxQueryRange = globalMaxQueryRange;
                  }
                } catch (error) {
                  // On error, fall back to global max query range
                  effectiveMaxQueryRange =
                    globalMaxQueryRange > 0 ? globalMaxQueryRange : -1;
                }
              } else if (globalMaxQueryRange > 0) {
                // No selected streams, use global max query range
                effectiveMaxQueryRange = globalMaxQueryRange;
              }

              // Validate and adjust time range if effective max query range exists
              if (
                effectiveMaxQueryRange > 0 &&
                searchObj.data.datetime?.startTime &&
                searchObj.data.datetime?.endTime
              ) {
                // Calculate time difference in hours
                const startTimeMicros = parseInt(
                  searchObj.data.datetime.startTime,
                );
                const endTimeMicros = parseInt(searchObj.data.datetime.endTime);
                const timeDiffInHours =
                  (endTimeMicros - startTimeMicros) / (60 * 60 * 1000000);

                // Check if time difference exceeds effective max query range
                if (timeDiffInHours > effectiveMaxQueryRange) {
                  // Adjust to current time - maxQueryRange
                  const currentTimeMicros = Date.now() * 1000; // Convert milliseconds to microseconds
                  const maxQueryRangeMicros =
                    effectiveMaxQueryRange * 60 * 60 * 1000000;

                  const adjustedStartTime =
                    currentTimeMicros - maxQueryRangeMicros;
                  const adjustedEndTime = currentTimeMicros;

                  // Get the current datetime type
                  const currentType =
                    searchObj.data.datetime.type || "relative";

                  // Build the complete datetime object with all required fields
                  const updatedDateTime = buildDateTimeObject(
                    adjustedStartTime,
                    adjustedEndTime,
                    currentType,
                  );

                  // Update searchObj.data.datetime with all fields
                  searchObj.data.datetime.startTime = adjustedStartTime;
                  searchObj.data.datetime.endTime = adjustedEndTime;

                  if (currentType === "relative") {
                    // For relative type, update relativeTimePeriod
                    searchObj.data.datetime.relativeTimePeriod =
                      updatedDateTime.relativeTimePeriod;
                  } else if (currentType === "absolute") {
                    // For absolute type, update selectedDate and selectedTime
                    searchObj.data.datetime.selectedDate =
                      updatedDateTime.selectedDate;
                    searchObj.data.datetime.selectedTime =
                      updatedDateTime.selectedTime;
                    searchObj.data.datetime.relativeTimePeriod = null;
                  }
                }
              }

              dateTimeRef.value.setSavedDate(searchObj.data.datetime);
              if (searchObj.meta.refreshInterval != "0") {
                onRefreshIntervalUpdate();
              } else {
                clearInterval(store.state.refreshIntervalID);
              }
              searchObj.data.stream.selectedStream.push(...selectedStreams);
              // we dont need to update local log filter field because
              // if visualize is there for any saved views we will get right any previous local filter fields
              // they will get applied to the current visualize selected stream
              // so we need to make sure we dont update that local filter fields when it is visualize
              if (extractedObj.meta.logsVisualizeToggle == "logs") {
                await updatedLocalLogFilterField();
              }
              await getStreams("logs", true);
            } else {
              // ----- Here we are explicitly handling stream change -----
              resetStreamData();
              searchObj.data.stream.streamType =
                extractedObj.data.stream.streamType;

              delete searchObj.meta.regions;
              if (extractedObj.meta.hasOwnProperty("regions")) {
                searchObj.meta["regions"] = extractedObj.meta.regions;
              } else {
                searchObj.meta["regions"] = [];
              }
              // Here copying selected stream object, as in loadStreamLists() we are setting selected stream object to empty object
              // After loading stream list, we are setting selected stream object to copied object
              // const selectedStream = cloneDeep(
              //   extractedObj.data.stream.selectedStream
              // );
              let selectedStreams = [];
              if (typeof extractedObj.data.stream.selectedStream == "object") {
                if (
                  extractedObj.data.stream.selectedStream.hasOwnProperty(
                    "value",
                  )
                ) {
                  selectedStreams.push(
                    extractedObj.data.stream.selectedStream.value,
                  );
                } else {
                  selectedStreams.push(
                    ...extractedObj.data.stream.selectedStream,
                  );
                }
              } else {
                selectedStreams.push(extractedObj.data.stream.selectedStream);
              }

              extractedObj.data.transforms = searchObj.data.transforms;
              extractedObj.data.histogram = {
                xData: [],
                yData: [],
                chartParams: {},
              };
              extractedObj.data.savedViews = searchObj.data.savedViews;
              extractedObj.data.queryResults = [];
              extractedObj.meta.scrollInfo = {};
              delete searchObj.data.queryResults.aggs;

              mergeDeep(searchObj, extractedObj);
              searchObj.data.streamResults = {};

              // Restore visualization data if available
              if (extractedObj.data.visualizationData) {
                await restoreVisualizationData(
                  extractedObj.data.visualizationData,
                );
              }

              const streamData = await getStreams(
                searchObj.data.stream.streamType,
                true,
              );
              searchObj.data.streamResults = streamData;
              await loadStreamLists();
              searchObj.data.stream.selectedStream = [selectedStreams];

              const streamValues = searchObj.data.stream.streamLists.map(
                (item) => item.value,
              );
              const streamNotExist = selectedStreams.filter(
                (stream_str) => !streamValues.includes(stream_str),
              );
              if (streamNotExist.length > 0) {
                let errMsg = t("search.streamNotExist").replace(
                  "[STREAM_NAME]",
                  streamNotExist,
                );
                throw new Error(errMsg);
                return;
              }
              // await nextTick();
              if (extractedObj.data.tempFunctionContent != "") {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: extractedObj.data.tempFunctionContent,
                  },
                  false,
                  extractedObj.meta.showTransformEditor, // Use saved view's editor state
                );
                searchObj.data.tempFunctionContent =
                  extractedObj.data.tempFunctionContent;
                searchObj.meta.functionEditorPlaceholderFlag = false;
              } else {
                populateFunctionImplementation(
                  {
                    name: "",
                    function: "",
                  },
                  false,
                  false, // No function content, so don't open editor
                );
                searchObj.data.tempFunctionContent = "";
                searchObj.meta.functionEditorPlaceholderFlag = true;
              }
              dateTimeRef.value.setSavedDate(searchObj.data.datetime);
              if (searchObj.meta.refreshInterval != "0") {
                onRefreshIntervalUpdate();
              } else {
                clearInterval(store.state.refreshIntervalID);
              }
              // we dont need to update local log filter field because
              // if visualize is there for any saved views we will get right any previous local filter fields
              // they will get applied to the current visualize selected stream
              // so we need to make sure we dont update that local filter fields when it is visualize
              if (extractedObj.meta.logsVisualizeToggle == "logs") {
                await updatedLocalLogFilterField();
              }
            }

            // Only reset function content if there's no function in the saved view
            if (
              searchObj.meta.toggleFunction == false &&
              !extractedObj.data.tempFunctionContent
            ) {
              searchObj.config.fnSplitterModel = 100;
              resetFunctionContent();
            }

            updateEditorWidth();

            $q.notify({
              message: `${item.view_name} view applied successfully.`,
              color: "positive",
              position: "bottom",
              timeout: 1000,
            });
            setTimeout(async () => {
              try {
                searchObj.loadingHistogram = false;
                searchObj.loading = true;
                searchObj.meta.refreshHistogram = true;
                // TODO OK: Remove all the instances of communicationMethod and below assignment aswell
                searchObj.communicationMethod = "streaming";
                await extractFields();
                await getQueryData();
                store.dispatch("setSavedViewFlag", false);
                updateUrlQueryParams();
                searchObj.shouldIgnoreWatcher = false;
              } catch (e) {
                searchObj.shouldIgnoreWatcher = false;
                console.log("Error while applying saved view", e);
              }
            }, 1000);

            if (
              extractedObj.data.resultGrid.colOrder &&
              extractedObj.data.resultGrid.colOrder.hasOwnProperty(
                searchObj.data.stream.selectedStream,
              )
            ) {
              searchObj.data.stream.selectedFields =
                extractedObj.data.resultGrid.colOrder[
                  searchObj.data.stream.selectedStream
                ].filter(
                  (_field) =>
                    _field !==
                    (store?.state?.zoConfig?.timestamp_column || "_timestamp"),
                );
            } else {
              searchObj.data.stream.selectedFields =
                extractedObj.data.stream.selectedFields;
            }

            if (
              extractedObj.data.resultGrid.colSizes &&
              extractedObj.data.resultGrid.colSizes.hasOwnProperty(
                searchObj.data.stream.selectedStream,
              )
            ) {
              searchObj.data.resultGrid.colSizes[
                searchObj.data.stream.selectedStream
              ] =
                extractedObj.data.resultGrid.colSizes[
                  searchObj.data.stream.selectedStream
                ];
            }
          } else {
            searchObj.shouldIgnoreWatcher = false;
            store.dispatch("setSavedViewFlag", false);
            $q.notify({
              message: err.message || `Error while applying saved view.`,
              color: "negative",
              position: "bottom",
              timeout: 3000,
            });
          }
        })
        .catch((err) => {
          searchObj.shouldIgnoreWatcher = false;
          store.dispatch("setSavedViewFlag", false);
          $q.notify({
            message: `Error while applying saved view.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
          console.log("Error while applying saved view", err);
        });
    };

    const handleSavedView = () => {
      if (isSavedViewAction.value == "create") {
        if (
          savedViewName.value == "" ||
          /^[A-Za-z0-9 \-\_]+$/.test(savedViewName.value) == false
        ) {
          $q.notify({
            message: `Please provide valid view name.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
        } else {
          saveViewLoader.value = true;
          createSavedViews(savedViewName.value);
        }
      }
      //  else {
      //   if (savedViewSelectedName.value.view_id) {
      //     saveViewLoader.value = false;
      //     showSavedViewConfirmDialog(() => {
      //       saveViewLoader.value = true;
      //       updateSavedViews(
      //         savedViewSelectedName.value.view_id,
      //         savedViewSelectedName.value.view_name,
      //       );
      //     });
      //   } else {
      //     $q.notify({
      //       message: `Please select saved view to update.`,
      //       color: "negative",
      //       position: "bottom",
      //       timeout: 1000,
      //     });
      //   }
      // }
    };

    const deleteSavedViews = async () => {
      try {
        savedviewsService
          .delete(
            store.state.selectedOrganization.identifier,
            deleteViewID.value,
          )
          .then((res) => {
            //remove it from localstorage as well
            const localStoredSavedViews = JSON.parse(
              localStorage.getItem("savedViews") || "[]",
            );
            delete localStoredSavedViews[deleteViewID.value];
            favoriteViews.value.forEach((item: any) => {
              //remove it from favorite views list because we dont need to show it in the favorite views list
              if (item == deleteViewID.value) {
                favoriteViews.value.splice(
                  favoriteViews.value.indexOf(item),
                  1,
                );
              }
            });
            //remove it from local saved views list because we dont need to show it in the local saved views list
            localSavedViews.value = localSavedViews.value.filter(
              (item: any) => item.view_id !== deleteViewID.value,
            );
            localStorage.setItem(
              "savedViews",
              JSON.stringify(localStoredSavedViews),
            );
            //we are deleting the local storage item and also we are removing the item from the favoriteViews array
            if (res.status == 200) {
              $q.notify({
                message: t("search.viewDeletedSuccessfully"),
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              getSavedViews();
            } else {
              $q.notify({
                message: `${t("search.errorDeletingSavedView")} ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            $q.notify({
              message: t("search.errorDeletingSavedView"),
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log("Error while deleting saved view", err);
          });
      } catch (e: any) {
        console.log("Error while getting saved views", e);
      }
    };

    const getSearchObj = () => {
      try {
        delete searchObj.meta.scrollInfo;
        delete searchObj?.value;
        let savedSearchObj = toRaw(searchObj);
        savedSearchObj = JSON.parse(JSON.stringify(savedSearchObj));

        delete savedSearchObj.data.queryResults;
        delete savedSearchObj.data.histogram;
        delete savedSearchObj.data.sortedQueryResults;
        delete savedSearchObj.data.stream.streamLists;
        delete savedSearchObj.data.stream.functions;
        delete savedSearchObj.data.streamResults;
        delete savedSearchObj.data.savedViews;
        delete savedSearchObj.data.transforms;

        // Turn off all loaders before saving view
        savedSearchObj.loading = false;
        savedSearchObj.loadingHistogram = false;
        savedSearchObj.loadingCounter = false;
        savedSearchObj.loadingStream = false;
        savedSearchObj.loadingSavedView = false;

        savedSearchObj.data.timezone = store.state.timezone;

        if (savedSearchObj.data.parsedQuery) {
          delete savedSearchObj.data.parsedQuery;
        }

        // Include visualization data if in visualization mode
        if (
          searchObj.meta.logsVisualizeToggle === "visualize" &&
          dashboardPanelData
        ) {
          const visualizationData = getVisualizationConfig(dashboardPanelData);
          if (visualizationData) {
            savedSearchObj.data.visualizationData = visualizationData;
          }
        }

        return savedSearchObj;
        // return b64EncodeUnicode(JSON.stringify(savedSearchObj));
      } catch (e) {
        console.log("Error while encoding search obj", e);
      }
    };

    const createSavedViews = (viewName: string) => {
      try {
        if (viewName.trim() == "") {
          $q.notify({
            message: `Please provide valid view name.`,
            color: "negative",
            position: "bottom",
            timeout: 1000,
          });
          saveViewLoader.value = false;
          return;
        }

        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        savedviewsService
          .post(store.state.selectedOrganization.identifier, viewObj)
          .then((res) => {
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              if (searchObj.data.hasOwnProperty("savedViews") == false) {
                searchObj.data.savedViews = [];
              }
              searchObj.data.savedViews.push({
                org_id: res.data.org_id,
                payload: viewObj.data,
                view_id: res.data.view_id,
                view_name: viewName,
              });
              $q.notify({
                message: t("search.viewCreatedSuccessfully"),
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              getSavedViews();
              isSavedViewAction.value = "create";
              savedViewName.value = "";
              saveViewLoader.value = false;
            } else {
              saveViewLoader.value = false;
              $q.notify({
                message: `${t("search.errorCreatingSavedView")} ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            saveViewLoader.value = false;
            $q.notify({
              message: t("search.errorCreatingSavedView"),
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log("Error while creating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewName.value = "";
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while saving view: ${e}`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log("Error while saving view", e);
      }
    };

    const updateSavedViews = (viewID: string, viewName: string) => {
      try {
        const viewObj: any = {
          data: getSearchObj(),
          view_name: viewName,
        };

        const dismiss = $q.notify({
          message: "Updating saved view...",
          position: "bottom",
          timeout: 0,
        });

        savedviewsService
          .put(store.state.selectedOrganization.identifier, viewID, viewObj)
          .then((res) => {
            dismiss();
            if (res.status == 200) {
              store.dispatch("setSavedViewDialog", false);
              //update the payload and view_name in savedViews object based on id
              searchObj.data.savedViews.forEach(
                (item: { view_id: string }, index: string | number) => {
                  if (item.view_id == viewID) {
                    searchObj.data.savedViews[index].payload = viewObj.data;
                    searchObj.data.savedViews[index].view_name = viewName;
                  }
                },
              );

              $q.notify({
                message: t("search.viewUpdatedSuccessfully"),
                color: "positive",
                position: "bottom",
                timeout: 1000,
              });
              isSavedViewAction.value = "create";
              savedViewSelectedName.value = "";
              saveViewLoader.value = false;
              confirmSavedViewDialogVisible.value = false;
            } else {
              saveViewLoader.value = false;
              $q.notify({
                message: `${t("search.errorUpdatingSavedView")} ${res.data.error_detail}`,
                color: "negative",
                position: "bottom",
                timeout: 1000,
              });
            }
          })
          .catch((err) => {
            dismiss();
            saveViewLoader.value = false;
            $q.notify({
              message: t("search.errorUpdatingSavedView"),
              color: "negative",
              position: "bottom",
              timeout: 1000,
            });
            console.log("Error while updating saved view", err);
          });
      } catch (e: any) {
        isSavedViewAction.value = "create";
        savedViewSelectedName.value = "";
        saveViewLoader.value = false;
        $q.notify({
          message: `Error while saving view: ${e}`,
          color: "negative",
          position: "bottom",
          timeout: 1000,
        });
        console.log("Error while saving view", e);
      }
    };

    /**
     * Computed property for share URL
     * Generates the full shareable URL with all query parameters
     */
    const shareURL = computed(() => {
      const queryObj = generateURLQuery(true, dashboardPanelData);
      // Removed the 'type' property from the object to avoid issues when navigating from the stream to the logs page,
      // especially when the user performs multi-select on streams and shares the URL.
      delete queryObj?.type;
      const queryString = Object.entries(queryObj)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
        )
        .join("&");

      let url = window.location.origin + window.location.pathname;

      if (queryString != "") {
        url += "?" + queryString;
      }

      return url;
    });
    const showSearchHistoryfn = () => {
      emit("showSearchHistory");
    };

    const QUERY_TEMPLATE = 'SELECT [FIELD_LIST] FROM "[STREAM_NAME]"';

    function getFieldList(
      stream,
      streamFields,
      interestingFields,
      isQuickMode,
    ) {
      searchObj.data.streamResults.list.forEach((item) => {
        if (
          item.name == stream &&
          Object.hasOwn(item, "schema") &&
          item.schema.length > 0
        ) {
          streamFields = item.schema;
        }
      });
      return streamFields
        .filter((item) => interestingFields.includes(item.name))
        .map((item) => item.name);
    }

    function buildStreamQuery(stream, fieldList, isQuickMode) {
      const selectFields =
        fieldList.length > 0 && isQuickMode
          ? fieldList
              .map((field) => quoteSqlIdentifierIfNeeded(field))
              .join(",")
          : "*";

      return QUERY_TEMPLATE.replace("[STREAM_NAME]", stream).replace(
        "[FIELD_LIST]",
        selectFields,
      );
    }

    const resetFilters = () => {
      if (searchObj.meta.sqlMode == true) {
        const parsedSQL = fnParsedSQL();
        if (Object.hasOwn(parsedSQL, "from") && parsedSQL.from.length > 0) {
          if (Object.hasOwn(parsedSQL, "where") && parsedSQL.where != "") {
            parsedSQL.where = null;
          }

          if (Object.hasOwn(parsedSQL, "limit") && parsedSQL.limit != "") {
            parsedSQL.limit = null;
          }

          if (Object.hasOwn(parsedSQL, "_next") && parsedSQL._next != "") {
            parsedSQL._next.where = null;
            parsedSQL._next.limit = null;
          }

          searchObj.data.query = fnUnparsedSQL(parsedSQL);
          searchObj.data.query = searchObj.data.query.replaceAll("`", '"');
          searchObj.data.editorValue = searchObj.data.query;
        } else {
          // Handle both single and multiple stream scenarios
          const queries = searchObj.data.stream.selectedStream
            .map((stream) => {
              // Destructure for better readability
              const { selectedStreamFields, interestingFieldList } =
                searchObj.data.stream;
              const { quickMode } = searchObj.meta;

              // Generate the field list for the current stream
              const fieldList = getFieldList(
                stream,
                selectedStreamFields,
                interestingFieldList,
                quickMode,
              );

              // Ensure fieldList is valid before building the query
              if (!fieldList || fieldList.length === 0) {
                console.warn(`No fields available for stream: ${stream}`);
                return null;
              }

              // Build and return the query for the current stream
              return buildStreamQuery(stream, fieldList, quickMode);
            })
            .filter(Boolean);

          searchObj.data.query = queries.join(" UNION ALL BY NAME ");
          searchObj.data.editorValue = searchObj.data.query;
        }
      } else {
        searchObj.data.query = "";
        searchObj.data.editorValue = "";
      }

      queryEditorRef.value?.setValue(searchObj.data.query);
      if (
        store.state.zoConfig.query_on_stream_selection == false ||
        (store.state.zoConfig.auto_query_enabled && searchObj.meta.liveMode)
      ) {
        handleRunQueryFn();
      }
    };

    const customDownloadDialog = ref(false);
    const showDownloadMenu = ref(false);

    const loadSavedView = () => {
      if (searchObj.data.savedViews.length == 0) {
        getSavedViews();
      }
    };

    const handleFavoriteSavedView = (row: any, flag: boolean) => {
      let localSavedView: any = {};
      let savedViews = useLocalSavedView();

      if (savedViews.value != null) {
        localSavedView = savedViews.value;
      }

      Object.keys(localSavedView).forEach((item, key) => {
        if (item == row.view_id) {
          if (flag) {
            delete localSavedView[item];
            useLocalSavedView(localSavedView);
            const index = favoriteViews.value.indexOf(row.view_id);
            if (index > -1) {
              favoriteViews.value.splice(index, 1);
            }

            let favoriteViewsList = localSavedViews.value;
            if (favoriteViewsList.length > 0) {
              favoriteViewsList = favoriteViewsList.filter(
                (item) => item.view_id != row.view_id,
              );
              // for (const [key, item] of favoriteViewsList.entries()) {
              //   console.log(item, key);
              //   if (item.view_id == row.view_id) {
              //     delete favoriteViewsList[key];
              //   }
              // }
              localSavedViews.value = favoriteViewsList;
            }
          }
        }
      });

      if (!flag) {
        if (favoriteViews.value.length >= 10) {
          $q.notify({
            message: "You can only save 10 views.",
            color: "info",
            position: "bottom",
            timeout: 2000,
          });
          return;
        }
        localSavedView[row.view_id] = JSON.parse(JSON.stringify(row));
        favoriteViews.value.push(row.view_id);
        localSavedViews.value.push(row);

        // moveItemsToTop(localSavedView, favoriteViews.value);

        useLocalSavedView(localSavedView);
        $q.notify({
          message: "View added to favorites.",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      } else {
        // alert(favoriteViews.value.length)
        // moveItemsToTop(localSavedView, favoriteViews.value);
        $q.notify({
          message: "View removed from favorites.",
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      }
    };

    const filterSavedViewFn = (rows: any, terms: any) => {
      var filtered = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["view_name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    const regionFilterMethod = (node, filter) => {
      const filt = filter.toLowerCase();
      return node.label && node.label.toLowerCase().indexOf(filt) > -1;
    };
    const resetRegionFilter = () => {
      regionFilter.value = "";
    };

    const handleRegionsSelection = (item, isSelected) => {
      if (isSelected) {
        const index = searchObj.meta.regions.indexOf(item);
        if (index > -1) {
          searchObj.meta.regions.splice(index, 1);
        }
      } else {
        searchObj.meta.regions.push(item);
      }
    };

    const handleQuickMode = () => {
      searchObj.meta.quickMode = !searchObj.meta.quickMode;
      emit("handleQuickModeChange");
    };

    const toggleLiveMode = () => {
      searchObj.meta.liveMode = !searchObj.meta.liveMode;
      localStorage.setItem(
        "oo_toggle_auto_run",
        String(searchObj.meta.liveMode),
      );
    };

    const handleHistogramMode = () => {};

    const handleRunQueryFn = (clear_cache = false) => {
      if (
        searchObj.meta.logsVisualizeToggle == "visualize" ||
        searchObj.meta.logsVisualizeToggle == "patterns" ||
        searchObj.meta.logsVisualizeToggle == "build"
      ) {
        emit(
          "handleRunQueryFn",
          typeof clear_cache === "boolean" ? clear_cache : false,
        );
      } else {
        handleRunQuery(typeof clear_cache === "boolean" ? clear_cache : false);
      }
    };

    // Toggle between Builder and Custom mode in Build tab
    const confirmBuildModeChange = ref(false);

    const onBuildModeToggle = (isBuilderMode: boolean) => {
      const currentlyCustom = !searchObj.meta.buildModeQueryEditorDisabled;

      // Show confirmation when switching from Custom to Builder
      if (currentlyCustom && isBuilderMode) {
        confirmBuildModeChange.value = true;
        return;
      }

      searchObj.meta.buildModeQueryEditorDisabled = isBuilderMode;
      emit("buildModeToggle", !isBuilderMode);
    };

    const confirmBuildModeChangeOk = () => {
      confirmBuildModeChange.value = false;
      searchObj.meta.buildModeQueryEditorDisabled = true;
      emit("buildModeToggle", false); // isCustomMode = false
    };

    const onLogsVisualizeToggleUpdate = async (value: any) => {
      // prevent action if visualize is disabled (SQL mode disabled with multiple streams)
      if (
        value === "visualize" &&
        !searchObj.meta.sqlMode &&
        searchObj.data.stream.selectedStream.length > 1
      ) {
        showErrorNotification(
          t("search.enableSqlOrSelectStream"),
        );
        return;
      }

      // confirm with user on toggle from visualize to logs
      if (
        value == "logs" &&
        searchObj.meta.logsVisualizeToggle == "visualize"
      ) {
        // cancel all the visualize queries
        cancelVisualizeQueries();

        if (
          searchObj.meta.logsVisualizeDirtyFlag === true ||
          !Object.hasOwn(searchObj.data?.queryResults, "hits") ||
          searchObj.data?.queryResults?.hits?.length == 0
        ) {
          searchObj.loading = true;
          if (searchObj.meta.sqlMode) {
            searchObj.data.queryResults.aggs = undefined;
          }
          searchObj.meta.refreshHistogram = true;
          getQueryData();
          searchObj.meta.logsVisualizeDirtyFlag = false;
        }
      } else if (
        value == "logs" &&
        searchObj.meta.logsVisualizeToggle == "patterns"
      ) {
        // Switching from patterns to logs - check if we need to fetch logs
        const hasLogs =
          searchObj.data?.queryResults?.hits &&
          searchObj.data.queryResults.hits.length > 0;

        // console.log("[SearchBar] Switching patterns ? logs, hasLogs:", hasLogs);

        // Reset pagination visibility when switching back to logs
        searchObj.meta.resultGrid.showPagination = true;

        if (!hasLogs) {
          // No logs data - fetch them
          // console.log("[SearchBar] Fetching logs data");
          searchObj.loading = true;
          searchObj.meta.refreshHistogram = true;
          getQueryData();
        } else {
          // Logs exist - just switch the view
          // console.log("[SearchBar] Reusing existing logs data");
        }
      } else if (
        value == "patterns" &&
        (searchObj.meta.logsVisualizeToggle == "logs" ||
          searchObj.meta.logsVisualizeToggle == "visualize")
      ) {
        // Switching to patterns mode - this will be handled by a separate watcher in Index.vue
        emit("extractPatterns");
        // console.log("[SearchBar] Switching to patterns mode");
      } else if (value == "visualize") {
        // validate query
        // return if query is empty and stream is not selected
        if (
          searchObj.data.query === "" &&
          searchObj?.data?.stream?.selectedStream?.length === 0
        ) {
          showErrorNotification(
            t("search.queryEmptyToVisualize"),
          );
          return;
        }

        let logsPageQuery = searchObj.data.query;

        // handle sql mode
        if (!searchObj.data.sqlMode) {
          const queryBuild = buildSearch();
          logsPageQuery = queryBuild?.query?.sql ?? "";
        }

        // if multiple sql, then do not allow to visualize
        if (
          logsPageQuery &&
          Array.isArray(logsPageQuery) &&
          logsPageQuery.length > 1
        ) {
          showErrorNotification(
            t("search.multipleSqlNotAllowed"),
          );
          return;
        }

        // validate that timestamp column is not used as an alias
        if (!checkTimestampAlias(logsPageQuery)) {
          showErrorNotification(
            `Alias '${store.state.zoConfig.timestamp_column || "_timestamp"}' is not allowed.`,
          );
          return;
        }

        // validate sql query that all fields have alias
        if (!allSelectionFieldsHaveAlias(logsPageQuery)) {
          showErrorNotification(
            t("search.aggregationFieldsNeedAlias"),
          );
          return;
        }

        // cancel all the logs queries
        cancelQuery();
      } else if (value == "build") {
        // Only generate SQL query if user is already in SQL mode (Case 3).
        // When SQL mode is OFF (Case 1), BuildQueryPage will set up builder
        // mode with default histogram/count fields and carry over WHERE clause.
        if (searchObj.meta.sqlMode) {
          // Generate query using buildSearch if query is empty or doesn't have SELECT
          if (
            !searchObj.data.query ||
            searchObj.data.query.toLowerCase().indexOf("select") < 0
          ) {
            const queryBuild = buildSearch();
            const builtQuery = queryBuild?.query?.sql ?? "";
            if (builtQuery) {
              searchObj.data.query = builtQuery;
              searchObj.data.editorValue = builtQuery;
            }
          }
        }

        // Wait for Vue reactivity to process query changes before switching tabs
        await nextTick();

        // Quick mode logic only relevant for SQL mode
        if (searchObj.meta.sqlMode) {
          const isSelectAllQuery = /^\s*select\s+\*\s+from\s+/i.test(
            searchObj.data.query || "",
          );
          const shouldEnableQuickMode =
            !searchObj.meta.sqlMode || isSelectAllQuery;
          const isQuickModeDisabled = !searchObj.meta.quickMode;
          const isQuickModeConfigEnabled =
            store.state.zoConfig.quick_mode_enabled === true;

          if (
            shouldEnableQuickMode &&
            isQuickModeDisabled &&
            isQuickModeConfigEnabled
          ) {
            searchObj.meta.quickMode = true;
          }
        }
      }
      searchObj.meta.logsVisualizeToggle = value;
      updateUrlQueryParams();

      if (searchObj.meta.logsVisualizeToggle === "logs") {
        const hasLogs =
          searchObj.data?.queryResults?.hits &&
          searchObj.data.queryResults.hits.length > 0;

        if (hasLogs) {
          searchObj.data.histogram.chartParams.title = getHistogramTitle(false);
        }
      }

      // dispatch resize event
      window.dispatchEvent(new Event("resize"));
    };

    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs",
    );
    const { dashboardPanelData, resetDashboardPanelData } =
      useDashboardPanelData(dashboardPanelDataPageKey);

    // [START] cancel running queries

    const variablesAndPanelsDataLoadingState =
      inject("variablesAndPanelsDataLoadingState", {}) || {};

    const visualizeSearchRequestTraceIds = computed(() => {
      const searchIds = Object.values(
        variablesAndPanelsDataLoadingState?.searchRequestTraceIds ?? {},
      )
        .filter((item: any) => item.length > 0)
        .flat() as string[];

      // If custom field extraction is in progress, push a dummy trace id so that cancel button is visible.
      if (variablesAndPanelsDataLoadingState?.fieldsExtractionLoading) {
        searchIds.push("fieldExtraction");
      }

      return searchIds;
    });
    const backgroundColorStyle = computed(() => {
      const isDarkMode = store.state.theme === "dark";
      return {
        backgroundColor:
          searchObj.data.transformType === "function" && isFocused.value
            ? isDarkMode
              ? "var(--o2-card-bg)"
              : "white" // Dark mode: grey, Light mode: yellow (or any color)
            : "",
        borderBottom:
          searchObj.data.transformType === "function" && isFocused.value
            ? isDarkMode
              ? "0.375rem solid var(--o2-card-bg)"
              : "0.375rem solid var(--o2-card-bg)"
            : "none",
        // Conditional width when focused (expand-on-focus active)
        width: isFocused.value
          ? store.state.isAiChatEnabled
            ? "calc(75% - 104px)" // AI chat enabled: 75% minus nav width
            : "calc(100% - 104px)" // AI chat disabled: full width minus nav
          : undefined,
      };
    });
    const editorWidthToggleFunction = computed(() => {
      const isDarkMode = store.state.theme === "dark";

      if (!searchObj.data.transformType === "function" && isFocused.value) {
        return {
          width: `calc(100 - ${searchObj.config.fnSplitterModel})%`,
          borderBottom: isDarkMode ? "2px solid #575A5A" : "2px solid #E0E0E0",
        };
      } else {
        return {
          width: "100%",
          borderBottom: "none",
        };
      }
    });
    const { traceIdRef, cancelQuery: cancelVisualizeQuery } = useCancelQuery();

    const cancelVisualizeQueries = () => {
      // Filter out the dummy id before sending to backend cancel API
      traceIdRef.value = visualizeSearchRequestTraceIds.value.filter(
        (id: any) => id !== "fieldExtraction",
      );

      cancelVisualizeQuery();
    };

    const disable = ref(false);

    watch(variablesAndPanelsDataLoadingState, () => {
      const panelsValues = Object.values(
        variablesAndPanelsDataLoadingState?.panels,
      );
      disable.value = panelsValues.some((item: any) => item === true);
    });

    const iconRight = computed(() => {
      return (
        "img:" +
        getImageURL(
          store.state.theme === "dark"
            ? "images/common/function_dark.svg"
            : "images/common/function.svg",
        )
      );
    });
    const functionToggleIcon = computed(() => {
      return (
        "img:" +
        getImageURL(
          searchObj.data.transformType === "function"
            ? "images/common/function_dark.svg"
            : "images/common/function.svg",
        )
      );
    });
    const createScheduleJob = () => {
      searchSchedulerJob.value = true;
      searchObj.meta.jobRecords = 100;
    };

    const checkQuery = (query) => {
      const jobQuery = router.currentRoute.value.query.query;
      if (jobQuery == b64EncodeUnicode(query)) {
        return true;
      }
      return false;
    };
    const checkFnQuery = (fnQuery) => {
      const jobFnQuery = router.currentRoute.value.query.functionContent;
      if (jobFnQuery == b64EncodeUnicode(fnQuery)) {
        return true;
      }
      return false;
    };

    const updateTransforms = () => {
      updateEditorWidth();
    };

    const selectTransform = (item: any, isSelected: boolean) => {
      if (searchObj.data.transformType === "function") {
        populateFunctionImplementation(item, isSelected);
      }

      // If action is selected notify the user
      if (searchObj.data.transformType === "action") {
        updateActionSelection(item);
      }

      if (typeof item === "object")
        searchObj.data.selectedTransform = {
          ...item,
          type: searchObj.data.transformType,
        };
    };

    const updateActionSelection = (item: any) => {
      $q.notify({
        message: `${item?.name} action applied successfully`,
        timeout: 3000,
        color: "secondary",
      });
    };

    const updateEditorWidth = () => {
      if (searchObj.data.transformType) {
        if (searchObj.meta.showTransformEditor) {
          searchObj.config.fnSplitterModel = 60;
        } else {
          searchObj.config.fnSplitterModel = 100;
        }
      } else {
        searchObj.config.fnSplitterModel = 100;
      }
    };
    //so if it is active we need light this is fixed
    //if it is inactive we will be having 2 conditions
    //1. if dark mode show light color
    //2.if light mode show dark color
    const visualizeIcon = computed(() => {
      return searchObj.meta.logsVisualizeToggle === "visualize"
        ? getImageURL("images/common/visualize_icon_light.svg")
        : store.state.theme == "dark"
          ? getImageURL("images/common/visualize_icon_light.svg")
          : getImageURL("images/common/visualize_icon_dark.svg");
    });
    const histogramIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/bar_chart_histogram_light.svg")
        : getImageURL("images/common/bar_chart_histogram.svg");
    });
    const sqlIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/hugeicons_sql_light.svg")
        : getImageURL("images/common/hugeicons_sql.svg");
    });
    const quickModeIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/quick_mode_light.svg")
        : getImageURL("images/common/quick_mode.svg");
    });
    const searchHistoryIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/search_history_light.svg")
        : getImageURL("images/common/search_history.svg");
    });
    const downloadTableIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/download_table_light.svg")
        : getImageURL("images/common/download_table.svg");
    });
    const customRangeIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/custom_range_light.svg")
        : getImageURL("images/common/custom_range.svg");
    });
    const createScheduledSearchIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/create_scheduled_search_light.svg")
        : getImageURL("images/common/create_scheduled_search.svg");
    });
    const listScheduledSearchIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/list_scheduled_search_light.svg")
        : getImageURL("images/common/list_scheduled_search.svg");
    });

    // [END] cancel running queries

    // [START] explain query functionality
    const openExplainDialog = () => {
      if (searchObj.data.query && searchObj.data.query.trim() !== "") {
        showExplainDialog.value = true;
      }
    };
    // [END] explain query functionality

    return {
      $q,
      t,
      store,
      router,
      fnEditorRef,
      searchObj,
      queryEditorRef,
      syntaxGuideRef,
      confirmDialogVisible,
      confirmCallback,
      refreshTimes: searchObj.config.refreshTimes,
      refreshTimeChange,
      updateQueryValue,
      updateDateTime,
      showConfirmDialog,
      showSavedViewConfirmDialog,
      cancelConfirmDialog,
      confirmDialogOK,
      updateQuery,
      downloadLogs,
      saveFunction,
      resetFunctionContent,
      resetEditorLayout,
      populateFunctionImplementation,
      functionModel,
      functionOptions,
      filterFn,
      refreshData,
      handleRunQuery,
      handleRunQueryFn,
      autoCompleteKeywords,
      autoCompleteSuggestions,
      effectiveKeywords,
      effectiveSuggestions,
      onRefreshIntervalUpdate,
      updateTimezone,
      dateTimeRef,
      fnSavedView,
      openSavedViewsList,
      applySavedView,
      isSavedViewAction,
      savedViewName,
      savedViewSelectedName,
      handleSavedView,
      deleteSavedViews,
      deleteViewID,
      confirmDelete,
      saveViewLoader,
      savedViewDropdownModel,
      savedViewsListDialog,
      moreOptionsDropdownModel,
      fnSavedFunctionDialog,
      isSavedFunctionAction,
      savedFunctionName,
      savedFunctionSelectedName,
      saveFunctionLoader,
      shareURL,
      showSearchHistoryfn,
      getImageURL,
      resetFilters,
      customDownloadDialog,
      buildSearch,
      confirmSavedViewDialogVisible,
      rowsPerPage,
      handleFavoriteSavedView,
      favoriteViews,
      localSavedViews,
      loadSavedView,
      filterSavedViewFn,
      config,
      handleRegionsSelection,
      handleQuickMode,
      handleHistogramMode,
      regionFilterMethod,
      regionFilterRef,
      regionFilter,
      resetRegionFilter,
      cancelQuery,
      onLogsVisualizeToggleUpdate,
      onBuildModeToggle,
      confirmBuildModeChange,
      confirmBuildModeChangeOk,
      visualizeSearchRequestTraceIds,
      disable,
      cancelVisualizeQueries,
      isFocused,
      backgroundColorStyle,
      editorWidthToggleFunction,
      fnParsedSQL,
      fnUnparsedSQL,
      iconRight,
      functionToggleIcon,
      searchSchedulerJob,
      autoSearchSchedulerJob,
      routeToSearchSchedule,
      createScheduleJob,
      searchInspectDialog,
      searchTerm,
      filteredActionOptions,
      filteredFunctionOptions,
      confirmUpdate,
      updateViewObj,
      updateSavedViews,
      checkQuery,
      checkFnQuery,
      transformsExpandState,
      transformsLabel,
      transformIcon,
      transformTypes,
      filteredTransformOptions,
      updateTransforms,
      selectTransform,
      actionEditorQuery,
      isActionsEnabled,
      showFunctionEditor,
      isVrlEditorDisabled,
      closeSocketWithError,
      histogram_svg,
      visualizeIcon,
      histogramIcon,
      sqlIcon,
      quickModeIcon,
      searchHistoryIcon,
      downloadTableIcon,
      customRangeIcon,
      createScheduledSearchIcon,
      listScheduledSearchIcon,
      getColumnNames,
      getSearchObj,
      toggleHistogram,
      createSavedViews,
      showDownloadMenu,
      // Expose additional functions for testing
      updateAutoComplete,
      handleEscKey,
      applyAction,
      getFieldList,
      buildStreamQuery,
      updateActionSelection,
      updateEditorWidth,
      showExplainDialog,
      openExplainDialog,
      isNaturalLanguageDetected,
      isGeneratingSQL,
      vrlEditorNlpMode,
      shouldMoveSavedViewToMenu,
      shouldMoveSqlToggleToMenu,
      shouldMoveShareToMenu,
      toggleLiveMode,
    };
  },
  computed: {
    isVisualizeDisabled() {
      return (
        !this.searchObj.meta.sqlMode &&
        this.searchObj.data.stream.selectedStream.length > 1
      );
    },
    isSqlModeDisabled() {
      return (
        this.searchObj.meta.logsVisualizeToggle === "visualize" &&
        this.searchObj.data.stream.selectedStream.length > 1
      );
    },
    addSearchTerm() {
      return this.searchObj.data.stream.addToFilter;
    },
    removeFieldTerm() {
      return this.searchObj.data.stream.removeFilterField;
    },
    toggleTransformEditor() {
      return this.searchObj.meta.showTransformEditor;
    },
    confirmMessage() {
      return "Are you sure you want to update the function?";
    },
    confirmMessageSavedView() {
      return "Are you sure you want to update the saved view?";
    },
    resetFunction() {
      return this.searchObj.data.tempFunctionName;
    },
    resetFunctionDefinition() {
      return this.searchObj.data.tempFunctionContent;
    },
  },
  watch: {
    addSearchTerm() {
      if (this.searchObj.data.stream.addToFilter != "") {
        let currentQuery = this.searchObj.data.query.split("|");
        if (currentQuery.length > 1) {
          if (currentQuery[1].trim() != "") {
            currentQuery[1] += " and " + filter;
          } else {
            currentQuery[1] = filter;
          }
          this.searchObj.data.query = currentQuery.join("| ");
          this.searchObj.data.editorValue = this.searchObj.data.query;
        } else {
          let unionType: string = "";
          if (
            currentQuery[0]
              .replace("union all", "UNION ALL")
              .includes("UNION ALL")
          ) {
            unionType = "UNION ALL";
          } else if (
            currentQuery[0].replace("union", "UNION").includes("UNION")
          ) {
            unionType = "UNION";
          }

          // Use regular expression to match "UNION" or "UNION ALL" (case insensitive)
          const unionRegex = /\bUNION ALL\b|\bUNION\b/i;

          // Split the string by "UNION" or "UNION ALL" if they are present
          const queries = currentQuery[0].split(unionRegex);

          // Iterate over each part
          queries.forEach((query, index) => {
            let filter = this.searchObj.data.stream.addToFilter;

            const isFilterValueNull = filter.split(/=|!=/)[1] === "'null'";

            if (isFilterValueNull) {
              filter = filter
                .replace(/=|!=/, (match) => {
                  return match === "=" ? " is " : " is not ";
                })
                .replace(/'null'/, "null");
            }

            if (this.searchObj.meta.sqlMode == true) {
              if (
                unionType == "" &&
                this.searchObj.data.stream.selectedStream.length > 1
              ) {
                const parsedSQL = this.fnParsedSQL();
                const streamPrefix: string =
                  parsedSQL.from[0].as != null
                    ? parsedSQL.from[0].as
                    : parsedSQL.from[0].table;
                filter = `"${streamPrefix}".${filter}`;
              }

              // if query contains order by clause or limit clause then add where clause before that
              // if query contains where clause then add filter after that with and operator and keep order by or limit after that
              // if query does not contain where clause then add where clause before filter
              if (query.toLowerCase().includes("where")) {
                // Replace an existing condition for this field, or append if none.
                const fieldNameSQL = getFieldFromExpression(filter);
                if (fieldNameSQL && hasFieldCondition(query, fieldNameSQL)) {
                  query = replaceExistingFieldCondition(
                    query,
                    fieldNameSQL,
                    filter,
                  );
                } else {
                  // Find the earliest clause that ends the WHERE conditions.
                  // Standard SQL clause order: WHERE ? GROUP BY ? HAVING ? ORDER BY ? LIMIT.
                  // We must insert the new filter before whichever comes first so it
                  // stays inside the WHERE clause rather than after GROUP BY / ORDER BY.
                  const terminatingClauses = [
                    "group by",
                    "having",
                    "order by",
                    "limit",
                  ];
                  const lowerQuery = query.toLowerCase();
                  let firstClause: string | null = null;
                  let firstIndex = Infinity;
                  for (const clause of terminatingClauses) {
                    const idx = lowerQuery.indexOf(clause);
                    if (idx !== -1 && idx < firstIndex) {
                      firstIndex = idx;
                      firstClause = clause;
                    }
                  }
                  if (firstClause) {
                    const [beforeClause, afterClause] = queryIndexSplit(
                      query,
                      firstClause,
                    );
                    query =
                      beforeClause.trim() +
                      " AND " +
                      filter +
                      " " +
                      firstClause +
                      afterClause;
                  } else {
                    query = query + " AND " + filter;
                  }
                }
              } else {
                // Find the earliest clause to insert WHERE before.
                // SQL clause order: FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT
                const terminatingClauses = [
                  "group by",
                  "having",
                  "order by",
                  "limit",
                ];
                const lowerQuery = query.toLowerCase();
                let firstClause: string | null = null;
                let firstIndex = Infinity;
                for (const clause of terminatingClauses) {
                  const idx = lowerQuery.indexOf(clause);
                  if (idx !== -1 && idx < firstIndex) {
                    firstIndex = idx;
                    firstClause = clause;
                  }
                }
                if (firstClause) {
                  const [beforeClause, afterClause] = queryIndexSplit(
                    query,
                    firstClause,
                  );
                  query =
                    beforeClause.trim() +
                    " where " +
                    filter +
                    " " +
                    firstClause +
                    afterClause;
                } else {
                  query = query + " where " + filter;
                }
              }
              currentQuery[0] = query;
            } else {
              const fieldName = getFieldFromExpression(filter);
              if (fieldName && hasFieldCondition(currentQuery[0], fieldName)) {
                currentQuery[0] = replaceExistingFieldCondition(
                  currentQuery[0],
                  fieldName,
                  filter,
                );
              } else {
                currentQuery[0].length == 0
                  ? (currentQuery[0] = filter)
                  : (currentQuery[0] += " and " + filter);
              }
            }

            // this.searchObj.data.query = currentQuery[0];
            queries[index] = currentQuery[0];
          });

          if (unionType == "") {
            this.searchObj.data.query = queries.join("");
          } else {
            this.searchObj.data.query = queries.join(` ${unionType} `);
          }
          this.searchObj.data.editorValue = this.searchObj.data.query;
          this.searchObj.data.stream.addToFilter = "";
          if (this.queryEditorRef?.setValue)
            this.queryEditorRef.setValue(this.searchObj.data.query);
          if (
            this.store.state.zoConfig.auto_query_enabled &&
            this.searchObj.meta.liveMode
          ) {
            this.$emit("searchdata");
          }
        }
      }
    },
    removeFieldTerm(fieldName: string) {
      if (!fieldName) return;
      let newValue: string;
      if (this.searchObj.meta.sqlMode) {
        try {
          const parsed = this.fnParsedSQL();
          if (parsed?.where) {
            const newWhere = removeFieldFromWhereAST(parsed.where, fieldName);
            newValue = this.fnUnparsedSQL({
              ...parsed,
              where: newWhere,
            }).replaceAll("`", '"');
          } else {
            newValue = this.searchObj.data.editorValue;
          }
        } catch (e) {
          console.log("Error removing field condition from SQL:", e);
          newValue = removeFieldCondition(
            this.searchObj.data.editorValue,
            fieldName,
          );
        }
      } else {
        newValue = removeFieldCondition(
          this.searchObj.data.editorValue,
          fieldName,
        );
      }
      this.searchObj.data.editorValue = newValue;
      this.searchObj.data.query = newValue;
      this.searchObj.data.stream.removeFilterField = "";
      if (this.queryEditorRef?.setValue) this.queryEditorRef.setValue(newValue);
      if (
        this.store.state.zoConfig.auto_query_enabled &&
        this.searchObj.meta.liveMode
      ) {
        this.$emit("searchdata");
      }
    },
    toggleTransformEditor(newVal) {
      if (newVal == false) {
        this.searchObj.config.fnSplitterModel = 100;
      } else {
        this.searchObj.config.fnSplitterModel = 60;
      }

      this.resetEditorLayout();
    },
    resetFunction(newVal) {
      if (newVal == "" && store && !store?.state?.savedViewFlag) {
        this.resetFunctionContent();
        if (
          this.store.state.zoConfig?.auto_query_enabled &&
          this.searchObj.meta.liveMode
        ) {
          this.$emit("searchdata");
        }
      }
    },
    resetFunctionDefinition(newVal) {
      if (newVal == "") this.resetFunctionContent();
    },
  },
});
</script>

<style scoped lang="scss">
.expand-on-focus {
  position: fixed !important;
  height: calc(100vh - 12.5rem) !important;
  z-index: 20 !important;
  /* Width is now handled dynamically via backgroundColorStyle computed property */
}

.file-type label {
  transform: translate(-0.75rem, -175%);
  font-weight: bold;
  font-size: 0.875rem; // 14px
  color: var(--o2-text-secondary);
}
.q-dark .q-btn {
  font-weight: 600;
  border: 0 solid rgba(255, 255, 255, 0.2);
}
.q-dark .file-type label,
.q-dark .file-type .q-btn {
  color: var(--o2-text-secondary);
}

// Toolbar Icon and Toggle Styles
.toolbar-toggle-container {
  padding: 0 0.175rem; // 0 ~2.8px
  margin-left: 0.25rem; // 8px
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0.0625rem solid var(--color-button-outline-border); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  cursor: pointer;

  &:hover {
    background-color: var(--o2-hover-accent);
  }
}

.dark-theme .toolbar-toggle-container {
  border: 0.0625rem solid var(--color-button-outline-border);
}

.toolbar-icon {
  width: 1rem; // 16px
  height: 1rem; // 16px
  object-fit: contain;
}

.q-dark .toolbar-icon {
  filter: invert(1);
}

.toolbar-icon-in-toggle {
  font-size: 0.9rem; // ~14.4px
}

.syntax-guide-in-menu {
  :deep(.q-btn) {
    border: none !important;
    margin-left: 0 !important;

    &:hover {
      background-color: transparent !important;
    }

    &::before {
      display: none !important;
    }
  }
}

.syntax-guide-menu-item {
  :deep(.q-btn) {
    padding: 0 !important;
    min-height: unset !important;
    border: none !important;
    margin: 0 !important;
    font-size: inherit !important;
    font-weight: inherit !important;

    .q-icon {
      font-size: 1.25rem; // match q-icon size="xs" used by other items
    }

    .q-btn__content {
      gap: 0.5rem; // match tw:gap-2
    }

    &:hover {
      background-color: transparent !important;
    }

    &::before {
      display: none !important;
    }
  }
}

.toolbar-reset-btn {
  padding: 0.25rem 0.375rem; // 4px 6px
  margin-left: 0.25rem; // 8px
  border: 0.0625rem solid var(--o2-border-color); // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  min-height: 1.875rem; // 30px

  .q-icon {
    font-size: 1.215rem; // 16px
  }

  &:hover {
    background-color: var(--o2-hover-accent);
  }

  &.theme-dark {
    border-color: var(--o2-border-color) !important;
  }
}

.q-dark .toolbar-reset-btn,
.dark-theme .toolbar-reset-btn {
  border-color: var(--o2-border-color);
}

.group-menu-btn {
  padding: 0.25rem 0.25rem !important; // 4px 8px
  margin-left: 0.25rem; // 8px
  border: 0.0625rem solid var(--color-button-outline-border) !important; // 1px
  border-radius: 0.375rem; // 6px
  transition: all 0.2s ease;
  min-height: 1.875rem !important; // 30px
  font-size: 0.75rem; // 12px
  font-weight: 500;

  .q-icon {
    font-size: 1.125rem; // 18px
  }

  &:hover {
    background-color: var(--o2-hover-accent);
  }
}

.dark-theme .group-menu-btn,
.q-dark .group-menu-btn {
  border: 0.0625rem solid var(--color-button-outline-border) !important;
}
.o2-run-query-button {
  font-size: 11px;
  font-weight: 500 !important;
  line-height: 16px !important;
  padding: 0px 0px !important;
  width: 94px !important;
  transition:
    box-shadow 0.3s ease,
    opacity 0.2s ease;
  /* subtle default glow */
  // box-shadow: 0 0 8px color-mix(in srgb, var(--o2-primary-btn-bg), transparent 60%);
}
.o2-color-primary {
  background-color: var(--o2-primary-btn-bg);
  color: var(--o2-primary-btn-text);
  &:hover {
    opacity: 0.9;
    box-shadow: 0 0 8px
      color-mix(in srgb, var(--o2-primary-btn-bg), transparent 30%);
  }
}
.search-button-enterprise-border-radius {
  border-radius: 0.375rem 0px 0px 0.375rem !important;
}
.search-button-normal-border-radius {
  border-radius: 0.375rem;
}
.search-button-dropdown-enterprise-border-radius {
  border-radius: 0px 0.375rem 0.375rem 0px !important;
}

.o2-color-cancel {
  background-color: #f67a7a;
  color: var(--o2-primary-btn-text);
}

.logs-search-splitter {
  :deep(.q-splitter__separator) {
    height: 100%;
  }
}

.query-mode-toggle {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--o2-muted-background);
  padding: 2px 4px;
  border-radius: 0.375rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  border: 0.0625rem solid var(--o2-border-color);

  .mode-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--o2-text-secondary);
  }
}

// Dark mode support (both .dark-theme and .q-dark selectors)
.dark-theme .query-mode-toggle,
.q-dark .query-mode-toggle {
  background: #1e1e1e;
  border-color: #3a3a3a;

  .mode-label {
    color: rgba(255, 255, 255, 0.7);
  }
}
</style>
